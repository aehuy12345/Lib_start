import { createBorrowService, ORDER_NOT_FOUND, ALREADY_PROCESSED, CONFIRMED, REJECTED } from '../../src/modules/borrow/borrow.service';
import { CONFIRM_BLOCKED, evaluateConfirmEligibility, addDays } from '../../src/modules/borrow/borrow.rules';
import {
  rejectBorrowSchema, pendingQuerySchema, REASON_REQUIRED, REASON_TOO_LONG,
} from '../../src/modules/borrow/borrow.validation';

// 2026-10-24 17:30 UTC = ngày 25/10 theo giờ Việt Nam.
const NOW = new Date('2026-10-24T17:30:00Z');

describe('evaluateConfirmEligibility (2.3.2)', () => {
  const OK = { availableQuantity: 1, readerStatus: 'active', activeCount: 1, unpaidFineCount: 0, overdueCount: 0 };

  it('đủ điều kiện → null', () => {
    expect(evaluateConfirmEligibility(OK)).toBeNull();
  });

  it('activeCount gồm chính đơn đang duyệt: 5 vẫn xác nhận được, 6 thì chặn', () => {
    expect(evaluateConfirmEligibility({ ...OK, activeCount: 5 })).toBeNull();
    expect(evaluateConfirmEligibility({ ...OK, activeCount: 6 })).toBe('limit_reached');
  });

  it.each([
    ['out_of_stock', { availableQuantity: 0 }],
    ['reader_inactive', { readerStatus: 'inactive' }],
    ['reader_inactive', { readerStatus: 'pending' }],
    ['unpaid_fine', { unpaidFineCount: 1 }],
    ['overdue', { overdueCount: 2 }],
  ])('%s', (reason, patch) => {
    expect(evaluateConfirmEligibility({ ...OK, ...patch })).toBe(reason);
    expect(CONFIRM_BLOCKED[reason]).toMatch(/chỉ có thể từ chối/);
  });

  it('edge 2: hết sách được kiểm tra trước các điều kiện của độc giả', () => {
    expect(evaluateConfirmEligibility({ ...OK, availableQuantity: 0, readerStatus: 'inactive', unpaidFineCount: 1 }))
      .toBe('out_of_stock');
  });
});

describe('addDays', () => {
  it('cộng theo lịch, qua tháng, năm và năm nhuận', () => {
    expect(addDays('2026-10-25', 14)).toBe('2026-11-08');
    expect(addDays('2028-02-20', 10)).toBe('2028-03-01');
    expect(addDays('2026-12-25', 30)).toBe('2027-01-24');
  });
});

describe('rejectBorrowSchema (2.3.2 edge 3)', () => {
  it('trim lý do', () => {
    expect(rejectBorrowSchema.validate({ reason: '  Hết sách  ' }).value).toEqual({ reason: 'Hết sách' });
  });

  it.each([undefined, null, '', '    ', 12])('%j → bắt buộc', (reason) => {
    expect(rejectBorrowSchema.validate({ reason }).error.details[0].message).toBe(REASON_REQUIRED);
  });

  it('500 ký tự hợp lệ, 501 → quá dài', () => {
    expect(rejectBorrowSchema.validate({ reason: 'a'.repeat(500) }).error).toBeUndefined();
    expect(rejectBorrowSchema.validate({ reason: 'a'.repeat(501) }).error.details[0].message).toBe(REASON_TOO_LONG);
  });

  it('pendingQuerySchema: trang sai → 1', () => {
    expect(pendingQuerySchema.validate({ page: 'x' }).value).toEqual({ page: 1 });
    expect(pendingQuerySchema.validate({}).value).toEqual({ page: 1 });
  });
});

const ORDER = { readerId: 1, bookId: 7, status: 'pending', requestedDays: 14 };

