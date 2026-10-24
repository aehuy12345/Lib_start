const { HttpError } = require('../../lib/httpError');
const { businessToday, toDateString } = require('../../lib/businessDate');
const { checkBorrowConditions, countReaderBorrowState } = require('./borrow.conditions');
const { INELIGIBLE, CONFIRM_BLOCKED, evaluateConfirmEligibility, addDays } = require('./borrow.rules');

const BOOK_GONE = 'Sách không còn tồn tại';
const ORDER_NOT_FOUND = 'Không tìm thấy đơn mượn';
const NOT_CANCELLABLE = 'Chỉ hủy được đơn đang chờ xác nhận';
const CREATED = 'Đã gửi yêu cầu mượn, chờ nhân viên xác nhận';
const ALREADY_PROCESSED = 'Đơn đã được xử lý hoặc đã bị hủy, vui lòng tải lại danh sách';
const CONFIRMED = 'Đã xác nhận đơn mượn';
const REJECTED = 'Đã từ chối đơn mượn';
const PAGE_SIZE = 10;

// Lỗi nghiệp vụ kèm mã lý do để client hiển thị đúng (vd liên kết tới 2.5.2 khi còn phiếu phạt).
function ineligible(reason) {
  return Object.assign(new HttpError(409, INELIGIBLE[reason]), { reason });
}

function confirmBlocked(reason) {
  return Object.assign(new HttpError(409, CONFIRM_BLOCKED[reason]), { reason });
}

function alreadyProcessed() {
  return Object.assign(new HttpError(409, ALREADY_PROCESSED), { reason: 'already_processed' });
}

function toOrder(row) {
  return {
    id: row.id,
    bookId: row.bookId,
    status: row.status,
    requestedDays: row.requestedDays,
    createdAt: row.createdAt,
  };
}

