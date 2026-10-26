import dayjs from 'dayjs'

// 2.7.2: khớp server/src/modules/report/report.validation.js.
export const REPORT_TYPES = [
  { value: 'books', label: 'Sách' },
  { value: 'borrows', label: 'Mượn trả' },
  { value: 'fines', label: 'Phạt' },
  { value: 'damaged-lost', label: 'Sách mất / hư' },
]
export const PERIODS = [
  { value: 'day', label: 'Ngày' },
  { value: 'week', label: 'Tuần' },
  { value: 'month', label: 'Tháng' },
  { value: 'quarter', label: 'Quý' },
  { value: 'year', label: 'Năm' },
  { value: 'custom', label: 'Tùy chọn' },
]
export const GROUP_BY = [
  { value: 'day', label: 'Theo ngày' },
  { value: 'month', label: 'Theo tháng' },
  { value: 'quarter', label: 'Theo quý' },
]
export const MAX_RANGE_DAYS = 366
export const FINE_TYPE_LABELS = { late: 'Trả muộn', damaged: 'Hư hỏng', lost: 'Mất sách' }
export const CONDITION_LABELS = { lost: 'Mất', damaged: 'Hư hỏng' }

const TYPE_VALUES = REPORT_TYPES.map((t) => t.value)
const PERIOD_VALUES = PERIODS.map((p) => p.value)
const GROUP_VALUES = GROUP_BY.map((g) => g.value)
const ISO = 'YYYY-MM-DD'

// Ngày hôm nay theo giờ Việt Nam, giống server (không theo múi giờ trình duyệt).
export function businessToday(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(now)
}

export function isIsoDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && dayjs(value).format(ISO) === value
}

// Khoảng [from, to] của Ngày / Tuần / Tháng / Quý / Năm chứa ngày `anchor`. Edge 9 [Giả định]: tuần bắt đầu thứ Hai.
export function periodRange(period, anchor) {
  const d = dayjs(anchor)
  const range = (start, end) => ({ from: start.format(ISO), to: end.format(ISO) })
  if (period === 'day') return range(d, d)
  if (period === 'week') {
    const monday = d.subtract((d.day() + 6) % 7, 'day')
    return range(monday, monday.add(6, 'day'))
  }
  if (period === 'quarter') {
    const start = d.month(Math.floor(d.month() / 3) * 3).startOf('month')
    return range(start, start.add(2, 'month').endOf('month'))
  }
  if (period === 'year') return range(d.startOf('year'), d.endOf('year'))
  return range(d.startOf('month'), d.endOf('month'))
}

// Edge 1, 2: lỗi khoảng thời gian, '' nếu hợp lệ. Server kiểm tra lại.
export function rangeError(from, to) {
  if (!isIsoDate(from) || !isIsoDate(to)) return 'Vui lòng chọn đủ từ ngày và đến ngày'
  const days = dayjs(to).diff(dayjs(from), 'day') + 1
  if (days < 1) return 'Khoảng thời gian không hợp lệ: từ ngày phải nhỏ hơn hoặc bằng đến ngày'
  if (days > MAX_RANGE_DAYS) return `Khoảng thời gian tối đa ${MAX_RANGE_DAYS} ngày`
  return ''
}

// Bộ lọc nằm trên URL. Với Ngày..Năm, from là mốc và khoảng được tính lại; Tùy chọn giữ nguyên from/to
// (kể cả sai, để trang báo lỗi edge 1). Giá trị lạ quay về mặc định: báo cáo Sách, tháng hiện tại.
export function readReportParams(searchParams, today = businessToday()) {
  const type = TYPE_VALUES.includes(searchParams.get('type')) ? searchParams.get('type') : 'books'
  const period = PERIOD_VALUES.includes(searchParams.get('period')) ? searchParams.get('period') : 'month'
  const rawFrom = searchParams.get('from') ?? ''
  const rawTo = searchParams.get('to') ?? ''
  let range
  if (period === 'custom') range = rawFrom || rawTo ? { from: rawFrom, to: rawTo } : periodRange('month', today)
  else range = periodRange(period, isIsoDate(rawFrom) ? rawFrom : today)
  const groupBy = GROUP_VALUES.includes(searchParams.get('groupBy')) ? searchParams.get('groupBy') : ''
  const page = Number(searchParams.get('page'))
  return { type, period, ...range, groupBy, page: Number.isInteger(page) && page > 0 ? page : 1 }
}

export function nextReportParams({ type, period, from, to, groupBy, page }) {
  const out = { type, period, from, to }
  if (type === 'borrows' && groupBy) out.groupBy = groupBy
  if (page > 1) out.page = String(page)
  return out
}

// Tham số gửi server; CSV dùng đúng bộ này (edge 6).
export function reportQuery({ type, from, to, groupBy, page }) {
  const query = { from, to }
  if (type === 'borrows' && groupBy) query.groupBy = groupBy
  if (page > 1) query.page = page
  return query
}

export function csvFileName(type, from, to) {
  const slugs = { books: 'sach', borrows: 'muon-tra', fines: 'phat', 'damaged-lost': 'sach-mat-hu' }
  return `bao-cao-${slugs[type]}_${from}_${to}.csv`
}

// Nhãn mốc thời gian của báo cáo Mượn trả; khớp periodLabel ở server/src/modules/report/report.export.js.
export function periodLabel(period, groupBy) {
  const [year, month, day] = period.split('-')
  if (groupBy === 'month') return `${month}/${year}`
  if (groupBy === 'quarter') return `Quý ${Math.floor((Number(month) - 1) / 3) + 1}/${year}`
  return `${day}/${month}/${year}`
}

const numberFormat = new Intl.NumberFormat('vi-VN')
export const formatNumber = (value) => numberFormat.format(value ?? 0)
export const formatMoney = (value) => `${numberFormat.format(value ?? 0)} đ`
