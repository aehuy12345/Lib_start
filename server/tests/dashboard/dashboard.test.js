import request from 'supertest';
import { Prisma } from '@prisma/client';
import { createApp } from '../../src/app';
import { createTokenService } from '../../src/lib/tokens';
import { createDashboardService } from '../../src/modules/dashboard/dashboard.service';

// 2026-10-25 17:30 UTC = 00:30 ngày 26/10 ở Việt Nam (edge 4: ranh giới nửa đêm).
const NOW = new Date('2026-10-25T17:30:00Z');

// Ghép lại câu SQL mà $queryRaw nhận để kiểm tra điều kiện và tham số.
function sqlOf(call) {
  const [strings, ...values] = call;
  return Prisma.sql(strings, ...values);
}

function makeService(prisma) {
  return createDashboardService({ prisma, now: () => NOW });
}

describe('dashboardService.bookStats', () => {
  it('cộng số lượng sách chưa xóa, đếm lần trả Mất / Hư hỏng đã xác nhận', async () => {
    const stats = { titleCount: 3, totalQuantity: 10, available: 6, borrowed: 3, lost: 2, damaged: 1 };
    const prisma = { $queryRaw: vi.fn(async () => [stats]) };
    expect(await makeService(prisma).bookStats()).toEqual(stats);
    const { sql } = sqlOf(prisma.$queryRaw.mock.calls[0]);
    // Edge 7: sách đã xóa không tính vào tổng sách. Edge 1: coalesce để bảng rỗng ra 0.
    expect(sql.match(/b\.deleted_at IS NULL/g)).toHaveLength(6);
    expect(sql).toContain('coalesce(sum(b.available_quantity), 0)');
    expect(sql).toContain("rr.condition = 'lost'");
    expect(sql).toContain("rr.condition = 'damaged'");
    expect(sql.match(/rr\.status = 'confirmed'/g)).toHaveLength(2);
  });
});

describe('dashboardService.readerStats', () => {
  it('đếm Reader theo trạng thái, không tính tài khoản Chờ xác nhận', async () => {
    const prisma = { user: { groupBy: vi.fn(async () => [{ status: 'active', _count: { _all: 7 } }]) } };
    expect(await makeService(prisma).readerStats()).toEqual({ active: 7, disabled: 0 });
    expect(prisma.user.groupBy).toHaveBeenCalledWith(expect.objectContaining({
      where: { role: 'reader', status: { in: ['active', 'disabled'] } },
    }));
  });
});

describe('dashboardService.borrowsToday', () => {
  it('edge 4: ngày hôm nay theo Asia/Ho_Chi_Minh, cộng mọi trạng thái', async () => {
    const prisma = { $queryRaw: vi.fn(async () => [{ status: 'pending', count: 2 }, { status: 'borrowing', count: 3 }]) };
    expect(await makeService(prisma).borrowsToday()).toEqual({
      date: '2026-10-26',
      total: 5,
      byStatus: { pending: 2, borrowing: 3, returned: 0, rejected: 0, cancelled: 0 },
    });
    const query = sqlOf(prisma.$queryRaw.mock.calls[0]);
    expect(query.sql).toContain('(created_at AT TIME ZONE ?)::date = ?::date');
    expect(query.values).toEqual(['Asia/Ho_Chi_Minh', '2026-10-26']);
  });

  it('edge 1: chưa có đơn nào → 0', async () => {
    const prisma = { $queryRaw: vi.fn(async () => []) };
    expect((await makeService(prisma).borrowsToday()).total).toBe(0);
  });
});

describe('dashboardService.topBooks', () => {
  it('5 sách mượn nhiều nhất, bằng nhau theo tên, gồm cả sách đã xóa (edge 7)', async () => {
    const books = [{ id: 1, title: 'A', author: 'X', borrowCount: 4, deleted: true }];
    const prisma = { $queryRaw: vi.fn(async () => books) };
    expect(await makeService(prisma).topBooks()).toEqual({ books });
    const query = sqlOf(prisma.$queryRaw.mock.calls[0]);
    // Edge 2: chỉ sách từng được mượn, nên ít hơn 5 thì trả ít hơn.
    expect(query.sql).toContain('WHERE borrow_count > 0');
    expect(query.sql).not.toContain('deleted_at IS NULL');
    expect(query.sql).toContain('ORDER BY borrow_count DESC, title ASC');
    expect(query.values).toEqual([5]);
  });
});

