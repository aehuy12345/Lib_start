import { createBorrowService, BOOK_GONE, ORDER_NOT_FOUND, NOT_CANCELLABLE, CREATED } from '../../src/modules/borrow/borrow.service';
import { INELIGIBLE } from '../../src/modules/borrow/borrow.rules';
import { createBorrowSchema, INVALID_DAYS } from '../../src/modules/borrow/borrow.validation';

describe('createBorrowSchema (2.3.1)', () => {
  it('bỏ trống thời hạn → 14 ngày; chuỗi số được chuyển', () => {
    expect(createBorrowSchema.validate({ bookId: 7 }).value).toEqual({ bookId: 7, requestedDays: 14 });
    expect(createBorrowSchema.validate({ bookId: '7', requestedDays: '30' }).value).toEqual({ bookId: 7, requestedDays: 30 });
  });

  it.each([1, 14, 30])('%i ngày hợp lệ', (requestedDays) => {
    expect(createBorrowSchema.validate({ bookId: 7, requestedDays }).error).toBeUndefined();
  });

  it.each([0, -1, 31, 1.5, 'abc', null])('edge 2: %j ngày → lỗi', (requestedDays) => {
    const { error } = createBorrowSchema.validate({ bookId: 7, requestedDays });
    expect(error.details[0]).toMatchObject({ path: ['requestedDays'], message: INVALID_DAYS });
  });

  it.each([undefined, 0, 'x', 1.5])('bookId %j → lỗi', (bookId) => {
    expect(createBorrowSchema.validate({ bookId }).error.details[0].path).toEqual(['bookId']);
  });
});

// 2026-10-24 17:30 UTC = ngày 25/10 theo giờ Việt Nam.
const NOW = new Date('2026-10-24T17:30:00Z');
const CREATED_ROW = { id: 50, readerId: 1, bookId: 7, status: 'pending', requestedDays: 20, createdAt: NOW, borrowedAt: null };

function makeService({ book = { availableQuantity: 2 }, counts = {}, sameBook = null, createError } = {}) {
  const calls = [];
  const tx = {
    $queryRaw: vi.fn(async (strings) => {
      const sql = strings.join('?');
      calls.push(sql);
      if (sql.includes('FROM users')) return [{ id: 1 }];
      return book ? [book] : [];
    }),
    borrowOrder: {
      count: vi.fn(async ({ where }) => (where.dueDate ? counts.overdue ?? 0 : counts.active ?? 0)),
      findFirst: vi.fn(async () => sameBook),
      create: vi.fn(async () => {
        if (createError) throw createError;
        return CREATED_ROW;
      }),
    },
    fineTicket: { count: vi.fn(async () => counts.fines ?? 0) },
  };
  const prisma = {
    $transaction: vi.fn(async (fn) => fn(tx)),
    borrowOrder: { updateMany: vi.fn(async () => ({ count: 1 })), findFirst: vi.fn(async () => null) },
  };
  return { service: createBorrowService({ prisma, now: () => NOW }), prisma, tx, calls };
}

