import request from 'supertest';
import { createApp } from '../../src/app';
import { createTokenService } from '../../src/lib/tokens';

const tokens = createTokenService({ secret: 'test-secret', expiresIn: '24h' });
const USERS = {
  1: { id: 1, email: 'r@example.com', name: 'R', role: 'reader', status: 'active' },
  2: { id: 2, email: 'l@example.com', name: 'L', role: 'librarian', status: 'active' },
  3: { id: 3, email: 'a@example.com', name: 'A', role: 'admin', status: 'active' },
};
const bearer = (id = 1) => `Bearer ${tokens.sign(USERS[id])}`;
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);

function makeApp() {
  const authService = { getSessionUser: vi.fn(async (id) => USERS[id] ?? null) };
  const profileService = {
    getProfile: vi.fn(async (id) => ({ id, name: 'R' })),
    updateProfile: vi.fn(async (id, data) => ({ id, ...data })),
    changePassword: vi.fn(async () => {}),
    uploadAvatar: vi.fn(async () => ({ avatarUrl: 'https://cdn/avatars/x.jpg' })),
    deleteAvatar: vi.fn(async () => ({ avatarUrl: null })),
  };
  return { app: createApp({ authService, profileService, tokens }), profileService };
}

const validProfile = { name: 'Nguyễn Văn A', phone: '0912345678', address: '1 Lê Lợi' };
const validPassword = { currentPassword: 'oldpass123', newPassword: 'newpass123', confirmPassword: 'newpass123' };

describe('Phân quyền /api/profile (2.1.3)', () => {
  it.each([
    ['get', '/api/profile'],
    ['patch', '/api/profile'],
    ['put', '/api/profile/password'],
    ['put', '/api/profile/avatar'],
    ['delete', '/api/profile/avatar'],
  ])('%s %s không có token → 401', async (method, url) => {
    const { app, profileService } = makeApp();
    const res = await request(app)[method](url);
    expect(res.status).toBe(401);
    expect(profileService.getProfile).not.toHaveBeenCalled();
  });

  it.each([2, 3])('edge 7: vai trò nhân viên/admin (user %i) → 403', async (id) => {
    const { app } = makeApp();
    const res = await request(app).get('/api/profile').set('Authorization', bearer(id));
    expect(res.status).toBe(403);
  });
});

describe('GET /api/profile', () => {
  it('reader → 200 hồ sơ của chính mình (id lấy từ phiên)', async () => {
    const { app, profileService } = makeApp();
    const res = await request(app).get('/api/profile').set('Authorization', bearer());
    expect(res.status).toBe(200);
    expect(res.body.profile).toEqual({ id: 1, name: 'R' });
    expect(profileService.getProfile).toHaveBeenCalledWith(1);
  });
});

describe('PATCH /api/profile', () => {
  it('hợp lệ → 200; trim, email/role bị bỏ (edge 4)', async () => {
    const { app, profileService } = makeApp();
    const res = await request(app).patch('/api/profile').set('Authorization', bearer())
      .send({ ...validProfile, name: '  Nguyễn Văn A ', email: 'hack@example.com', role: 'admin' });

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Cập nhật thông tin thành công');
    expect(profileService.updateProfile).toHaveBeenCalledWith(1, validProfile);
  });

  it.each(['+84912345678', '', undefined])('SĐT "%s" hợp lệ (không bắt buộc)', async (phone) => {
    const { app } = makeApp();
    const res = await request(app).patch('/api/profile').set('Authorization', bearer())
      .send({ ...validProfile, phone });
    expect(res.status).toBe(200);
  });

  it.each([
    [{ name: '' }, 'name', 'Tên không được để trống'],
    [{ name: 'a'.repeat(51) }, 'name', 'Tên tối đa 50 ký tự'],
    [{ phone: '12345' }, 'phone', 'Số điện thoại không đúng định dạng'],
    [{ phone: '091234567a' }, 'phone', 'Số điện thoại không đúng định dạng'],
    [{ phone: '+8491234567' }, 'phone', 'Số điện thoại không đúng định dạng'],
    [{ address: '   ' }, 'address', 'Địa chỉ không được để trống'],
    [{ address: undefined }, 'address', 'Địa chỉ không được để trống'],
    [{ address: 'a'.repeat(256) }, 'address', 'Địa chỉ tối đa 255 ký tự'],
  ])('%o → 400 lỗi tại %s', async (patch, field, message) => {
    const { app, profileService } = makeApp();
    const res = await request(app).patch('/api/profile').set('Authorization', bearer())
      .send({ ...validProfile, ...patch });
    expect(res.status).toBe(400);
    expect(res.body.errors[field]).toBe(message);
    expect(profileService.updateProfile).not.toHaveBeenCalled();
  });
});

