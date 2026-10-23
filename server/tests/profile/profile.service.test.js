import bcrypt from 'bcryptjs';
import { createProfileService } from '../../src/modules/profile/profile.service';
import { createLoginLimiter } from '../../src/lib/loginLimiter';

const PASSWORD = 'secret123';
const HASH = bcrypt.hashSync(PASSWORD, 4);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);

function makeUser(overrides = {}) {
  return {
    id: 7,
    email: 'r@example.com',
    name: 'R',
    phone: null,
    address: null,
    avatarPath: null,
    passwordHash: HASH,
    createdAt: new Date('2026-10-01T00:00:00Z'),
    ...overrides,
  };
}

function makeService({ user = makeUser(), oldPath = null, sums = [null, null], borrowCount = 0, ...opts } = {}) {
  const prisma = {
    user: {
      findUnique: vi.fn(async () => user),
      update: vi.fn(async ({ data }) => ({ ...user, ...data })),
    },
    borrowOrder: { count: vi.fn(async () => borrowCount) },
    fineTicket: {
      aggregate: vi.fn()
        .mockResolvedValueOnce({ _sum: { amount: sums[0] } })
        .mockResolvedValueOnce({ _sum: { amount: sums[1] } }),
    },
    $queryRaw: opts.queryRaw ?? vi.fn(async () => (user ? [{ oldPath }] : [])),
  };
  const storage = {
    upload: opts.upload ?? vi.fn(async () => {}),
    remove: opts.remove ?? vi.fn(async () => {}),
    publicUrl: (bucket, path) => (path ? `https://cdn/${bucket}/${path}` : null),
  };
  const logger = { error: vi.fn() };
  const service = createProfileService({
    prisma, storage, logger, newId: () => 'uuid-1', passwordLimiter: opts.passwordLimiter,
  });
  return { service, prisma, storage, logger };
}

describe('profileService.getProfile (2.1.3)', () => {
  it('trả thông tin, ảnh, số lần mượn và tiền phạt tính từ bảng liên quan (edge 5)', async () => {
    const { service, prisma } = makeService({
      user: makeUser({ phone: '0912345678', address: 'HN', avatarPath: 'a.png' }),
      borrowCount: 3,
      sums: [70000, 20000],
    });
    const profile = await service.getProfile(7);

    expect(profile).toEqual({
      id: 7,
      email: 'r@example.com',
      name: 'R',
      phone: '0912345678',
      address: 'HN',
      avatarUrl: 'https://cdn/avatars/a.png',
      createdAt: new Date('2026-10-01T00:00:00Z'),
      borrowCount: 3,
      totalFine: 70000,
      unpaidFine: 20000,
    });
    expect(profile).not.toHaveProperty('passwordHash');
    // Chỉ đếm đơn đã xác nhận mượn.
    expect(prisma.borrowOrder.count).toHaveBeenCalledWith({
      where: { readerId: 7, status: { in: ['borrowing', 'returned'] } },
    });
    expect(prisma.fineTicket.aggregate).toHaveBeenCalledWith(expect.objectContaining({
      where: { readerId: 7, status: { not: 'paid' } },
    }));
  });

  it('edge 1: chưa có SĐT/địa chỉ/ảnh/phiếu phạt → null và 0', async () => {
    const { service } = makeService();
    const profile = await service.getProfile(7);
    expect(profile).toMatchObject({ phone: null, address: null, avatarUrl: null, totalFine: 0, unpaidFine: 0 });
  });

  it('không có user → 404', async () => {
    const { service } = makeService({ user: null });
    await expect(service.getProfile(7)).rejects.toMatchObject({ status: 404 });
  });
});

describe('profileService.updateProfile (2.1.3)', () => {
  it('chỉ ghi name, phone, address; SĐT rỗng lưu null', async () => {
    const { service, prisma } = makeService();
    await service.updateProfile(7, { name: 'Mới', phone: '', address: 'HCM' });

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { name: 'Mới', phone: null, address: 'HCM' },
    });
  });
});

