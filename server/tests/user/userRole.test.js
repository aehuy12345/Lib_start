import request from 'supertest';
import { createApp } from '../../src/app';
import { createTokenService } from '../../src/lib/tokens';
import { ROLE_BLOCKED, evaluateRoleChange, canChangeRole } from '../../src/modules/user/user.rules';
import { changeRoleSchema } from '../../src/modules/user/user.validation';
import {
  createUserService, USER_NOT_FOUND, NOT_ADMIN, ROLE_CHANGED, ROLE_UNCHANGED,
} from '../../src/modules/user/user.service';

const ROW = {
  id: 5, email: 'an@example.com', name: 'An', role: 'reader', status: 'active', createdAt: new Date('2026-10-01T03:00:00Z'),
  activeBorrowCount: 1, pendingBorrowCount: 1, unpaidFineCount: 2,
};

describe('Quy tắc 2.6.2', () => {
  const reader = { id: 5, role: 'reader', status: 'active' };
  const admin = { id: 9, role: 'admin', status: 'active' };

  it.each([
    ['reader → librarian', reader, 'librarian', 1, null],
    ['reader → admin', reader, 'admin', 1, null],
    ['edge 3: tài khoản Vô hiệu hóa', { ...reader, status: 'disabled' }, 'librarian', 1, null],
    ['edge 3: tài khoản Chờ xác nhận', { ...reader, status: 'pending' }, 'admin', 1, null],
    ['chính mình', { ...admin, id: 3 }, 'reader', 2, 'self'],
    ['hạ cấp Admin cuối cùng', admin, 'librarian', 1, 'last_admin'],
    ['hạ cấp Admin khi còn 2 Admin', admin, 'reader', 2, null],
    ['hạ cấp Admin đã bị khóa', { ...admin, status: 'disabled' }, 'reader', 1, null],
  ])('%s', (_, target, role, activeAdminCount, reason) => {
    expect(evaluateRoleChange({ actorId: 3, target, role, activeAdminCount })).toBe(reason);
  });

  it('chỉ chính mình không có nút đổi vai trò', () => {
    expect(canChangeRole({ actorId: 3, target: { id: 3 } })).toBe(false);
    expect(canChangeRole({ actorId: 3, target: { id: 9 } })).toBe(true);
  });

  it.each([
    [{ role: 'librarian' }, null],
    [{ role: 'boss' }, 'Vai trò không hợp lệ'],
    [{ role: 'Admin' }, 'Vai trò không hợp lệ'],
    [{ role: 1 }, 'Vai trò không hợp lệ'],
    [{}, 'Vui lòng chọn vai trò'],
  ])('edge 5: body %j', (body, message) => {
    const { error } = changeRoleSchema.validate(body);
    expect(error?.details[0].message ?? null).toBe(message);
  });
});

