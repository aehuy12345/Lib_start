const { HttpError } = require('../lib/httpError');

const SESSION_EXPIRED = 'Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại';

// Phân quyền theo user trong DB, không tin role trong token (2.1.2 edge 3, 4).
function createRequireAuth({ tokens, authService }) {
  return async (req, res, next) => {
    const [scheme, token] = (req.get('authorization') ?? '').split(' ');
    if (scheme !== 'Bearer' || !token) return next(new HttpError(401, 'Vui lòng đăng nhập'));

    let payload;
    try {
      payload = tokens.verify(token);
    } catch {
      return next(new HttpError(401, SESSION_EXPIRED));
    }

    const user = await authService.getSessionUser(Number(payload.sub));
    if (!user) return next(new HttpError(401, SESSION_EXPIRED));
    req.user = user;
    next();
  };
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user?.role)) {
      return next(new HttpError(403, 'Bạn không có quyền thực hiện thao tác này'));
    }
    next();
  };
}

module.exports = { createRequireAuth, requireRole };
