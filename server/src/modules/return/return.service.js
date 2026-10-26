const { HttpError } = require('../../lib/httpError');
const { ORDER_NOT_FOUND } = require('../borrow/borrow.service');
const { RETURN_BLOCKED, evaluateReturnRequest } = require('./return.rules');

const RETURN_NOT_FOUND = 'Không tìm thấy yêu cầu trả sách';
const NOT_CANCELLABLE = 'Chỉ hủy được yêu cầu trả đang chờ xác nhận';
const CREATED = 'Đã gửi yêu cầu trả sách, vui lòng mang sách đến thư viện để nhân viên xác nhận';
const CANCELLED = 'Đã hủy yêu cầu trả sách';

function returnBlocked(reason) {
  return Object.assign(new HttpError(409, RETURN_BLOCKED[reason]), { reason });
}

function toReturnRequest(row) {
  return { id: row.id, borrowOrderId: row.borrowOrderId, status: row.status, createdAt: row.createdAt };
}

function createReturnService({ prisma, now = () => new Date() }) {
  // PRD 2.4.1. Đơn mượn giữ nguyên trạng thái cho tới khi nhân viên xác nhận (2.4.2).
  async function createReturnRequest(readerId, { borrowOrderId }) {
    try {
      const row = await prisma.$transaction(async (tx) => {
        // Cùng khóa FOR UPDATE với gia hạn (2.3.3): không thể vừa gia hạn vừa gửi yêu cầu trả.
        const [order] = await tx.$queryRaw`
          SELECT status FROM borrow_orders
          WHERE id = ${borrowOrderId} AND reader_id = ${readerId} FOR UPDATE`;
        // Đơn của người khác cũng là 404 để không lộ đơn tồn tại.
        if (!order) throw new HttpError(404, ORDER_NOT_FOUND);
        const pending = await tx.returnRequest.count({ where: { borrowOrderId, status: 'pending' } });
        const reason = evaluateReturnRequest({ status: order.status, hasPendingReturn: pending > 0 });
        if (reason) throw returnBlocked(reason);
        return tx.returnRequest.create({ data: { borrowOrderId, requestedById: readerId } });
      });
      return { message: CREATED, returnRequest: toReturnRequest(row) };
    } catch (err) {
      // Edge 1: partial unique index một yêu cầu `pending` mỗi đơn là chốt chặn cuối.
      if (err?.code === 'P2002') throw returnBlocked('pending_return');
      throw err;
    }
  }

  // [Giả định] đề xuất 2.4.1 edge 5: độc giả hủy yêu cầu còn `Chờ xác nhận`. Cập nhật có điều kiện
  // nên không đè lên yêu cầu nhân viên vừa xử lý (2.4.2).
  async function cancelReturnRequest(readerId, id) {
    const { count } = await prisma.returnRequest.updateMany({
      where: { id, requestedById: readerId, status: 'pending' },
      data: { status: 'cancelled', cancelledAt: now() },
    });
    if (count === 1) return { message: CANCELLED };
    const request = await prisma.returnRequest.findFirst({ where: { id, requestedById: readerId }, select: { id: true } });
    throw new HttpError(request ? 409 : 404, request ? NOT_CANCELLABLE : RETURN_NOT_FOUND);
  }

  return { createReturnRequest, cancelReturnRequest };
}

module.exports = { createReturnService, RETURN_NOT_FOUND, NOT_CANCELLABLE, CREATED, CANCELLED };
