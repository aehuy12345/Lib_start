import request from 'supertest';
import { createApp } from '../../src/app';
import { createTokenService } from '../../src/lib/tokens';
import { HttpError } from '../../src/lib/httpError';
import { ORDER_NOT_FOUND, ALREADY_PROCESSED } from '../../src/modules/borrow/borrow.service';
import { createFineService } from '../../src/modules/fine/fine.service';
import {
  STOCK_CHANGES, lateDaysOf, requiredFineTypes, checkFineTiers, TIER_REQUIRED, TIER_INVALID, lateTierRequired,
} from '../../src/modules/return/return.rules';
import {
  createReturnService, RETURN_NOT_FOUND, RETURN_ALREADY_PROCESSED, RETURNED, RETURN_REJECTED, COUNTER_BLOCKED,
} from '../../src/modules/return/return.service';
import { CONDITION_REQUIRED, NOTE_REQUIRED, NOTE_TOO_LONG } from '../../src/modules/return/return.validation';

// 2026-10-26 10:00 giờ VN.
const NOW = new Date('2026-10-26T03:00:00Z');
const TIERS = [
  { id: 1, name: 'Trả muộn', type: 'late', amount: 10000, isActive: true },
  { id: 2, name: 'Hư hỏng nhẹ', type: 'damaged', amount: 50000, isActive: true },
  { id: 3, name: 'Mất sách', type: 'lost', amount: 200000, isActive: true },
  { id: 4, name: 'Hư hỏng cũ', type: 'damaged', amount: 30000, isActive: false },
];
const tierMap = (tiers = TIERS) => new Map(tiers.map((t) => [t.id, t]));

describe('Quy tắc 2.4.2', () => {
  it('số ngày muộn theo ngày VN; đúng ngày hạn chưa muộn', () => {
    expect(lateDaysOf('2026-10-26', '2026-10-26')).toBe(0);
    expect(lateDaysOf('2026-10-30', '2026-10-26')).toBe(0);
    expect(lateDaysOf('2026-10-25', '2026-10-26')).toBe(1);
    expect(lateDaysOf('2026-10-22', '2026-10-26')).toBe(4);
  });

  it.each([
    ['normal', 0, []],
    ['normal', 3, ['late']],
    ['damaged', 0, ['damaged']],
    ['damaged', 2, ['late', 'damaged']],
    ['lost', 0, ['lost']],
    // Edge 6 / README điểm 9: Mất cũng có thể kèm phí muộn.
    ['lost', 5, ['late', 'lost']],
  ])('%s, muộn %i ngày → phiếu %j', (condition, lateDays, types) => {
    expect(requiredFineTypes(condition, lateDays)).toEqual(types);
  });

  it.each(Object.entries(STOCK_CHANGES))('%s giữ total = available + borrowed + damaged', (_, c) => {
    expect(c.availableQuantity + c.borrowedQuantity + c.damagedQuantity).toBe(c.totalQuantity);
    expect(c.borrowedQuantity).toBe(-1);
  });

  it('tác động kho theo flow: hư hỏng không về kho, mất giảm tổng', () => {
    expect(STOCK_CHANGES.normal).toMatchObject({ availableQuantity: 1, totalQuantity: 0 });
    expect(STOCK_CHANGES.damaged).toMatchObject({ availableQuantity: 0, damagedQuantity: 1 });
    expect(STOCK_CHANGES.lost).toMatchObject({ availableQuantity: 0, totalQuantity: -1 });
  });

  describe('checkFineTiers', () => {
    it('bình thường, đúng hạn → không cần mức phạt, kể cả khi chưa có mức nào (edge 4)', () => {
      expect(checkFineTiers({ condition: 'normal', lateDays: 0 }, new Map())).toBeNull();
    });

    it('hợp lệ khi đúng loại và còn áp dụng', () => {
      expect(checkFineTiers({ condition: 'damaged', lateDays: 2, fineTierId: 2, lateFineTierId: 1 }, tierMap())).toBeNull();
      expect(checkFineTiers({ condition: 'lost', lateDays: 0, fineTierId: 3 }, tierMap())).toBeNull();
    });

    it('trả muộn mà chưa chọn mức phạt Trả muộn', () => {
      expect(checkFineTiers({ condition: 'normal', lateDays: 3 }, tierMap()))
        .toEqual({ lateFineTierId: lateTierRequired(3) });
    });

    it('edge 2: hư hỏng hoặc mất chưa chọn mức phạt', () => {
      expect(checkFineTiers({ condition: 'lost', lateDays: 1 }, tierMap()))
        .toEqual({ lateFineTierId: lateTierRequired(1), fineTierId: TIER_REQUIRED });
    });

    it.each([
      ['sai loại', { condition: 'damaged', lateDays: 0, fineTierId: 3 }, 'fineTierId'],
      ['đã ẩn (edge 5)', { condition: 'damaged', lateDays: 0, fineTierId: 4 }, 'fineTierId'],
      ['không tồn tại', { condition: 'lost', lateDays: 0, fineTierId: 99 }, 'fineTierId'],
      ['mức hư hỏng chọn cho trả muộn', { condition: 'normal', lateDays: 1, lateFineTierId: 2 }, 'lateFineTierId'],
    ])('%s → TIER_INVALID', (_, input, field) => {
      expect(checkFineTiers(input, tierMap())).toEqual({ [field]: TIER_INVALID });
    });

    it('edge 4: Admin chưa cấu hình mức phạt → không xác nhận được hư hỏng', () => {
      expect(checkFineTiers({ condition: 'damaged', lateDays: 0, fineTierId: 2 }, new Map()))
        .toEqual({ fineTierId: TIER_INVALID });
    });
  });
});

