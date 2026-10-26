const crypto = require('node:crypto');
const { HttpError } = require('../../lib/httpError');
const { detectImageType } = require('../../lib/imageType');
const { MAX_IMAGE_BYTES, INVALID_IMAGE } = require('../../middlewares/upload');
const {
  PAYABLE_STATUSES, PAY_BLOCKED, canPay, evaluatePayment, REVIEW_BLOCKED, canReview, evaluateReview, transferContent,
} = require('./fineTicket.rules');

const PAGE_SIZE = 10;
const RECEIPT_BUCKET = 'receipts';
// README "Upload file": bucket receipts private, chỉ đọc qua signed URL ngắn hạn.
const RECEIPT_URL_TTL = 300;
const TICKET_NOT_FOUND = 'Không tìm thấy phiếu phạt';
const NO_RECEIPT = 'Phiếu phạt không có ảnh biên lai';
const SUBMITTED = 'Đã gửi, chờ nhân viên thư viện xác nhận';
const CONFIRMED = 'Đã xác nhận thanh toán';
const REJECTED = 'Đã từ chối thanh toán';

const FILTER_STATUSES = {
  due: PAYABLE_STATUSES,
  pending: ['pending'],
  paid: ['paid'],
  all: null,
};

function payBlocked(reason) {
  return Object.assign(new HttpError(409, PAY_BLOCKED[reason]), { reason });
}

function reviewBlocked(reason) {
  return Object.assign(new HttpError(409, REVIEW_BLOCKED[reason]), { reason });
}

const BOOK_TITLE = { borrowOrder: { select: { book: { select: { title: true } } } } };
const STAFF_INCLUDE = {
  reader: { select: { id: true, name: true, email: true } },
  borrowOrder: { select: { id: true, book: { select: { id: true, title: true } } } },
  confirmedBy: { select: { name: true } },
};
// Hàng đợi Chờ xác nhận: gửi sớm nhất trước như 2.3.2, 2.4.2 (index (status, submitted_at)); tab khác mới nhất trước.
const PENDING_ORDER = [{ submittedAt: 'asc' }, { id: 'asc' }];
const NEWEST_ORDER = [{ issuedAt: 'desc' }, { id: 'desc' }];

// 2.5.3 bước 2: chi tiết để đối chiếu sao kê gồm độc giả, đơn mượn, sách, nguyên nhân, số tiền, ngày phạt, ghi chú.
function toStaffTicket(row) {
  const ticket = toTicket(row);
  delete ticket.canPay;
  delete ticket.bookTitle;
  return {
    ...ticket,
    reader: row.reader,
    borrowOrderId: row.borrowOrder.id,
    book: row.borrowOrder.book,
    confirmedByName: row.confirmedBy?.name ?? null,
    canReview: canReview(row.status),
  };
}

