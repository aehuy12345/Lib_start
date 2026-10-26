const { HttpError } = require('../../lib/httpError');
const { businessToday, toDateString } = require('../../lib/businessDate');
const { ORDER_NOT_FOUND, ALREADY_PROCESSED } = require('../borrow/borrow.service');
const {
  RETURN_BLOCKED, evaluateReturnRequest, STOCK_CHANGES, lateDaysOf, requiredFineTypes, checkFineTiers,
} = require('./return.rules');

const RETURN_NOT_FOUND = 'Không tìm thấy yêu cầu trả sách';
const NOT_CANCELLABLE = 'Chỉ hủy được yêu cầu trả đang chờ xác nhận';
const CREATED = 'Đã gửi yêu cầu trả sách, vui lòng mang sách đến thư viện để nhân viên xác nhận';
const CANCELLED = 'Đã hủy yêu cầu trả sách';
const RETURN_ALREADY_PROCESSED = 'Yêu cầu trả đã được xử lý hoặc đã bị hủy, vui lòng tải lại danh sách';
const RETURNED = 'Đã xác nhận trả sách';
const RETURN_REJECTED = 'Đã từ chối yêu cầu trả sách';
const INVALID_DATA = 'Dữ liệu không hợp lệ';
const PAGE_SIZE = 10;

// Trả tại quầy (README điểm 10): lý do không nhận trả được, nói với nhân viên.
const COUNTER_BLOCKED = {
  not_borrowing: 'Đơn không còn ở trạng thái đang mượn, vui lòng tải lại danh sách',
  pending_return: 'Đơn đã có yêu cầu trả của độc giả, hãy xác nhận ở tab Chờ xác nhận trả',
};

function returnBlocked(reason) {
  return Object.assign(new HttpError(409, RETURN_BLOCKED[reason]), { reason });
}

function counterBlocked(reason) {
  return Object.assign(new HttpError(409, COUNTER_BLOCKED[reason]), { reason });
}

function alreadyProcessed(message = RETURN_ALREADY_PROCESSED) {
  return Object.assign(new HttpError(409, message), { reason: 'already_processed' });
}

function toReturnRequest(row) {
  return { id: row.id, borrowOrderId: row.borrowOrderId, status: row.status, createdAt: row.createdAt };
}

function paginate(total, page) {
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  return { page: Math.min(page, totalPages), pageSize: PAGE_SIZE, total, totalPages };
}

function returnedMessage(fines) {
  return fines.length ? `${RETURNED}, đã lập ${fines.length} phiếu phạt` : RETURNED;
}

