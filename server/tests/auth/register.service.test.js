import bcrypt from 'bcryptjs';
import { createAuthService, hashToken } from '../../src/modules/auth/auth.service';

const NOW = new Date('2026-10-23T03:00:00Z');

function makePrisma({ existing = null, createError = null } = {}) {
  const tx = {
    user: {
      create: vi.fn(async ({ data }) => {
        if (createError) throw createError;
        return { id: 1, ...data };
      }),
    },
    emailVerificationToken: { create: vi.fn(async ({ data }) => ({ id: 10, ...data })) },
  };
  return {
    tx,
    user: { findUnique: vi.fn(async () => existing) },
    $transaction: vi.fn(async (fn) => fn(tx)),
  };
}

function makeService(prisma, mailer = { sendMail: vi.fn(async () => {}) }) {
  const logger = { error: vi.fn(), info: vi.fn() };
  const service = createAuthService({
    prisma, mailer, clientUrl: 'http://app.test', now: () => NOW, logger,
  });
  return { service, mailer, logger };
}

const input = { email: 'reader@example.com', name: 'Nguyễn Văn A', password: 'secret123' };

describe('authService.register (2.1.1)', () => {
  it('tạo user role reader, status pending, hash mật khẩu', async () => {
    const prisma = makePrisma();
    const { service } = makeService(prisma);

    const user = await service.register(input);

    expect(user).toEqual({
      id: 1, email: 'reader@example.com', name: 'Nguyễn Văn A', role: 'reader', status: 'pending',
    });
    const data = prisma.tx.user.create.mock.calls[0][0].data;
    expect(data.role).toBe('reader');
    expect(data.status).toBe('pending');
    expect(data.passwordHash).not.toBe(input.password);
    expect(await bcrypt.compare(input.password, data.passwordHash)).toBe(true);
  });

  it('không trả password_hash ra ngoài', async () => {
    const { service } = makeService(makePrisma());
    const user = await service.register(input);
    expect(user).not.toHaveProperty('passwordHash');
  });

  it('tạo token xác thực hết hạn sau 24h, DB chỉ lưu hash', async () => {
    const prisma = makePrisma();
    const { service, mailer } = makeService(prisma);

    await service.register(input);

    const tokenData = prisma.tx.emailVerificationToken.create.mock.calls[0][0].data;
    expect(tokenData.userId).toBe(1);
    expect(tokenData.expiresAt).toEqual(new Date('2026-10-24T03:00:00Z'));

    const { text, to } = mailer.sendMail.mock.calls[0][0];
    expect(to).toBe('reader@example.com');
    const token = text.match(/token=([0-9a-f]{64})/)[1];
    expect(text).toContain(`http://app.test/verify-email?token=${token}`);
    expect(tokenData.tokenHash).toBe(hashToken(token));
    expect(tokenData.tokenHash).not.toBe(token);
  });

  it('email đã tồn tại → 409 "Email đã được sử dụng", không tạo user', async () => {
    const prisma = makePrisma({ existing: { id: 5 } });
    const { service } = makeService(prisma);

    await expect(service.register(input)).rejects.toMatchObject({
      status: 409,
      message: 'Email đã được sử dụng',
      errors: { email: 'Email đã được sử dụng' },
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('edge 2: request đồng thời thua ở UNIQUE (P2002) → 409', async () => {
    const prisma = makePrisma({ createError: Object.assign(new Error('unique'), { code: 'P2002' }) });
    const { service, mailer } = makeService(prisma);

    await expect(service.register(input)).rejects.toMatchObject({ status: 409 });
    expect(mailer.sendMail).not.toHaveBeenCalled();
  });

  it('lỗi DB khác được ném lại (báo lỗi hệ thống)', async () => {
    const prisma = makePrisma({ createError: new Error('connection lost') });
    const { service } = makeService(prisma);

    await expect(service.register(input)).rejects.toThrow('connection lost');
  });

  it('gửi mail lỗi vẫn đăng ký thành công và ghi log', async () => {
    const prisma = makePrisma();
    const mailer = { sendMail: vi.fn(async () => { throw new Error('smtp down'); }) };
    const { service, logger } = makeService(prisma, mailer);

    const user = await service.register(input);

    expect(user.status).toBe('pending');
    expect(logger.error).toHaveBeenCalled();
  });
});
