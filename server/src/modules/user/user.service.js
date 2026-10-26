const { Prisma } = require('@prisma/client');
const { HttpError } = require('../../lib/httpError');
const { escapeLike } = require('../book/book.service');
const {
  DISABLE_BLOCKED, ACTIVATE_BLOCKED, evaluateDisable, evaluateActivate, canDisable, canActivate,
} = require('./user.rules');

const PAGE_SIZE = 10;
const USER_NOT_FOUND = 'Không tìm thấy người dùng';
const NOT_ADMIN = 'Bạn không có quyền thực hiện thao tác này';
const DISABLED = 'Đã vô hiệu hóa tài khoản';
const ACTIVATED = 'Đã kích hoạt tài khoản';

function blocked(messages, reason) {
  return Object.assign(new HttpError(409, messages[reason]), { reason });
}

// Edge 3: số đơn đang mượn để client cảnh báo trước khi vô hiệu hóa.
const USER_COLUMNS = Prisma.sql`
  u.id, u.email, u.name, u.role, u.status, u.created_at AS "createdAt",
  (SELECT count(*)::int FROM borrow_orders bo WHERE bo.reader_id = u.id AND bo.status = 'borrowing')
    AS "activeBorrowCount"`;

function toUser(row, actorId, activeAdminCount) {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    status: row.status,
    createdAt: row.createdAt,
    activeBorrowCount: row.activeBorrowCount,
    isSelf: row.id === actorId,
    canDisable: canDisable({ actorId, target: row, activeAdminCount }),
    canActivate: canActivate(row.status),
  };
}

function createUserService({ prisma }) {
  async function countActiveAdmins(db = prisma) {
    return db.user.count({ where: { role: 'admin', status: 'active' } });
  }

  // 2.6.1, chỉ Admin. Query đã qua Joi: { role, q, page }. Mới tham gia trước.
  async function listUsers(actorId, { role = 'all', q = '', page = 1 }) {
    const conditions = [];
    if (role !== 'all') conditions.push(Prisma.sql`u.role = ${role}::user_role`);
    if (q) {
      // Edge 6: từ khóa đi qua tham số, escape wildcard; như 2.2.3 không phân biệt hoa thường và dấu.
      const pattern = `%${escapeLike(q)}%`;
      conditions.push(Prisma.sql`(public.immutable_unaccent(u.name) ILIKE public.immutable_unaccent(${pattern})
        OR u.email ILIKE ${pattern})`);
    }
    const where = conditions.length ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}` : Prisma.empty;

    const [[{ count }], activeAdminCount] = await Promise.all([
      prisma.$queryRaw`SELECT count(*)::int AS count FROM users u ${where}`,
      countActiveAdmins(),
    ]);
    // Edge 7 [Giả định]: 10 dòng/trang như các danh sách khác; trang vượt cuối trả trang cuối.
    const totalPages = Math.max(1, Math.ceil(count / PAGE_SIZE));
    const current = Math.min(page, totalPages);
    const rows = count === 0 ? [] : await prisma.$queryRaw`
      SELECT ${USER_COLUMNS} FROM users u ${where}
      ORDER BY u.created_at DESC, u.id DESC
      LIMIT ${PAGE_SIZE} OFFSET ${(current - 1) * PAGE_SIZE}`;

    return {
      users: rows.map((row) => toUser(row, actorId, activeAdminCount)),
      pagination: { page: current, pageSize: PAGE_SIZE, total: count, totalPages },
    };
  }

  // Khóa mọi Admin đang hoạt động (theo id) rồi tới dòng người dùng: hai Admin vô hiệu hóa nhau cùng lúc
  // thì người sau thấy mình đã bị khóa (403), nên không bao giờ hết Admin (edge 2). 2.6.2 đổi vai trò
  // phải khóa theo cùng thứ tự.
  async function changeStatus(actorId, id, evaluate, messages, status, action) {
    return prisma.$transaction(async (tx) => {
      const admins = await tx.$queryRaw`
        SELECT id FROM users WHERE role = 'admin' AND status = 'active' ORDER BY id FOR UPDATE`;
      if (!admins.some((admin) => admin.id === actorId)) throw new HttpError(403, NOT_ADMIN);
      const [target] = await tx.$queryRaw`SELECT id, role, status FROM users WHERE id = ${id} FOR UPDATE`;
      if (!target) throw new HttpError(404, USER_NOT_FOUND);
      const reason = evaluate({ actorId, target, activeAdminCount: admins.length });
      if (reason) throw blocked(messages, reason);

      await tx.user.update({ where: { id }, data: { status } });
      // ERD audit_logs: ghi người thực hiện kích hoạt hoặc vô hiệu hóa.
      await tx.auditLog.create({
        data: {
          actorId, action, entityType: 'user', entityId: id, oldValue: { status: target.status }, newValue: { status },
        },
      });
      const [row] = await tx.$queryRaw`SELECT ${USER_COLUMNS} FROM users u WHERE u.id = ${id}`;
      return toUser(row, actorId, await countActiveAdmins(tx));
    });
  }

  // Edge 3: đơn mượn giữ nguyên, nhân viên vẫn xử lý trả sách và phiếu phạt. Edge 4: requireAuth đọc
  // status từ DB nên request kế tiếp của người bị khóa nhận 401.
  async function disableUser(actorId, id) {
    const user = await changeStatus(actorId, id, evaluateDisable, DISABLE_BLOCKED, 'disabled', 'user.disable');
    return { message: DISABLED, user };
  }

  // Edge 5: kích hoạt tài khoản Chờ xác nhận không đặt email_verified_at (email chưa được xác nhận).
  async function activateUser(actorId, id) {
    const evaluate = ({ target }) => evaluateActivate(target.status);
    const user = await changeStatus(actorId, id, evaluate, ACTIVATE_BLOCKED, 'active', 'user.activate');
    return { message: ACTIVATED, user };
  }

  return { listUsers, disableUser, activateUser };
}

module.exports = { createUserService, PAGE_SIZE, USER_NOT_FOUND, NOT_ADMIN, DISABLED, ACTIVATED };
