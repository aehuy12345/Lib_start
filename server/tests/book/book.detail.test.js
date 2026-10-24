import request from 'supertest';
import { createApp } from '../../src/app';
import { createTokenService } from '../../src/lib/tokens';
import { HttpError } from '../../src/lib/httpError';
import { createBookService, BOOK_NOT_FOUND } from '../../src/modules/book/book.service';
import { parseBookId, borrowHistoryQuerySchema } from '../../src/modules/book/book.validation';

describe('parseBookId (2.2.4 edge 1)', () => {
  it.each([['1', 1], ['42', 42], ['2147483647', 2147483647]])('"%s" → %i', (raw, id) => {
    expect(parseBookId(raw)).toBe(id);
  });

  it.each(['0', '-1', 'abc', '1.5', '01', '1e3', ' 1', '2147483648', '99999999999'])('"%s" → null', (raw) => {
    expect(parseBookId(raw)).toBeNull();
  });
});

describe('borrowHistoryQuerySchema', () => {
  it.each([[{}, 1], [{ page: '3' }, 3], [{ page: '0' }, 1], [{ page: 'x' }, 1]])('%j → page %i', (query, page) => {
    expect(borrowHistoryQuerySchema.validate(query).value).toEqual({ page });
  });
});

const BOOK_ROW = {
  id: 7, title: 'Dế Mèn', author: 'Tô Hoài', publishYear: 1941, isbn: '9780306406157', description: 'Truyện',
  category: { id: 2, name: 'Thiếu nhi' }, coverPath: null, totalQuantity: 5, availableQuantity: 2,
  borrowedQuantity: 3, damagedQuantity: 0, createdAt: new Date('2026-10-01T00:00:00Z'),
};
// 2026-10-24 17:30 UTC = ngày 25/10 theo giờ Việt Nam.
const NOW = new Date('2026-10-24T17:30:00Z');

function makeService({ book = BOOK_ROW, counts = {}, orders = [], total = orders.length } = {}) {
  const prisma = {
    book: { findFirst: vi.fn(async () => book) },
    borrowOrder: {
      count: vi.fn(async ({ where }) => {
        if (where.dueDate) return counts.overdue ?? 0;
        if (where.bookId && where.readerId) return counts.sameBook ?? 0;
        if (where.readerId) return counts.active ?? 0;
        return total;
      }),
      findMany: vi.fn(async () => orders),
    },
    fineTicket: { count: vi.fn(async () => counts.fines ?? 0) },
  };
  const storage = { publicUrl: (bucket, path) => (path ? `https://cdn/${bucket}/${path}` : null) };
  return { service: createBookService({ prisma, storage, now: () => NOW }), prisma };
}

describe('bookService.getBook (2.2.4)', () => {
  it('trả đủ thông tin PRD, ảnh bìa null khi chưa có (edge 8), không kèm lịch sử', async () => {
    const { service, prisma } = makeService();
    const book = await service.getBook(7);
    expect(prisma.book.findFirst).toHaveBeenCalledWith({ where: { id: 7, deletedAt: null }, include: { category: true } });
    expect(book).toEqual({
      id: 7, title: 'Dế Mèn', author: 'Tô Hoài', publishYear: 1941, isbn: '9780306406157', description: 'Truyện',
      category: { id: 2, name: 'Thiếu nhi' }, coverUrl: null, totalQuantity: 5, availableQuantity: 2,
      borrowedQuantity: 3, createdAt: BOOK_ROW.createdAt,
    });
  });

  it('không có hoặc đã xóa mềm → 404', async () => {
    const { service } = makeService({ book: null });
    await expect(service.getBook(7)).rejects.toMatchObject({ status: 404, message: BOOK_NOT_FOUND });
  });
});

const order = (id, extra = {}) => ({
  id, status: 'pending', createdAt: new Date('2026-10-20T03:00:00Z'), borrowedAt: null, dueDate: null, returnedAt: null,
  reader: { id: 1, name: 'Độc Giả', email: 'r@example.com' }, ...extra,
});

