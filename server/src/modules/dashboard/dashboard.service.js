const { BUSINESS_TZ, businessToday, toDateString } = require('../../lib/businessDate');

const TOP_BOOKS_LIMIT = 5;
const OVERDUE_READERS_LIMIT = 10;
const DAY_MS = 24 * 3600 * 1000;

// Số ngày từ hạn trả tới hôm nay ('YYYY-MM-DD'), cùng cách tính lateDays của 2.4.2.
function daysBetween(fromDate, toDate) {
  return Math.round((Date.parse(toDate) - Date.parse(fromDate)) / DAY_MS);
}

// 2.7.1 (Librarian + Admin), chỉ đọc. Mỗi thẻ là một truy vấn riêng để client hiển thị lỗi và Thử lại
// từng thẻ. Edge 1: SUM/COUNT trên bảng rỗng trả về 0, không chia cho số nào.
function createDashboardService({ prisma, now = () => new Date() }) {
  // Edge 7: sách đã soft delete không tính vào tổng sách. Bị mất / Hư hỏng là số lần trả sách đã xác nhận
  // với tình trạng đó (định nghĩa chỉ số trong flow), cũng chỉ trên sách chưa xóa.
  async function bookStats() {
    const [row] = await prisma.$queryRaw`
      SELECT
        (SELECT count(*)::int FROM books b WHERE b.deleted_at IS NULL) AS "titleCount",
        (SELECT coalesce(sum(b.total_quantity), 0)::int FROM books b WHERE b.deleted_at IS NULL) AS "totalQuantity",
        (SELECT coalesce(sum(b.available_quantity), 0)::int FROM books b WHERE b.deleted_at IS NULL) AS "available",
        (SELECT coalesce(sum(b.borrowed_quantity), 0)::int FROM books b WHERE b.deleted_at IS NULL) AS "borrowed",
        (SELECT count(*) FILTER (WHERE rr.condition = 'lost')::int FROM return_requests rr
          JOIN borrow_orders bo ON bo.id = rr.borrow_order_id JOIN books b ON b.id = bo.book_id
          WHERE rr.status = 'confirmed' AND b.deleted_at IS NULL) AS "lost",
        (SELECT count(*) FILTER (WHERE rr.condition = 'damaged')::int FROM return_requests rr
          JOIN borrow_orders bo ON bo.id = rr.borrow_order_id JOIN books b ON b.id = bo.book_id
          WHERE rr.status = 'confirmed' AND b.deleted_at IS NULL) AS "damaged"`;
    return row;
  }

  // Chỉ đếm vai trò Reader; tài khoản Chờ xác nhận không tính.
  async function readerStats() {
    const rows = await prisma.user.groupBy({
      by: ['status'],
      where: { role: 'reader', status: { in: ['active', 'disabled'] } },
      _count: { _all: true },
    });
    const count = (status) => rows.find((r) => r.status === status)?._count._all ?? 0;
    return { active: count('active'), disabled: count('disabled') };
  }

  // Edge 4: "hôm nay" theo Asia/Ho_Chi_Minh của server, không theo giờ trình duyệt. Đếm mọi đơn tạo trong
  // ngày, kèm số theo trạng thái hiện tại.
  async function borrowsToday() {
    const today = businessToday(now());
    const rows = await prisma.$queryRaw`
      SELECT status::text AS status, count(*)::int AS count FROM borrow_orders
      WHERE (created_at AT TIME ZONE ${BUSINESS_TZ})::date = ${today}::date
      GROUP BY status`;
    const byStatus = { pending: 0, borrowing: 0, returned: 0, rejected: 0, cancelled: 0 };
    for (const row of rows) byStatus[row.status] = row.count;
    return { date: today, total: rows.reduce((sum, row) => sum + row.count, 0), byStatus };
  }

  // borrow_count tăng khi đơn được xác nhận (2.3.2), nên là số đơn mượn đã xác nhận. Edge 2: chỉ sách từng
  // được mượn; edge 7: vẫn tính sách đã xóa. Bằng nhau thì theo tên.
  async function topBooks() {
    const rows = await prisma.$queryRaw`
      SELECT id, title, author, borrow_count AS "borrowCount", deleted_at IS NOT NULL AS deleted
      FROM books WHERE borrow_count > 0
      ORDER BY borrow_count DESC, title ASC, id ASC
      LIMIT ${TOP_BOOKS_LIMIT}`;
    return { books: rows };
  }

  // Độc giả có ít nhất một đơn Đang mượn đã qua hạn (Quá hạn suy ra từ due_date < hôm nay, như 2.3.3).
  // Edge 3: 10 độc giả muộn nhiều nhất kèm tổng số để client báo còn bao nhiêu người.
  async function overdueReaders() {
    const today = businessToday(now());
    const [[{ total }], readers] = await Promise.all([
      prisma.$queryRaw`
        SELECT count(DISTINCT reader_id)::int AS total FROM borrow_orders
        WHERE status = 'borrowing' AND due_date < ${today}::date`,
      prisma.$queryRaw`
        SELECT u.id, u.name, u.email, min(bo.due_date) AS "oldestDueDate"
        FROM borrow_orders bo JOIN users u ON u.id = bo.reader_id
        WHERE bo.status = 'borrowing' AND bo.due_date < ${today}::date
        GROUP BY u.id
        ORDER BY min(bo.due_date) ASC, u.name ASC, u.id ASC
        LIMIT ${OVERDUE_READERS_LIMIT}`,
    ]);
    const orders = readers.length === 0 ? [] : await prisma.borrowOrder.findMany({
      where: { readerId: { in: readers.map((r) => r.id) }, status: 'borrowing', dueDate: { lt: new Date(today) } },
      select: { id: true, readerId: true, dueDate: true, book: { select: { id: true, title: true } } },
      orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
    });

    return {
      total,
      limit: OVERDUE_READERS_LIMIT,
      readers: readers.map((reader) => {
        const books = orders.filter((o) => o.readerId === reader.id).map((o) => {
          const dueDate = toDateString(o.dueDate);
          return { borrowOrderId: o.id, bookId: o.book.id, title: o.book.title, dueDate, lateDays: daysBetween(dueDate, today) };
        });
        return {
          id: reader.id,
          name: reader.name,
          email: reader.email,
          maxLateDays: daysBetween(toDateString(reader.oldestDueDate), today),
          books,
        };
      }),
    };
  }

  return { bookStats, readerStats, borrowsToday, topBooks, overdueReaders };
}

module.exports = { createDashboardService, TOP_BOOKS_LIMIT, OVERDUE_READERS_LIMIT };
