import request from 'supertest';
import { createApp } from '../../src/app';
import { createTokenService } from '../../src/lib/tokens';
import { HttpError } from '../../src/lib/httpError';
import { createBorrowService, ORDER_NOT_FOUND, EXTENDED } from '../../src/modules/borrow/borrow.service';
import {
  EXTEND_BLOCKED, diffDays, displayStatus, evaluateExtension,
} from '../../src/modules/borrow/borrow.rules';
import { historyQuerySchema } from '../../src/modules/borrow/borrow.validation';

// 2026-10-24 17:30 UTC = ngày 25/10 theo giờ Việt Nam (edge 4).
const NOW = new Date('2026-10-24T17:30:00Z');
const TODAY = '2026-10-25';
const date = (s) => new Date(`${s}T00:00:00Z`);

describe('Quy tắc 2.3.3', () => {
  it('diffDays: số ngày còn lại, âm khi quá hạn', () => {
    expect(diffDays('2026-10-30', TODAY)).toBe(5);
    expect(diffDays(TODAY, TODAY)).toBe(0);
    expect(diffDays('2026-10-20', TODAY)).toBe(-5);
    expect(diffDays('2026-11-01', '2026-10-31')).toBe(1);
  });

  it('displayStatus: Quá hạn chỉ khi đang mượn và hôm nay > hạn trả', () => {
    expect(displayStatus({ status: 'borrowing', dueDate: '2026-10-24' }, TODAY)).toBe('overdue');
    expect(displayStatus({ status: 'borrowing', dueDate: TODAY }, TODAY)).toBe('borrowing');
    expect(displayStatus({ status: 'returned', dueDate: '2026-10-01' }, TODAY)).toBe('returned');
    expect(displayStatus({ status: 'pending', dueDate: null }, TODAY)).toBe('pending');
  });

  const OK = { status: 'borrowing', dueDate: '2026-10-30', extensionCount: 0, hasPendingReturn: false };

  it('evaluateExtension: đủ điều kiện → null, kể cả đúng ngày hạn', () => {
    expect(evaluateExtension(OK, TODAY)).toBeNull();
    expect(evaluateExtension({ ...OK, dueDate: TODAY }, TODAY)).toBeNull();
  });

  it.each([
    [{ status: 'pending', dueDate: null }, 'not_borrowing'],
    [{ status: 'returned' }, 'not_borrowing'],
    [{ dueDate: '2026-10-24' }, 'overdue'],
    [{ extensionCount: 1 }, 'already_extended'],
    [{ hasPendingReturn: true }, 'pending_return'],
    // Thứ tự kiểm tra theo flow: quá hạn trước khi xét đã gia hạn.
    [{ dueDate: '2026-10-24', extensionCount: 1 }, 'overdue'],
  ])('evaluateExtension %j → %s', (patch, reason) => {
    expect(evaluateExtension({ ...OK, ...patch }, TODAY)).toBe(reason);
  });
});

describe('historyQuerySchema (2.3.3)', () => {
  it('mặc định tất cả, trang 1', () => {
    expect(historyQuerySchema.validate({}).value).toEqual({ status: 'all', page: 1 });
  });

  it.each(['pending', 'borrowing', 'overdue', 'returned', 'rejected'])('status %s hợp lệ', (status) => {
    expect(historyQuerySchema.validate({ status }).value.status).toBe(status);
  });

  it('giá trị lạ quay về mặc định', () => {
    expect(historyQuerySchema.validate({ status: 'cancelled', page: 'x' }).value).toEqual({ status: 'all', page: 1 });
  });
});

function row(patch = {}) {
  return {
    id: 1, status: 'borrowing', requestedDays: 14, createdAt: NOW, borrowedAt: NOW,
    dueDate: date('2026-10-30'), extensionCount: 0, returnedAt: null, rejectReason: null,
    book: { id: 7, title: 'Sách', author: 'Tác giả' }, returnRequests: [], ...patch,
  };
}