const ON_TIME = { id: 50, readerId: 1, bookId: 7, status: 'borrowing', dueDate: new Date('2026-10-30') };
const LATE = { ...ON_TIME, dueDate: new Date('2026-10-22') };

function makeTx({ request: req = { borrowOrderId: 50 }, order = ON_TIME, lockedStatus = 'pending', pending = 0, tiers = TIERS, createError } = {}) {
  const calls = [];
  let ticketId = 100;
  const tx = {
    $queryRaw: vi.fn(async (strings, ...values) => {
      const sql = strings.join('?');
      calls.push({ sql, values });
      if (/FROM return_requests WHERE id = \? FOR UPDATE/.test(sql)) return [{ status: lockedStatus }];
      if (/FROM return_requests/.test(sql)) return req ? [req] : [];
      if (/FROM borrow_orders/.test(sql)) return order ? [order] : [];
      return [{ id: values[0] }];
    }),
    fineTier: { findMany: vi.fn(async ({ where }) => tiers.filter((t) => where.id.in.includes(t.id))) },
    book: { update: vi.fn(async () => ({})) },
    borrowOrder: { update: vi.fn(async () => ({})) },
    returnRequest: {
      count: vi.fn(async () => pending),
      create: vi.fn(async ({ data }) => {
        if (createError) throw createError;
        return { id: 77, ...data };
      }),
      update: vi.fn(async () => ({})),
    },
    fineTicket: { create: vi.fn(async ({ data }) => ({ id: (ticketId += 1), ...data })) },
  };
  const prisma = { $transaction: vi.fn(async (fn) => fn(tx)) };
  return { service: createReturnService({ prisma, now: () => NOW }), tx, calls, prisma };
}