function createBorrowService({ prisma, now = () => new Date() }) {
  // PRD 2.3.1. Kho chưa bị trừ, chỉ trừ khi nhân viên xác nhận (2.3.2); hạn trả tính từ ngày xác nhận.
  async function createBorrowOrder(readerId, { bookId, requestedDays }) {
    try {
      const row = await prisma.$transaction(async (tx) => {
        // Edge 3: khóa theo độc giả để các yêu cầu gửi dồn dập không cùng lọt qua giới hạn 5 cuốn.
        await tx.$queryRaw`SELECT id FROM users WHERE id = ${readerId} FOR UPDATE`;
        // FOR SHARE cùng dòng mà xóa sách (2.2.5) khóa FOR UPDATE: sách không thể bị xóa giữa lúc đếm và tạo đơn.
        const [book] = await tx.$queryRaw`
          SELECT available_quantity AS "availableQuantity"
          FROM books WHERE id = ${bookId} AND deleted_at IS NULL FOR SHARE`;
        if (!book) throw Object.assign(new HttpError(404, BOOK_GONE), { reason: 'book_gone' });
        const result = await checkBorrowConditions(tx, {
          readerId, bookId, availableQuantity: book.availableQuantity, now: now(),
        });
        if (!result.canBorrow) throw ineligible(result.reason);
        return tx.borrowOrder.create({ data: { readerId, bookId, requestedDays } });
      });
      return { message: CREATED, order: toOrder(row) };
    } catch (err) {
      // Index UNIQUE (reader_id, book_id) cho đơn hoạt động là chốt chặn cuối.
      if (err?.code === 'P2002') throw ineligible('already_requested');
      throw err;
    }
  }

  // [Giả định] đề xuất 2.3.1: độc giả tự hủy đơn còn `Chờ xác nhận`. Cập nhật có điều kiện nên không
  // đè lên đơn vừa được nhân viên xác nhận/từ chối (2.3.2).
  async function cancelBorrowOrder(readerId, id) {
    const { count } = await prisma.borrowOrder.updateMany({
      where: { id, readerId, status: 'pending' },
      data: { status: 'cancelled', cancelledAt: now() },
    });
    if (count === 1) return;
    // Đơn của người khác cũng là 404 để không lộ đơn tồn tại.
    const order = await prisma.borrowOrder.findFirst({ where: { id, readerId }, select: { id: true } });
    throw new HttpError(order ? 409 : 404, order ? NOT_CANCELLABLE : ORDER_NOT_FOUND);
  }

  // 2.3.2: danh sách đơn Chờ xác nhận, cũ nhất trước [Giả định] để xử lý theo thứ tự gửi.
  // Kèm SL có sẵn để UI báo trước khi sách đã hết (edge 2); server vẫn kiểm tra lại lúc xác nhận.
  async function listPendingOrders({ page = 1 }) {
    const where = { status: 'pending' };
    const total = await prisma.borrowOrder.count({ where });
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const current = Math.min(page, totalPages);
    const rows = total === 0 ? [] : await prisma.borrowOrder.findMany({
      where,
      include: {
        reader: { select: { id: true, name: true, email: true } },
        book: { select: { id: true, title: true, author: true, availableQuantity: true } },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      skip: (current - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    });
    return {
      orders: rows.map((row) => ({
        id: row.id,
        reader: row.reader,
        book: row.book,
        requestedDays: row.requestedDays,
        createdAt: row.createdAt,
      })),
      pagination: { page: current, pageSize: PAGE_SIZE, total, totalPages },
    };
  }

  // 2.3.2 Xác nhận: đổi trạng thái và trừ kho trong cùng một transaction (edge 4).
  async function confirmBorrowOrder(staffId, id) {
    const at = now();
    const row = await prisma.$transaction(async (tx) => {
      // Edge 1: khóa dòng đơn; nhân viên thứ hai chờ rồi thấy đơn không còn `pending`.
      // Hủy đơn (2.3.1) cũng cập nhật dòng này nên không thể chen giữa.
      const [order] = await tx.$queryRaw`
        SELECT reader_id AS "readerId", book_id AS "bookId", status, requested_days AS "requestedDays"
        FROM borrow_orders WHERE id = ${id} FOR UPDATE`;
      if (!order) throw new HttpError(404, ORDER_NOT_FOUND);
      if (order.status !== 'pending') throw alreadyProcessed();
      // Cùng thứ tự khóa với tạo đơn 2.3.1 (users → books) để không deadlock.
      // Edge 7: không kiểm tra vai trò, đơn gắn với user.
      const [reader] = await tx.$queryRaw`SELECT status FROM users WHERE id = ${order.readerId} FOR SHARE`;
      // FOR UPDATE cùng dòng mà sửa/xóa sách (2.2.5) khóa. Edge 5: đơn hoạt động chặn xóa nên sách luôn còn.
      const [book] = await tx.$queryRaw`
        SELECT available_quantity AS "availableQuantity" FROM books WHERE id = ${order.bookId} FOR UPDATE`;
      const counts = await countReaderBorrowState(tx, { readerId: order.readerId, now: at });
      const reason = evaluateConfirmEligibility({
        availableQuantity: book.availableQuantity, readerStatus: reader.status, ...counts,
      });
      if (reason) throw confirmBlocked(reason);

      // Không tăng `version`: chỉ nhân viên sửa sách mới đổi version (2.2.5).
      // borrow_count tăng khi xác nhận (ERD), dùng cho sắp xếp "phổ biến nhất".
      await tx.book.update({
        where: { id: order.bookId },
        data: {
          availableQuantity: { decrement: 1 },
          borrowedQuantity: { increment: 1 },
          borrowCount: { increment: 1 },
        },
      });
      // Hạn trả = ngày xác nhận (giờ VN) + thời hạn độc giả chọn (ERD).
      return tx.borrowOrder.update({
        where: { id },
        data: {
          status: 'borrowing',
          processedById: staffId,
          processedAt: at,
          borrowedAt: at,
          dueDate: new Date(addDays(businessToday(at), order.requestedDays)),
        },
      });
    });
    return {
      message: CONFIRMED,
      order: { ...toOrder(row), borrowedAt: row.borrowedAt, dueDate: toDateString(row.dueDate) },
    };
  }

  // 2.3.2 Từ chối: cập nhật có điều kiện (edge 1); kho không đổi vì đơn chờ chưa trừ kho.
  async function rejectBorrowOrder(staffId, id, { reason }) {
    const { count } = await prisma.borrowOrder.updateMany({
      where: { id, status: 'pending' },
      data: { status: 'rejected', rejectReason: reason, processedById: staffId, processedAt: now() },
    });
    if (count === 1) return { message: REJECTED };
    const order = await prisma.borrowOrder.findUnique({ where: { id }, select: { id: true } });
    if (!order) throw new HttpError(404, ORDER_NOT_FOUND);
    throw alreadyProcessed();
  }

  return { createBorrowOrder, cancelBorrowOrder, listPendingOrders, confirmBorrowOrder, rejectBorrowOrder };
}

module.exports = {
  createBorrowService, BOOK_GONE, ORDER_NOT_FOUND, NOT_CANCELLABLE, CREATED,
  ALREADY_PROCESSED, CONFIRMED, REJECTED,
};
