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
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const VALID = {
  title: 'Dế Mèn phiêu lưu ký',
  author: 'Tô Hoài',
  publishYear: 1941,
  isbn: '978-0-306-40615-7',
  categoryId: 1,
  description: 'Truyện thiếu nhi',
  quantity: 3,
};

function makeApp({ warning = null } = {}) {
  const authService = { getSessionUser: vi.fn(async (id) => USERS[id] ?? null) };
  const bookService = {
    createBook: vi.fn(async (data) => ({ book: { id: 10, title: data.title }, warning })),
  };
  return { app: createApp({ authService, bookService, tokens }), bookService };
}

const post = (app, id = 2) => request(app).post('/api/books').set('Authorization', bearer(id));

describe('Phân quyền POST /api/books (2.2.2)', () => {
  it('không có token → 401', async () => {
    const { app } = makeApp();
    expect((await request(app).post('/api/books').send(VALID)).status).toBe(401);
  });

  it('reader → 403', async () => {
    const { app, bookService } = makeApp();
    const res = await post(app, 1).send(VALID);
    expect(res.status).toBe(403);
    expect(bookService.createBook).not.toHaveBeenCalled();
  });

  it.each([2, 3])('librarian/admin (user %i) → 201', async (id) => {
    const { app } = makeApp();
    const res = await post(app, id).send(VALID);
    expect(res.status).toBe(201);
    expect(res.body.message).toBe('Thêm sách thành công');
  });
});

describe('POST /api/books — dữ liệu', () => {
  it('JSON hợp lệ: trim, chuẩn hóa ISBN, field lạ bị bỏ, không có file', async () => {
    const { app, bookService } = makeApp();
    const res = await post(app).send({ ...VALID, title: '  Dế Mèn  ', availableQuantity: 99 });
    expect(res.status).toBe(201);
    expect(bookService.createBook).toHaveBeenCalledWith(
      { ...VALID, title: 'Dế Mèn', isbn: '9780306406157' },
      undefined,
    );
  });

  it('multipart: số dạng chuỗi được chuyển, ảnh bìa ở field cover', async () => {
    const { app, bookService } = makeApp();
    let req = post(app);
    for (const [k, v] of Object.entries(VALID)) req = req.field(k, String(v));
    const res = await req.attach('cover', JPEG, { filename: 'c.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(201);
    const [data, file] = bookService.createBook.mock.calls[0];
    expect(data).toEqual({ ...VALID, isbn: '9780306406157' });
    expect(file.buffer.equals(JPEG)).toBe(true);
  });

  it('ISBN bỏ trống được chấp nhận', async () => {
    const { app, bookService } = makeApp();
    const res = await post(app).send({ ...VALID, isbn: '' });
    expect(res.status).toBe(201);
    expect(bookService.createBook.mock.calls[0][0].isbn).toBe('');
  });

  it('edge 5: có cảnh báo trùng tên + tác giả thì trả kèm warning', async () => {
    const { app } = makeApp({ warning: 'Lưu ý: đã có sách cùng tên và tác giả' });
    const res = await post(app).send(VALID);
    expect(res.status).toBe(201);
    expect(res.body.warning).toBe('Lưu ý: đã có sách cùng tên và tác giả');
  });

  it('ảnh bìa quá 2 MB → 413 lỗi tại field cover (edge 8)', async () => {
    const { app, bookService } = makeApp();
    const res = await post(app).field('title', 'x').attach('cover', Buffer.alloc(2 * 1024 * 1024 + 1), 'big.jpg');
    expect(res.status).toBe(413);
    expect(res.body.errors.cover).toBe('Chỉ nhận ảnh JPG, PNG, WebP tối đa 2 MB');
    expect(bookService.createBook).not.toHaveBeenCalled();
  });

  const year = new Date().getFullYear();
  it.each([
    ['title', '', 'Tên sách không được để trống'],
    ['title', '   ', 'Tên sách không được để trống'],
    ['title', 'a'.repeat(101), 'Tên sách tối đa 100 ký tự'],
    ['author', '', 'Tác giả không được để trống'],
    ['author', 'a'.repeat(101), 'Tác giả tối đa 100 ký tự'],
    ['description', '', 'Mô tả không được để trống'],
    ['description', 'a'.repeat(256), 'Mô tả tối đa 255 ký tự'],
    ['publishYear', 1899, 'Năm xuất bản phải từ 1900 đến năm hiện tại'],
    ['publishYear', year + 1, 'Năm xuất bản phải từ 1900 đến năm hiện tại'],
    ['publishYear', 2000.5, 'Năm xuất bản không hợp lệ'],
    ['publishYear', 'abc', 'Năm xuất bản phải là số'],
    ['isbn', '0306406153', 'ISBN phải là ISBN-10 hoặc ISBN-13 hợp lệ'],
    ['isbn', '123', 'ISBN phải là ISBN-10 hoặc ISBN-13 hợp lệ'],
    ['quantity', 0, 'Số lượng phải lớn hơn 0'],
    ['quantity', -1, 'Số lượng phải lớn hơn 0'],
    ['quantity', 1.5, 'Số lượng phải là số nguyên'],
    ['quantity', 'abc', 'Số lượng phải là số'],
    ['categoryId', undefined, 'Vui lòng chọn thể loại'],
    ['categoryId', '', 'Vui lòng chọn thể loại'],
  ])('%s = %j → 400 "%s"', async (field, value, msg) => {
    const { app, bookService } = makeApp();
    const res = await post(app).send({ ...VALID, [field]: value });
    expect(res.status).toBe(400);
    expect(res.body.errors[field]).toBe(msg);
    expect(bookService.createBook).not.toHaveBeenCalled();
  });

  it('biên hợp lệ: 100/100/255 ký tự, năm 1900 và năm hiện tại, số lượng 1', async () => {
    const { app } = makeApp();
    for (const body of [
      { ...VALID, title: 'a'.repeat(100), author: 'b'.repeat(100), description: 'c'.repeat(255) },
      { ...VALID, publishYear: 1900, quantity: 1 },
      { ...VALID, publishYear: year },
    ]) {
      expect((await post(app).send(body)).status).toBe(201);
    }
  });
});
