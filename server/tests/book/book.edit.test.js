import request from 'supertest';
import { createApp } from '../../src/app';
import { createTokenService } from '../../src/lib/tokens';
import { HttpError } from '../../src/lib/httpError';
import {
  createBookService, BOOK_NOT_FOUND, VERSION_CONFLICT, ISBN_TAKEN, activeBorrowsMessage,
} from '../../src/modules/book/book.service';
import { updateBookSchema } from '../../src/modules/book/book.validation';

const INPUT = {
  title: 'Dế Mèn', author: 'Tô Hoài', publishYear: 1941, isbn: '9780306406157',
  categoryId: 2, description: 'Truyện', quantity: 5, version: 3, removeCover: false,
};
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const STOCK = { version: 3, borrowedQuantity: 2, damagedQuantity: 0, coverPath: 'old.png' };
const NOW = new Date('2026-10-24T03:00:00Z');
const uniqueError = () => Object.assign(new Error('unique'), { code: 'P2002' });

describe('updateBookSchema (2.2.5)', () => {
  it('như 2.2.2 + version bắt buộc; removeCover mặc định false, nhận chuỗi từ multipart', () => {
    const { value, error } = updateBookSchema.validate({
      ...INPUT, quantity: '5', version: '3', removeCover: 'true',
    });
    expect(error).toBeUndefined();
    expect(value).toMatchObject({ quantity: 5, version: 3, removeCover: true });
    expect(updateBookSchema.validate({ ...INPUT, removeCover: undefined }).value.removeCover).toBe(false);
  });

  it('thiếu version → lỗi tại field version', () => {
    const { error } = updateBookSchema.validate({ ...INPUT, version: undefined });
    expect(error.details[0]).toMatchObject({ path: ['version'], message: expect.stringContaining('tải lại') });
  });

  it('validate như 2.2.2: số lượng 0 bị từ chối', () => {
    const { error } = updateBookSchema.validate({ ...INPUT, quantity: 0 });
    expect(error.details[0].message).toBe('Số lượng phải lớn hơn 0');
  });
});

function makeService({
  current = STOCK, locked = STOCK, category = { id: 2 }, sameIsbn = null, categoryLocked = [{ id: 2 }],
  update, upload, active = 0, duplicates = 0,
} = {}) {
  const calls = [];
  const tx = {
    $queryRaw: vi.fn(async (strings) => {
      const sql = strings.join('?');
      if (sql.includes('FROM categories')) { calls.push('lockCategory'); return categoryLocked; }
      calls.push('lockBook');
      if (sql.includes('cover_path')) return locked ? [locked] : [];
      return locked ? [{ id: 7 }] : [];
    }),
    book: {
      update: update ?? vi.fn(async ({ data }) => {
        calls.push(data.deletedAt ? 'softDelete' : 'update');
        return {
          id: 7, ...data, borrowedQuantity: 2, damagedQuantity: 0, version: 4,
          createdAt: NOW, category: { id: 2, name: 'Thiếu nhi' },
        };
      }),
    },
    borrowOrder: { count: vi.fn(async () => active) },
  };
  const prisma = {
    category: { findFirst: vi.fn(async () => category) },
    book: {
      findFirst: vi.fn(async ({ where }) => (where.isbn ? sameIsbn : current)),
      count: vi.fn(async () => duplicates),
    },
    borrowOrder: { count: vi.fn(async () => active) },
    $transaction: vi.fn(async (fn) => fn(tx)),
  };
  const storage = {
    upload: upload ?? vi.fn(async () => { calls.push('upload'); }),
    remove: vi.fn(async (bucket, path) => { calls.push(`remove:${path}`); }),
    publicUrl: (bucket, path) => (path ? `https://cdn/${bucket}/${path}` : null),
  };
  const logger = { error: vi.fn() };
  const service = createBookService({ prisma, storage, logger, newId: () => 'uuid', now: () => NOW });
  return { service, prisma, tx, storage, calls, logger };
}

