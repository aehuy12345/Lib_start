// 2.5.2: bộ lọc và cách hiển thị phiếu phạt, khớp server/src/modules/fine/fineTicket.*.js.
export const TICKET_FILTERS = [
  { value: 'due', label: 'Cần thanh toán' },
  { value: 'pending', label: 'Chờ xác nhận' },
  { value: 'paid', label: 'Đã thanh toán' },
  { value: 'all', label: 'Tất cả' },
]
const FILTER_VALUES = TICKET_FILTERS.map((f) => f.value)

export const TICKET_STATUS_LABELS = {
  unpaid: 'Chưa thanh toán',
  pending: 'Chờ xác nhận',
  paid: 'Đã thanh toán',
  rejected: 'Từ chối',
}

export const RECEIPT_TYPES = ['image/jpeg', 'image/png', 'image/webp']
export const RECEIPT_MAX_BYTES = 2 * 1024 * 1024
export const RECEIPT_ERROR = 'Chỉ nhận ảnh JPG, PNG, WebP tối đa 2 MB'

// Giá trị lạ trên URL được thay bằng mặc định, giống server.
export function readTicketParams(searchParams) {
  const status = FILTER_VALUES.includes(searchParams.get('status')) ? searchParams.get('status') : 'due'
  const page = Number(searchParams.get('page'))
  return { status, page: Number.isInteger(page) && page > 0 ? page : 1 }
}

export function nextTicketParams({ status, page }) {
  const out = {}
  if (status && status !== 'due') out.status = status
  if (page > 1) out.page = String(page)
  return out
}

// Ảnh biên lai tùy chọn; kiểm tra nhanh ở client, server kiểm tra lại theo nội dung file.
export function validateReceiptFile(file) {
  if (!file) return null
  if (!RECEIPT_TYPES.includes(file.type) || file.size > RECEIPT_MAX_BYTES) return RECEIPT_ERROR
  return null
}

const EMPTY_MESSAGES = {
  due: 'Bạn không có khoản phạt nào cần thanh toán.',
  pending: 'Không có phiếu phạt nào đang chờ xác nhận.',
  paid: 'Chưa có phiếu phạt nào đã thanh toán.',
  all: 'Bạn không có khoản phạt nào.',
}

export function emptyMessage(status) {
  return EMPTY_MESSAGES[status] ?? EMPTY_MESSAGES.all
}