function makeService({ order = ORDER, reader = { status: 'active' }, book = { availableQuantity: 2 }, counts = {} } = {}) {
  const calls = [];
  const tx = {
    $queryRaw: vi.fn(async (strings) => {
      const sql = strings.join('?');
      calls.push(sql);
      if (sql.includes('FROM borrow_orders')) return order ? [order] : [];
      if (sql.includes('FROM users')) return [reader];
      return [book];
    }),
    borrowOrder: {
      count: vi.fn(async ({ where }) => (where.dueDate ? counts.overdue ?? 0 : counts.active ?? 1)),
      update: vi.fn(async ({ data }) => ({ id: 50, bookId: 7, requestedDays: 14, createdAt: NOW, ...data })),
    },
    fineTicket: { count: vi.fn(async () => counts.fines ?? 0) },
    book: { update: vi.fn(async () => ({})) },
  };
  const prisma = {
    $transaction: vi.fn(async (fn) => fn(tx)),
    borrowOrder: {
      count: vi.fn(async () => 0),
      findMany: vi.fn(async () => []),
      updateMany: vi.fn(async () => ({ count: 1 })),
      findUnique: vi.fn(async () => null),
    },
  };
  return { service: createBorrowService({ prisma, now: () => NOW }), prisma, tx, calls };
}

describe('borrowService.confirmBorrowOrder (2.3.2)', () => {
  it('đổi sang Đang mượn, hạn trả = ngày VN + thời hạn, trừ kho trong cùng transaction', async () => {
    const { service, tx, prisma } = makeService();
    const result = await service.confirmBorrowOrder(2, 50);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.book.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { availableQuantity: { decrement: 1 }, borrowedQuantity: { increment: 1 }, borrowCount: { increment: 1 } },
    });
    expect(tx.borrowOrder.update).toHaveBeenCalledWith({
      where: { id: 50 },
      data: {
        status: 'borrowing', processedById: 2, processedAt: NOW, borrowedAt: NOW,
        dueDate: new Date('2026-11-08T00:00:00Z'),
      },
    });
    expect(result).toEqual({
      message: CONFIRMED,
      order: { id: 50, bookId: 7, status: 'borrowing', requestedDays: 14, createdAt: NOW, borrowedAt: NOW, dueDate: '2026-11-08' },
    });
  });

  it('không tăng version của sách (chỉ nhân viên sửa sách mới tăng)', async () => {
    const { service, tx } = makeService();
    await service.confirmBorrowOrder(2, 50);
    expect(tx.book.update.mock.calls[0][0].data).not.toHaveProperty('version');
  });

  it('edge 1: khóa đơn FOR UPDATE, rồi độc giả FOR SHARE, rồi sách FOR UPDATE', async () => {
    const { service, calls, tx } = makeService();
    await service.confirmBorrowOrder(2, 50);
    expect(calls[0]).toMatch(/FROM borrow_orders WHERE id = \? FOR UPDATE/);
    expect(calls[1]).toMatch(/FROM users WHERE id = \? FOR SHARE/);
    expect(calls[2]).toMatch(/FROM books WHERE id = \? FOR UPDATE/);
    expect(tx.$queryRaw.mock.calls.map((c) => c.slice(1))).toEqual([[50], [1], [7]]);
  });

  it('kiểm tra điều kiện của độc giả của đơn (không phải nhân viên)', async () => {
    const { service, tx } = makeService();
    await service.confirmBorrowOrder(2, 50);
    expect(tx.fineTicket.count).toHaveBeenCalledWith({ where: { readerId: 1, status: { not: 'paid' } } });
  });

  it('không có đơn → 404', async () => {
    const { service, tx } = makeService({ order: null });
    await expect(service.confirmBorrowOrder(2, 50)).rejects.toMatchObject({ status: 404, message: ORDER_NOT_FOUND });
    expect(tx.book.update).not.toHaveBeenCalled();
  });

  it.each(['borrowing', 'rejected', 'cancelled', 'returned'])('edge 1: đơn đã %s → 409 already_processed', async (status) => {
    const { service, tx } = makeService({ order: { ...ORDER, status } });
    await expect(service.confirmBorrowOrder(2, 50))
      .rejects.toMatchObject({ status: 409, reason: 'already_processed', message: ALREADY_PROCESSED });
    expect(tx.book.update).not.toHaveBeenCalled();
    expect(tx.borrowOrder.update).not.toHaveBeenCalled();
  });

  it.each([
    ['out_of_stock', { book: { availableQuantity: 0 } }],
    ['reader_inactive', { reader: { status: 'inactive' } }],
    ['limit_reached', { counts: { active: 6 } }],
    ['unpaid_fine', { counts: { fines: 1 } }],
    ['overdue', { counts: { overdue: 1 } }],
  ])('%s → 409 kèm reason, không đổi đơn hay kho', async (reason, opts) => {
    const { service, tx } = makeService(opts);
    await expect(service.confirmBorrowOrder(2, 50))
      .rejects.toMatchObject({ status: 409, reason, message: CONFIRM_BLOCKED[reason] });
    expect(tx.book.update).not.toHaveBeenCalled();
    expect(tx.borrowOrder.update).not.toHaveBeenCalled();
  });

  it('edge 4: cập nhật đơn lỗi → lỗi lan ra để transaction rollback cả phần trừ kho', async () => {
    const { service, tx } = makeService();
    const boom = new Error('db down');
    tx.borrowOrder.update.mockRejectedValue(boom);
    await expect(service.confirmBorrowOrder(2, 50)).rejects.toBe(boom);
  });
});