// Mã phiếu (`12` hoặc `#12`, nội dung chuyển khoản `THU VIEN PHAT 12`) cũng tìm được.
function ticketIdFromQuery(q) {
  const match = /^(?:#|THU VIEN PHAT\s+)?(\d{1,9})$/i.exec(q);
  return match ? Number(match[1]) : null;
}

function toTicket(row) {
  return {
    id: row.id,
    type: row.type,
    tierName: row.tierName,
    bookTitle: row.borrowOrder?.book?.title ?? null,
    note: row.note,
    amount: row.amount,
    status: row.status,
    issuedAt: row.issuedAt,
    submittedAt: row.submittedAt,
    // Lý do của lần từ chối gần nhất được giữ tới khi có kết quả mới (ERD fine_tickets).
    rejectReason: row.rejectReason,
    rejectedAt: row.rejectedAt,
    confirmedAt: row.confirmedAt,
    hasReceipt: !!row.receiptPath,
    canPay: canPay(row.status),
    transferContent: transferContent(row.id),
  };
}

// [Giả định] Thông tin tài khoản nhận chuyển khoản lấy từ biến môi trường; thiếu số tài khoản thì
// client báo liên hệ thư viện (flow 2.5.2: không có cổng thanh toán tự động).
function bankFromEnv(env = process.env) {
  if (!env.BANK_ACCOUNT_NUMBER) return null;
  return {
    bankName: env.BANK_NAME || null,
    accountNumber: env.BANK_ACCOUNT_NUMBER,
    accountHolder: env.BANK_ACCOUNT_HOLDER || null,
  };
}

function createFineTicketService({
  prisma,
  storage,
  bank = bankFromEnv(),
  newId = () => crypto.randomUUID(),
  now = () => new Date(),
  logger = console,
}) {
  async function listMyTickets(readerId, { status = 'due', page = 1 }) {
    const statuses = FILTER_STATUSES[status];
    const where = statuses ? { readerId, status: { in: statuses } } : { readerId };
    const [total, due, pendingCount] = await Promise.all([
      prisma.fineTicket.count({ where }),
      prisma.fineTicket.aggregate({
        where: { readerId, status: { in: PAYABLE_STATUSES } }, _count: { _all: true }, _sum: { amount: true },
      }),
      prisma.fineTicket.count({ where: { readerId, status: 'pending' } }),
    ]);
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const current = Math.min(page, totalPages);
    const rows = total === 0 ? [] : await prisma.fineTicket.findMany({
      where,
      // Sách đã xóa mềm vẫn hiện tên.
      include: BOOK_TITLE,
      orderBy: [{ issuedAt: 'desc' }, { id: 'desc' }],
      skip: (current - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    });
    return {
      tickets: rows.map(toTicket),
      pagination: { page: current, pageSize: PAGE_SIZE, total, totalPages },
      summary: { dueCount: due._count._all, dueAmount: due._sum.amount ?? 0, pendingCount },
      bank,
    };
  }

  async function removeQuietly(path) {
    try {
      await storage.remove(RECEIPT_BUCKET, path);
    } catch (err) {
      logger.error(`Không xóa được file ${RECEIPT_BUCKET}/${path}`, err);
    }
  }

  async function uploadReceipt(file) {
    if (file.buffer.length > MAX_IMAGE_BYTES) throw new HttpError(413, INVALID_IMAGE, { receipt: INVALID_IMAGE });
    const type = detectImageType(file.buffer);
    if (!type) throw new HttpError(400, INVALID_IMAGE, { receipt: INVALID_IMAGE });
    const path = `${newId()}.${type.ext}`;
    try {
      await storage.upload(RECEIPT_BUCKET, path, file.buffer, type.mime);
    } catch (err) {
      logger.error('Upload ảnh biên lai thất bại', err);
      throw new HttpError(502, 'Không tải được ảnh biên lai, vui lòng thử lại');
    }
    return path;
  }

  // Độc giả bấm "Đã thanh toán", ảnh biên lai tùy chọn (README điểm 7). Thứ tự như upload khác:
  // upload ảnh → ghi DB → xóa ảnh cũ. Khóa dòng phiếu FOR UPDATE nên hai lần bấm (edge 1) chạy lần lượt;
  // 2.5.3 xác nhận/từ chối phải khóa cùng dòng này.
  async function payTicket(readerId, id, file) {
    const newPath = file?.buffer?.length ? await uploadReceipt(file) : null;
    let result;
    try {
      result = await prisma.$transaction(async (tx) => {
        const [ticket] = await tx.$queryRaw`
          SELECT status, receipt_path AS "receiptPath"
          FROM fine_tickets WHERE id = ${id} AND reader_id = ${readerId} FOR UPDATE`;
        // Phiếu của người khác cũng là 404 (edge 6).
        if (!ticket) throw new HttpError(404, TICKET_NOT_FOUND);
        const reason = evaluatePayment(ticket.status);
        if (reason) throw payBlocked(reason);
        const row = await tx.fineTicket.update({
          where: { id },
          // Gửi lại sau khi bị từ chối ghi đè submitted_at và receipt_path (ERD).
          data: { status: 'pending', submittedAt: now(), receiptPath: newPath },
          include: BOOK_TITLE,
        });
        return { row, oldPath: ticket.receiptPath };
      });
    } catch (err) {
      if (newPath) await removeQuietly(newPath);
      throw err;
    }
    if (result.oldPath) await removeQuietly(result.oldPath);
    return { message: SUBMITTED, ticket: toTicket(result.row) };
  }

  // 2.5.3 bước 1: danh sách cho nhân viên, mọi độc giả.
  async function listTickets({ status = 'pending', q = '', page = 1 }) {
    const where = status === 'all' ? {} : { status };
    if (q) {
      const contains = { contains: q, mode: 'insensitive' };
      const id = ticketIdFromQuery(q);
      where.OR = [
        { reader: { name: contains } }, { reader: { email: contains } }, { borrowOrder: { book: { title: contains } } },
        ...(id ? [{ id }] : []),
      ];
    }
    const [total, pending] = await Promise.all([
      prisma.fineTicket.count({ where }),
      prisma.fineTicket.aggregate({ where: { status: 'pending' }, _count: { _all: true }, _sum: { amount: true } }),
    ]);
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const current = Math.min(page, totalPages);
    const rows = total === 0 ? [] : await prisma.fineTicket.findMany({
      where,
      include: STAFF_INCLUDE,
      orderBy: status === 'pending' ? PENDING_ORDER : NEWEST_ORDER,
      skip: (current - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    });
    return {
      tickets: rows.map(toStaffTicket),
      pagination: { page: current, pageSize: PAGE_SIZE, total, totalPages },
      summary: { pendingCount: pending._count._all, pendingAmount: pending._sum.amount ?? 0 },
    };
  }

  // Khóa dòng phiếu FOR UPDATE như payTicket (2.5.2), nên hai nhân viên (edge 1) hoặc nhân viên và độc giả
  // gửi lại không ghi đè nhau. Trả thêm số phiếu chưa thanh toán xong của độc giả (edge 5: 0 thì hết bị chặn mượn).
  async function reviewTicket(id, data) {
    return prisma.$transaction(async (tx) => {
      const [ticket] = await tx.$queryRaw`
        SELECT status, reader_id AS "readerId" FROM fine_tickets WHERE id = ${id} FOR UPDATE`;
      if (!ticket) throw new HttpError(404, TICKET_NOT_FOUND);
      const reason = evaluateReview(ticket.status);
      if (reason) throw reviewBlocked(reason);
      const row = await tx.fineTicket.update({ where: { id }, data, include: STAFF_INCLUDE });
      const readerOutstanding = await tx.fineTicket.count({
        where: { readerId: ticket.readerId, status: { not: 'paid' } },
      });
      return { ticket: toStaffTicket(row), readerOutstanding };
    });
  }

  // Đã thanh toán là kết quả mới nên bỏ lý do từ chối của lần trước (ERD fine_tickets).
  async function confirmTicket(staffId, id) {
    const result = await reviewTicket(id, {
      status: 'paid', confirmedById: staffId, confirmedAt: now(), rejectReason: null, rejectedAt: null,
    });
    return { message: CONFIRMED, ...result };
  }

  // Edge 3: chuyển thiếu hoặc thừa thì từ chối kèm lý do; độc giả thấy lý do và gửi lại (2.5.2 edge 2).
  // [Giả định] ERD không có cột người từ chối nên chỉ lưu lý do và thời điểm.
  async function rejectTicket(staffId, id, { reason }) {
    const result = await reviewTicket(id, { status: 'rejected', rejectReason: reason, rejectedAt: now() });
    return { message: REJECTED, ...result };
  }

  async function getMyReceiptUrl(readerId, id) {
    return receiptUrl({ id, readerId });
  }

  // README "Upload file": nhân viên cũng xem được biên lai qua signed URL để đối chiếu.
  async function getReceiptUrl(id) {
    return receiptUrl({ id });
  }

  async function receiptUrl(where) {
    const ticket = await prisma.fineTicket.findFirst({ where, select: { receiptPath: true } });
    if (!ticket) throw new HttpError(404, TICKET_NOT_FOUND);
    if (!ticket.receiptPath) throw new HttpError(404, NO_RECEIPT);
    try {
      return { url: await storage.signedUrl(RECEIPT_BUCKET, ticket.receiptPath, RECEIPT_URL_TTL) };
    } catch (err) {
      logger.error('Không tạo được link ảnh biên lai', err);
      throw new HttpError(502, 'Không tải được ảnh biên lai, vui lòng thử lại');
    }
  }

  return { listMyTickets, payTicket, getMyReceiptUrl, listTickets, confirmTicket, rejectTicket, getReceiptUrl };
}

module.exports = {
  createFineTicketService, bankFromEnv, ticketIdFromQuery, PAGE_SIZE, RECEIPT_BUCKET, RECEIPT_URL_TTL,
  TICKET_NOT_FOUND, NO_RECEIPT, SUBMITTED, CONFIRMED, REJECTED,
};