describe('returnService.confirmReturnRequest (2.4.2)', () => {
  it('bình thường, đúng hạn: khóa đơn → yêu cầu → sách, kho +1/-1, không lập phiếu', async () => {
    const { service, tx, calls } = makeTx();
    const res = await service.confirmReturnRequest(2, 9, { condition: 'normal', note: '' });
    expect(calls.map((c) => c.sql.replace(/\s+/g, ' ').trim())).toEqual([
      expect.stringMatching(/FROM return_requests WHERE id = \?$/),
      expect.stringMatching(/FROM borrow_orders WHERE id = \? FOR UPDATE$/),
      expect.stringMatching(/FROM return_requests WHERE id = \? FOR UPDATE$/),
      expect.stringMatching(/FROM books WHERE id = \? FOR UPDATE$/),
    ]);
    expect(calls[1].values).toEqual([50]);
    expect(tx.fineTier.findMany).not.toHaveBeenCalled();
    expect(tx.book.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { availableQuantity: { increment: 1 }, borrowedQuantity: { increment: -1 } },
    });
    expect(tx.borrowOrder.update).toHaveBeenCalledWith({ where: { id: 50 }, data: { status: 'returned', returnedAt: NOW } });
    expect(tx.returnRequest.update).toHaveBeenCalledWith({
      where: { id: 9 },
      data: { status: 'confirmed', processedById: 2, processedAt: NOW, condition: 'normal', conditionNote: null, lateDays: 0 },
    });
    expect(tx.fineTicket.create).not.toHaveBeenCalled();
    expect(res).toEqual({
      message: RETURNED,
      result: { returnRequestId: 9, borrowOrderId: 50, condition: 'normal', lateDays: 0, fines: [] },
    });
  });

  it('bình thường, trả muộn: khóa độc giả trước sách, lập phiếu Trả muộn bản sao số tiền', async () => {
    const { service, tx, calls } = makeTx({ order: LATE });
    const res = await service.confirmReturnRequest(2, 9, { condition: 'normal', lateFineTierId: 1 });
    const sqls = calls.map((c) => c.sql);
    const users = sqls.findIndex((s) => /FROM users WHERE id = \? FOR UPDATE/.test(s));
    expect(users).toBeGreaterThan(-1);
    expect(users).toBeLessThan(sqls.findIndex((s) => /FROM books/.test(s)));
    expect(calls[users].values).toEqual([1]);
    expect(tx.fineTicket.create).toHaveBeenCalledWith({
      data: {
        readerId: 1, borrowOrderId: 50, returnRequestId: 9, fineTierId: 1, type: 'late',
        tierName: 'Trả muộn', amount: 10000, note: 'Trả muộn 4 ngày', issuedById: 2,
      },
    });
    expect(res.message).toBe(`${RETURNED}, đã lập 1 phiếu phạt`);
    expect(res.result.lateDays).toBe(4);
  });

  it('hư hỏng + trả muộn: 2 phiếu, borrowed -1, damaged +1, available giữ nguyên', async () => {
    const { service, tx } = makeTx({ order: LATE });
    const res = await service.confirmReturnRequest(2, 9, {
      condition: 'damaged', fineTierId: 2, note: 'Rách bìa', lateFineTierId: 1,
    });
    expect(tx.book.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { borrowedQuantity: { increment: -1 }, damagedQuantity: { increment: 1 } },
    });
    expect(tx.returnRequest.update.mock.calls[0][0].data).toMatchObject({ condition: 'damaged', conditionNote: 'Rách bìa', lateDays: 4 });
    expect(tx.fineTicket.create).toHaveBeenCalledTimes(2);
    expect(tx.fineTicket.create.mock.calls[1][0].data).toMatchObject({ type: 'damaged', amount: 50000, note: 'Rách bìa' });
    expect(res.result.fines).toEqual([
      { id: 101, type: 'late', tierName: 'Trả muộn', amount: 10000 },
      { id: 102, type: 'damaged', tierName: 'Hư hỏng nhẹ', amount: 50000 },
    ]);
    expect(res.message).toBe(`${RETURNED}, đã lập 2 phiếu phạt`);
  });

  it('mất, đúng hạn: borrowed -1, tổng -1, một phiếu Mất', async () => {
    const { service, tx } = makeTx();
    await service.confirmReturnRequest(2, 9, { condition: 'lost', fineTierId: 3, note: 'Độc giả làm mất' });
    expect(tx.book.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { borrowedQuantity: { increment: -1 }, totalQuantity: { increment: -1 } },
    });
    expect(tx.fineTicket.create).toHaveBeenCalledTimes(1);
    expect(tx.fineTicket.create.mock.calls[0][0].data).toMatchObject({ type: 'lost', tierName: 'Mất sách', amount: 200000 });
  });

  it('trả muộn mà thiếu mức phạt Trả muộn → 400 field, không ghi gì', async () => {
    const { service, tx } = makeTx({ order: LATE });
    await expect(service.confirmReturnRequest(2, 9, { condition: 'lost', fineTierId: 3, note: 'x' }))
      .rejects.toMatchObject({ status: 400, errors: { lateFineTierId: lateTierRequired(4) } });
    expect(tx.book.update).not.toHaveBeenCalled();
    expect(tx.fineTicket.create).not.toHaveBeenCalled();
  });

  it('edge 5: mức phạt vừa bị ẩn → 400 TIER_INVALID', async () => {
    const { service, tx } = makeTx();
    await expect(service.confirmReturnRequest(2, 9, { condition: 'damaged', fineTierId: 4, note: 'x' }))
      .rejects.toMatchObject({ status: 400, errors: { fineTierId: TIER_INVALID } });
    expect(tx.borrowOrder.update).not.toHaveBeenCalled();
  });

  it('không có yêu cầu → 404', async () => {
    const { service, tx } = makeTx({ request: null });
    await expect(service.confirmReturnRequest(2, 9, { condition: 'normal' }))
      .rejects.toMatchObject({ status: 404, message: RETURN_NOT_FOUND });
    expect(tx.book.update).not.toHaveBeenCalled();
  });

  it.each(['confirmed', 'rejected', 'cancelled'])('edge 1: yêu cầu đã %s → 409 already_processed', async (status) => {
    const { service, tx } = makeTx({ lockedStatus: status });
    await expect(service.confirmReturnRequest(2, 9, { condition: 'normal' }))
      .rejects.toMatchObject({ status: 409, reason: 'already_processed', message: RETURN_ALREADY_PROCESSED });
    expect(tx.book.update).not.toHaveBeenCalled();
  });
});

