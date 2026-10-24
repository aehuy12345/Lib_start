const { HttpError } = require('../../lib/httpError');
const { checkBorrowConditions } = require('./borrow.conditions');
const { INELIGIBLE } = require('./borrow.rules');

const BOOK_GONE = 'Sách không còn tồn tại';
const ORDER_NOT_FOUND = 'Không tìm thấy đơn mượn';
const NOT_CANCELLABLE = 'Chỉ hủy được đơn đang chờ xác nhận';
const CREATED = 'Đã gửi yêu cầu mượn, chờ nhân viên xác nhận';

// Lỗi nghiệp vụ kèm mã lý do để client hiển thị đúng (vd liên kết tới 2.5.2 khi còn phiếu phạt).
function ineligible(reason) {
  return Object.assign(new HttpError(409, INELIGIBLE[reason]), { reason });
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

  return { createBorrowOrder, cancelBorrowOrder };
}

module.exports = { createBorrowService, BOOK_GONE, ORDER_NOT_FOUND, NOT_CANCELLABLE, CREATED };
