const crypto = require('node:crypto');
const { HttpError } = require('../../lib/httpError');
const { detectImageType } = require('../../lib/imageType');
const { MAX_IMAGE_BYTES, INVALID_IMAGE } = require('../../middlewares/upload');
const { PAYABLE_STATUSES, PAY_BLOCKED, canPay, evaluatePayment, transferContent } = require('./fineTicket.rules');

const PAGE_SIZE = 10;
const RECEIPT_BUCKET = 'receipts';
// README "Upload file": bucket receipts private, chỉ đọc qua signed URL ngắn hạn.
const RECEIPT_URL_TTL = 300;
const TICKET_NOT_FOUND = 'Không tìm thấy phiếu phạt';
const NO_RECEIPT = 'Phiếu phạt không có ảnh biên lai';
const SUBMITTED = 'Đã gửi, chờ nhân viên thư viện xác nhận';

const FILTER_STATUSES = {
  due: PAYABLE_STATUSES,
  pending: ['pending'],
  paid: ['paid'],
  all: null,
};

function payBlocked(reason) {
  return Object.assign(new HttpError(409, PAY_BLOCKED[reason]), { reason });
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
      include: { borrowOrder: { select: { book: { select: { title: true } } } } },
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
          include: { borrowOrder: { select: { book: { select: { title: true } } } } },
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

  async function getMyReceiptUrl(readerId, id) {
    const ticket = await prisma.fineTicket.findFirst({ where: { id, readerId }, select: { receiptPath: true } });
    if (!ticket) throw new HttpError(404, TICKET_NOT_FOUND);
    if (!ticket.receiptPath) throw new HttpError(404, NO_RECEIPT);
    try {
      return { url: await storage.signedUrl(RECEIPT_BUCKET, ticket.receiptPath, RECEIPT_URL_TTL) };
    } catch (err) {
      logger.error('Không tạo được link ảnh biên lai', err);
      throw new HttpError(502, 'Không tải được ảnh biên lai, vui lòng thử lại');
    }
  }

  return { listMyTickets, payTicket, getMyReceiptUrl };
}

module.exports = {
  createFineTicketService, bankFromEnv, PAGE_SIZE, RECEIPT_BUCKET, RECEIPT_URL_TTL,
  TICKET_NOT_FOUND, NO_RECEIPT, SUBMITTED,
};