describe('PUT /api/profile/password', () => {
  it('hợp lệ → 200', async () => {
    const { app, profileService } = makeApp();
    const res = await request(app).put('/api/profile/password').set('Authorization', bearer()).send(validPassword);
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Đổi mật khẩu thành công');
    expect(profileService.changePassword).toHaveBeenCalledWith(1, validPassword);
  });

  it.each([
    [{ currentPassword: '' }, 'currentPassword', 'Mật khẩu hiện tại không được để trống'],
    [{ newPassword: 'short', confirmPassword: 'short' }, 'newPassword', 'Mật khẩu tối thiểu 8 ký tự'],
    [{ newPassword: 'a'.repeat(17), confirmPassword: 'a'.repeat(17) }, 'newPassword', 'Mật khẩu tối đa 16 ký tự'],
    [{ confirmPassword: 'different1' }, 'confirmPassword', 'Xác nhận mật khẩu không khớp'],
    [{ confirmPassword: '' }, 'confirmPassword', 'Xác nhận mật khẩu không được để trống'],
  ])('%o → 400 lỗi tại %s', async (patch, field, message) => {
    const { app, profileService } = makeApp();
    const res = await request(app).put('/api/profile/password').set('Authorization', bearer())
      .send({ ...validPassword, ...patch });
    expect(res.status).toBe(400);
    expect(res.body.errors[field]).toBe(message);
    expect(profileService.changePassword).not.toHaveBeenCalled();
  });
});

describe('PUT /api/profile/avatar', () => {
  it('multipart field avatar → 200 kèm URL mới', async () => {
    const { app, profileService } = makeApp();
    const res = await request(app).put('/api/profile/avatar').set('Authorization', bearer())
      .attach('avatar', JPEG, { filename: 'a.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ message: 'Cập nhật ảnh đại diện thành công', avatarUrl: 'https://cdn/avatars/x.jpg' });
    expect(profileService.uploadAvatar).toHaveBeenCalledWith(1, expect.objectContaining({ buffer: JPEG }));
  });

  it('edge 9: file quá 2 MB → 413 ở multer, không gọi service', async () => {
    const { app, profileService } = makeApp();
    const res = await request(app).put('/api/profile/avatar').set('Authorization', bearer())
      .attach('avatar', Buffer.alloc(2 * 1024 * 1024 + 1), 'big.jpg');
    expect(res.status).toBe(413);
    expect(res.body.message).toBe('Chỉ nhận ảnh JPG, PNG, WebP tối đa 2 MB');
    expect(profileService.uploadAvatar).not.toHaveBeenCalled();
  });

  it('sai tên field / nhiều file → 400', async () => {
    const { app, profileService } = makeApp();
    const res = await request(app).put('/api/profile/avatar').set('Authorization', bearer())
      .attach('photo', JPEG, 'a.jpg');
    expect(res.status).toBe(400);
    expect(profileService.uploadAvatar).not.toHaveBeenCalled();
  });

  it('không phải multipart → service nhận file undefined (service trả 400)', async () => {
    const { app, profileService } = makeApp();
    await request(app).put('/api/profile/avatar').set('Authorization', bearer()).send({});
    expect(profileService.uploadAvatar).toHaveBeenCalledWith(1, undefined);
  });
});

describe('DELETE /api/profile/avatar', () => {
  it('→ 200, avatarUrl null', async () => {
    const { app, profileService } = makeApp();
    const res = await request(app).delete('/api/profile/avatar').set('Authorization', bearer());
    expect(res.status).toBe(200);
    expect(res.body.avatarUrl).toBeNull();
    expect(profileService.deleteAvatar).toHaveBeenCalledWith(1);
  });
});
