import request from 'supertest';
import { Prisma } from '@prisma/client';
import { createApp } from '../../src/app';
import { createTokenService } from '../../src/lib/tokens';
import {
  DISABLE_BLOCKED, ACTIVATE_BLOCKED, evaluateDisable, evaluateActivate, canDisable, canActivate,
} from '../../src/modules/user/user.rules';
import { listUsersQuerySchema, parseUserId } from '../../src/modules/user/user.validation';
import {
  createUserService, USER_NOT_FOUND, NOT_ADMIN, DISABLED, ACTIVATED,
} from '../../src/modules/user/user.service';

const JOINED = new Date('2026-10-01T03:00:00Z');

describe('Quy tắc 2.6.1', () => {
  const reader = { id: 5, role: 'reader', status: 'active' };
  const admin = { id: 9, role: 'admin', status: 'active' };

  it.each([
    ['reader đang hoạt động', reader, 1, null],
    ['tài khoản Chờ xác nhận', { ...reader, status: 'pending' }, 1, null],
    ['edge 1: chính mình', { ...admin, id: 3 }, 2, 'self'],
    ['đã vô hiệu hóa', { ...reader, status: 'disabled' }, 1, 'already_disabled'],
    ['edge 2: Admin cuối cùng', admin, 1, 'last_admin'],
    ['Admin khác khi còn 2 Admin', admin, 2, null],
    ['Admin đã bị khóa không tính là Admin hoạt động', { ...admin, status: 'disabled' }, 1, 'already_disabled'],
  ])('vô hiệu hóa %s', (_, target, activeAdminCount, reason) => {
    const args = { actorId: 3, target, activeAdminCount };
    expect(evaluateDisable(args)).toBe(reason);
    expect(canDisable(args)).toBe(reason === null);
  });

  it.each([
    // Edge 5: tài khoản Chờ xác nhận dùng cùng thao tác Kích hoạt.
    ['pending', null], ['disabled', null], ['active', 'already_active'],
  ])('kích hoạt %s → %s', (status, reason) => {
    expect(evaluateActivate(status)).toBe(reason);
    expect(canActivate(status)).toBe(reason === null);
  });

  it.each([
    [{}, { role: 'all', q: '', page: 1 }],
    [{ role: 'librarian', q: '  an  ', page: '3' }, { role: 'librarian', q: 'an', page: 3 }],
    [{ role: 'boss', q: 'x'.repeat(101), page: '-1' }, { role: 'all', q: '', page: 1 }],
  ])('query %j → %j', (input, expected) => {
    expect(listUsersQuerySchema.validate(input).value).toEqual(expected);
  });

  it.each([['7', 7], ['0', null], ['abc', null], ['1.5', null], ['2147483648', null]])('id "%s" → %s', (raw, id) => {
    expect(parseUserId(raw)).toBe(id);
  });
});

const ROW = {
  id: 5, email: 'an@example.com', name: 'An', role: 'reader', status: 'active', createdAt: JOINED, activeBorrowCount: 2,
  pendingBorrowCount: 1, unpaidFineCount: 3,
};

// Ghép lại câu SQL mà $queryRaw nhận để kiểm tra điều kiện và tham số.
function sqlOf(call) {
  const [strings, ...values] = call;
  return Prisma.sql(strings, ...values);
}

