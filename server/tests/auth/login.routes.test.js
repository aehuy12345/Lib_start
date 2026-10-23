import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { createApp } from '../../src/app';
import { HttpError } from '../../src/lib/httpError';
import { createTokenService } from '../../src/lib/tokens';
import { createRequireAuth, requireRole } from '../../src/middlewares/auth';
import { errorHandler } from '../../src/middlewares/errorHandler';

const SECRET = 'test-secret';
const tokens = createTokenService({ secret: SECRET, expiresIn: '24h' });
const reader = { id: 1, email: 'r@example.com', name: 'R', role: 'reader', status: 'active' };
const bearer = (user = reader) => `Bearer ${tokens.sign(user)}`;

function makeApp({ login, getSessionUser } = {}) {
  const authService = {
    register: vi.fn(),
    verifyEmail: vi.fn(),
    login: login ?? vi.fn(async ({ email }) => ({ token: 'jwt', user: { ...reader, email } })),
    getSessionUser: getSessionUser ?? vi.fn(async (id) => (id === reader.id ? reader : null)),
  };
  return { app: createApp({ authService, tokens }), authService };
}

const valid = { email: 'r@example.com', password: 'secret123' };

describe('POST /api/auth/login (2.1.2)', () => {
  it('hợp lệ → 200 kèm token và user; email được chuẩn hóa, field lạ bị bỏ', async () => {
    const { app, authService } = makeApp();
    const res = await request(app).post('/api/auth/login')
      .send({ email: '  R@Example.COM ', password: 'secret123', role: 'admin' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ message: 'Đăng nhập thành công', token: 'jwt', user: { role: 'reader' } });
    expect(authService.login).toHaveBeenCalledWith({
      email: 'r@example.com', password: 'secret123', ip: expect.any(String),
    });
  });

  it.each([
    ['email trống', { email: '' }, 'email', 'Email không được để trống'],
    ['email sai định dạng', { email: 'abc' }, 'email', 'Email không đúng định dạng'],
    ['mật khẩu trống', { password: '' }, 'password', 'Mật khẩu không được để trống'],
    ['mật khẩu 7 ký tự', { password: '1234567' }, 'password', 'Mật khẩu tối thiểu 8 ký tự'],
    ['mật khẩu 17 ký tự', { password: 'a'.repeat(17) }, 'password', 'Mật khẩu tối đa 16 ký tự'],
  ])('%s → 400', async (_, patch, field, message) => {
    const { app, authService } = makeApp();
    const res = await request(app).post('/api/auth/login').send({ ...valid, ...patch });

    expect(res.status).toBe(400);
    expect(res.body.errors[field]).toBe(message);
    expect(authService.login).not.toHaveBeenCalled();
  });

  it('body rỗng → lỗi ở cả 2 field', async () => {
    const { app } = makeApp();
    const res = await request(app).post('/api/auth/login').send({});
    expect(Object.keys(res.body.errors).sort()).toEqual(['email', 'password']);
  });

  it.each([
    [401, 'Email hoặc mật khẩu không đúng'],
    [403, 'Tài khoản chưa được xác nhận'],
    [429, 'Bạn đã nhập sai quá nhiều lần, vui lòng thử lại sau 15 phút'],
  ])('lỗi nghiệp vụ %i được trả nguyên', async (status, message) => {
    const { app } = makeApp({ login: vi.fn(async () => { throw new HttpError(status, message); }) });
    const res = await request(app).post('/api/auth/login').send(valid);
    expect(res.status).toBe(status);
    expect(res.body.message).toBe(message);
  });
});

describe('GET /api/auth/me + middleware requireAuth', () => {
  it('token hợp lệ → 200, user lấy từ DB', async () => {
    const { app } = makeApp();
    const res = await request(app).get('/api/auth/me').set('Authorization', bearer());
    expect(res.status).toBe(200);
    expect(res.body.user).toEqual(reader);
  });

  it('không có token → 401', async () => {
    const { app } = makeApp();
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.message).toBe('Vui lòng đăng nhập');
  });

  it.each([
    ['sai scheme', () => `Token ${tokens.sign(reader)}`],
    ['token rác', () => 'Bearer abc.def.ghi'],
    ['ký bằng secret khác', () => `Bearer ${jwt.sign({ role: 'admin' }, 'other', { subject: '1' })}`],
    ['alg none', () => `Bearer ${jwt.sign({ role: 'admin' }, null, { algorithm: 'none', subject: '1' })}`],
    ['edge 5: token hết hạn', () => `Bearer ${jwt.sign(
      { role: 'reader', exp: Math.floor(Date.now() / 1000) - 1 }, SECRET, { subject: '1' },
    )}`],
  ])('%s → 401, không tra DB', async (_, header) => {
    const { app, authService } = makeApp();
    const res = await request(app).get('/api/auth/me').set('Authorization', header());
    expect(res.status).toBe(401);
    expect(authService.getSessionUser).not.toHaveBeenCalled();
  });

  it('edge 3: user bị vô hiệu hóa khi token còn hạn → 401', async () => {
    const { app } = makeApp({ getSessionUser: vi.fn(async () => null) });
    const res = await request(app).get('/api/auth/me').set('Authorization', bearer());
    expect(res.status).toBe(401);
    expect(res.body.message).toBe('Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại');
  });

  it('token có hạn 24h, chứa userId và role', () => {
    const { iat, exp, sub, role } = jwt.decode(tokens.sign(reader));
    expect(exp - iat).toBe(24 * 60 * 60);
    expect({ sub, role }).toEqual({ sub: '1', role: 'reader' });
  });
});

describe('requireRole', () => {
  // Route thử: chỉ librarian/admin vào được.
  function makeStaffApp(dbUser) {
    const app = express();
    const requireAuth = createRequireAuth({ tokens, authService: { getSessionUser: async () => dbUser } });
    app.get('/staff', requireAuth, requireRole('librarian', 'admin'), (req, res) => res.json({ role: req.user.role }));
    app.use(errorHandler);
    return app;
  }

  it.each(['librarian', 'admin'])('%s → 200', async (role) => {
    const user = { ...reader, role };
    const res = await request(makeStaffApp(user)).get('/staff').set('Authorization', bearer(user));
    expect(res.status).toBe(200);
  });

  it('reader → 403', async () => {
    const res = await request(makeStaffApp(reader)).get('/staff').set('Authorization', bearer());
    expect(res.status).toBe(403);
    expect(res.body.message).toBe('Bạn không có quyền thực hiện thao tác này');
  });

  it('edge 4: token mang role admin nhưng DB đã đổi thành reader → 403', async () => {
    const res = await request(makeStaffApp(reader)).get('/staff').set('Authorization', bearer({ ...reader, role: 'admin' }));
    expect(res.status).toBe(403);
  });
});
