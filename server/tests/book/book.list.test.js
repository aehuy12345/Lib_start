import request from 'supertest';
import { Prisma } from '@prisma/client';
import { createApp } from '../../src/app';
import { createTokenService } from '../../src/lib/tokens';
import { createBookService, escapeLike, CATEGORY_GONE } from '../../src/modules/book/book.service';
import { listBooksQuerySchema, SEARCH_MAX } from '../../src/modules/book/book.validation';

const parse = (query) => listBooksQuerySchema.validate(query, { abortEarly: false, stripUnknown: true });

describe('listBooksQuerySchema (2.2.3)', () => {
  it('mặc định: trang 1, sắp xếp Tên A-Z, không từ khóa', () => {
    expect(parse({}).value).toEqual({ sort: 'name', page: 1 });
  });

  it('nhận đủ tham số hợp lệ, số dạng chuỗi được chuyển, từ khóa được trim', () => {
    expect(parse({ q: '  Tô Hoài ', categoryId: '3', sort: 'popular', page: '2' }).value)
      .toEqual({ q: 'Tô Hoài', categoryId: 3, sort: 'popular', page: 2 });
  });

  it.each(['abc', '', 'NEWEST'])('sort lạ "%s" → name', (sort) => {
    expect(parse({ sort }).value.sort).toBe('name');
  });

  it.each(['0', '-1', '2.5', 'x', ''])('page sai "%s" → 1', (page) => {
    expect(parse({ page }).value.page).toBe(1);
  });

  it.each(['   ', '', ['a', 'b']])('edge 4: từ khóa %j coi như không có', (q) => {
    expect(parse({ q }).value).not.toHaveProperty('q');
  });

  it('từ khóa quá dài bị cắt còn SEARCH_MAX ký tự', () => {
    expect(parse({ q: 'a'.repeat(SEARCH_MAX + 50) }).value.q).toHaveLength(SEARCH_MAX);
  });

  it('categoryId rỗng = không lọc', () => {
    expect(parse({ categoryId: '' }).value).not.toHaveProperty('categoryId');
  });

  it.each(['abc', '0', '-2', '1.5'])('categoryId sai "%s" → lỗi', (categoryId) => {
    expect(parse({ categoryId }).error.details[0].message).toBe('Thể loại không hợp lệ');
  });
});

describe('escapeLike (edge 2)', () => {
  it('escape %, _ và \\', () => {
    expect(escapeLike('100%_a\\b')).toBe('100\\%\\_a\\\\b');
  });

  it("giữ nguyên dấu nháy và chữ tiếng Việt (đã tham số hóa)", () => {
    expect(escapeLike("O'Brien Mắt Biếc")).toBe("O'Brien Mắt Biếc");
  });
});

// $queryRaw được gọi dạng tagged template: (strings, ...values). Truy vấn đếm có `count(*)`.
function makeService({ count = 0, rows = [], category = { id: 5 } } = {}) {
  const prisma = {
    $queryRaw: vi.fn(async (strings) => (strings.join('').includes('count(*)') ? [{ count }] : rows)),
    category: { findFirst: vi.fn(async () => category) },
  };
  const storage = { publicUrl: (bucket, path) => (path ? `https://cdn/${bucket}/${path}` : null) };
  return { service: createBookService({ prisma, storage }), prisma };
}

// Dựng lại đối tượng Sql (đã gộp các Prisma.sql lồng nhau) để đọc câu lệnh và tham số.
function rawCall(prisma, index) {
  const [strings, ...values] = prisma.$queryRaw.mock.calls[index];
  return Prisma.sql(strings, ...values);
}

const ROW = {
  id: 1, title: 'Dế Mèn', author: 'Tô Hoài', publishYear: 1941, coverPath: 'a.jpg',
  availableQuantity: 0, borrowedQuantity: 3, categoryId: 5, categoryName: 'Thiếu nhi',
};