describe('borrowService.createBorrowOrder (2.3.1)', () => {
  it('đủ điều kiện → tạo đơn Chờ xác nhận với thời hạn yêu cầu, không trừ kho', async () => {
    const { service, tx } = makeService({ counts: { active: 4 } });
    const result = await service.createBorrowOrder(1, { bookId: 7, requestedDays: 20 });
    expect(result).toEqual({
      message: CREATED,
      order: { id: 50, bookId: 7, status: 'pending', requestedDays: 20, createdAt: NOW },
    });
    expect(tx.borrowOrder.create).toHaveBeenCalledWith({ data: { readerId: 1, bookId: 7, requestedDays: 20 } });
    // Không có câu lệnh nào cập nhật sách.
    expect(tx.book).toBeUndefined();
  });

  it('edge 3: khóa dòng độc giả FOR UPDATE trước, rồi sách FOR SHARE (chặn xóa sách 2.2.5)', async () => {
    const { service, calls, tx } = makeService();
    await service.createBorrowOrder(1, { bookId: 7, requestedDays: 14 });
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatch(/FROM users WHERE id = \? FOR UPDATE/);
    expect(calls[1]).toMatch(/FROM books WHERE id = \? AND deleted_at IS NULL FOR SHARE/);
    expect(tx.$queryRaw.mock.calls[0].slice(1)).toEqual([1]);
    expect(tx.$queryRaw.mock.calls[1].slice(1)).toEqual([7]);
  });

  it('kiểm tra điều kiện trong transaction: đơn chờ + đang mượn, phiếu chưa paid, quá hạn theo ngày VN', async () => {
    const { service, tx } = makeService();
    await service.createBorrowOrder(1, { bookId: 7, requestedDays: 14 });
    const wheres = tx.borrowOrder.count.mock.calls.map(([arg]) => arg.where);
    expect(wheres).toContainEqual({ readerId: 1, status: { in: ['pending', 'borrowing'] } });
    expect(wheres).toContainEqual({ readerId: 1, status: 'borrowing', dueDate: { lt: new Date('2026-10-25T00:00:00Z') } });
    expect(tx.borrowOrder.findFirst.mock.calls[0][0].where).toEqual({ readerId: 1, status: { in: ['pending', 'borrowing'] }, bookId: 7 });
    expect(tx.fineTicket.count).toHaveBeenCalledWith({ where: { readerId: 1, status: { not: 'paid' } } });
  });

  it('sách không tồn tại hoặc đã xóa → 404', async () => {
    const { service, tx } = makeService({ book: null });
    await expect(service.createBorrowOrder(1, { bookId: 7, requestedDays: 14 }))
      .rejects.toMatchObject({ status: 404, message: BOOK_GONE, reason: 'book_gone' });
    expect(tx.borrowOrder.create).not.toHaveBeenCalled();
  });

  it.each([
    ['out_of_stock', { book: { availableQuantity: 0 } }],
    ['limit_reached', { counts: { active: 5 } }],
    ['unpaid_fine', { counts: { fines: 1 } }],
    ['overdue', { counts: { overdue: 1 } }],
    ['already_requested', { sameBook: { id: 3, status: 'pending' }, counts: { active: 1 } }],
  ])('%s → 409 kèm lý do, không tạo đơn', async (reason, opts) => {
    const { service, tx } = makeService(opts);
    await expect(service.createBorrowOrder(1, { bookId: 7, requestedDays: 14 }))
      .rejects.toMatchObject({ status: 409, reason, message: INELIGIBLE[reason] });
    expect(tx.borrowOrder.create).not.toHaveBeenCalled();
  });

  it('edge 5: đơn cũ cùng sách đã trả/bị từ chối/đã hủy không chặn (chỉ tìm đơn chờ + đang mượn)', async () => {
    const { service, tx } = makeService({ sameBook: null });
    await service.createBorrowOrder(1, { bookId: 7, requestedDays: 14 });
    expect(tx.borrowOrder.create).toHaveBeenCalled();
  });

  it('vi phạm UNIQUE đơn hoạt động (P2002) → 409 already_requested', async () => {
    const { service } = makeService({ createError: Object.assign(new Error('dup'), { code: 'P2002' }) });
    await expect(service.createBorrowOrder(1, { bookId: 7, requestedDays: 14 }))
      .rejects.toMatchObject({ status: 409, reason: 'already_requested' });
  });

  it('lỗi khác giữ nguyên', async () => {
    const boom = new Error('db down');
    const { service } = makeService({ createError: boom });
    await expect(service.createBorrowOrder(1, { bookId: 7, requestedDays: 14 })).rejects.toBe(boom);
  });
});

describe('borrowService.cancelBorrowOrder (2.3.1 đề xuất)', () => {
  it('chỉ hủy đơn của chính mình khi còn Chờ xác nhận', async () => {
    const { service, prisma } = makeService();
    await service.cancelBorrowOrder(1, 50);
    expect(prisma.borrowOrder.updateMany).toHaveBeenCalledWith({
      where: { id: 50, readerId: 1, status: 'pending' },
      data: { status: 'cancelled', cancelledAt: NOW },
    });
  });

  it('đơn đã được xử lý (không còn chờ) → 409', async () => {
    const { service, prisma } = makeService();
    prisma.borrowOrder.updateMany.mockResolvedValue({ count: 0 });
    prisma.borrowOrder.findFirst.mockResolvedValue({ id: 50 });
    await expect(service.cancelBorrowOrder(1, 50)).rejects.toMatchObject({ status: 409, message: NOT_CANCELLABLE });
    expect(prisma.borrowOrder.findFirst).toHaveBeenCalledWith({ where: { id: 50, readerId: 1 }, select: { id: true } });
  });

  it('không có hoặc là đơn của người khác → 404', async () => {
    const { service, prisma } = makeService();
    prisma.borrowOrder.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.cancelBorrowOrder(1, 50)).rejects.toMatchObject({ status: 404, message: ORDER_NOT_FOUND });
  });
});
