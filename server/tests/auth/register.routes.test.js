import request from 'supertest';
import { createApp } from '../../src/app';
import { HttpError } from '../../src/lib/httpError';

function makeApp(register = vi.fn(async (body) => ({ id: 1, ...body, role: 'reader', status: 'pending' }))) {
  const authService = { register, verifyEmail: vi.fn() };
  return { app: createApp({ authService }), register };
}

const valid = {
  email: 'reader@example.com',
  name: 'Nguyễn Văn A',
  password: 'secret123',
  confirmPassword: 'secret123',
};

describe('POST /api/auth/register: validation (2.1.1)', () => {
  it('dữ liệu hợp lệ → 201, kèm thông báo chờ xác nhận', async () => {
    const { app, register } = makeApp();
    const res = await request(app).post('/api/auth/register').send(valid);

    expect(res.status).toBe(201);
    expect(res.body.message).toMatch(/chờ xác nhận/);
    expect(register).toHaveBeenCalledWith({
      email: 'reader@example.com', name: 'Nguyễn Văn A', password: 'secret123', confirmPassword: 'secret123',
    });
  });

  it('edge 1: email chữ hoa và khoảng trắng được chuẩn hóa về lowercase', async () => {
    const { app, register } = makeApp();
    await request(app).post('/api/auth/register').send({ ...valid, email: '  Reader@Example.COM ' });
    expect(register.mock.calls[0][0].email).toBe('reader@example.com');
  });

  it('edge 7: field role bị bỏ qua', async () => {
    const { app, register } = makeApp();
    await request(app).post('/api/auth/register').send({ ...valid, role: 'admin', status: 'active' });
    expect(register.mock.calls[0][0]).not.toHaveProperty('role');
    expect(register.mock.calls[0][0]).not.toHaveProperty('status');
  });

  it('tên được trim', async () => {
    const { app, register } = makeApp();
    await request(app).post('/api/auth/register').send({ ...valid, name: '  An  ' });
    expect(register.mock.calls[0][0].name).toBe('An');
  });

  it.each([
    ['email sai định dạng', { email: 'abc' }, 'email', 'Email không đúng định dạng'],
    ['email trống', { email: '' }, 'email', 'Email không được để trống'],
    ['edge 5: tên chỉ có khoảng trắng', { name: '   ' }, 'name', 'Tên không được để trống'],
    ['tên 51 ký tự', { name: 'a'.repeat(51) }, 'name', 'Tên tối đa 50 ký tự'],
    ['edge 3: mật khẩu 7 ký tự', { password: '1234567', confirmPassword: '1234567' }, 'password', 'Mật khẩu tối thiểu 8 ký tự'],
    ['edge 3: mật khẩu 17 ký tự', { password: 'a'.repeat(17), confirmPassword: 'a'.repeat(17) }, 'password', 'Mật khẩu tối đa 16 ký tự'],
    ['edge 4: confirm không khớp', { confirmPassword: 'secret124' }, 'confirmPassword', 'Xác nhận mật khẩu không khớp'],
    ['confirm trống', { confirmPassword: '' }, 'confirmPassword', 'Xác nhận mật khẩu không được để trống'],
  ])('%s → 400', async (_, patch, field, message) => {
    const { app, register } = makeApp();
    const res = await request(app).post('/api/auth/register').send({ ...valid, ...patch });

    expect(res.status).toBe(400);
    expect(res.body.errors[field]).toBe(message);
    expect(register).not.toHaveBeenCalled();
  });

  it('mật khẩu đúng biên 8 và 16 ký tự được chấp nhận', async () => {
    for (const password of ['a'.repeat(8), 'a'.repeat(16)]) {
      const { app } = makeApp();
      const res = await request(app).post('/api/auth/register').send({ ...valid, password, confirmPassword: password });
      expect(res.status).toBe(201);
    }
  });

  it('thiếu mọi field → 400 với lỗi từng field', async () => {
    const { app } = makeApp();
    const res = await request(app).post('/api/auth/register').send({});
    expect(Object.keys(res.body.errors).sort()).toEqual(['confirmPassword', 'email', 'name', 'password']);
  });

  it('email đã tồn tại → 409', async () => {
    const { app } = makeApp(vi.fn(async () => {
      throw new HttpError(409, 'Email đã được sử dụng', { email: 'Email đã được sử dụng' });
    }));
    const res = await request(app).post('/api/auth/register').send(valid);
    expect(res.status).toBe(409);
    expect(res.body.errors.email).toBe('Email đã được sử dụng');
  });

  it('lỗi không lường trước → 500, không lộ chi tiết', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { app } = makeApp(vi.fn(async () => { throw new Error('db password wrong'); }));
    const res = await request(app).post('/api/auth/register').send(valid);
    expect(res.status).toBe(500);
    expect(res.body.message).toBe('Lỗi hệ thống, vui lòng thử lại sau');
  });
});

describe('POST /api/auth/verify-email', () => {
  it('token sai định dạng → 400', async () => {
    const { app } = makeApp();
    const res = await request(app).post('/api/auth/verify-email').send({ token: 'xyz' });
    expect(res.status).toBe(400);
  });
});