describe('borrowService.listMyOrders (2.3.3)', () => {
  function makeService(rows = [], total = rows.length) {
    const prisma = {
      borrowOrder: { count: vi.fn(async () => total), findMany: vi.fn(async () => rows) },
    };
    return { service: createBorrowService({ prisma, now: () => NOW }), prisma };
  }

  it.each([
    ['all', { readerId: 1, status: { not: 'cancelled' } }],
    ['pending', { readerId: 1, status: 'pending' }],
    ['returned', { readerId: 1, status: 'returned' }],
    ['rejected', { readerId: 1, status: 'rejected' }],
    ['borrowing', { readerId: 1, status: 'borrowing', dueDate: { gte: date(TODAY) } }],
    ['overdue', { readerId: 1, status: 'borrowing', dueDate: { lt: date(TODAY) } }],
  ])('edge 1 + lọc %s: luôn lọc theo độc giả', async (status, where) => {
    const { service, prisma } = makeService([row()]);
    await service.listMyOrders(1, { status, page: 1 });
    expect(prisma.borrowOrder.count).toHaveBeenCalledWith({ where });
    expect(prisma.borrowOrder.findMany.mock.calls[0][0]).toMatchObject({
      where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: 0, take: 10,
    });
  });

  it('suy ra trạng thái, số ngày còn lại và nút gia hạn', async () => {
    const { service } = makeService([
      row({ id: 1 }),
      row({ id: 2, dueDate: date('2026-10-22') }),
      row({ id: 3, extensionCount: 1 }),
      row({ id: 4, returnRequests: [{ id: 9 }] }),
      row({ id: 5, status: 'rejected', borrowedAt: null, dueDate: null, rejectReason: 'Hết sách' }),
      row({ id: 6, status: 'returned', returnedAt: NOW }),
    ]);
    const { orders, today } = await service.listMyOrders(1, {});
    expect(today).toBe(TODAY);
    expect(orders.map((o) => [o.id, o.status, o.daysLeft, o.canExtend])).toEqual([
      [1, 'borrowing', 5, true],
      [2, 'overdue', -3, false],
      [3, 'borrowing', 5, false],
      [4, 'borrowing', 5, false],
      [5, 'rejected', null, false],
      [6, 'returned', null, false],
    ]);
    expect(orders[0]).toMatchObject({ dueDate: '2026-10-30', book: { title: 'Sách' }, hasPendingReturn: false });
    expect(orders[3].hasPendingReturn).toBe(true);
    expect(orders[4].rejectReason).toBe('Hết sách');
  });

  it('edge 6: trang vượt quá → trang cuối; không có đơn → không truy vấn danh sách', async () => {
    const { service, prisma } = makeService([row()], 25);
    const result = await service.listMyOrders(1, { page: 9 });
    expect(result.pagination).toEqual({ page: 3, pageSize: 10, total: 25, totalPages: 3 });
    expect(prisma.borrowOrder.findMany.mock.calls[0][0].skip).toBe(20);

    const empty = makeService([], 0);
    expect((await empty.service.listMyOrders(1, {})).orders).toEqual([]);
    expect(empty.prisma.borrowOrder.findMany).not.toHaveBeenCalled();
  });
});

describe('borrowService.extendBorrowOrder (2.3.3)', () => {
  function makeService({ order = { status: 'borrowing', dueDate: date('2026-10-30'), extensionCount: 0 }, pendingReturns = 0 } = {}) {
    const calls = [];
    const tx = {
      $queryRaw: vi.fn(async (strings, ...values) => {
        calls.push({ sql: strings.join('?'), values });
        return order ? [order] : [];
      }),
      returnRequest: { count: vi.fn(async () => pendingReturns) },
      borrowOrder: {
        update: vi.fn(async ({ data }) => ({ id: 50, dueDate: data.dueDate, extensionCount: 1 })),
      },
    };
    const prisma = { $transaction: vi.fn(async (fn) => fn(tx)) };
    return { service: createBorrowService({ prisma, now: () => NOW }), tx, calls };
  }

  it('cộng 7 ngày vào hạn trả, khóa đơn của chính độc giả', async () => {
    const { service, tx, calls } = makeService();
    const result = await service.extendBorrowOrder(1, 50);
    expect(calls[0].sql).toMatch(/FROM borrow_orders WHERE id = \? AND reader_id = \? FOR UPDATE/);
    expect(calls[0].values).toEqual([50, 1]);
    expect(tx.returnRequest.count).toHaveBeenCalledWith({ where: { borrowOrderId: 50, status: 'pending' } });
    expect(tx.borrowOrder.update).toHaveBeenCalledWith({
      where: { id: 50 },
      data: { dueDate: date('2026-11-06'), extensionCount: { increment: 1 }, extendedAt: NOW },
    });
    expect(result).toEqual({
      message: EXTENDED, order: { id: 50, dueDate: '2026-11-06', extensionCount: 1, daysLeft: 12 },
    });
  });

  it('đơn không có hoặc của người khác → 404', async () => {
    const { service } = makeService({ order: null });
    await expect(service.extendBorrowOrder(1, 50)).rejects.toMatchObject({ status: 404, message: ORDER_NOT_FOUND });
  });

  it.each([
    [{ order: { status: 'pending', dueDate: null, extensionCount: 0 } }, 'not_borrowing'],
    // Edge 3: hết hạn ngay trước khi bấm (hạn 24/10, hôm nay 25/10 giờ VN).
    [{ order: { status: 'borrowing', dueDate: date('2026-10-24'), extensionCount: 0 } }, 'overdue'],
    // Edge 2: lần bấm thứ hai thấy extension_count = 1.
    [{ order: { status: 'borrowing', dueDate: date('2026-10-30'), extensionCount: 1 } }, 'already_extended'],
    [{ pendingReturns: 1 }, 'pending_return'],
  ])('%j → 409 %s, không cập nhật', async (opts, reason) => {
    const { service, tx } = makeService(opts);
    await expect(service.extendBorrowOrder(1, 50)).rejects.toMatchObject({
      status: 409, reason, message: EXTEND_BLOCKED[reason],
    });
    expect(tx.borrowOrder.update).not.toHaveBeenCalled();
  });
});

