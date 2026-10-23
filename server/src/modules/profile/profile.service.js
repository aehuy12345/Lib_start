const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const { HttpError } = require('../../lib/httpError');
const { createLoginLimiter } = require('../../lib/loginLimiter');
const { detectImageType } = require('../../lib/imageType');
const { MAX_IMAGE_BYTES, INVALID_IMAGE } = require('../../middlewares/upload');

const BCRYPT_ROUNDS = 10;
const AVATAR_BUCKET = 'avatars';
// [Giả định] "Số lần mượn" chỉ tính đơn đã được xác nhận mượn (flow 2.1.3, điểm cần làm rõ).
const CONFIRMED_BORROW = ['borrowing', 'returned'];
const WRONG_PASSWORD = 'Mật khẩu hiện tại không đúng';

function createProfileService({
  prisma,
  storage,
  // [Giả định] Chặn dò mật khẩu hiện tại bằng token bị lộ: 5 lần sai / 15 phút mỗi user.
  passwordLimiter = createLoginLimiter(),
  newId = () => crypto.randomUUID(),
  logger = console,
}) {
  async function getProfile(userId) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new HttpError(404, 'Không tìm thấy người dùng');

    // Edge 5: số lần mượn và tiền phạt tính từ bảng liên quan, không lưu ở user.
    const [borrowCount, fineTotal, fineUnpaid] = await Promise.all([
      prisma.borrowOrder.count({ where: { readerId: userId, status: { in: CONFIRMED_BORROW } } }),
      prisma.fineTicket.aggregate({ where: { readerId: userId }, _sum: { amount: true } }),
      prisma.fineTicket.aggregate({ where: { readerId: userId, status: { not: 'paid' } }, _sum: { amount: true } }),
    ]);

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      phone: user.phone,
      address: user.address,
      avatarUrl: storage.publicUrl(AVATAR_BUCKET, user.avatarPath),
      createdAt: user.createdAt,
      borrowCount,
      totalFine: fineTotal._sum.amount ?? 0,
      unpaidFine: fineUnpaid._sum.amount ?? 0,
    };
  }

  // Input đã qua Joi: chỉ có name, phone, address (email bị bỏ, edge 4).
  async function updateProfile(userId, { name, phone, address }) {
    await prisma.user.update({
      where: { id: userId },
      data: { name, phone: phone || null, address },
    });
    return getProfile(userId);
  }

  async function changePassword(userId, { currentPassword, newPassword }) {
    const limitKey = String(userId);
    if (passwordLimiter.isBlocked(limitKey)) {
      throw new HttpError(429, 'Bạn đã nhập sai mật khẩu quá nhiều lần, vui lòng thử lại sau 15 phút');
    }

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { passwordHash: true } });
    if (!user) throw new HttpError(404, 'Không tìm thấy người dùng');

    if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
      passwordLimiter.recordFailure(limitKey);
      throw new HttpError(400, WRONG_PASSWORD, { currentPassword: WRONG_PASSWORD });
    }
    passwordLimiter.reset(limitKey);

    // Mật khẩu hiện tại đã đúng nên so chuỗi là đủ để biết mật khẩu mới có trùng không.
    if (newPassword === currentPassword) {
      const msg = 'Mật khẩu mới phải khác mật khẩu cũ';
      throw new HttpError(400, msg, { newPassword: msg });
    }

    // Edge 6 [Giả định]: giữ phiên hiện tại, token cũ hết hạn tự nhiên (JWT stateless).
    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await prisma.user.update({ where: { id: userId }, data: { passwordHash } });
  }

  // Ghi avatar_path mới và lấy giá trị cũ trong cùng một câu lệnh. FOR UPDATE khóa dòng nên
  // hai lần tải ảnh đồng thời chạy lần lượt: lần sau thấy file của lần trước và xóa nó (edge 13).
  async function swapAvatarPath(userId, path) {
    const rows = await prisma.$queryRaw`
      UPDATE users u SET avatar_path = ${path}
      FROM (SELECT id, avatar_path FROM users WHERE id = ${userId} FOR UPDATE) old
      WHERE u.id = old.id
      RETURNING old.avatar_path AS "oldPath"`;
    if (rows.length === 0) throw new HttpError(404, 'Không tìm thấy người dùng');
    return rows[0].oldPath;
  }

  // Edge 12: file cũ không xóa được thì DB vẫn đúng, chỉ ghi log để dọn sau.
  async function removeQuietly(path) {
    try {
      await storage.remove(AVATAR_BUCKET, path);
    } catch (err) {
      logger.error(`Không xóa được file ${AVATAR_BUCKET}/${path}`, err);
    }
  }

  async function uploadAvatar(userId, file) {
    if (!file?.buffer?.length) throw new HttpError(400, 'Vui lòng chọn ảnh', { avatar: 'Vui lòng chọn ảnh' });
    if (file.buffer.length > MAX_IMAGE_BYTES) {
      throw new HttpError(413, INVALID_IMAGE, { avatar: INVALID_IMAGE });
    }
    const type = detectImageType(file.buffer);
    if (!type) throw new HttpError(400, INVALID_IMAGE, { avatar: INVALID_IMAGE });

    const path = `${newId()}.${type.ext}`;
    try {
      await storage.upload(AVATAR_BUCKET, path, file.buffer, type.mime);
    } catch (err) {
      logger.error('Upload ảnh đại diện thất bại', err);
      throw new HttpError(502, 'Không tải được ảnh, vui lòng thử lại');
    }

    let oldPath;
    try {
      oldPath = await swapAvatarPath(userId, path);
    } catch (err) {
      // Edge 11: ghi DB lỗi thì xóa file vừa upload, ảnh cũ giữ nguyên.
      await removeQuietly(path);
      throw err;
    }
    if (oldPath) await removeQuietly(oldPath);

    return { avatarUrl: storage.publicUrl(AVATAR_BUCKET, path) };
  }

  async function deleteAvatar(userId) {
    const oldPath = await swapAvatarPath(userId, null);
    if (oldPath) await removeQuietly(oldPath);
    return { avatarUrl: null };
  }

  return { getProfile, updateProfile, changePassword, uploadAvatar, deleteAvatar };
}

module.exports = { createProfileService, AVATAR_BUCKET };