describe('profileService.changePassword (2.1.3)', () => {
  const change = (service, patch = {}) =>
    service.changePassword(7, { currentPassword: PASSWORD, newPassword: 'newpass123', ...patch });

  it('đúng mật khẩu hiện tại → hash và lưu mật khẩu mới', async () => {
    const { service, prisma } = makeService();
    await change(service);

    const { passwordHash } = prisma.user.update.mock.calls[0][0].data;
    expect(await bcrypt.compare('newpass123', passwordHash)).toBe(true);
  });

  it('sai mật khẩu hiện tại → 400 lỗi tại field, không lưu', async () => {
    const { service, prisma } = makeService();
    await expect(change(service, { currentPassword: 'wrongpass' })).rejects.toMatchObject({
      status: 400, errors: { currentPassword: 'Mật khẩu hiện tại không đúng' },
    });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('mật khẩu mới trùng mật khẩu cũ → 400', async () => {
    const { service, prisma } = makeService();
    await expect(change(service, { newPassword: PASSWORD })).rejects.toMatchObject({
      status: 400, errors: { newPassword: 'Mật khẩu mới phải khác mật khẩu cũ' },
    });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('[Giả định] sai 5 lần → 429, kể cả khi lần sau nhập đúng', async () => {
    const { service } = makeService({ passwordLimiter: createLoginLimiter({ max: 5 }) });
    for (let i = 0; i < 5; i += 1) {
      await expect(change(service, { currentPassword: 'wrongpass' })).rejects.toMatchObject({ status: 400 });
    }
    await expect(change(service)).rejects.toMatchObject({ status: 429 });
  });
});

describe('profileService.uploadAvatar (2.1.3)', () => {
  it('upload tên ngẫu nhiên theo định dạng thật → ghi DB → xóa ảnh cũ', async () => {
    const { service, storage, prisma } = makeService({ oldPath: 'old.jpg' });
    const result = await service.uploadAvatar(7, { buffer: PNG, originalname: 'avatar.jpg', mimetype: 'image/jpeg' });

    // Đuôi và Content-Type lấy từ magic bytes, không theo tên/mimetype client gửi.
    expect(storage.upload).toHaveBeenCalledWith('avatars', 'uuid-1.png', PNG, 'image/png');
    expect(prisma.$queryRaw).toHaveBeenCalled();
    expect(storage.remove).toHaveBeenCalledWith('avatars', 'old.jpg');
    expect(storage.upload.mock.invocationCallOrder[0]).toBeLessThan(prisma.$queryRaw.mock.invocationCallOrder[0]);
    expect(prisma.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(storage.remove.mock.invocationCallOrder[0]);
    expect(result).toEqual({ avatarUrl: 'https://cdn/avatars/uuid-1.png' });
  });

  it('chưa có ảnh cũ → không gọi xóa', async () => {
    const { service, storage } = makeService();
    await service.uploadAvatar(7, { buffer: JPEG });
    expect(storage.remove).not.toHaveBeenCalled();
  });

  it('edge 8: file đổi đuôi (không phải ảnh) → 400, không upload', async () => {
    const { service, storage } = makeService();
    await expect(service.uploadAvatar(7, { buffer: Buffer.from('MZ\x90\x00', 'latin1'), mimetype: 'image/jpeg' }))
      .rejects.toMatchObject({ status: 400, errors: { avatar: 'Chỉ nhận ảnh JPG, PNG, WebP tối đa 2 MB' } });
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it('thiếu file → 400', async () => {
    const { service } = makeService();
    await expect(service.uploadAvatar(7, undefined)).rejects.toMatchObject({ status: 400 });
  });

  it('edge 9: quá 2 MB → 413', async () => {
    const { service } = makeService();
    const big = Buffer.concat([JPEG, Buffer.alloc(2 * 1024 * 1024)]);
    await expect(service.uploadAvatar(7, { buffer: big })).rejects.toMatchObject({ status: 413 });
  });

  it('upload Storage lỗi → 502, DB và ảnh cũ giữ nguyên', async () => {
    const { service, prisma, storage } = makeService({
      oldPath: 'old.jpg', upload: vi.fn(async () => { throw new Error('network'); }),
    });
    await expect(service.uploadAvatar(7, { buffer: JPEG })).rejects.toMatchObject({
      status: 502, message: 'Không tải được ảnh, vui lòng thử lại',
    });
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(storage.remove).not.toHaveBeenCalled();
  });

  it('edge 11: ghi DB lỗi → xóa file vừa upload, không đụng ảnh cũ', async () => {
    const { service, storage } = makeService({ queryRaw: vi.fn(async () => { throw new Error('db down'); }) });
    await expect(service.uploadAvatar(7, { buffer: JPEG })).rejects.toThrow('db down');
    expect(storage.remove).toHaveBeenCalledTimes(1);
    expect(storage.remove).toHaveBeenCalledWith('avatars', 'uuid-1.jpg');
  });

  it('edge 12: xóa ảnh cũ lỗi → vẫn thành công, chỉ ghi log', async () => {
    const { service, logger } = makeService({
      oldPath: 'old.jpg', remove: vi.fn(async () => { throw new Error('storage'); }),
    });
    await expect(service.uploadAvatar(7, { buffer: JPEG })).resolves.toEqual({
      avatarUrl: 'https://cdn/avatars/uuid-1.jpg',
    });
    expect(logger.error).toHaveBeenCalled();
  });
});

describe('profileService.deleteAvatar (2.1.3)', () => {
  it('avatar_path = null rồi xóa file trên Storage', async () => {
    const { service, storage, prisma } = makeService({ oldPath: 'old.webp' });
    await expect(service.deleteAvatar(7)).resolves.toEqual({ avatarUrl: null });

    const [, path] = prisma.$queryRaw.mock.calls[0];
    expect(path).toBeNull();
    expect(storage.remove).toHaveBeenCalledWith('avatars', 'old.webp');
  });

  it('chưa có ảnh → không gọi Storage', async () => {
    const { service, storage } = makeService();
    await service.deleteAvatar(7);
    expect(storage.remove).not.toHaveBeenCalled();
  });
});
