import request from 'supertest';
import { createApp } from '../../src/app';
import { createTokenService } from '../../src/lib/tokens';
import { HttpError } from '../../src/lib/httpError';
import { REASON_REQUIRED } from '../../src/modules/borrow/borrow.validation';

describe('Routes 2.3.2 /api/borrow-orders (nhân viên)', () => {
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
      listPendingOrders: vi.fn(async () => ({ orders: [], pagination: { page: 1 } })),
      confirmBorrowOrder: vi.fn(async () => ({ message: 'ok', order: { id: 50 } })),
      rejectBorrowOrder: vi.fn(async () => ({ message: 'rejected' })),
    };
    return { app: createApp({ authService, borrowService, tokens }), borrowService };
  }

  it.each([
    ['get', '/api/borrow-orders/pending'],
    ['post', '/api/borrow-orders/50/confirm'],
    ['post', '/api/borrow-orders/50/reject'],
  ])('%s %s: khách → 401, độc giả → 403', async (method, url) => {
    const { app, borrowService } = makeApp();
    expect((await request(app)[method](url).send({ reason: 'x' })).status).toBe(401);
    expect((await request(app)[method](url).set('Authorization', bearer(1)).send({ reason: 'x' })).status).toBe(403);
    for (const fn of Object.values(borrowService)) expect(fn).not.toHaveBeenCalled();
  });

  it.each([2, 3])('GET /pending: nhân viên/admin (%i) → 200, trang sai → 1', async (id) => {
    const { app, borrowService } = makeApp();
    const res = await request(app).get('/api/borrow-orders/pending?page=abc').set('Authorization', bearer(id));
    expect(res.status).toBe(200);
    expect(borrowService.listPendingOrders).toHaveBeenCalledWith({ page: 1 });
  });

  it('confirm → 200, ghi nhận người xử lý', async () => {
    const { app, borrowService } = makeApp();
    const res = await request(app).post('/api/borrow-orders/50/confirm').set('Authorization', bearer(2));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ message: 'ok', order: { id: 50 } });
    expect(borrowService.confirmBorrowOrder).toHaveBeenCalledWith(2, 50);
  });

  it('confirm bị chặn → 409 kèm reason', async () => {
    const { app, borrowService } = makeApp();
    borrowService.confirmBorrowOrder.mockRejectedValue(
      Object.assign(new HttpError(409, 'Sách đã hết'), { reason: 'out_of_stock' }),
    );
    const res = await request(app).post('/api/borrow-orders/50/confirm').set('Authorization', bearer(3));
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ message: 'Sách đã hết', reason: 'out_of_stock' });
  });

  it('reject → 200 với lý do đã trim', async () => {
    const { app, borrowService } = makeApp();
    const res = await request(app).post('/api/borrow-orders/50/reject').set('Authorization', bearer(2)).send({ reason: '  Hết sách ' });
    expect(res.status).toBe(200);
    expect(borrowService.rejectBorrowOrder).toHaveBeenCalledWith(2, 50, { reason: 'Hết sách' });
  });

  it('edge 3: lý do rỗng/khoảng trắng → 400 errors.reason, không gọi service', async () => {
    const { app, borrowService } = makeApp();
    for (const body of [{}, { reason: '   ' }]) {
      const res = await request(app).post('/api/borrow-orders/50/reject').set('Authorization', bearer(2)).send(body);
      expect(res.status).toBe(400);
      expect(res.body.errors).toEqual({ reason: REASON_REQUIRED });
    }
    expect(borrowService.rejectBorrowOrder).not.toHaveBeenCalled();
  });

  it.each(['abc', '0', '1.5'])('id "%s" → 404, không gọi service', async (id) => {
    const { app, borrowService } = makeApp();
    expect((await request(app).post(`/api/borrow-orders/${id}/confirm`).set('Authorization', bearer(2))).status).toBe(404);
    expect((await request(app).post(`/api/borrow-orders/${id}/reject`).set('Authorization', bearer(2)).send({ reason: 'x' })).status).toBe(404);
    expect(borrowService.confirmBorrowOrder).not.toHaveBeenCalled();
    expect(borrowService.rejectBorrowOrder).not.toHaveBeenCalled();
  });
});