describe('dashboardService.overdueReaders', () => {
  function makePrisma({ total = 2, readers, orders }) {
    return {
      $queryRaw: vi.fn(async (strings) => (strings.join('').includes('AS total') ? [{ total }] : readers)),
      borrowOrder: { findMany: vi.fn(async () => orders) },
    };
  }

  it('độc giả quá hạn kèm sách và số ngày muộn, tối đa 10 (edge 3)', async () => {
    const prisma = makePrisma({
      total: 12,
      readers: [
        { id: 5, name: 'An', email: 'an@example.com', oldestDueDate: new Date('2026-10-20') },
        { id: 6, name: 'Bình', email: 'binh@example.com', oldestDueDate: new Date('2026-10-25') },
      ],
      orders: [
        { id: 11, readerId: 5, dueDate: new Date('2026-10-20'), book: { id: 1, title: 'Sách 1' } },
        { id: 12, readerId: 5, dueDate: new Date('2026-10-24'), book: { id: 2, title: 'Sách 2' } },
        { id: 13, readerId: 6, dueDate: new Date('2026-10-25'), book: { id: 3, title: 'Sách 3' } },
      ],
    });
    expect(await makeService(prisma).overdueReaders()).toEqual({
      total: 12,
      limit: 10,
      readers: [
        {
          id: 5, name: 'An', email: 'an@example.com', maxLateDays: 6,
          books: [
            { borrowOrderId: 11, bookId: 1, title: 'Sách 1', dueDate: '2026-10-20', lateDays: 6 },
            { borrowOrderId: 12, bookId: 2, title: 'Sách 2', dueDate: '2026-10-24', lateDays: 2 },
          ],
        },
        {
          id: 6, name: 'Bình', email: 'binh@example.com', maxLateDays: 1,
          books: [{ borrowOrderId: 13, bookId: 3, title: 'Sách 3', dueDate: '2026-10-25', lateDays: 1 }],
        },
      ],
    });
    const list = sqlOf(prisma.$queryRaw.mock.calls[1]);
    expect(list.sql).toContain("bo.status = 'borrowing' AND bo.due_date < ?::date");
    expect(list.sql).toContain('ORDER BY min(bo.due_date) ASC');
    expect(list.values).toEqual(['2026-10-26', 10]);
    expect(prisma.borrowOrder.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { readerId: { in: [5, 6] }, status: 'borrowing', dueDate: { lt: new Date('2026-10-26') } },
    }));
  });

  it('edge 1: không ai quá hạn → danh sách trống, không truy vấn đơn', async () => {
    const prisma = makePrisma({ total: 0, readers: [], orders: [] });
    expect(await makeService(prisma).overdueReaders()).toEqual({ total: 0, limit: 10, readers: [] });
    expect(prisma.borrowOrder.findMany).not.toHaveBeenCalled();
  });
});

describe('Phân quyền /api/dashboard', () => {
  const tokens = createTokenService({ secret: 'test-secret', expiresIn: '24h' });
  const USERS = {
    1: { id: 1, email: 'r@example.com', name: 'R', role: 'reader', status: 'active' },
    2: { id: 2, email: 'l@example.com', name: 'L', role: 'librarian', status: 'active' },
    3: { id: 3, email: 'a@example.com', name: 'A', role: 'admin', status: 'active' },
  };
  const bearer = (id) => `Bearer ${tokens.sign(USERS[id])}`;
  const ROUTES = [
    ['/api/dashboard/books', 'bookStats'],
    ['/api/dashboard/readers', 'readerStats'],
    ['/api/dashboard/borrows-today', 'borrowsToday'],
    ['/api/dashboard/top-books', 'topBooks'],
    ['/api/dashboard/overdue-readers', 'overdueReaders'],
  ];

  function makeApp() {
    const authService = { getSessionUser: vi.fn(async (id) => USERS[id] ?? null) };
    const dashboardService = Object.fromEntries(ROUTES.map(([, method]) => [method, vi.fn(async () => ({ method }))]));
    return { app: createApp({ authService, dashboardService, tokens }), dashboardService };
  }

  it.each(ROUTES)('%s không có token → 401', async (url) => {
    expect((await request(makeApp().app).get(url)).status).toBe(401);
  });

  it.each(ROUTES)('edge 6: reader %s → 403', async (url, method) => {
    const { app, dashboardService } = makeApp();
    expect((await request(app).get(url).set('Authorization', bearer(1))).status).toBe(403);
    expect(dashboardService[method]).not.toHaveBeenCalled();
  });

  it.each(ROUTES)('librarian và admin %s → 200, không cache (edge 5)', async (url, method) => {
    const { app } = makeApp();
    for (const id of [2, 3]) {
      const res = await request(app).get(url).set('Authorization', bearer(id));
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ method });
      expect(res.headers['cache-control']).toBe('no-store');
    }
  });

  it('thẻ không tồn tại → 404', async () => {
    const res = await request(makeApp().app).get('/api/dashboard/fines').set('Authorization', bearer(3));
    expect(res.status).toBe(404);
  });

  it('một truy vấn lỗi chỉ làm hỏng thẻ đó', async () => {
    const { app, dashboardService } = makeApp();
    dashboardService.topBooks.mockRejectedValueOnce(new Error('db down'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await request(app).get('/api/dashboard/top-books').set('Authorization', bearer(2))).status).toBe(500);
    expect((await request(app).get('/api/dashboard/books').set('Authorization', bearer(2))).status).toBe(200);
  });
});
