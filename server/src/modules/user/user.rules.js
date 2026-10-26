// 2.6.1: Admin kích hoạt hoặc vô hiệu hóa tài khoản. Trạng thái: pending (2.1.1), active, disabled.
const DISABLE_BLOCKED = {
  // Edge 1: tránh Admin tự khóa mất quyền truy cập.
  self: 'Không thể vô hiệu hóa tài khoản của chính bạn',
  // Edge 2: hệ thống luôn còn ít nhất một Admin đang hoạt động (ERD users).
  last_admin: 'Không thể vô hiệu hóa Admin cuối cùng đang hoạt động',
  already_disabled: 'Tài khoản đã bị vô hiệu hóa, danh sách đã được tải lại',
};

const ACTIVATE_BLOCKED = {
  already_active: 'Tài khoản đã được kích hoạt, danh sách đã được tải lại',
};

// 2.6.2: Admin đổi vai trò người dùng.
const ROLE_BLOCKED = {
  self: 'Không thể tự đổi vai trò của mình',
  last_admin: 'Hệ thống phải còn ít nhất một Admin đang hoạt động',
};

function isActiveAdmin(user) {
  return user.role === 'admin' && user.status === 'active';
}

// [Giả định] Tài khoản Chờ xác nhận cũng vô hiệu hóa được (vd đăng ký rác).
function evaluateDisable({ actorId, target, activeAdminCount }) {
  if (target.id === actorId) return 'self';
  if (target.status === 'disabled') return 'already_disabled';
  if (isActiveAdmin(target) && activeAdminCount <= 1) return 'last_admin';
  return null;
}

// Edge 5 [Giả định]: Kích hoạt dùng chung cho tài khoản Chờ xác nhận và Vô hiệu hóa.
function evaluateActivate(status) {
  return status === 'active' ? 'already_active' : null;
}

// Vai trò mới trùng vai trò hiện tại được xử lý trước (không thay đổi gì), nên ở đây role khác target.role.
// Edge 3 [Giả định]: tài khoản Vô hiệu hóa / Chờ xác nhận vẫn đổi được, chỉ có hiệu lực khi kích hoạt.
function evaluateRoleChange({ actorId, target, role, activeAdminCount }) {
  if (target.id === actorId) return 'self';
  if (isActiveAdmin(target) && role !== 'admin' && activeAdminCount <= 1) return 'last_admin';
  return null;
}

// Nút đổi vai trò chỉ bị ẩn với chính mình; Admin cuối cùng vẫn được nâng/giữ, server chặn khi hạ cấp.
function canChangeRole({ actorId, target }) {
  return target.id !== actorId;
}

function canDisable(args) {
  return evaluateDisable(args) === null;
}

function canActivate(status) {
  return evaluateActivate(status) === null;
}

module.exports = {
  DISABLE_BLOCKED, ACTIVATE_BLOCKED, ROLE_BLOCKED, isActiveAdmin, evaluateDisable, evaluateActivate,
  evaluateRoleChange, canDisable, canActivate, canChangeRole,
};
