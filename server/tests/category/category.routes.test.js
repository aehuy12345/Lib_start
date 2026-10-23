import request from 'supertest';
import { createApp } from '../../src/app';
import { createTokenService } from '../../src/lib/tokens';

const tokens = createTokenService({ secret: 'test-secret', expiresIn: '24h' });
const USERS = {
  1: { id: 1, email: 'r@example.com', name: 'R', role: 'reader', status: 'active' },
  2: { id: 2, email: 'l@example.com', name: 'L', role: 'librarian', status: 'active' },
  3: { id: 3, email: 'a@example.com', name: 'A', role: 'admin', status: 'active' },
};
const bearer = (id = 2) => `Bearer ${tokens.sign(USERS[id])}`;

function makeApp() {
  const authService = { getSessionUser: vi.fn(async (id) => USERS[id] ?? null) };
  const categoryService = {
    listCategories: vi.fn(async () => [{ id: 1, name: 'Văn học', bookCount: 0 }]),
    createCategory: vi.fn(async (data) => ({ id: 2, ...data, bookCount: 0 })),
    updateCategory: vi.fn(async (id, data) => ({ id, ...data, bookCount: 0 })),
    deleteCategory: vi.fn(async () => {}),
  };
  return { app: createApp({ authService, categoryService, tokens }), categoryService };
}

describe('Phân quyền /api/categories (2.2.1)', () => {
  it.each([
    ['get', '/api/categories'],
    ['post', '/api/categories'],
    ['patch', '/api/categories/1'],
    ['delete', '/api/categories/1'],
  ])('%s %s không có token → 401', async (method, url) => {
    const { app } = makeApp();
    const res = await request(app)[method](url);
    expect(res.status).toBe(401);
  });

  it('edge 6: reader → 403', async () => {
    const { app, categoryService } = makeApp();
    const res = await request(app).get('/api/categories').set('Authorization', bearer(1));
    expect(res.status).toBe(403);
    expect(categoryService.listCategories).not.toHaveBeenCalled();
  });

  it.each([2, 3])('librarian/admin (user %i) → 200', async (id) => {
    const { app } = makeApp();
    const res = await request(app).get('/api/categories').set('Authorization', bearer(id));
    expect(res.status).toBe(200);
    expect(res.body.categories).toHaveLength(1);
  });
});

describe('POST /api/categories', () => {
  it('hợp lệ → 201, tên được trim (edge 1), field lạ bị bỏ', async () => {
    const { app, categoryService } = makeApp();
    const res = await request(app).post('/api/categories').set('Authorization', bearer())
      .send({ name: '  Khoa học  ', extra: 'x' });
    expect(res.status).toBe(201);
    expect(res.body.message).toBe('Thêm thể loại thành công');
    expect(categoryService.createCategory).toHaveBeenCalledWith({ name: 'Khoa học' });
  });

  it('đúng 50 ký tự → 201', async () => {
    const { app } = makeApp();
    const res = await request(app).post('/api/categories').set('Authorization', bearer()).send({ name: 'a'.repeat(50) });
    expect(res.status).toBe(201);
  });

  it.each([
    [{}, 'Tên thể loại không được để trống'],
    [{ name: '' }, 'Tên thể loại không được để trống'],
    [{ name: '    ' }, 'Tên thể loại không được để trống'],
    [{ name: 'a'.repeat(51) }, 'Tên thể loại tối đa 50 ký tự'],
    [{ name: 123 }, 'Tên thể loại không hợp lệ'],
  ])('%j → 400 "%s"', async (body, msg) => {
    const { app, categoryService } = makeApp();
    const res = await request(app).post('/api/categories').set('Authorization', bearer()).send(body);
    expect(res.status).toBe(400);
    expect(res.body.errors.name).toBe(msg);
    expect(categoryService.createCategory).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/categories/:id', () => {
  it('hợp lệ → 200', async () => {
    const { app, categoryService } = makeApp();
    const res = await request(app).patch('/api/categories/5').set('Authorization', bearer()).send({ name: ' Mới ' });
    expect(res.status).toBe(200);
    expect(categoryService.updateCategory).toHaveBeenCalledWith(5, { name: 'Mới' });
  });

  it('tên rỗng → 400', async () => {
    const { app } = makeApp();
    const res = await request(app).patch('/api/categories/5').set('Authorization', bearer()).send({ name: '' });
    expect(res.status).toBe(400);
  });

  it.each(['abc', '0', '-1', '1.5', '99999999999'])('id "%s" không hợp lệ → 404', async (id) => {
    const { app, categoryService } = makeApp();
    const res = await request(app).patch(`/api/categories/${id}`).set('Authorization', bearer()).send({ name: 'X' });
    expect(res.status).toBe(404);
    expect(categoryService.updateCategory).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/categories/:id', () => {
  it('→ 200 Đã xóa thể loại', async () => {
    const { app, categoryService } = makeApp();
    const res = await request(app).delete('/api/categories/3').set('Authorization', bearer(3));
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Đã xóa thể loại');
    expect(categoryService.deleteCategory).toHaveBeenCalledWith(3);
  });

  it('id không hợp lệ → 404', async () => {
    const { app } = makeApp();
    const res = await request(app).delete('/api/categories/x').set('Authorization', bearer());
    expect(res.status).toBe(404);
  });
});
