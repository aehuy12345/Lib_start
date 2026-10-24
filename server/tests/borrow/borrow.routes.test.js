import request from 'supertest';
import { createApp } from '../../src/app';
import { createTokenService } from '../../src/lib/tokens';
import { HttpError } from '../../src/lib/httpError';
import { INVALID_DAYS } from '../../src/modules/borrow/borrow.validation';

describe('Routes 2.3.1 /api/borrow-orders', () => {
  const tokens = createTokenService({ secret: 'test-secret', expiresIn: '24h' });
  const USERS = {
    1: { id: 1, name: 'R', role: 'reader', status: 'active' },
    2: { id: 2, name: 'L', role: 'librarian', status: 'active' },
    3: { id: 3, name: 'A', role: 'admin', status: 'active' },
  };
  const bearer = (id) => `Bearer ${tokens.sign(USERS[id])}`;

  function makeApp() {
    // Edge 6: tài khoản bị vô hiệu hóa → getSessionUser trả null → 401.
    const authService = { getSessionUser: vi.fn(async (id) => USERS[id] ?? null) };
    const borrowService = {
      createBorrowOrder: vi.fn(async () => ({ message: 'ok', order: { id: 50 } })),
      cancelBorrowOrder: vi.fn(async () => {}),
    };
    return { app: createApp({ authService, borrowService, tokens }), borrowService };
  }

  describe('POST /api/borrow-orders', () => {
    it('khách → 401; librarian/admin → 403', async () => {
      const { app, borrowService } = makeApp();
      expect((await request(app).post('/api/borrow-orders').send({ bookId: 7 })).status).toBe(401);
      for (const id of [2, 3]) {
        const res = await request(app).post('/api/borrow-orders').set('Authorization', bearer(id)).send({ bookId: 7 });
        expect(res.status).toBe(403);
      }
      expect(borrowService.createBorrowOrder).not.toHaveBeenCalled();
    });

    it('reader → 201, dùng id của chính mình, thời hạn mặc định 14', async () => {
      const { app, borrowService } = makeApp();
      const res = await request(app).post('/api/borrow-orders').set('Authorization', bearer(1)).send({ bookId: 7, readerId: 99 });
      expect(res.status).toBe(201);
      expect(res.body).toEqual({ message: 'ok', order: { id: 50 } });
      expect(borrowService.createBorrowOrder).toHaveBeenCalledWith(1, { bookId: 7, requestedDays: 14 });
    });

    it('edge 2: thời hạn sai → 400 errors.requestedDays, không gọi service', async () => {
      const { app, borrowService } = makeApp();
      const res = await request(app).post('/api/borrow-orders').set('Authorization', bearer(1)).send({ bookId: 7, requestedDays: 31 });
      expect(res.status).toBe(400);
      expect(res.body.errors).toEqual({ requestedDays: INVALID_DAYS });
      expect(borrowService.createBorrowOrder).not.toHaveBeenCalled();
    });

    it('lỗi nghiệp vụ → 409 kèm reason', async () => {
      const { app, borrowService } = makeApp();
      borrowService.createBorrowOrder.mockRejectedValue(
        Object.assign(new HttpError(409, 'Cần thanh toán phiếu phạt trước khi mượn'), { reason: 'unpaid_fine' }),
      );
      const res = await request(app).post('/api/borrow-orders').set('Authorization', bearer(1)).send({ bookId: 7 });
      expect(res.status).toBe(409);
      expect(res.body).toEqual({ message: 'Cần thanh toán phiếu phạt trước khi mượn', reason: 'unpaid_fine' });
    });
  });

  describe('POST /api/borrow-orders/:id/cancel', () => {
    it('khách → 401; nhân viên → 403', async () => {
      const { app } = makeApp();
      expect((await request(app).post('/api/borrow-orders/50/cancel')).status).toBe(401);
      expect((await request(app).post('/api/borrow-orders/50/cancel').set('Authorization', bearer(2))).status).toBe(403);
    });

    it('reader → 200', async () => {
      const { app, borrowService } = makeApp();
      const res = await request(app).post('/api/borrow-orders/50/cancel').set('Authorization', bearer(1));
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ message: 'Đã hủy yêu cầu mượn' });
      expect(borrowService.cancelBorrowOrder).toHaveBeenCalledWith(1, 50);
    });

    it.each(['abc', '0', '-1', '1.5'])('id "%s" → 404, không gọi service', async (id) => {
      const { app, borrowService } = makeApp();
      expect((await request(app).post(`/api/borrow-orders/${id}/cancel`).set('Authorization', bearer(1))).status).toBe(404);
      expect(borrowService.cancelBorrowOrder).not.toHaveBeenCalled();
    });
  });
});