describe('userService.changeRole', () => {
  function makeService({ admins = [{ id: 3 }, { id: 9 }], target = ROW, after = ROW } = {}) {
    const tx = {
      $queryRaw: vi.fn()
        .mockResolvedValueOnce(admins)
        .mockResolvedValueOnce(target ? [target] : [])
        .mockResolvedValueOnce([after]),
      user: { update: vi.fn(async () => ({})), count: vi.fn(async () => admins.length) },
      auditLog: { create: vi.fn(async () => ({})) },
    };
    const prisma = { $transaction: vi.fn(async (fn) => fn(tx)) };
    return { service: createUserService({ prisma }), tx };
  }

  it('đổi vai trò trong transaction: khóa Admin rồi người dùng, cập nhật role, ghi audit log', async () => {
    const { service, tx } = makeService({ after: { ...ROW, role: 'librarian' } });
    const result = await service.changeRole(3, 5, 'librarian');
    const [strings] = tx.$queryRaw.mock.calls[0];
    expect(strings.join('?')).toMatch(/role = 'admin' AND status = 'active' ORDER BY id FOR UPDATE/);
    expect(tx.$queryRaw.mock.calls[1][0].join('?')).toMatch(/WHERE id = \? FOR UPDATE/);
    expect(tx.user.update).toHaveBeenCalledWith({ where: { id: 5 }, data: { role: 'librarian' } });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: {
        actorId: 3, action: 'user.role', entityType: 'user', entityId: 5,
        oldValue: { role: 'reader' }, newValue: { role: 'librarian' },
      },
    });
    // Dữ liệu mượn và phạt cũ giữ nguyên.
    expect(result).toMatchObject({
      message: ROLE_CHANGED, changed: true,
      user: { id: 5, role: 'librarian', activeBorrowCount: 1, pendingBorrowCount: 1, unpaidFineCount: 2 },
    });
  });

  it('nâng lên Admin', async () => {
    const { service, tx } = makeService({ after: { ...ROW, role: 'admin' } });
    await service.changeRole(3, 5, 'admin');
    expect(tx.user.update).toHaveBeenCalledWith({ where: { id: 5 }, data: { role: 'admin' } });
  });

  it('vai trò không đổi (edge 2: Admin khác đã đổi trước) → 200, không cập nhật, không ghi log', async () => {
    const { service, tx } = makeService({ target: { ...ROW, role: 'librarian' }, after: { ...ROW, role: 'librarian' } });
    const result = await service.changeRole(3, 5, 'librarian');
    expect(result).toMatchObject({ message: ROLE_UNCHANGED, changed: false, user: { role: 'librarian' } });
    expect(tx.user.update).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it.each([
    ['chính mình', { target: { id: 3, role: 'admin', status: 'active' } }, 3, 'self'],
    ['Admin cuối cùng', { admins: [{ id: 3 }], target: { id: 9, role: 'admin', status: 'active' } }, 9, 'last_admin'],
  ])('%s → 409', async (_, options, id, reason) => {
    const { service, tx } = makeService(options);
    await expect(service.changeRole(3, id, 'reader')).rejects.toMatchObject({
      status: 409, reason, message: ROLE_BLOCKED[reason],
    });
    expect(tx.user.update).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('edge 2: hai Admin hạ cấp nhau, người sau không còn là Admin → 403', async () => {
    const { service, tx } = makeService({ admins: [{ id: 9 }], target: { id: 9, role: 'admin', status: 'active' } });
    await expect(service.changeRole(3, 9, 'reader')).rejects.toMatchObject({ status: 403, message: NOT_ADMIN });
    expect(tx.user.update).not.toHaveBeenCalled();
  });

  it('người dùng không tồn tại → 404', async () => {
    const { service } = makeService({ target: null });
    await expect(service.changeRole(3, 404, 'reader')).rejects.toMatchObject({ status: 404, message: USER_NOT_FOUND });
  });
});

describe('Phân quyền POST /api/users/:id/role', () => {
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
      changeRole: vi.fn(async (actorId, id, role) => ({ message: ROLE_CHANGED, changed: true, user: { id, role } })),
    };
    return { app: createApp({ authService, userService, tokens }), userService, authService };
  }

  it('không có token → 401', async () => {
    const { app } = makeApp();
    expect((await request(app).post('/api/users/5/role').send({ role: 'librarian' })).status).toBe(401);
  });

  it('edge 6: librarian và reader → 403', async () => {
    const { app, userService } = makeApp();
    for (const id of [1, 2]) {
      const res = await request(app).post('/api/users/5/role').set('Authorization', bearer(id)).send({ role: 'admin' });
      expect(res.status).toBe(403);
    }
    expect(userService.changeRole).not.toHaveBeenCalled();
  });

  it('admin đổi vai trò', async () => {
    const { app, userService } = makeApp();
    const res = await request(app).post('/api/users/5/role').set('Authorization', bearer()).send({ role: 'librarian', x: 1 });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ message: ROLE_CHANGED, changed: true, user: { id: 5, role: 'librarian' } });
    expect(userService.changeRole).toHaveBeenCalledWith(3, 5, 'librarian');
  });

  it.each([[{ role: 'boss' }], [{}]])('edge 5: body %j → 400', async (body) => {
    const { app, userService } = makeApp();
    const res = await request(app).post('/api/users/5/role').set('Authorization', bearer()).send(body);
    expect(res.status).toBe(400);
    expect(res.body.errors.role).toBeTruthy();
    expect(userService.changeRole).not.toHaveBeenCalled();
  });

  it('id không hợp lệ → 404', async () => {
    const { app, userService } = makeApp();
    const res = await request(app).post('/api/users/abc/role').set('Authorization', bearer()).send({ role: 'reader' });
    expect(res.status).toBe(404);
    expect(userService.changeRole).not.toHaveBeenCalled();
  });

  it('edge 1: người bị hạ quyền gọi API Admin ở request kế tiếp → 403 (role đọc từ DB)', async () => {
    const { app, authService } = makeApp();
    authService.getSessionUser.mockResolvedValueOnce({ ...USERS[3], role: 'librarian' });
    const res = await request(app).post('/api/users/5/role').set('Authorization', bearer()).send({ role: 'reader' });
    expect(res.status).toBe(403);
  });
});
