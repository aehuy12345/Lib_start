const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const { HttpError } = require('../../lib/httpError');
const { createLoginLimiter } = require('../../lib/loginLimiter');

const BCRYPT_ROUNDS = 10;
const VERIFY_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // [Giả định] ERD: token sống 24h
const EMAIL_TAKEN = 'Email đã được sử dụng';
const INVALID_CREDENTIALS = 'Email hoặc mật khẩu không đúng';
// So mật khẩu với hash giả khi email không tồn tại để thời gian phản hồi giống nhau (2.1.2 edge 1).
const DUMMY_HASH = bcrypt.hashSync('dummy-password', BCRYPT_ROUNDS);

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function toPublicUser(user) {
  return { id: user.id, email: user.email, name: user.name, role: user.role, status: user.status };
}

function isUniqueViolation(err) {
  return err?.code === 'P2002';
}

function createAuthService({
  prisma,
  mailer,
  clientUrl,
  tokens,
  loginLimiter = createLoginLimiter(),
  now = () => new Date(),
  logger = console,
}) {
  // Input đã qua Joi: email lowercase + trim, name trim, field lạ (role) bị bỏ.
  async function register({ email, name, password }) {
    const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (existing) throw new HttpError(409, EMAIL_TAKEN, { email: EMAIL_TAKEN });

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(now().getTime() + VERIFY_TOKEN_TTL_MS);

    let user;
    try {
      user = await prisma.$transaction(async (tx) => {
        const created = await tx.user.create({
          data: { email, name, passwordHash, role: 'reader', status: 'pending' },
        });
        await tx.emailVerificationToken.create({
          data: { userId: created.id, tokenHash: hashToken(token), expiresAt },
        });
        return created;
      });
    } catch (err) {
      // Hai request cùng email chạy đồng thời: UNIQUE ở DB chặn request thua.
      if (isUniqueViolation(err)) throw new HttpError(409, EMAIL_TAKEN, { email: EMAIL_TAKEN });
      throw err;
    }

    // [Giả định] Gửi mail lỗi không hủy đăng ký; Admin vẫn kích hoạt thủ công được (2.6.1).
    const link = `${clientUrl}/verify-email?token=${token}`;
    try {
      await mailer.sendMail({
        to: user.email,
        subject: 'Xác nhận tài khoản thư viện',
        text: `Chào ${user.name},\n\nBấm vào link sau để xác nhận tài khoản (hiệu lực 24 giờ):\n${link}`,
      });
    } catch (err) {
      logger.error('Gửi email xác nhận thất bại', err);
    }

    return toPublicUser(user);
  }

  async function verifyEmail({ token }) {
    const record = await prisma.emailVerificationToken.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { user: true },
    });
    if (!record || record.usedAt) {
      throw new HttpError(400, 'Link xác thực không hợp lệ hoặc đã được sử dụng');
    }
    const current = now();
    if (record.expiresAt <= current) {
      throw new HttpError(400, 'Link xác thực đã hết hạn');
    }

    // Tài khoản đã bị Admin vô hiệu hóa thì chỉ ghi nhận email, không tự kích hoạt lại.
    const userData = { emailVerifiedAt: current };
    if (record.user.status === 'pending') userData.status = 'active';

    const [, user] = await prisma.$transaction([
      prisma.emailVerificationToken.update({ where: { id: record.id }, data: { usedAt: current } }),
      prisma.user.update({ where: { id: record.userId }, data: userData }),
    ]);
    return toPublicUser(user);
  }

  // Email đã qua Joi (lowercase + trim). ip dùng làm khóa rate limit cùng email.
  async function login({ email, password, ip }) {
    const limitKey = `${ip}|${email}`;
    if (loginLimiter.isBlocked(limitKey)) {
      throw new HttpError(429, 'Bạn đã nhập sai quá nhiều lần, vui lòng thử lại sau 15 phút');
    }

    const user = await prisma.user.findUnique({ where: { email } });
    const passwordOk = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !passwordOk) {
      loginLimiter.recordFailure(limitKey);
      throw new HttpError(401, INVALID_CREDENTIALS);
    }
    loginLimiter.reset(limitKey);

    // Chỉ báo trạng thái sau khi mật khẩu đúng để không lộ email đã đăng ký.
    if (user.status === 'pending') throw new HttpError(403, 'Tài khoản chưa được xác nhận');
    if (user.status === 'disabled') throw new HttpError(403, 'Tài khoản đã bị vô hiệu hóa');

    return { token: tokens.sign(user), user: toPublicUser(user) };
  }

  // Dùng cho middleware mỗi request: chỉ user còn Kích hoạt mới có phiên hợp lệ.
  async function getSessionUser(id) {
    if (!Number.isInteger(id) || id <= 0) return null;
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user || user.status !== 'active') return null;
    return toPublicUser(user);
  }

  return { register, verifyEmail, login, getSessionUser };
}

module.exports = { createAuthService, hashToken };