describe('bookService.listBooks (2.2.3)', () => {
  it('trả sách với thông tin PRD và URL ảnh bìa công khai', async () => {
    const { service } = makeService({ count: 1, rows: [ROW, { ...ROW, id: 2, coverPath: null }] });
    const { books, pagination } = await service.listBooks({ sort: 'name', page: 1 });
    expect(books[0]).toEqual({
      id: 1, title: 'Dế Mèn', author: 'Tô Hoài', publishYear: 1941,
      category: { id: 5, name: 'Thiếu nhi' }, coverUrl: 'https://cdn/book-covers/a.jpg',
      availableQuantity: 0, borrowedQuantity: 3,
    });
    // Edge 7: chưa có ảnh → null, client hiển thị ảnh mặc định.
    expect(books[1].coverUrl).toBeNull();
    expect(pagination).toEqual({ page: 1, pageSize: 10, total: 1, totalPages: 1 });
  });

  it('edge 1: thư viện trống → không chạy truy vấn trang, totalPages 1', async () => {
    const { service, prisma } = makeService({ count: 0 });
    const result = await service.listBooks({ sort: 'name', page: 3 });
    expect(result).toEqual({ books: [], pagination: { page: 1, pageSize: 10, total: 0, totalPages: 1 } });
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('chỉ lấy sách chưa xóa mềm; LIMIT 10 OFFSET theo trang', async () => {
    const { service, prisma } = makeService({ count: 35, rows: [ROW] });
    const { pagination } = await service.listBooks({ sort: 'name', page: 3 });
    expect(pagination).toEqual({ page: 3, pageSize: 10, total: 35, totalPages: 4 });
    const page = rawCall(prisma, 1);
    expect(page.sql).toContain('b.deleted_at IS NULL');
    expect(page.sql).toMatch(/LIMIT \? OFFSET \?/);
    expect(page.values.slice(-2)).toEqual([10, 20]);
  });

  it('trang vượt tổng số trang → trả trang cuối', async () => {
    const { service, prisma } = makeService({ count: 12, rows: [ROW] });
    const { pagination } = await service.listBooks({ sort: 'name', page: 99 });
    expect(pagination.page).toBe(2);
    expect(rawCall(prisma, 1).values.slice(-2)).toEqual([10, 10]);
  });

  it.each([
    ['name', 'b.title ASC, b.id ASC'],
    ['newest', 'b.publish_year DESC, b.id DESC'],
    ['popular', 'b.borrow_count DESC, b.id ASC'],
  ])('sắp xếp %s có id làm tiêu chí phụ (edge 6)', async (sort, order) => {
    const { service, prisma } = makeService({ count: 1, rows: [ROW] });
    await service.listBooks({ sort, page: 1 });
    expect(rawCall(prisma, 1).sql).toContain(`ORDER BY ${order}`);
  });

  it('tìm theo tên hoặc tác giả, không phân biệt dấu, từ khóa đã escape và tham số hóa', async () => {
    const { service, prisma } = makeService({ count: 1, rows: [ROW] });
    await service.listBooks({ q: "50%_O'B", sort: 'name', page: 1 });
    const count = rawCall(prisma, 0);
    expect(count.sql).toContain('public.immutable_unaccent(b.title) ILIKE public.immutable_unaccent(?)');
    expect(count.sql).toContain('OR public.immutable_unaccent(b.author) ILIKE');
    expect(count.sql).not.toContain("O'B");
    expect(count.values).toEqual(["%50\\%\\_O'B%", "%50\\%\\_O'B%"]);
  });

  it('lọc thể loại: kiểm tra thể loại còn tồn tại rồi thêm điều kiện category_id', async () => {
    const { service, prisma } = makeService({ count: 1, rows: [ROW] });
    await service.listBooks({ categoryId: 5, sort: 'name', page: 1 });
    expect(prisma.category.findFirst).toHaveBeenCalledWith({ where: { id: 5, deletedAt: null }, select: { id: true } });
    const count = rawCall(prisma, 0);
    expect(count.sql).toContain('b.category_id = ?');
    expect(count.values).toEqual([5]);
  });

  it('thể loại không tồn tại hoặc đã xóa → 400, không truy vấn sách', async () => {
    const { service, prisma } = makeService({ category: null });
    await expect(service.listBooks({ categoryId: 99, sort: 'name', page: 1 }))
      .rejects.toMatchObject({ status: 400, errors: { categoryId: CATEGORY_GONE } });
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('không có từ khóa/thể loại thì không thêm điều kiện', async () => {
    const { service, prisma } = makeService({ count: 1, rows: [ROW] });
    await service.listBooks({ sort: 'name', page: 1 });
    const count = rawCall(prisma, 0);
    expect(count.sql).not.toContain('ILIKE');
    expect(count.sql).not.toContain('category_id');
    expect(prisma.category.findFirst).not.toHaveBeenCalled();
  });
});

describe('GET /api/books (2.2.3, công khai)', () => {
  const tokens = createTokenService({ secret: 'test-secret', expiresIn: '24h' });
  const RESULT = { books: [], pagination: { page: 1, pageSize: 10, total: 0, totalPages: 1 } };

  function makeApp() {
    const authService = { getSessionUser: vi.fn(async () => null) };
    const bookService = { listBooks: vi.fn(async () => RESULT) };
    const categoryService = { listCategoryOptions: vi.fn(async () => [{ id: 1, name: 'Văn học' }]) };
    return { app: createApp({ authService, bookService, categoryService, tokens }), bookService, categoryService };
  }

  it('không cần token → 200, tham số đã chuẩn hóa', async () => {
    const { app, bookService } = makeApp();
    const res = await request(app).get('/api/books').query({ q: ' dế ', categoryId: '2', sort: 'lạ', page: '-1', x: '1' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual(RESULT);
    expect(bookService.listBooks).toHaveBeenCalledWith({ q: 'dế', categoryId: 2, sort: 'name', page: 1 });
  });

  it('token hỏng cũng không chặn trang công khai', async () => {
    const { app } = makeApp();
    const res = await request(app).get('/api/books').set('Authorization', 'Bearer hong');
    expect(res.status).toBe(200);
  });

  it('categoryId sai định dạng → 400 tại field categoryId', async () => {
    const { app, bookService } = makeApp();
    const res = await request(app).get('/api/books?categoryId=abc');
    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual({ categoryId: 'Thể loại không hợp lệ' });
    expect(bookService.listBooks).not.toHaveBeenCalled();
  });

  it('GET /api/categories/options công khai, chỉ id + tên', async () => {
    const { app } = makeApp();
    const res = await request(app).get('/api/categories/options');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ categories: [{ id: 1, name: 'Văn học' }] });
  });
});
