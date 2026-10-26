// 2.5.3: bộ lọc của nhân viên, khớp staffTicketsQuerySchema ở server/src/modules/fine/fineTicket.validation.js.
export const STAFF_TICKET_FILTERS = [
  { value: 'pending', label: 'Chờ xác nhận' },
  { value: 'unpaid', label: 'Chưa thanh toán' },
  { value: 'rejected', label: 'Từ chối' },
  { value: 'paid', label: 'Đã thanh toán' },
  { value: 'all', label: 'Tất cả' },
]
const FILTER_VALUES = STAFF_TICKET_FILTERS.map((f) => f.value)
export const SEARCH_MAX = 100

// Giá trị lạ trên URL được thay bằng mặc định, giống server.
export function readStaffTicketParams(searchParams) {
  const status = FILTER_VALUES.includes(searchParams.get('status')) ? searchParams.get('status') : 'pending'
  const q = (searchParams.get('q') ?? '').trim().slice(0, SEARCH_MAX)
  const page = Number(searchParams.get('page'))
  return { status, q, page: Number.isInteger(page) && page > 0 ? page : 1 }
}

export function nextStaffTicketParams({ status, q, page }) {
  const out = {}
  if (status && status !== 'pending') out.status = status
  if (q) out.q = q
  if (page > 1) out.page = String(page)
  return out
}

const EMPTY_MESSAGES = {
  pending: 'Không có phiếu phạt nào chờ xác nhận.',
  unpaid: 'Không có phiếu phạt nào chưa thanh toán.',
  rejected: 'Không có phiếu phạt nào bị từ chối.',
  paid: 'Chưa có phiếu phạt nào đã thanh toán.',
  all: 'Chưa có phiếu phạt nào.',
}

export function staffEmptyMessage(status, q) {
  if (q) return 'Không có phiếu phạt nào phù hợp.'
  return EMPTY_MESSAGES[status] ?? EMPTY_MESSAGES.all
}

// Edge 5: độc giả không còn phiếu nào chưa Đã thanh toán thì hết bị chặn mượn (2.3.1).
export function reviewNotice(ticket, { message, readerOutstanding }) {
  const text = `Phiếu #${ticket.id} của ${ticket.reader.name}: ${message}.`
  if (readerOutstanding === 0) return `${text} Độc giả không còn khoản phạt nào và có thể mượn sách lại.`
  return `${text} Độc giả còn ${readerOutstanding} phiếu phạt chưa thanh toán xong.`
}
