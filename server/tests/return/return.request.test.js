import request from 'supertest';
import { createApp } from '../../src/app';
import { createTokenService } from '../../src/lib/tokens';
import { HttpError } from '../../src/lib/httpError';
import { ORDER_NOT_FOUND } from '../../src/modules/borrow/borrow.service';
import { RETURN_BLOCKED, evaluateReturnRequest } from '../../src/modules/return/return.rules';
import {
  createReturnService, RETURN_NOT_FOUND, NOT_CANCELLABLE, CREATED, CANCELLED,
} from '../../src/modules/return/return.service';

const NOW = new Date('2026-10-26T03:00:00Z');

describe('Quy tắc 2.4.1', () => {
  it('đang mượn, chưa có yêu cầu chờ → được gửi', () => {
    expect(evaluateReturnRequest({ status: 'borrowing', hasPendingReturn: false })).toBeNull();
  });

  it.each([
    // Edge 3 (đã trả ở quầy) và edge 7 (bị từ chối, chờ mượn, đã hủy).
    [{ status: 'returned', hasPendingReturn: false }, 'not_borrowing'],
    [{ status: 'rejected', hasPendingReturn: false }, 'not_borrowing'],
    [{ status: 'pending', hasPendingReturn: false }, 'not_borrowing'],
    [{ status: 'cancelled', hasPendingReturn: false }, 'not_borrowing'],
    // Edge 1: một yêu cầu chờ mỗi đơn.
    [{ status: 'borrowing', hasPendingReturn: true }, 'pending_return'],
  ])('%j → %s', (input, reason) => {
    expect(evaluateReturnRequest(input)).toBe(reason);
  });
});

describe('returnService.createReturnRequest (2.4.1)', () => {
  function makeService({ order = { status: 'borrowing' }, pending = 0, createError } = {}) {
    const calls = [];
    const tx = {
      $queryRaw: vi.fn(async (strings, ...values) => {
        calls.push({ sql: strings.join('?'), values });
        return order ? [order] : [];
      }),
      returnRequest: {
        count: vi.fn(async () => pending),
        create: vi.fn(async ({ data }) => {
          if (createError) throw createError;
          return { id: 9, ...data, status: 'pending', createdAt: NOW };
        }),
      },
    };
    const prisma = { $transaction: vi.fn(async (fn) => fn(tx)) };
    return { service: createReturnService({ prisma, now: () => NOW }), tx, calls };
  }

  it('khóa đơn của chính độc giả rồi tạo yêu cầu Chờ xác nhận', async () => {
    const { service, tx, calls } = makeService();
    const result = await service.createReturnRequest(1, { borrowOrderId: 50 });
    expect(calls[0].sql).toMatch(/FROM borrow_orders\s+WHERE id = \? AND reader_id = \? FOR UPDATE/);
    expect(calls[0].values).toEqual([50, 1]);
    expect(tx.returnRequest.count).toHaveBeenCalledWith({ where: { borrowOrderId: 50, status: 'pending' } });
    expect(tx.returnRequest.create).toHaveBeenCalledWith({ data: { borrowOrderId: 50, requestedById: 1 } });
    expect(result).toEqual({
      message: CREATED, returnRequest: { id: 9, borrowOrderId: 50, status: 'pending', createdAt: NOW },
    });
  });

  it('đơn không có hoặc của người khác → 404', async () => {
    const { service, tx } = makeService({ order: null });
    await expect(service.createReturnRequest(1, { borrowOrderId: 50 }))
      .rejects.toMatchObject({ status: 404, message: ORDER_NOT_FOUND });
    expect(tx.returnRequest.create).not.toHaveBeenCalled();
  });

  it.each([
    [{ order: { status: 'returned' } }, 'not_borrowing'],
    [{ order: { status: 'pending' } }, 'not_borrowing'],
    [{ pending: 1 }, 'pending_return'],
  ])('%j → 409 %s, không tạo', async (opts, reason) => {
    const { service, tx } = makeService(opts);
    await expect(service.createReturnRequest(1, { borrowOrderId: 50 }))
      .rejects.toMatchObject({ status: 409, reason, message: RETURN_BLOCKED[reason] });
    expect(tx.returnRequest.create).not.toHaveBeenCalled();
  });

  it('edge 1: va chạm unique index (P2002) → 409 pending_return', async () => {
    const { service } = makeService({ createError: Object.assign(new Error('dup'), { code: 'P2002' }) });
    await expect(service.createReturnRequest(1, { borrowOrderId: 50 }))
      .rejects.toMatchObject({ status: 409, reason: 'pending_return' });
  });
});

