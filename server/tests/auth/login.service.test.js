import bcrypt from 'bcryptjs';
import { createAuthService } from '../../src/modules/auth/auth.service';
import { createLoginLimiter } from '../../src/lib/loginLimiter';

const PASSWORD = 'secret123';
const HASH = bcrypt.hashSync(PASSWORD, 4);

function makeUser(overrides = {}) {
  return {
    id: 7, email: 'r@example.com', name: 'R', passwordHash: HASH, role: 'reader', status: 'active', ...overrides,
  };
}

function makeService(user, { loginLimiter } = {}) {
  const prisma = { user: { findUnique: vi.fn(async () => user) } };
  const tokens = { sign: vi.fn(() => 'signed-jwt') };
  const service = createAuthService({
    prisma, mailer: { sendMail: vi.fn() }, clientUrl: 'x', tokens, loginLimiter,
  });
  return { service, prisma, tokens };
}

const login = (service, patch = {}) =>
  service.login({ email: 'r@example.com', password: PASSWORD, ip: '1.1.1.1', ...patch });

async function failTimes(service, n) {
  for (let i = 0; i < n; i += 1) {
    await expect(login(service, { password: 'wrongpass' })).rejects.toMatchObject({ status: 401 });
  }
}

describe('authService.login (2.1.2)', () => {
  it.each(['reader', 'librarian', 'admin'])('tài khoản %s đang kích hoạt → trả token và user', async (role) => {
    const { service, tokens } = makeService(makeUser({ role }));
    const result = await login(service);

    expect(result.token).toBe('signed-jwt');
    expect(result.user).toEqual({ id: 7, email: 'r@example.com', name: 'R', role, status: 'active' });
    expect(tokens.sign).toHaveBeenCalledWith(expect.objectContaining({ id: 7, role }));
  });

  it('edge 1: email không tồn tại → 401 thông báo chung', async () => {
    const { service } = makeService(null);
    await expect(login(service)).rejects.toMatchObject({ status: 401, message: 'Email hoặc mật khẩu không đúng' });
  });

  it('edge 1: sai mật khẩu → cùng 401 thông báo chung', async () => {
    const { service, tokens } = makeService(makeUser());
    await expect(login(service, { password: 'wrongpass' }))
      .rejects.toMatchObject({ status: 401, message: 'Email hoặc mật khẩu không đúng' });
    expect(tokens.sign).not.toHaveBeenCalled();
  });

  it('tài khoản chờ xác nhận + mật khẩu đúng → 403', async () => {
    const { service, tokens } = makeService(makeUser({ status: 'pending' }));
    await expect(login(service)).rejects.toMatchObject({ status: 403, message: 'Tài khoản chưa được xác nhận' });
    expect(tokens.sign).not.toHaveBeenCalled();
  });

  it('tài khoản vô hiệu hóa + mật khẩu đúng → 403', async () => {
    const { service } = makeService(makeUser({ status: 'disabled' }));
    await expect(login(service)).rejects.toMatchObject({ status: 403, message: 'Tài khoản đã bị vô hiệu hóa' });
  });

  it('không lộ trạng thái khi sai mật khẩu: pending + sai mật khẩu vẫn là 401 chung', async () => {
    const { service } = makeService(makeUser({ status: 'pending' }));
    await expect(login(service, { password: 'wrongpass' })).rejects.toMatchObject({ status: 401 });
  });

  describe('edge 2: rate limit 5 lần sai / 15 phút theo IP + email', () => {
    it('sau 5 lần sai bị chặn 429, kể cả khi mật khẩu đúng', async () => {
      const { service, prisma } = makeService(makeUser(), { loginLimiter: createLoginLimiter() });
      await failTimes(service, 5);
      prisma.user.findUnique.mockClear();

      await expect(login(service)).rejects.toMatchObject({ status: 429 });
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });

    it('IP khác hoặc email khác không bị ảnh hưởng', async () => {
      const { service } = makeService(makeUser(), { loginLimiter: createLoginLimiter() });
      await failTimes(service, 5);
      await expect(login(service, { ip: '2.2.2.2' })).resolves.toHaveProperty('token');
      await expect(login(service, { email: 'other@example.com' })).resolves.toHaveProperty('token');
    });

    it('đăng nhập đúng xóa bộ đếm lần sai', async () => {
      const { service } = makeService(makeUser(), { loginLimiter: createLoginLimiter() });
      await failTimes(service, 4);
      await login(service);
      await failTimes(service, 4);
      await expect(login(service)).resolves.toHaveProperty('token');
    });
  });
});

describe('authService.getSessionUser (2.1.2 phiên đăng nhập)', () => {
  it('user đang kích hoạt → trả user với role từ DB', async () => {
    const { service } = makeService(makeUser({ role: 'librarian' }));
    await expect(service.getSessionUser(7)).resolves.toMatchObject({ id: 7, role: 'librarian' });
  });

  it.each(['pending', 'disabled'])('edge 3: user %s → null', async (status) => {
    const { service } = makeService(makeUser({ status }));
    await expect(service.getSessionUser(7)).resolves.toBeNull();
  });

  it('user không còn tồn tại → null', async () => {
    const { service } = makeService(null);
    await expect(service.getSessionUser(7)).resolves.toBeNull();
  });

  it('id không hợp lệ → null, không truy vấn DB', async () => {
    const { service, prisma } = makeService(makeUser());
    await expect(service.getSessionUser(NaN)).resolves.toBeNull();
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });
});
