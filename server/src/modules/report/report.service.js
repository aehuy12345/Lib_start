const { Prisma } = require('@prisma/client');
const { BUSINESS_TZ, businessToday } = require('../../lib/businessDate');
const { resolveRange } = require('./report.validation');

const PAGE_SIZE = 10;
const BOOK_CHART_LIMIT = 10;
const FINE_TYPES = ['late', 'damaged', 'lost'];
// date_trunc + bước của generate_series cho từng cách gom nhóm.
const BUCKETS = {
  day: { unit: 'day', step: '1 day' },
  month: { unit: 'month', step: '1 month' },
  quarter: { unit: 'quarter', step: '3 months' },
};

// Cột thời điểm (UTC) nằm trong [from, to] tính theo ngày Asia/Ho_Chi_Minh, cả hai đầu. So sánh trực tiếp
// trên cột để dùng được index. `column` chỉ là hằng trong file này, không đến từ request.
function within(column, { from, to }) {
  const col = Prisma.raw(column);
  return Prisma.sql`${col} >= (${from}::date::timestamp AT TIME ZONE ${BUSINESS_TZ})
    AND ${col} < ((${to}::date + 1)::timestamp AT TIME ZONE ${BUSINESS_TZ})`;
}

// Trang vượt quá trang cuối thì trả trang cuối (như 2.2.3). all = true (xuất CSV): lấy mọi dòng.
function paging(total, page, all) {
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const current = Math.min(page, totalPages);
  return {
    pagination: { page: current, pageSize: PAGE_SIZE, total, totalPages },
    limit: all ? Prisma.empty : Prisma.sql`LIMIT ${PAGE_SIZE} OFFSET ${(current - 1) * PAGE_SIZE}`,
  };
}

// SUM trên cột int trả về bigint; số tiền phạt cộng lại có thể vượt int32 nên giữ bigint rồi đổi sang Number.
const toNumber = (value) => Number(value ?? 0);

