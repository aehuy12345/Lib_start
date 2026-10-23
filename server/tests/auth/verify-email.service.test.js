import { createAuthService, hashToken } from '../../src/modules/auth/auth.service';

const NOW = new Date('2026-10-23T03:00:00Z');
const TOKEN = 'a'.repeat(64);

function makePrisma(record) {
  return {
    emailVerificationToken: {
      findUnique: vi.fn(async () => record),
      update: vi.fn((args) => ({ op: 'token.update', args })),
    },
    user: {
      update: vi.fn((args) => ({ op: 'user.update', args })),
    },
    $transaction: vi.fn(async (ops) => [
      {},
      { id: record.userId, email: 'r@example.com', name: 'R', role: 'reader', ...ops[1].args.data },
    ]),
  };
}

function makeRecord(overrides = {}) {
  return {
    id: 10,
    userId: 1,
    usedAt: null,
    expiresAt: new Date('2026-10-23T10:00:00Z'),
    user: { id: 1, status: 'pending' },
    ...overrides,
  };
}

function makeService(prisma) {
  return createAuthService({ prisma, mailer: { sendMail: vi.fn() }, clientUrl: 'x', now: () => NOW });
}

describe('authService.verifyEmail (2.1.1, README điểm 1)', () => {
  it('kích hoạt tài khoản pending và đánh dấu token đã dùng', async () => {
    const prisma = makePrisma(makeRecord());
    const user = await makeService(prisma).verifyEmail({ token: TOKEN });

    expect(prisma.emailVerificationToken.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tokenHash: hashToken(TOKEN) } }),
    );
    expect(prisma.emailVerificationToken.update.mock.calls[0][0].data).toEqual({ usedAt: NOW });
    expect(prisma.user.update.mock.calls[0][0].data).toEqual({ emailVerifiedAt: NOW, status: 'active' });
    expect(user.status).toBe('active');
  });

  it('tài khoản đã bị vô hiệu hóa: chỉ ghi nhận email, không kích hoạt lại', async () => {
    const prisma = makePrisma(makeRecord({ user: { id: 1, status: 'disabled' } }));
    await makeService(prisma).verifyEmail({ token: TOKEN });

    expect(prisma.user.update.mock.calls[0][0].data).toEqual({ emailVerifiedAt: NOW });
  });

  it('token không tồn tại → 400', async () => {
    const prisma = makePrisma(null);
    prisma.emailVerificationToken.findUnique = vi.fn(async () => null);
    await expect(makeService(prisma).verifyEmail({ token: TOKEN }))
      .rejects.toMatchObject({ status: 400 });
  });

  it('token đã dùng → 400', async () => {
    const prisma = makePrisma(makeRecord({ usedAt: new Date('2026-10-22T00:00:00Z') }));
    await expect(makeService(prisma).verifyEmail({ token: TOKEN }))
      .rejects.toMatchObject({ status: 400, message: 'Link xác thực không hợp lệ hoặc đã được sử dụng' });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('token hết hạn → 400 "Link xác thực đã hết hạn"', async () => {
    const prisma = makePrisma(makeRecord({ expiresAt: NOW }));
    await expect(makeService(prisma).verifyEmail({ token: TOKEN }))
      .rejects.toMatchObject({ status: 400, message: 'Link xác thực đã hết hạn' });
  });
});