describe('returnService.rejectReturnRequest', () => {
  function makeService({ count = 1, existing = null } = {}) {
    const prisma = {
      returnRequest: { updateMany: vi.fn(async () => ({ count })), findUnique: vi.fn(async () => existing) },
    };
    return { service: createReturnService({ prisma, now: () => NOW }), prisma };
  }

  it('cập nhật có điều kiện yêu cầu Chờ xác nhận', async () => {
    const { service, prisma } = makeService();
    expect(await service.rejectReturnRequest(2, 9, { reason: 'Chưa mang sách' })).toEqual({ message: RETURN_REJECTED });
    expect(prisma.returnRequest.updateMany).toHaveBeenCalledWith({
      where: { id: 9, status: 'pending' },
      data: { status: 'rejected', rejectReason: 'Chưa mang sách', processedById: 2, processedAt: NOW },
    });
  });

  it('đã xử lý → 409 already_processed; không có → 404', async () => {
    await expect(makeService({ count: 0, existing: { id: 9 } }).service.rejectReturnRequest(2, 9, { reason: 'x' }))
      .rejects.toMatchObject({ status: 409, reason: 'already_processed' });
    await expect(makeService({ count: 0 }).service.rejectReturnRequest(2, 9, { reason: 'x' }))
      .rejects.toMatchObject({ status: 404, message: RETURN_NOT_FOUND });
  });
});

describe('returnService.counterReturn (trả tại quầy, README điểm 10)', () => {
  it('tạo yêu cầu đứng tên nhân viên rồi xác nhận trong cùng transaction', async () => {
    const { service, tx, prisma } = makeTx({ order: LATE });
    const res = await service.counterReturn(2, { borrowOrderId: 50, condition: 'normal', lateFineTierId: 1 });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.returnRequest.create).toHaveBeenCalledWith({ data: { borrowOrderId: 50, requestedById: 2 } });
    expect(tx.returnRequest.update.mock.calls[0][0]).toMatchObject({ where: { id: 77 }, data: { status: 'confirmed' } });
    expect(tx.fineTicket.create.mock.calls[0][0].data).toMatchObject({ returnRequestId: 77, type: 'late' });
    expect(res.result).toMatchObject({ returnRequestId: 77, borrowOrderId: 50, lateDays: 4 });
  });

  it('đơn không tồn tại → 404', async () => {
    const { service } = makeTx({ order: null });
    await expect(service.counterReturn(2, { borrowOrderId: 50, condition: 'normal' }))
      .rejects.toMatchObject({ status: 404, message: ORDER_NOT_FOUND });
  });

  it.each([
    [{ order: { ...ON_TIME, status: 'returned' } }, 'not_borrowing'],
    [{ order: { ...ON_TIME, status: 'pending' } }, 'not_borrowing'],
    [{ pending: 1 }, 'pending_return'],
  ])('%j → 409 %s, không tạo yêu cầu', async (opts, reason) => {
    const { service, tx } = makeTx(opts);
    await expect(service.counterReturn(2, { borrowOrderId: 50, condition: 'normal' }))
      .rejects.toMatchObject({ status: 409, reason, message: COUNTER_BLOCKED[reason] });
    expect(tx.returnRequest.create).not.toHaveBeenCalled();
  });

  it('va chạm unique index (P2002) → 409 already_processed', async () => {
    const { service } = makeTx({ createError: Object.assign(new Error('dup'), { code: 'P2002' }) });
    await expect(service.counterReturn(2, { borrowOrderId: 50, condition: 'normal' }))
      .rejects.toMatchObject({ status: 409, reason: 'already_processed', message: ALREADY_PROCESSED });
  });
});