// 2.7.2 (Librarian + Admin), chỉ đọc. Mọi báo cáo gom nhóm trong DB (edge 2); CSV gọi lại đúng hàm này với
// cùng bộ lọc (edge 6).
function createReportService({ prisma, now = () => new Date() }) {
  // Báo cáo Sách: tồn kho hiện tại của sách chưa xóa (như 2.7.1 edge 7) + số lượt mượn (đơn được xác nhận,
  // theo borrowed_at), số bản mất / hư hỏng (trả sách đã xác nhận, theo processed_at) trong khoảng.
  async function books(range, { page = 1, all = false } = {}) {
    const from = Prisma.sql`
      FROM books b
      JOIN categories c ON c.id = b.category_id
      LEFT JOIN (
        SELECT book_id, count(*)::int AS n FROM borrow_orders
        WHERE ${within('borrowed_at', range)} GROUP BY book_id
      ) l ON l.book_id = b.id
      LEFT JOIN (
        SELECT bo.book_id,
          count(*) FILTER (WHERE rr.condition = 'lost')::int AS lost,
          count(*) FILTER (WHERE rr.condition = 'damaged')::int AS damaged
        FROM return_requests rr JOIN borrow_orders bo ON bo.id = rr.borrow_order_id
        WHERE rr.status = 'confirmed' AND rr.condition IN ('lost', 'damaged') AND ${within('rr.processed_at', range)}
        GROUP BY bo.book_id
      ) x ON x.book_id = b.id
      WHERE b.deleted_at IS NULL`;

    const [summary] = await prisma.$queryRaw`
      SELECT count(*)::int AS "titleCount",
        coalesce(sum(b.total_quantity), 0)::int AS "totalQuantity",
        coalesce(sum(b.available_quantity), 0)::int AS available,
        coalesce(sum(b.borrowed_quantity), 0)::int AS borrowed,
        coalesce(sum(b.damaged_quantity), 0)::int AS damaged,
        coalesce(sum(l.n), 0)::int AS "borrowsInRange",
        coalesce(sum(x.lost), 0)::int AS "lostInRange",
        coalesce(sum(x.damaged), 0)::int AS "damagedInRange"
      ${from}`;
    const { pagination, limit } = paging(summary.titleCount, page, all);
    const [rows, chart] = await Promise.all([
      prisma.$queryRaw`
        SELECT b.id, b.title, b.author, b.isbn, c.name AS category,
          b.total_quantity AS "totalQuantity", b.available_quantity AS available,
          b.borrowed_quantity AS borrowed, b.damaged_quantity AS damaged,
          coalesce(l.n, 0) AS "borrowsInRange", coalesce(x.lost, 0) AS "lostInRange",
          coalesce(x.damaged, 0) AS "damagedInRange"
        ${from}
        ORDER BY "borrowsInRange" DESC, b.title ASC, b.id ASC
        ${limit}`,
      // Biểu đồ: 10 sách mượn nhiều nhất trong khoảng; không cần cho CSV.
      all ? [] : prisma.$queryRaw`
        SELECT b.id, b.title, l.n AS borrows
        ${from} AND l.n > 0
        ORDER BY l.n DESC, b.title ASC, b.id ASC
        LIMIT ${BOOK_CHART_LIMIT}`,
    ]);
    return { summary, chart, rows, pagination, hasData: summary.titleCount > 0 };
  }

  // Báo cáo Mượn trả: số đơn được xác nhận mượn (borrowed_at) và số đơn đã trả (returned_at) theo từng ngày,
  // tháng hoặc quý; mốc nào không có thì là 0. Tính cả sách đã xóa (thống kê mượn, như 2.7.1 edge 7).
  async function borrows(range) {
    const { unit, step } = BUCKETS[range.groupBy];
    const bucketOf = (column) => Prisma.sql`date_trunc(${unit}, ${Prisma.raw(column)} AT TIME ZONE ${BUSINESS_TZ})::date`;
    const rows = await prisma.$queryRaw`
      WITH buckets AS (
        SELECT generate_series(date_trunc(${unit}, ${range.from}::date::timestamp), ${range.to}::date::timestamp,
          ${step}::interval)::date AS bucket
      ), lent AS (
        SELECT ${bucketOf('borrowed_at')} AS bucket, count(*)::int AS n FROM borrow_orders
        WHERE ${within('borrowed_at', range)} GROUP BY 1
      ), back AS (
        SELECT ${bucketOf('returned_at')} AS bucket, count(*)::int AS n FROM borrow_orders
        WHERE status = 'returned' AND ${within('returned_at', range)} GROUP BY 1
      )
      SELECT to_char(k.bucket, 'YYYY-MM-DD') AS period, coalesce(l.n, 0) AS borrowed, coalesce(r.n, 0) AS returned
      FROM buckets k LEFT JOIN lent l ON l.bucket = k.bucket LEFT JOIN back r ON r.bucket = k.bucket
      ORDER BY k.bucket`;
    const summary = {
      borrowed: rows.reduce((sum, row) => sum + row.borrowed, 0),
      returned: rows.reduce((sum, row) => sum + row.returned, 0),
    };
    return { groupBy: range.groupBy, summary, rows, hasData: summary.borrowed + summary.returned > 0 };
  }

  // Báo cáo Phạt: theo loại phạt, trong khoảng — phát sinh (issued_at), đã thu (đã xác nhận thanh toán,
  // confirmed_at), chưa thu (phát sinh trong khoảng, chưa thanh toán xong). Kèm danh sách độc giả nợ tại thời
  // điểm xem (flow: "người nợ ngoài hạn" = nợ phạt hoặc có sách quá hạn, hai cột), không theo khoảng thời gian.
  async function fines(range, { page = 1, all = false } = {}) {
    const issued = within('t.issued_at', range);
    const confirmed = within('t.confirmed_at', range);
    const today = businessToday(now());
    const byTypeRows = await prisma.$queryRaw`
      SELECT t.type::text AS type,
        count(*) FILTER (WHERE ${issued})::int AS "issuedCount",
        coalesce(sum(t.amount) FILTER (WHERE ${issued}), 0)::bigint AS "issuedAmount",
        count(*) FILTER (WHERE t.status = 'paid' AND ${confirmed})::int AS "collectedCount",
        coalesce(sum(t.amount) FILTER (WHERE t.status = 'paid' AND ${confirmed}), 0)::bigint AS "collectedAmount",
        count(*) FILTER (WHERE t.status <> 'paid' AND ${issued})::int AS "outstandingCount",
        coalesce(sum(t.amount) FILTER (WHERE t.status <> 'paid' AND ${issued}), 0)::bigint AS "outstandingAmount"
      FROM fine_tickets t
      WHERE (${issued}) OR (${confirmed})
      GROUP BY t.type`;
    const keys = ['issuedCount', 'issuedAmount', 'collectedCount', 'collectedAmount', 'outstandingCount', 'outstandingAmount'];
    const byType = FINE_TYPES.map((type) => {
      const row = byTypeRows.find((r) => r.type === type) ?? {};
      return { type, ...Object.fromEntries(keys.map((key) => [key, toNumber(row[key])])) };
    });
    const summary = Object.fromEntries(keys.map((key) => [key, byType.reduce((sum, row) => sum + row[key], 0)]));

    // Nợ phạt = phiếu chưa thanh toán xong (status <> 'paid', như điều kiện chặn mượn 2.3.1).
    const debtors = Prisma.sql`
      FROM users u
      LEFT JOIN (
        SELECT reader_id, count(*)::int AS n, sum(amount)::bigint AS amount FROM fine_tickets
        WHERE status <> 'paid' GROUP BY reader_id
      ) d ON d.reader_id = u.id
      LEFT JOIN (
        SELECT reader_id, count(*)::int AS n, (${today}::date - min(due_date))::int AS late_days FROM borrow_orders
        WHERE status = 'borrowing' AND due_date < ${today}::date GROUP BY reader_id
      ) o ON o.reader_id = u.id
      WHERE d.reader_id IS NOT NULL OR o.reader_id IS NOT NULL`;
    const [{ total }] = await prisma.$queryRaw`SELECT count(*)::int AS total ${debtors}`;
    const { pagination, limit } = paging(total, page, all);
    const rows = await prisma.$queryRaw`
      SELECT u.id, u.name, u.email,
        coalesce(d.n, 0) AS "unpaidCount", coalesce(d.amount, 0) AS "unpaidAmount",
        coalesce(o.n, 0) AS "overdueCount", coalesce(o.late_days, 0) AS "maxLateDays"
      ${debtors}
      ORDER BY coalesce(d.amount, 0) DESC, coalesce(o.late_days, 0) DESC, u.name ASC, u.id ASC
      ${limit}`;

    return {
      date: today,
      summary,
      byType,
      debtors: rows.map((row) => ({ ...row, unpaidAmount: toNumber(row.unpaidAmount) })),
      pagination,
      hasData: summary.issuedCount + summary.collectedCount + total > 0,
    };
  }

  // Báo cáo Sách mất / hư: lần trả đã xác nhận với tình trạng Mất hoặc Hư hỏng trong khoảng (processed_at),
  // gom theo sách và tình trạng; mỗi lần trả là một bản cần thay. Bỏ sách đã xóa (không còn cần thay).
  async function damagedLost(range, { page = 1, all = false } = {}) {
    const from = Prisma.sql`
      FROM return_requests rr
      JOIN borrow_orders bo ON bo.id = rr.borrow_order_id
      JOIN books b ON b.id = bo.book_id
      JOIN categories c ON c.id = b.category_id
      WHERE rr.status = 'confirmed' AND rr.condition IN ('lost', 'damaged') AND b.deleted_at IS NULL
        AND ${within('rr.processed_at', range)}`;
    const [counts] = await prisma.$queryRaw`
      SELECT count(*) FILTER (WHERE rr.condition = 'lost')::int AS lost,
        count(*) FILTER (WHERE rr.condition = 'damaged')::int AS damaged,
        count(DISTINCT b.id::text || ':' || rr.condition::text)::int AS total
      ${from}`;
    const { pagination, limit } = paging(counts.total, page, all);
    const rows = await prisma.$queryRaw`
      SELECT b.id AS "bookId", b.title, b.author, b.isbn, c.name AS category, rr.condition::text AS condition,
        count(*)::int AS copies,
        to_char(max(rr.processed_at AT TIME ZONE ${BUSINESS_TZ}), 'YYYY-MM-DD') AS "lastRecordedAt"
      ${from}
      GROUP BY b.id, c.name, rr.condition
      ORDER BY max(rr.processed_at) DESC, b.title ASC, b.id ASC, rr.condition ASC
      ${limit}`;
    return {
      summary: { lost: counts.lost, damaged: counts.damaged, copies: counts.lost + counts.damaged },
      rows,
      pagination,
      hasData: counts.total > 0,
    };
  }

  const REPORTS = { books, borrows, fines, 'damaged-lost': damagedLost };

  // query đã qua reportQuerySchema; type đã được route kiểm tra.
  async function getReport(type, query, options = {}) {
    const range = resolveRange(query, businessToday(now()));
    const report = await REPORTS[type](range, { page: query.page, ...options });
    return { type, from: range.from, to: range.to, ...report };
  }

  return { getReport, books, borrows, fines, damagedLost };
}

module.exports = { createReportService, PAGE_SIZE, BOOK_CHART_LIMIT, within };