describe('userService.listUsers', () => {
  function makeService(rows = [ROW], total = rows.length, activeAdmins = 2) {
    const prisma = {
      $queryRaw: vi.fn(async (strings) => (strings.join('').includes('AS count FROM users') ? [{ count: total }] : rows)),
      user: { count: vi.fn(async () => activeAdmins) },
    };
    return { service: createUserService({ prisma }), prisma };
  }

  it('hiển thị Email, Tên, Vai trò, Ngày tham gia, Trạng thái kèm số sách đang mượn', async () => {
    const { service, prisma } = makeService();
    const result = await service.listUsers(3, { role: 'all', q: '', page: 1 });
    expect(result.users).toEqual([{
      id: 5, email: 'an@example.com', name: 'An', role: 'reader', status: 'active', createdAt: JOINED,
      activeBorrowCount: 2, pendingBorrowCount: 1, unpaidFineCount: 3, isSelf: false, canDisable: true,
      canActivate: false, canChangeRole: true,
    }]);
    expect(result.pagination).toEqual({ page: 1, pageSize: 10, total: 1, totalPages: 1 });
    const list = sqlOf(prisma.$queryRaw.mock.calls[1]);
    expect(list.sql).not.toContain('WHERE u.');
    expect(list.sql).toContain('ORDER BY u.created_at DESC, u.id DESC');
    expect(list.values).toEqual([10, 0]);
    expect(prisma.user.count).toHaveBeenCalledWith({ where: { role: 'admin', status: 'active' } });
  });

  it('edge 6: lọc vai trò và tìm theo tên/email, escape wildcard, không phân biệt dấu', async () => {
    const { service, prisma } = makeService();
    await service.listUsers(3, { role: 'librarian', q: '50%_a\\', page: 1 });
    const count = sqlOf(prisma.$queryRaw.mock.calls[0]);
    expect(count.sql).toContain('u.role = ?::user_role');
    expect(count.sql).toContain('immutable_unaccent(u.name) ILIKE public.immutable_unaccent(?)');
    expect(count.sql).toContain('u.email ILIKE ?');
    expect(count.values).toEqual(['librarian', '%50\\%\\_a\\\\%', '%50\\%\\_a\\\\%']);
  });

  it('không có kết quả thì không truy vấn danh sách', async () => {
    const { service, prisma } = makeService([], 0);
    const result = await service.listUsers(3, { role: 'all', q: 'zzz', page: 1 });
    expect(result.users).toEqual([]);
    expect(result.pagination).toEqual({ page: 1, pageSize: 10, total: 0, totalPages: 1 });
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('edge 7: trang vượt cuối trả trang cuối', async () => {
    const { service, prisma } = makeService([ROW], 25);
    const result = await service.listUsers(3, { role: 'all', q: '', page: 9 });
    expect(result.pagination).toEqual({ page: 3, pageSize: 10, total: 25, totalPages: 3 });
    expect(sqlOf(prisma.$queryRaw.mock.calls[1]).values).toEqual([10, 20]);
  });

  it('edge 1, 2: chính mình và Admin cuối cùng không có nút Vô hiệu hóa', async () => {
    const self = { ...ROW, id: 3, role: 'admin' };
    const { service } = makeService([self], 1, 1);
    const [user] = (await service.listUsers(3, {})).users;
    expect(user).toMatchObject({ isSelf: true, canDisable: false, canChangeRole: false });
  });
});

describe('userService.disableUser / activateUser', () => {
  function makeService({ admins = [{ id: 3 }, { id: 9 }], target = ROW, after = ROW, activeAdmins = 2 } = {}) {
    const tx = {
      $queryRaw: vi.fn()
        .mockResolvedValueOnce(admins)
        .mockResolvedValueOnce(target ? [target] : [])
        .mockResolvedValueOnce([after]),
      user: { update: vi.fn(async () => ({})), count: vi.fn(async () => activeAdmins) },
      auditLog: { create: vi.fn(async () => ({})) },
    };
    const prisma = { $transaction: vi.fn(async (fn) => fn(tx)) };
    return { service: createUserService({ prisma }), tx };
  }

  it('vô hiệu hóa: khóa Admin rồi người dùng, cập nhật status, ghi audit log', async () => {
    const { service, tx } = makeService({ after: { ...ROW, status: 'disabled' } });
    const result = await service.disableUser(3, 5);
    const [lockAdmins, lockTarget] = tx.$queryRaw.mock.calls.map(sqlOf);
    expect(lockAdmins.sql).toMatch(/role = 'admin' AND status = 'active' ORDER BY id FOR UPDATE/);
    expect(lockTarget.sql).toMatch(/FROM users WHERE id = \? FOR UPDATE/);
    expect(lockTarget.values).toEqual([5]);
    expect(tx.user.update).toHaveBeenCalledWith({ where: { id: 5 }, data: { status: 'disabled' } });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: {
        actorId: 3, action: 'user.disable', entityType: 'user', entityId: 5,
        oldValue: { status: 'active' }, newValue: { status: 'disabled' },
      },
    });
    expect(result.message).toBe(DISABLED);
    // Edge 3: đơn mượn giữ nguyên, chỉ đổi trạng thái tài khoản.
    expect(result.user).toMatchObject({ id: 5, status: 'disabled', activeBorrowCount: 2, canActivate: true });
  });

  it.each([
    ['edge 1: chính mình', { target: { id: 3, role: 'admin', status: 'active' } }, 'self'],
    ['edge 2: Admin cuối cùng', { admins: [{ id: 3 }], target: { id: 9, role: 'admin', status: 'active' } }, 'last_admin'],
    ['đã bị vô hiệu hóa', { target: { ...ROW, status: 'disabled' } }, 'already_disabled'],
  ])('%s → 409', async (_, options, reason) => {
    const { service, tx } = makeService(options);
    await expect(service.disableUser(3, options.target.id)).rejects.toMatchObject({
      status: 409, reason, message: DISABLE_BLOCKED[reason],
    });
    expect(tx.user.update).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('edge 2: hai Admin vô hiệu hóa nhau, người sau đã bị khóa → 403', async () => {
    const { service, tx } = makeService({ admins: [{ id: 9 }], target: { id: 9, role: 'admin', status: 'active' } });
    await expect(service.disableUser(3, 9)).rejects.toMatchObject({ status: 403, message: NOT_ADMIN });
    expect(tx.user.update).not.toHaveBeenCalled();
  });

  it('người dùng không tồn tại → 404', async () => {
    const { service } = makeService({ target: null });
    await expect(service.disableUser(3, 404)).rejects.toMatchObject({ status: 404, message: USER_NOT_FOUND });
  });

  it('edge 5: kích hoạt tài khoản Chờ xác nhận', async () => {
    const pending = { ...ROW, status: 'pending' };
    const { service, tx } = makeService({ target: pending, after: { ...pending, status: 'active' } });
    const result = await service.activateUser(3, 5);
    expect(tx.user.update).toHaveBeenCalledWith({ where: { id: 5 }, data: { status: 'active' } });
    expect(tx.auditLog.create.mock.calls[0][0].data).toMatchObject({
      action: 'user.activate', oldValue: { status: 'pending' }, newValue: { status: 'active' },
    });
    expect(result).toMatchObject({ message: ACTIVATED, user: { status: 'active', canDisable: true } });
  });

  it('kích hoạt tài khoản đã kích hoạt → 409', async () => {
    const { service } = makeService();
    await expect(service.activateUser(3, 5)).rejects.toMatchObject({
      status: 409, reason: 'already_active', message: ACTIVATE_BLOCKED.already_active,
    });
  });
});

describe('Phân quyền /api/users', () => {
  const tokens = createTokenService({ secret: 'test-secret', expiresIn: '24h' });
  const USERS = {
    1: { id: 1, email: 'r@example.com', name: 'R', role: 'reader', status: 'active' },
    2: { id: 2, email: 'l@example.com', name: 'L', role: 'librarian', status: 'active' },
    3: { id: 3, email: 'a@example.com', name: 'A', role: 'admin', status: 'active' },
  };
  const bearer = (id = 3) => `Bearer ${tokens.sign(USERS[id])}`;

  function makeApp() {
    const authService = { getSessionUser: vi.fn(async (id) => USERS[id] ?? null) };
    const userService = {
      listUsers: vi.fn(async () => ({ users: [], pagination: { page: 1, pageSize: 10, total: 0, totalPages: 1 } })),
      disableUser: vi.fn(async (actorId, id) => ({ message: DISABLED, user: { id } })),
      activateUser: vi.fn(async (actorId, id) => ({ message: ACTIVATED, user: { id } })),
    };
    return { app: createApp({ authService, userService, tokens }), userService, authService };
  }

  const ROUTES = [['get', '/api/users'], ['post', '/api/users/5/disable'], ['post', '/api/users/5/activate']];

  it.each(ROUTES)('%s %s không có token → 401', async (method, url) => {
    const { app } = makeApp();
    expect((await request(app)[method](url)).status).toBe(401);
  });

  it.each(ROUTES)('edge 8: librarian và reader %s %s → 403', async (method, url) => {
    const { app, userService } = makeApp();
    for (const id of [1, 2]) {
      expect((await request(app)[method](url).set('Authorization', bearer(id))).status).toBe(403);
    }
    expect(userService.listUsers).not.toHaveBeenCalled();
    expect(userService.disableUser).not.toHaveBeenCalled();
    expect(userService.activateUser).not.toHaveBeenCalled();
  });

  it('admin xem danh sách, query lạ về mặc định', async () => {
    const { app, userService } = makeApp();
    const res = await request(app).get('/api/users?role=x&q=%20an%20&page=abc').set('Authorization', bearer());
    expect(res.status).toBe(200);
    expect(userService.listUsers).toHaveBeenCalledWith(3, { role: 'all', q: 'an', page: 1 });
  });

  it('admin vô hiệu hóa và kích hoạt', async () => {
    const { app, userService } = makeApp();
    const disabled = await request(app).post('/api/users/5/disable').set('Authorization', bearer());
    expect(disabled.status).toBe(200);
    expect(disabled.body).toEqual({ message: DISABLED, user: { id: 5 } });
    expect(userService.disableUser).toHaveBeenCalledWith(3, 5);
    const activated = await request(app).post('/api/users/5/activate').set('Authorization', bearer());
    expect(activated.status).toBe(200);
    expect(userService.activateUser).toHaveBeenCalledWith(3, 5);
  });

  it('id không hợp lệ → 404', async () => {
    const { app, userService } = makeApp();
    const res = await request(app).post('/api/users/abc/disable').set('Authorization', bearer());
    expect(res.status).toBe(404);
    expect(res.body.message).toBe(USER_NOT_FOUND);
    expect(userService.disableUser).not.toHaveBeenCalled();
  });

  it('edge 4: tài khoản bị vô hiệu hóa khi đang đăng nhập → request kế tiếp 401', async () => {
    const { app, authService } = makeApp();
    authService.getSessionUser.mockResolvedValueOnce(null);
    expect((await request(app).get('/api/users').set('Authorization', bearer())).status).toBe(401);
  });
});