describe('returnService danh sách cho nhân viên', () => {
  const row = {
    id: 50, borrowedAt: new Date('2026-10-01T02:00:00Z'), dueDate: new Date('2026-10-22'),
    reader: { id: 1, name: 'R', email: 'r@x.vn' }, book: { id: 7, title: 'S', author: 'T' },
  };

  it('listPendingReturns: cũ nhất trước, kèm số ngày muộn, trang quá cuối về trang cuối', async () => {
    const prisma = {
      returnRequest: {
        count: vi.fn(async () => 11),
        findMany: vi.fn(async () => [{ id: 9, createdAt: NOW, borrowOrder: row }]),
      },
    };
    const res = await createReturnService({ prisma, now: () => NOW }).listPendingReturns({ page: 5 });
    const args = prisma.returnRequest.findMany.mock.calls[0][0];
    expect(args.where).toEqual({ status: 'pending' });
    expect(args.orderBy).toEqual([{ createdAt: 'asc' }, { id: 'asc' }]);
    expect(args.skip).toBe(10);
    expect(res.pagination).toEqual({ page: 2, pageSize: 10, total: 11, totalPages: 2 });
    expect(res.today).toBe('2026-10-26');
    expect(res.returnRequests).toEqual([{
      id: 9, createdAt: NOW, borrowOrderId: 50, reader: row.reader, book: row.book,
      borrowedAt: row.borrowedAt, dueDate: '2026-10-22', lateDays: 4,
    }]);
  });

  it('listCounterOrders: đơn đang mượn chưa có yêu cầu chờ, lọc theo độc giả hoặc sách', async () => {
    const prisma = { borrowOrder: { count: vi.fn(async () => 1), findMany: vi.fn(async () => [row]) } };
    const res = await createReturnService({ prisma, now: () => NOW }).listCounterOrders({ q: 'abc', page: 1 });
    const contains = { contains: 'abc', mode: 'insensitive' };
    expect(prisma.borrowOrder.count).toHaveBeenCalledWith({
      where: {
        status: 'borrowing',
        returnRequests: { none: { status: 'pending' } },
        OR: [{ reader: { name: contains } }, { reader: { email: contains } }, { book: { title: contains } }],
      },
    });
    expect(prisma.borrowOrder.findMany.mock.calls[0][0].orderBy).toEqual([{ dueDate: 'asc' }, { id: 'asc' }]);
    expect(res.orders[0]).toMatchObject({ id: 50, dueDate: '2026-10-22', lateDays: 4 });
  });

  it('listCounterOrders: q rỗng không lọc; không có đơn thì không truy vấn trang', async () => {
    const prisma = { borrowOrder: { count: vi.fn(async () => 0), findMany: vi.fn() } };
    const res = await createReturnService({ prisma, now: () => NOW }).listCounterOrders({});
    expect(prisma.borrowOrder.count.mock.calls[0][0].where.OR).toBeUndefined();
    expect(prisma.borrowOrder.findMany).not.toHaveBeenCalled();
    expect(res.orders).toEqual([]);
  });
});