describe('bookService.updateBook (2.2.5)', () => {
  it('lưu: available = tổng mới - đang mượn - hư hỏng, tăng version, giữ ảnh cũ', async () => {
    const { service, tx, storage } = makeService();
    const { book, warning } = await service.updateBook(7, INPUT);

    expect(tx.book.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: {
        title: 'Dế Mèn', author: 'Tô Hoài', publishYear: 1941, isbn: '9780306406157', description: 'Truyện',
        categoryId: 2, totalQuantity: 5, availableQuantity: 3, coverPath: 'old.png', version: { increment: 1 },
      },
      include: { category: true },
    });
    expect(book).toMatchObject({ id: 7, version: 4, coverUrl: 'https://cdn/book-covers/old.png' });
    expect(warning).toBeNull();
    expect(storage.remove).not.toHaveBeenCalled();
  });

  it('ISBN của chính sách này không tính là trùng', async () => {
    const { service, prisma } = makeService();
    await service.updateBook(7, INPUT);
    expect(prisma.book.findFirst).toHaveBeenCalledWith({
      where: { isbn: '9780306406157', deletedAt: null, id: { not: 7 } }, select: { id: true },
    });
  });

  it('thay ảnh: upload ảnh mới → khóa sách → khóa thể loại → update → xóa ảnh cũ', async () => {
    const { service, calls, tx } = makeService();
    const { book } = await service.updateBook(7, INPUT, { buffer: JPEG });
    expect(calls).toEqual(['upload', 'lockBook', 'lockCategory', 'update', 'remove:old.png']);
    expect(tx.book.update.mock.calls[0][0].data.coverPath).toBe('uuid.jpg');
    expect(book.coverUrl).toBe('https://cdn/book-covers/uuid.jpg');
  });

  it('xóa ảnh: cover_path = null rồi xóa file cũ', async () => {
    const { service, tx, storage } = makeService();
    const { book } = await service.updateBook(7, { ...INPUT, removeCover: true });
    expect(tx.book.update.mock.calls[0][0].data.coverPath).toBeNull();
    expect(storage.remove).toHaveBeenCalledWith('book-covers', 'old.png');
    expect(book.coverUrl).toBeNull();
  });

  it('vừa chọn ảnh mới vừa removeCover → ảnh mới thắng', async () => {
    const { service, tx } = makeService();
    await service.updateBook(7, { ...INPUT, removeCover: true }, { buffer: JPEG });
    expect(tx.book.update.mock.calls[0][0].data.coverPath).toBe('uuid.jpg');
  });

  it('xóa file cũ lỗi chỉ ghi log, vẫn trả thành công', async () => {
    const { service, storage, logger } = makeService();
    storage.remove.mockRejectedValue(new Error('down'));
    await expect(service.updateBook(7, { ...INPUT, removeCover: true })).resolves.toBeTruthy();
    expect(logger.error).toHaveBeenCalled();
  });

  it('edge 2: tổng mới bằng đúng số đang mượn → được, available = 0', async () => {
    const { service, tx } = makeService();
    await service.updateBook(7, { ...INPUT, quantity: 2 });
    expect(tx.book.update.mock.calls[0][0].data).toMatchObject({ totalQuantity: 2, availableQuantity: 0 });
  });

  it('tổng mới nhỏ hơn số đang mượn → 400 tại quantity, không upload ảnh', async () => {
    const { service, storage, prisma } = makeService();
    await expect(service.updateBook(7, { ...INPUT, quantity: 1 }, { buffer: JPEG })).rejects.toMatchObject({
      status: 400, errors: { quantity: 'Tổng số lượng không được nhỏ hơn số bản đang mượn (2)' },
    });
    expect(storage.upload).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('có bản hư hỏng: tổng tối thiểu = đang mượn + hư hỏng', async () => {
    const stock = { ...STOCK, damagedQuantity: 1 };
    const { service } = makeService({ current: stock, locked: stock });
    await expect(service.updateBook(7, { ...INPUT, quantity: 2 })).rejects.toMatchObject({
      status: 400, errors: { quantity: 'Tổng số lượng không được nhỏ hơn 3 (2 bản đang mượn, 1 bản hư hỏng)' },
    });
  });

  it('edge 5: version cũ → 409 xung đột tại field version, không upload ảnh', async () => {
    const { service, storage } = makeService({ current: { ...STOCK, version: 4 } });
    await expect(service.updateBook(7, INPUT, { buffer: JPEG })).rejects.toMatchObject({
      status: 409, errors: { version: VERSION_CONFLICT },
    });
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it('edge 5, 7: người khác lưu sau precheck (version đổi khi khóa) → 409 và xóa ảnh vừa upload', async () => {
    const { service, storage, tx } = makeService({ locked: { ...STOCK, version: 4 } });
    await expect(service.updateBook(7, INPUT, { buffer: JPEG })).rejects.toMatchObject({ status: 409 });
    expect(tx.book.update).not.toHaveBeenCalled();
    expect(storage.remove).toHaveBeenCalledWith('book-covers', 'uuid.jpg');
    expect(storage.remove).not.toHaveBeenCalledWith('book-covers', 'old.png');
  });

  it('số đang mượn tăng sau precheck → kiểm tra lại trên dòng đã khóa', async () => {
    const { service, tx } = makeService({ locked: { ...STOCK, borrowedQuantity: 5 } });
    await expect(service.updateBook(7, { ...INPUT, quantity: 4 })).rejects.toMatchObject({
      status: 400, errors: { quantity: expect.stringContaining('(5)') },
    });
    expect(tx.book.update).not.toHaveBeenCalled();
  });

  it('ISBN trùng sách khác → 409 tại isbn, không upload ảnh', async () => {
    const { service, storage } = makeService({ sameIsbn: { id: 9 } });
    await expect(service.updateBook(7, INPUT, { buffer: JPEG })).rejects.toMatchObject({
      status: 409, errors: { isbn: ISBN_TAKEN },
    });
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it('edge 7: ISBN trùng do race (P2002) → 409, xóa ảnh mới, giữ ảnh cũ', async () => {
    const { service, storage } = makeService({ update: vi.fn(async () => { throw uniqueError(); }) });
    await expect(service.updateBook(7, INPUT, { buffer: JPEG })).rejects.toMatchObject({
      status: 409, errors: { isbn: ISBN_TAKEN },
    });
    expect(storage.remove).toHaveBeenCalledTimes(1);
    expect(storage.remove).toHaveBeenCalledWith('book-covers', 'uuid.jpg');
  });

  it('edge 4: đổi sang thể loại đã xóa → 400 tại categoryId', async () => {
    const { service } = makeService({ category: null });
    await expect(service.updateBook(7, INPUT)).rejects.toMatchObject({
      status: 400, errors: { categoryId: expect.any(String) },
    });
  });

  it('edge 4: thể loại bị xóa sau precheck → khóa FOR SHARE không thấy dòng → 400', async () => {
    const { service, tx } = makeService({ categoryLocked: [] });
    await expect(service.updateBook(7, INPUT)).rejects.toMatchObject({ status: 400 });
    expect(tx.book.update).not.toHaveBeenCalled();
  });

  it('sách không tồn tại/đã xóa → 404; bị xóa trong lúc lưu → 404', async () => {
    await expect(makeService({ current: null }).service.updateBook(7, INPUT))
      .rejects.toMatchObject({ status: 404, message: BOOK_NOT_FOUND });
    await expect(makeService({ locked: null }).service.updateBook(7, INPUT))
      .rejects.toMatchObject({ status: 404 });
  });

  it('khóa dòng sách FOR UPDATE, chỉ sách chưa xóa', async () => {
    const { service, tx } = makeService();
    await service.updateBook(7, INPUT);
    expect(tx.$queryRaw.mock.calls[0][0].join('?')).toMatch(/FROM books WHERE id = \? AND deleted_at IS NULL FOR UPDATE/);
  });

  it('edge 9: ảnh sai định dạng → 400, không ghi DB', async () => {
    const { service, prisma } = makeService();
    await expect(service.updateBook(7, INPUT, { buffer: Buffer.from('text') })).rejects.toMatchObject({
      status: 400, errors: { cover: expect.any(String) },
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('upload lỗi → 502, chưa lưu thay đổi nào', async () => {
    const { service, prisma } = makeService({ upload: vi.fn(async () => { throw new Error('down'); }) });
    await expect(service.updateBook(7, INPUT, { buffer: JPEG })).rejects.toMatchObject({ status: 502 });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('trùng tên + tác giả với sách khác → trả kèm warning (như 2.2.2 edge 5)', async () => {
    const { service, prisma } = makeService({ duplicates: 1 });
    const { warning } = await service.updateBook(7, INPUT);
    expect(warning).toMatch(/cùng tên và tác giả/);
    expect(prisma.book.count.mock.calls[0][0].where.id).toEqual({ not: 7 });
  });
});

describe('bookService.getDeleteCheck / deleteBook (2.2.5)', () => {
  it('không có đơn hoạt động → canDelete', async () => {
    const { service, prisma } = makeService();
    expect(await service.getDeleteCheck(7)).toEqual({ canDelete: true, activeBorrowCount: 0 });
    expect(prisma.borrowOrder.count).toHaveBeenCalledWith({
      where: { bookId: 7, status: { in: ['pending', 'borrowing'] } },
    });
  });

  it('edge 3: có đơn chờ xác nhận/đang mượn → không xóa được, kèm số đơn', async () => {
    const { service } = makeService({ active: 2 });
    expect(await service.getDeleteCheck(7)).toEqual({ canDelete: false, activeBorrowCount: 2 });
  });

  it('getDeleteCheck sách không tồn tại → 404', async () => {
    await expect(makeService({ current: null }).service.getDeleteCheck(7)).rejects.toMatchObject({ status: 404 });
  });

  it('edge 1, 8: soft delete (deleted_at = now), không xóa ảnh bìa', async () => {
    const { service, tx, storage, calls } = makeService();
    await service.deleteBook(7);
    expect(calls).toEqual(['lockBook', 'softDelete']);
    expect(tx.book.update).toHaveBeenCalledWith({ where: { id: 7 }, data: { deletedAt: NOW } });
    expect(tx.$queryRaw.mock.calls[0][0].join('?')).toMatch(/FROM books WHERE id = \? AND deleted_at IS NULL FOR UPDATE/);
    expect(storage.remove).not.toHaveBeenCalled();
  });

  it('có đơn mới trong lúc xác nhận (đếm lại trong transaction) → 409, không xóa', async () => {
    const { service, tx } = makeService({ active: 1 });
    await expect(service.deleteBook(7)).rejects.toMatchObject({ status: 409, message: activeBorrowsMessage(1) });
    expect(tx.book.update).not.toHaveBeenCalled();
  });

  it('sách đã bị xóa → 404', async () => {
    await expect(makeService({ locked: null }).service.deleteBook(7)).rejects.toMatchObject({ status: 404 });
  });
});

// ---- Routes ----
const tokens = createTokenService({ secret: 'test-secret', expiresIn: '24h' });
const USERS = {
  1: { id: 1, email: 'r@example.com', name: 'R', role: 'reader', status: 'active' },
  2: { id: 2, email: 'l@example.com', name: 'L', role: 'librarian', status: 'active' },
  3: { id: 3, email: 'a@example.com', name: 'A', role: 'admin', status: 'active' },
};
const bearer = (id) => `Bearer ${tokens.sign(USERS[id])}`;
const BODY = { ...INPUT, isbn: '978-0-306-40615-7' };

function makeApp() {
  const authService = { getSessionUser: vi.fn(async (id) => USERS[id] ?? null) };
  const bookService = {
    updateBook: vi.fn(async (id, data) => ({ book: { id, title: data.title }, warning: null })),
    getDeleteCheck: vi.fn(async () => ({ canDelete: true, activeBorrowCount: 0 })),
    deleteBook: vi.fn(async () => {}),
  };
  return { app: createApp({ authService, bookService, tokens }), bookService };
}

describe('Phân quyền sửa/xóa sách (edge 6)', () => {
  const routes = [
    ['put', '/api/books/7', BODY],
    ['get', '/api/books/7/delete-check'],
    ['delete', '/api/books/7'],
  ];

  it.each(routes)('%s %s không token → 401', async (method, url, body) => {
    const { app } = makeApp();
    expect((await request(app)[method](url).send(body)).status).toBe(401);
  });

  it.each(routes)('%s %s reader → 403', async (method, url, body) => {
    const { app, bookService } = makeApp();
    const res = await request(app)[method](url).set('Authorization', bearer(1)).send(body);
    expect(res.status).toBe(403);
    expect(bookService.updateBook).not.toHaveBeenCalled();
    expect(bookService.deleteBook).not.toHaveBeenCalled();
  });

  it.each([2, 3])('librarian/admin (user %i) sửa và xóa được', async (id) => {
    const { app } = makeApp();
    const put = await request(app).put('/api/books/7').set('Authorization', bearer(id)).send(BODY);
    expect(put.status).toBe(200);
    expect(put.body.message).toBe('Cập nhật sách thành công');
    const del = await request(app).delete('/api/books/7').set('Authorization', bearer(id));
    expect(del.status).toBe(200);
    expect(del.body.message).toBe('Đã xóa sách');
  });
});

describe('PUT /api/books/:id — dữ liệu', () => {
  it('JSON: chuẩn hóa ISBN, bỏ field lạ, truyền id dạng số', async () => {
    const { app, bookService } = makeApp();
    const res = await request(app).put('/api/books/7').set('Authorization', bearer(2))
      .send({ ...BODY, availableQuantity: 99 });
    expect(res.status).toBe(200);
    expect(bookService.updateBook).toHaveBeenCalledWith(7, INPUT, undefined);
  });

  it('multipart: removeCover và số dạng chuỗi, ảnh ở field cover', async () => {
    const { app, bookService } = makeApp();
    const req = request(app).put('/api/books/7').set('Authorization', bearer(2));
    Object.entries({ ...BODY, removeCover: 'true' }).forEach(([k, v]) => req.field(k, String(v)));
    const res = await req.attach('cover', JPEG, { filename: 'a.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(200);
    const [id, data, file] = bookService.updateBook.mock.calls[0];
    expect(id).toBe(7);
    expect(data).toMatchObject({ quantity: 5, version: 3, removeCover: true });
    expect(file.buffer).toEqual(JPEG);
  });

  it('thiếu version, dữ liệu sai → 400 kèm lỗi theo field', async () => {
    const { app, bookService } = makeApp();
    const res = await request(app).put('/api/books/7').set('Authorization', bearer(2))
      .send({ ...BODY, version: undefined, title: '' });
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.errors)).toEqual(expect.arrayContaining(['version', 'title']));
    expect(bookService.updateBook).not.toHaveBeenCalled();
  });

  it('id sai định dạng → 404', async () => {
    const { app, bookService } = makeApp();
    const res = await request(app).put('/api/books/abc').set('Authorization', bearer(2)).send(BODY);
    expect(res.status).toBe(404);
    expect(bookService.updateBook).not.toHaveBeenCalled();
  });

  it('xung đột phiên bản → 409 kèm errors.version', async () => {
    const { app, bookService } = makeApp();
    bookService.updateBook.mockRejectedValue(new HttpError(409, VERSION_CONFLICT, { version: VERSION_CONFLICT }));
    const res = await request(app).put('/api/books/7').set('Authorization', bearer(2)).send(BODY);
    expect(res.status).toBe(409);
    expect(res.body.errors.version).toBe(VERSION_CONFLICT);
  });
});

describe('DELETE /api/books/:id và delete-check', () => {
  it('delete-check trả số đơn hoạt động', async () => {
    const { app, bookService } = makeApp();
    bookService.getDeleteCheck.mockResolvedValue({ canDelete: false, activeBorrowCount: 3 });
    const res = await request(app).get('/api/books/7/delete-check').set('Authorization', bearer(2));
    expect(res.body).toEqual({ canDelete: false, activeBorrowCount: 3 });
    expect(bookService.getDeleteCheck).toHaveBeenCalledWith(7);
  });

  it('còn đơn hoạt động → 409 kèm thông báo', async () => {
    const { app, bookService } = makeApp();
    bookService.deleteBook.mockRejectedValue(new HttpError(409, activeBorrowsMessage(2)));
    const res = await request(app).delete('/api/books/7').set('Authorization', bearer(2));
    expect(res.status).toBe(409);
    expect(res.body.message).toContain('2 đơn mượn hoạt động');
  });

  it('id sai → 404', async () => {
    const { app } = makeApp();
    expect((await request(app).delete('/api/books/0').set('Authorization', bearer(2))).status).toBe(404);
  });
});