describe('borrowService.rejectBorrowOrder (2.3.2)', () => {
  it('cập nhật có điều kiện status = pending, lưu lý do và người xử lý', async () => {
    const { service, prisma } = makeService();
    expect(await service.rejectBorrowOrder(2, 50, { reason: 'Hết sách' })).toEqual({ message: REJECTED });
    expect(prisma.borrowOrder.updateMany).toHaveBeenCalledWith({
      where: { id: 50, status: 'pending' },
      data: { status: 'rejected', rejectReason: 'Hết sách', processedById: 2, processedAt: NOW },
    });
  });

  it('edge 1: đơn đã được xử lý → 409 already_processed', async () => {
    const { service, prisma } = makeService();
    prisma.borrowOrder.updateMany.mockResolvedValue({ count: 0 });
    prisma.borrowOrder.findUnique.mockResolvedValue({ id: 50 });
    await expect(service.rejectBorrowOrder(2, 50, { reason: 'x' }))
      .rejects.toMatchObject({ status: 409, reason: 'already_processed' });
  });

  it('không có đơn → 404', async () => {
    const { service, prisma } = makeService();
    prisma.borrowOrder.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.rejectBorrowOrder(2, 50, { reason: 'x' })).rejects.toMatchObject({ status: 404 });
  });
});

describe('borrowService.listPendingOrders (2.3.2)', () => {
  it('chỉ đơn Chờ xác nhận, cũ nhất trước, 10 mỗi trang, kèm độc giả và SL sách có sẵn', async () => {
    const { service, prisma } = makeService();
    prisma.borrowOrder.count.mockResolvedValue(25);
    prisma.borrowOrder.findMany.mockResolvedValue([{
      id: 50, readerId: 1, bookId: 7, status: 'pending', requestedDays: 20, createdAt: NOW,
      reader: { id: 1, name: 'R', email: 'r@x.vn' },
      book: { id: 7, title: 'T', author: 'A', availableQuantity: 0 },
    }]);
    const result = await service.listPendingOrders({ page: 2 });
    expect(prisma.borrowOrder.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { status: 'pending' },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      skip: 10,
      take: 10,
    }));
    expect(result).toEqual({
      orders: [{
        id: 50, requestedDays: 20, createdAt: NOW,
        reader: { id: 1, name: 'R', email: 'r@x.vn' },
        book: { id: 7, title: 'T', author: 'A', availableQuantity: 0 },
      }],
      pagination: { page: 2, pageSize: 10, total: 25, totalPages: 3 },
    });
  });

  it('trang quá cuối → trang cuối; không có đơn → danh sách rỗng, không gọi findMany', async () => {
    const { service, prisma } = makeService();
    expect(await service.listPendingOrders({ page: 5 })).toEqual({
      orders: [], pagination: { page: 1, pageSize: 10, total: 0, totalPages: 1 },
    });
    expect(prisma.borrowOrder.findMany).not.toHaveBeenCalled();
    prisma.borrowOrder.count.mockResolvedValue(12);
    await service.listPendingOrders({ page: 9 });
    expect(prisma.borrowOrder.findMany.mock.calls[0][0].skip).toBe(10);
  });
});