describe('fineService.listTierOptions', () => {
  it('chỉ mức đang áp dụng, nhóm theo loại', async () => {
    const prisma = {
      fineTier: { findMany: vi.fn(async () => TIERS.filter((t) => t.isActive).map(({ isActive, ...t }) => t)) },
    };
    const tiers = await createFineService({ prisma }).listTierOptions();
    expect(prisma.fineTier.findMany.mock.calls[0][0].where).toEqual({ isActive: true });
    expect(tiers).toEqual({
      late: [{ id: 1, name: 'Trả muộn', amount: 10000 }],
      damaged: [{ id: 2, name: 'Hư hỏng nhẹ', amount: 50000 }],
      lost: [{ id: 3, name: 'Mất sách', amount: 200000 }],
    });
  });

  it('edge 4: chưa cấu hình mức nào → các nhóm rỗng', async () => {
    const prisma = { fineTier: { findMany: vi.fn(async () => []) } };
    expect(await createFineService({ prisma }).listTierOptions()).toEqual({ late: [], damaged: [], lost: [] });
  });
});

describe('Routes 2.4.2', () => {
  const tokens = createTokenService({ secret: 'test-secret', expiresIn: '24h' });
  const USERS = {
    1: { id: 1, name: 'R', role: 'reader', status: 'active' },
    2: { id: 2, name: 'L', role: 'librarian', status: 'active' },
    3: { id: 3, name: 'A', role: 'admin', status: 'active' },
  };
  const bearer = (id) => `Bearer ${tokens.sign(USERS[id])}`;

  function makeApp() {
    const authService = { getSessionUser: vi.fn(async (id) => USERS[id] ?? null) };
    const returnService = {
      listPendingReturns: vi.fn(async () => ({ returnRequests: [] })),
      listCounterOrders: vi.fn(async () => ({ orders: [] })),
      confirmReturnRequest: vi.fn(async () => ({ message: RETURNED })),
      rejectReturnRequest: vi.fn(async () => ({ message: RETURN_REJECTED })),
      counterReturn: vi.fn(async () => ({ message: RETURNED })),
    };
    const fineService = { listTierOptions: vi.fn(async () => ({ late: [], damaged: [], lost: [] })) };
    return { app: createApp({ authService, returnService, fineService, tokens }), returnService, fineService };
  }

  const ENDPOINTS = [
    ['get', '/api/return-requests/pending'],
    ['get', '/api/return-requests/counter-orders'],
    ['post', '/api/return-requests/counter'],
    ['post', '/api/return-requests/9/confirm'],
    ['post', '/api/return-requests/9/reject'],
    ['get', '/api/fine-tiers/options'],
  ];

  it.each(ENDPOINTS)('%s %s: khách 401, độc giả 403', async (method, url) => {
    const { app } = makeApp();
    expect((await request(app)[method](url)).status).toBe(401);
    expect((await request(app)[method](url).set('Authorization', bearer(1))).status).toBe(403);
  });

  it('GET danh sách: librarian và admin 200, query sai quay về mặc định', async () => {
    const { app, returnService, fineService } = makeApp();
    for (const id of [2, 3]) {
      expect((await request(app).get('/api/return-requests/pending?page=abc').set('Authorization', bearer(id))).status).toBe(200);
    }
    expect(returnService.listPendingReturns).toHaveBeenCalledWith({ page: 1 });
    await request(app).get('/api/return-requests/counter-orders?q=%20An%20&page=2').set('Authorization', bearer(2));
    expect(returnService.listCounterOrders).toHaveBeenCalledWith({ q: 'An', page: 2 });
    const res = await request(app).get('/api/fine-tiers/options').set('Authorization', bearer(2));
    expect(res.body).toEqual({ tiers: { late: [], damaged: [], lost: [] } });
    expect(fineService.listTierOptions).toHaveBeenCalledTimes(1);
  });

  it('POST confirm: bình thường bỏ mức phạt hư hỏng, giữ mức Trả muộn', async () => {
    const { app, returnService } = makeApp();
    const res = await request(app).post('/api/return-requests/9/confirm').set('Authorization', bearer(2))
      .send({ condition: 'normal', fineTierId: 2, lateFineTierId: '1', note: '  ' });
    expect(res.status).toBe(200);
    expect(returnService.confirmReturnRequest).toHaveBeenCalledWith(2, 9, { condition: 'normal', lateFineTierId: 1, note: '' });
  });

  it('POST confirm: hư hỏng có đủ mức phạt và ghi chú (trim)', async () => {
    const { app, returnService } = makeApp();
    await request(app).post('/api/return-requests/9/confirm').set('Authorization', bearer(3))
      .send({ condition: 'damaged', fineTierId: 2, note: ' Rách bìa ' });
    expect(returnService.confirmReturnRequest).toHaveBeenCalledWith(3, 9, { condition: 'damaged', fineTierId: 2, note: 'Rách bìa' });
  });

  it.each([
    [{}, { condition: CONDITION_REQUIRED }],
    [{ condition: 'broken' }, { condition: CONDITION_REQUIRED }],
    [{ condition: 'damaged' }, { fineTierId: TIER_REQUIRED, note: NOTE_REQUIRED }],
    [{ condition: 'lost', fineTierId: 3, note: '   ' }, { note: NOTE_REQUIRED }],
    [{ condition: 'lost', fineTierId: 3, note: 'a'.repeat(501) }, { note: NOTE_TOO_LONG }],
    [{ condition: 'normal', note: 'a'.repeat(501) }, { note: NOTE_TOO_LONG }],
    [{ condition: 'damaged', fineTierId: 'x', note: 'a' }, { fineTierId: 'Mức phạt không hợp lệ' }],
  ])('POST confirm body %j → 400', async (body, errors) => {
    const { app, returnService } = makeApp();
    const res = await request(app).post('/api/return-requests/9/confirm').set('Authorization', bearer(2)).send(body);
    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual(errors);
    expect(returnService.confirmReturnRequest).not.toHaveBeenCalled();
  });

  it('POST confirm/reject: id sai → 404', async () => {
    const { app } = makeApp();
    for (const action of ['confirm', 'reject']) {
      const res = await request(app).post(`/api/return-requests/abc/${action}`).set('Authorization', bearer(2))
        .send({ condition: 'normal', reason: 'x' });
      expect(res.status).toBe(404);
    }
  });

  it('POST confirm: 409 kèm reason', async () => {
    const { app, returnService } = makeApp();
    returnService.confirmReturnRequest.mockRejectedValue(
      Object.assign(new HttpError(409, RETURN_ALREADY_PROCESSED), { reason: 'already_processed' }),
    );
    const res = await request(app).post('/api/return-requests/9/confirm').set('Authorization', bearer(2)).send({ condition: 'normal' });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ message: RETURN_ALREADY_PROCESSED, reason: 'already_processed' });
  });

  it('POST reject: lý do bắt buộc, trim', async () => {
    const { app, returnService } = makeApp();
    const bad = await request(app).post('/api/return-requests/9/reject').set('Authorization', bearer(2)).send({ reason: '  ' });
    expect(bad.status).toBe(400);
    expect(bad.body.errors.reason).toBe('Lý do từ chối là bắt buộc');
    const ok = await request(app).post('/api/return-requests/9/reject').set('Authorization', bearer(2)).send({ reason: ' Chưa mang sách ' });
    expect(ok.status).toBe(200);
    expect(returnService.rejectReturnRequest).toHaveBeenCalledWith(2, 9, { reason: 'Chưa mang sách' });
  });

  it('POST counter: cần đơn mượn và tình trạng', async () => {
    const { app, returnService } = makeApp();
    const bad = await request(app).post('/api/return-requests/counter').set('Authorization', bearer(2)).send({});
    expect(bad.status).toBe(400);
    expect(bad.body.errors).toEqual({ borrowOrderId: 'Đơn mượn không hợp lệ', condition: CONDITION_REQUIRED });
    const ok = await request(app).post('/api/return-requests/counter').set('Authorization', bearer(2))
      .send({ borrowOrderId: 50, condition: 'lost', fineTierId: 3, note: 'Mất' });
    expect(ok.status).toBe(200);
    expect(returnService.counterReturn).toHaveBeenCalledWith(2, { borrowOrderId: 50, condition: 'lost', fineTierId: 3, note: 'Mất' });
  });
});