describe('bookService.listBorrowHistory (2.2.4)', () => {
  it('mọi trạng thái, mới nhất trước, 10 dòng mỗi trang, chỉ lấy tên + email độc giả', async () => {
    const { service, prisma } = makeService({ orders: [order(1)], total: 25 });
    const { pagination } = await service.listBorrowHistory(7, { page: 2 });
    expect(pagination).toEqual({ page: 2, pageSize: 10, total: 25, totalPages: 3 });
    expect(prisma.borrowOrder.findMany).toHaveBeenCalledWith({
      where: { bookId: 7 },
      include: { reader: { select: { id: true, name: true, email: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: 10,
      take: 10,
    });
  });

  it('quá hạn suy ra theo ngày Việt Nam; hạn trả dạng YYYY-MM-DD', async () => {
    const borrowed = { status: 'borrowing', borrowedAt: new Date('2026-10-01T02:00:00Z') };
    const { service } = makeService({
      orders: [
        order(1, { ...borrowed, dueDate: new Date('2026-10-24T00:00:00Z') }), // hôm qua theo giờ VN
        order(2, { ...borrowed, dueDate: new Date('2026-10-25T00:00:00Z') }), // hôm nay: chưa quá hạn
        order(3, { ...borrowed, status: 'returned', dueDate: new Date('2026-10-02T00:00:00Z'), returnedAt: new Date('2026-10-10T00:00:00Z') }),
        order(4, { status: 'rejected' }),
      ],
    });
    const { borrows } = await service.listBorrowHistory(7, { page: 1 });
    expect(borrows.map((b) => [b.status, b.dueDate])).toEqual([
      ['overdue', '2026-10-24'], ['borrowing', '2026-10-25'], ['returned', '2026-10-02'], ['rejected', null],
    ]);
    expect(borrows[0]).toEqual({
      id: 1, reader: { id: 1, name: 'Độc Giả', email: 'r@example.com' }, status: 'overdue',
      requestedAt: new Date('2026-10-20T03:00:00Z'), borrowedAt: borrowed.borrowedAt, dueDate: '2026-10-24', returnedAt: null,
    });
  });

  it('edge 5: chưa từng được mượn → rỗng, không truy vấn trang', async () => {
    const { service, prisma } = makeService({ total: 0 });
    expect(await service.listBorrowHistory(7, { page: 4 })).toEqual({
      borrows: [], pagination: { page: 1, pageSize: 10, total: 0, totalPages: 1 },
    });
    expect(prisma.borrowOrder.findMany).not.toHaveBeenCalled();
  });

  it('trang vượt quá → trang cuối', async () => {
    const { service, prisma } = makeService({ orders: [order(1)], total: 11 });
    expect((await service.listBorrowHistory(7, { page: 9 })).pagination.page).toBe(2);
    expect(prisma.borrowOrder.findMany.mock.calls[0][0].skip).toBe(10);
  });

  it('sách không tồn tại → 404', async () => {
    const { service, prisma } = makeService({ book: null });
    await expect(service.listBorrowHistory(7, { page: 1 })).rejects.toMatchObject({ status: 404 });
    expect(prisma.borrowOrder.count).not.toHaveBeenCalled();
  });
});

describe('bookService.getBorrowEligibility (2.2.4)', () => {
  it('đủ điều kiện', async () => {
    const { service } = makeService({ counts: { active: 4 } });
    expect(await service.getBorrowEligibility(7, 1)).toEqual({ canBorrow: true, reason: null, message: null });
  });

  it('đếm đơn chờ + đang mượn, đơn cùng sách, phiếu phạt chưa paid, đơn quá hạn theo ngày VN', async () => {
    const { service, prisma } = makeService();
    await service.getBorrowEligibility(7, 1);
    const wheres = prisma.borrowOrder.count.mock.calls.map(([arg]) => arg.where);
    expect(wheres).toContainEqual({ readerId: 1, status: { in: ['pending', 'borrowing'] } });
    expect(wheres).toContainEqual({ readerId: 1, status: { in: ['pending', 'borrowing'] }, bookId: 7 });
    expect(wheres).toContainEqual({ readerId: 1, status: 'borrowing', dueDate: { lt: new Date('2026-10-25T00:00:00Z') } });
    expect(prisma.fineTicket.count).toHaveBeenCalledWith({ where: { readerId: 1, status: { not: 'paid' } } });
  });

  it.each([
    ['out_of_stock', { book: { availableQuantity: 0 } }],
    ['limit_reached', { counts: { active: 5 } }],
    ['unpaid_fine', { counts: { fines: 1 } }],
    ['overdue', { counts: { overdue: 1 } }],
    ['already_requested', { counts: { sameBook: 1, active: 1 } }],
  ])('%s', async (reason, opts) => {
    const { service } = makeService(opts);
    expect(await service.getBorrowEligibility(7, 1)).toMatchObject({ canBorrow: false, reason });
  });

  it('edge 2: sách đã bị xóa → 404', async () => {
    const { service } = makeService({ book: null });
    await expect(service.getBorrowEligibility(7, 1)).rejects.toMatchObject({ status: 404 });
  });
});

describe('Routes 2.2.4', () => {
  const tokens = createTokenService({ secret: 'test-secret', expiresIn: '24h' });
  const USERS = {
    1: { id: 1, name: 'R', role: 'reader', status: 'active' },
    2: { id: 2, name: 'L', role: 'librarian', status: 'active' },
    3: { id: 3, name: 'A', role: 'admin', status: 'active' },
  };
  const bearer = (id) => `Bearer ${tokens.sign(USERS[id])}`;
  const HISTORY = { borrows: [], pagination: { page: 1, pageSize: 10, total: 0, totalPages: 1 } };

  function makeApp() {
    const authService = { getSessionUser: vi.fn(async (id) => USERS[id] ?? null) };
    const bookService = {
      getBook: vi.fn(async (id) => {
        if (id === 404) throw new HttpError(404, BOOK_NOT_FOUND);
        return { id, title: 'Dế Mèn' };
      }),
      listBorrowHistory: vi.fn(async () => HISTORY),
      getBorrowEligibility: vi.fn(async () => ({ canBorrow: true, reason: null, message: null })),
    };
    return { app: createApp({ authService, bookService, tokens }), bookService };
  }

  describe('GET /api/books/:id (công khai)', () => {
    it('khách → 200, chỉ có book', async () => {
      const { app, bookService } = makeApp();
      const res = await request(app).get('/api/books/7');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ book: { id: 7, title: 'Dế Mèn' } });
      expect(bookService.getBook).toHaveBeenCalledWith(7);
    });

    it('token hỏng không chặn trang công khai', async () => {
      const { app } = makeApp();
      expect((await request(app).get('/api/books/7').set('Authorization', 'Bearer hong')).status).toBe(200);
    });

    it.each(['abc', '-1', '0', '1.5', '99999999999'])('edge 1: id "%s" → 404, không gọi service', async (id) => {
      const { app, bookService } = makeApp();
      const res = await request(app).get(`/api/books/${id}`);
      expect(res.status).toBe(404);
      expect(res.body.message).toBe(BOOK_NOT_FOUND);
      expect(bookService.getBook).not.toHaveBeenCalled();
    });

    it('sách không tồn tại → 404', async () => {
      const { app } = makeApp();
      const res = await request(app).get('/api/books/404');
      expect(res.status).toBe(404);
      expect(res.body.message).toBe(BOOK_NOT_FOUND);
    });
  });

  describe('GET /api/books/:id/borrow-history (nhân viên)', () => {
    it('edge 4: khách → 401, reader → 403, không trả dữ liệu', async () => {
      const { app, bookService } = makeApp();
      expect((await request(app).get('/api/books/7/borrow-history')).status).toBe(401);
      const res = await request(app).get('/api/books/7/borrow-history').set('Authorization', bearer(1));
      expect(res.status).toBe(403);
      expect(res.body).not.toHaveProperty('borrows');
      expect(bookService.listBorrowHistory).not.toHaveBeenCalled();
    });

    it.each([2, 3])('librarian/admin (user %i) → 200, page đã chuẩn hóa', async (id) => {
      const { app, bookService } = makeApp();
      const res = await request(app).get('/api/books/7/borrow-history?page=x').set('Authorization', bearer(id));
      expect(res.status).toBe(200);
      expect(res.body).toEqual(HISTORY);
      expect(bookService.listBorrowHistory).toHaveBeenCalledWith(7, { page: 1 });
    });

    it('id sai → 404', async () => {
      const { app } = makeApp();
      expect((await request(app).get('/api/books/abc/borrow-history').set('Authorization', bearer(2))).status).toBe(404);
    });
  });

  describe('GET /api/books/:id/borrow-eligibility (độc giả)', () => {
    it('khách → 401; librarian/admin → 403', async () => {
      const { app, bookService } = makeApp();
      expect((await request(app).get('/api/books/7/borrow-eligibility')).status).toBe(401);
      expect((await request(app).get('/api/books/7/borrow-eligibility').set('Authorization', bearer(2))).status).toBe(403);
      expect((await request(app).get('/api/books/7/borrow-eligibility').set('Authorization', bearer(3))).status).toBe(403);
      expect(bookService.getBorrowEligibility).not.toHaveBeenCalled();
    });

    it('reader → 200, dùng id của chính mình', async () => {
      const { app, bookService } = makeApp();
      const res = await request(app).get('/api/books/7/borrow-eligibility').set('Authorization', bearer(1));
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ canBorrow: true, reason: null, message: null });
      expect(bookService.getBorrowEligibility).toHaveBeenCalledWith(7, 1);
    });
  });
});
