// 2.3.3: bộ lọc và cách hiển thị lịch sử mượn, khớp historyQuerySchema của server.
export const HISTORY_FILTERS = [
  { value: 'all', label: 'Tất cả' },
  { value: 'pending', label: 'Chờ xác nhận' },
  { value: 'borrowing', label: 'Đang mượn' },
  { value: 'overdue', label: 'Quá hạn' },
  { value: 'returned', label: 'Đã trả' },
  { value: 'rejected', label: 'Bị từ chối' },
]
const FILTER_VALUES = HISTORY_FILTERS.map((f) => f.value)

export const STATUS_LABELS = Object.fromEntries(HISTORY_FILTERS.slice(1).map((f) => [f.value, f.label]))

// Giá trị lạ trên URL được thay bằng mặc định, giống server.
export function readHistoryParams(searchParams) {
  const status = FILTER_VALUES.includes(searchParams.get('status')) ? searchParams.get('status') : 'all'
  const page = Number(searchParams.get('page'))
  return { status, page: Number.isInteger(page) && page > 0 ? page : 1 }
}

export function nextHistoryParams({ status, page }) {
  const out = {}
  if (status && status !== 'all') out.status = status
  if (page > 1) out.page = String(page)
  return out
}

// Số ngày còn lại = hạn trả − hôm nay; "Quá n ngày" khi quá hạn (flow 2.3.3).
export function daysLeftLabel(daysLeft) {
  if (daysLeft == null) return '—'
  if (daysLeft > 0) return `${daysLeft} ngày`
  if (daysLeft === 0) return 'Hết hạn hôm nay'
  return `Quá ${-daysLeft} ngày`
}

// Hiển thị theo nhóm (flow 2.3.3); Quá hạn nằm chung nhóm Đang mượn. Nhóm rỗng bị bỏ.
export const HISTORY_GROUPS = [
  { key: 'pending', title: 'Chờ xác nhận', statuses: ['pending'] },
  { key: 'borrowing', title: 'Đang mượn', statuses: ['borrowing', 'overdue'] },
  { key: 'returned', title: 'Đã trả', statuses: ['returned'] },
  { key: 'rejected', title: 'Bị từ chối', statuses: ['rejected'] },
]

export function groupOrders(orders) {
  return HISTORY_GROUPS
    .map((group) => ({ ...group, orders: orders.filter((o) => group.statuses.includes(o.status)) }))
    .filter((group) => group.orders.length > 0)
}