describe('returnService.cancelReturnRequest (2.4.1 edge 5)', () => {
  function makeService({ count = 1, existing = null } = {}) {
    const prisma = {
      returnRequest: {
        updateMany: vi.fn(async () => ({ count })),
        findFirst: vi.fn(async () => existing),
      },
    };
    return { service: createReturnService({ prisma, now: () => NOW }), prisma };
  }

  it('chỉ hủy yêu cầu Chờ xác nhận của chính độc giả', async () => {
    const { service, prisma } = makeService();
    expect(await service.cancelReturnRequest(1, 9)).toEqual({ message: CANCELLED });
    expect(prisma.returnRequest.updateMany).toHaveBeenCalledWith({
      where: { id: 9, requestedById: 1, status: 'pending' },
      data: { status: 'cancelled', cancelledAt: NOW },
    });
  });

  it('đã được xử lý → 409; không có hoặc của người khác → 404', async () => {
    await expect(makeService({ count: 0, existing: { id: 9 } }).service.cancelReturnRequest(1, 9))
      .rejects.toMatchObject({ status: 409, message: NOT_CANCELLABLE });
    const { service, prisma } = makeService({ count: 0 });
    await expect(service.cancelReturnRequest(1, 9)).rejects.toMatchObject({ status: 404, message: RETURN_NOT_FOUND });
    expect(prisma.returnRequest.findFirst).toHaveBeenCalledWith({ where: { id: 9, requestedById: 1 }, select: { id: true } });
  });
});

describe('Routes 2.4.1 /api/return-requests', () => {
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
      createReturnRequest: vi.fn(async () => ({ message: CREATED, returnRequest: { id: 9 } })),
      cancelReturnRequest: vi.fn(async () => ({ message: CANCELLED })),
    };
    return { app: createApp({ authService, returnService, tokens }), returnService };
  }

  it('POST /: khách 401, nhân viên 403', async () => {
    const { app, returnService } = makeApp();
    expect((await request(app).post('/api/return-requests').send({ borrowOrderId: 50 })).status).toBe(401);
    for (const id of [2, 3]) {
      const res = await request(app).post('/api/return-requests').set('Authorization', bearer(id)).send({ borrowOrderId: 50 });
      expect(res.status).toBe(403);
    }
    expect(returnService.createReturnRequest).not.toHaveBeenCalled();
  });

  it('POST /: reader → 201, dùng id của chính mình', async () => {
    const { app, returnService } = makeApp();
    const res = await request(app).post('/api/return-requests').set('Authorization', bearer(1))
      .send({ borrowOrderId: '50', requestedById: 99 });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ message: CREATED, returnRequest: { id: 9 } });
    expect(returnService.createReturnRequest).toHaveBeenCalledWith(1, { borrowOrderId: 50 });
  });

  it.each([{}, { borrowOrderId: 0 }, { borrowOrderId: 'abc' }, { borrowOrderId: 1.5 }])(
    'POST /: body %j → 400',
    async (body) => {
      const { app, returnService } = makeApp();
      const res = await request(app).post('/api/return-requests').set('Authorization', bearer(1)).send(body);
      expect(res.status).toBe(400);
      expect(res.body.errors.borrowOrderId).toBe('Đơn mượn không hợp lệ');
      expect(returnService.createReturnRequest).not.toHaveBeenCalled();
    },
  );

  it('POST /: lỗi nghiệp vụ → 409 kèm reason', async () => {
    const { app, returnService } = makeApp();
    returnService.createReturnRequest.mockRejectedValue(
      Object.assign(new HttpError(409, RETURN_BLOCKED.pending_return), { reason: 'pending_return' }),
    );
    const res = await request(app).post('/api/return-requests').set('Authorization', bearer(1)).send({ borrowOrderId: 50 });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ message: RETURN_BLOCKED.pending_return, reason: 'pending_return' });
  });

  it('POST /:id/cancel: phân quyền, id sai → 404, reader → 200', async () => {
    const { app, returnService } = makeApp();
    expect((await request(app).post('/api/return-requests/9/cancel')).status).toBe(401);
    expect((await request(app).post('/api/return-requests/9/cancel').set('Authorization', bearer(2))).status).toBe(403);
    expect((await request(app).post('/api/return-requests/abc/cancel').set('Authorization', bearer(1))).status).toBe(404);
    const res = await request(app).post('/api/return-requests/9/cancel').set('Authorization', bearer(1));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ message: CANCELLED });
    expect(returnService.cancelReturnRequest).toHaveBeenCalledTimes(1);
    expect(returnService.cancelReturnRequest).toHaveBeenCalledWith(1, 9);
  });
});