const orderSummary = {
  id: true,
  borrowedAt: true,
  dueDate: true,
  reader: { select: { id: true, name: true, email: true } },
  // Sách không thể bị xóa khi còn đơn đang mượn (2.2.5) nên luôn còn.
  book: { select: { id: true, title: true, author: true } },
};

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

  // 2.4.2 bước 2: yêu cầu trả Chờ xác nhận, cũ nhất trước như danh sách duyệt mượn (2.3.2).
  // Kèm số ngày muộn tính tới hôm nay để nhân viên biết trước phải chọn mức phạt Trả muộn.
  async function listPendingReturns({ page = 1 }) {
    const today = businessToday(now());
    const where = { status: 'pending' };
    const pagination = paginate(await prisma.returnRequest.count({ where }), page);
    const rows = pagination.total === 0 ? [] : await prisma.returnRequest.findMany({
      where,
      select: { id: true, createdAt: true, borrowOrder: { select: orderSummary } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      skip: (pagination.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    });
    return {
      returnRequests: rows.map(({ id, createdAt, borrowOrder }) => ({
        id, createdAt, borrowOrderId: borrowOrder.id, ...toOrderSummary(borrowOrder, today),
      })),
      pagination,
      today,
    };
  }

  // Trả tại quầy: đơn đang mượn chưa có yêu cầu trả chờ (đơn có yêu cầu thì xác nhận ở tab kia).
  // Quá hạn lâu nhất trước.
  async function listCounterOrders({ q = '', page = 1 }) {
    const today = businessToday(now());
    const where = { status: 'borrowing', returnRequests: { none: { status: 'pending' } } };
    if (q) {
      const contains = { contains: q, mode: 'insensitive' };
      where.OR = [{ reader: { name: contains } }, { reader: { email: contains } }, { book: { title: contains } }];
    }
    const pagination = paginate(await prisma.borrowOrder.count({ where }), page);
    const rows = pagination.total === 0 ? [] : await prisma.borrowOrder.findMany({
      where,
      select: orderSummary,
      orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
      skip: (pagination.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    });
    return { orders: rows.map((row) => ({ id: row.id, ...toOrderSummary(row, today) })), pagination, today };
  }

  // 2.4.2: đổi trạng thái yêu cầu và đơn, cập nhật kho, lập phiếu phạt trong cùng transaction (edge 8).
  // Gọi khi đã khóa dòng đơn FOR UPDATE. Thứ tự khóa borrow_orders → users → books như 2.3.2.
  async function completeReturn(tx, { staffId, order, returnRequestId, input, at }) {
    const { condition } = input;
    const lateDays = lateDaysOf(toDateString(order.dueDate), businessToday(at));
    const types = requiredFineTypes(condition, lateDays);
    const tierIds = types.map((type) => (type === 'late' ? input.lateFineTierId : input.fineTierId)).filter(Boolean);
    const tiers = new Map(tierIds.length === 0 ? [] : (await tx.fineTier.findMany({
      where: { id: { in: tierIds } },
      select: { id: true, name: true, type: true, amount: true, isActive: true },
    })).map((tier) => [tier.id, tier]));
    // Edge 2, 4: thiếu mức phạt (kể cả khi Admin chưa cấu hình mức nào) hoặc mức đã bị ẩn.
    const errors = checkFineTiers({ ...input, lateDays }, tiers);
    if (errors) throw new HttpError(400, INVALID_DATA, errors);

    // Edge 9: khóa độc giả để 2.3.2 (users FOR SHARE) không xác nhận mượn giữa lúc lập phiếu phạt.
    if (types.length) await tx.$queryRaw`SELECT id FROM users WHERE id = ${order.readerId} FOR UPDATE`;
    // Không tăng `version`: chỉ nhân viên sửa sách mới đổi version (2.2.5).
    await tx.$queryRaw`SELECT id FROM books WHERE id = ${order.bookId} FOR UPDATE`;
    const change = STOCK_CHANGES[condition];
    await tx.book.update({
      where: { id: order.bookId },
      data: Object.fromEntries(Object.entries(change).filter(([, n]) => n !== 0).map(([field, n]) => [field, { increment: n }])),
    });
    await tx.borrowOrder.update({ where: { id: order.id }, data: { status: 'returned', returnedAt: at } });
    const note = input.note || null;
    await tx.returnRequest.update({
      where: { id: returnRequestId },
      data: { status: 'confirmed', processedById: staffId, processedAt: at, condition, conditionNote: note, lateDays },
    });

    // Edge 5: phiếu lưu bản sao tên và số tiền mức phạt tại thời điểm lập.
    const fines = [];
    for (const type of types) {
      const tier = tiers.get(type === 'late' ? input.lateFineTierId : input.fineTierId);
      const ticket = await tx.fineTicket.create({
        data: {
          readerId: order.readerId, borrowOrderId: order.id, returnRequestId, fineTierId: tier.id,
          type, tierName: tier.name, amount: tier.amount,
          note: type === 'late' ? `Trả muộn ${lateDays} ngày` : note, issuedById: staffId,
        },
      });
      fines.push({ id: ticket.id, type, tierName: tier.name, amount: tier.amount });
    }
    return { returnRequestId, borrowOrderId: order.id, condition, lateDays, fines };
  }

  const lockOrder = (tx, id) => tx.$queryRaw`
    SELECT id, reader_id AS "readerId", book_id AS "bookId", status, due_date AS "dueDate"
    FROM borrow_orders WHERE id = ${id} FOR UPDATE`;

  // 2.4.2 Xác nhận trả.
  async function confirmReturnRequest(staffId, id, input) {
    const at = now();
    const result = await prisma.$transaction(async (tx) => {
      const [request] = await tx.$queryRaw`SELECT borrow_order_id AS "borrowOrderId" FROM return_requests WHERE id = ${id}`;
      if (!request) throw new HttpError(404, RETURN_NOT_FOUND);
      // Khóa đơn trước như 2.4.1 và 2.3.3, rồi tới yêu cầu: nhân viên thứ hai chờ rồi thấy yêu cầu
      // không còn `pending` (edge 1); độc giả hủy yêu cầu (2.4.1) cũng phải chờ.
      const [order] = await lockOrder(tx, request.borrowOrderId);
      const [locked] = await tx.$queryRaw`SELECT status FROM return_requests WHERE id = ${id} FOR UPDATE`;
      if (locked.status !== 'pending' || order.status !== 'borrowing') throw alreadyProcessed();
      return completeReturn(tx, { staffId, order, returnRequestId: id, input, at });
    });
    return { message: returnedMessage(result.fines), result };
  }

  // [Giả định] đề xuất 2.4.1 đã duyệt: nhân viên từ chối kèm lý do (vd độc giả chưa mang sách tới)
  // để độc giả gửi lại. Cập nhật có điều kiện (edge 1); đơn và kho không đổi.
  async function rejectReturnRequest(staffId, id, { reason }) {
    const { count } = await prisma.returnRequest.updateMany({
      where: { id, status: 'pending' },
      data: { status: 'rejected', rejectReason: reason, processedById: staffId, processedAt: now() },
    });
    if (count === 1) return { message: RETURN_REJECTED };
    const request = await prisma.returnRequest.findUnique({ where: { id }, select: { id: true } });
    if (!request) throw new HttpError(404, RETURN_NOT_FOUND);
    throw alreadyProcessed();
  }

  // Trả tại quầy (README điểm 10, ERD): nhân viên tạo yêu cầu trả đứng tên mình và xác nhận ngay
  // trong cùng transaction.
  async function counterReturn(staffId, { borrowOrderId, ...input }) {
    const at = now();
    try {
      const result = await prisma.$transaction(async (tx) => {
        const [order] = await lockOrder(tx, borrowOrderId);
        if (!order) throw new HttpError(404, ORDER_NOT_FOUND);
        if (order.status !== 'borrowing') throw counterBlocked('not_borrowing');
        const pending = await tx.returnRequest.count({ where: { borrowOrderId, status: 'pending' } });
        if (pending > 0) throw counterBlocked('pending_return');
        const request = await tx.returnRequest.create({ data: { borrowOrderId, requestedById: staffId } });
        return completeReturn(tx, { staffId, order, returnRequestId: request.id, input, at });
      });
      return { message: returnedMessage(result.fines), result };
    } catch (err) {
      // UNIQUE một yêu cầu `confirmed`/`pending` mỗi đơn là chốt chặn cuối.
      if (err?.code === 'P2002') throw alreadyProcessed(ALREADY_PROCESSED);
      throw err;
    }
  }

  return {
    createReturnRequest, cancelReturnRequest, listPendingReturns, listCounterOrders,
    confirmReturnRequest, rejectReturnRequest, counterReturn,
  };
}

function toOrderSummary(order, today) {
  const dueDate = toDateString(order.dueDate);
  return {
    reader: order.reader, book: order.book, borrowedAt: order.borrowedAt, dueDate, lateDays: lateDaysOf(dueDate, today),
  };
}

module.exports = {
  createReturnService, RETURN_NOT_FOUND, NOT_CANCELLABLE, CREATED, CANCELLED,
  RETURN_ALREADY_PROCESSED, RETURNED, RETURN_REJECTED, COUNTER_BLOCKED,
};