describe('Routes 2.3.3', () => {
  const tokens = createTokenService({ secret: 'test-secret', expiresIn: '24h' });
  const USERS = {
    1: { id: 1, name: 'R', role: 'reader', status: 'active' },
    2: { id: 2, name: 'L', role: 'librarian', status: 'active' },
    3: { id: 3, name: 'A', role: 'admin', status: 'active' },
  };
  const bearer = (id) => `Bearer ${tokens.sign(USERS[id])}`;

  function makeApp() {
    const authService = { getSessionUser: vi.fn(async (id) => USERS[id] ?? null) };
    const borrowService = {
      listMyOrders: vi.fn(async () => ({ orders: [], pagination: { page: 1 } })),
      extendBorrowOrder: vi.fn(async () => ({ message: EXTENDED, order: { id: 50 } })),
    };
    return { app: createApp({ authService, borrowService, tokens }), borrowService };
  }

  it('GET /mine: khách 401, nhân viên 403', async () => {
    const { app, borrowService } = makeApp();
    expect((await request(app).get('/api/borrow-orders/mine')).status).toBe(401);
    for (const id of [2, 3]) {
      expect((await request(app).get('/api/borrow-orders/mine').set('Authorization', bearer(id))).status).toBe(403);
    }
    expect(borrowService.listMyOrders).not.toHaveBeenCalled();
  });

  it('GET /mine: reader dùng id của chính mình, query được chuẩn hóa', async () => {
    const { app, borrowService } = makeApp();
    const res = await request(app).get('/api/borrow-orders/mine?status=overdue&page=2&readerId=9')
      .set('Authorization', bearer(1));
    expect(res.status).toBe(200);
    expect(borrowService.listMyOrders).toHaveBeenCalledWith(1, { status: 'overdue', page: 2 });

    await request(app).get('/api/borrow-orders/mine?status=abc&page=-1').set('Authorization', bearer(1));
    expect(borrowService.listMyOrders).toHaveBeenLastCalledWith(1, { status: 'all', page: 1 });
  });

  it('POST /:id/extend: khách 401, nhân viên 403', async () => {
    const { app, borrowService } = makeApp();
    expect((await request(app).post('/api/borrow-orders/50/extend')).status).toBe(401);
    expect((await request(app).post('/api/borrow-orders/50/extend').set('Authorization', bearer(2))).status).toBe(403);
    expect(borrowService.extendBorrowOrder).not.toHaveBeenCalled();
  });

  it('POST /:id/extend: reader → 200; id sai → 404', async () => {
    const { app, borrowService } = makeApp();
    const res = await request(app).post('/api/borrow-orders/50/extend').set('Authorization', bearer(1));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ message: EXTENDED, order: { id: 50 } });
    expect(borrowService.extendBorrowOrder).toHaveBeenCalledWith(1, 50);
    expect((await request(app).post('/api/borrow-orders/abc/extend').set('Authorization', bearer(1))).status).toBe(404);
  });

  it('lỗi nghiệp vụ → 409 kèm reason', async () => {
    const { app, borrowService } = makeApp();
    borrowService.extendBorrowOrder.mockRejectedValue(
      Object.assign(new HttpError(409, EXTEND_BLOCKED.already_extended), { reason: 'already_extended' }),
    );
    const res = await request(app).post('/api/borrow-orders/50/extend').set('Authorization', bearer(1));
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ message: EXTEND_BLOCKED.already_extended, reason: 'already_extended' });
  });
});
