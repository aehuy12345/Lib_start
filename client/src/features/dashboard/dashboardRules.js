const numberFormat = new Intl.NumberFormat('vi-VN')

export function formatCount(value) {
  return numberFormat.format(value ?? 0)
}

// Edge 3: dashboard chỉ hiện 10 độc giả đầu; báo số còn lại (danh sách đầy đủ ở báo cáo 2.7.2).
export function overdueRemainder({ total, readers }) {
  const rest = total - readers.length
  return rest > 0 ? `Còn ${formatCount(rest)} độc giả quá hạn khác.` : null
}

// Dòng phụ của thẻ đơn mượn hôm nay; bỏ trạng thái bằng 0.
const TODAY_LABELS = [
  ['pending', 'chờ xác nhận'],
  ['borrowing', 'đang mượn'],
  ['returned', 'đã trả'],
  ['rejected', 'bị từ chối'],
  ['cancelled', 'đã hủy'],
]

export function todayBreakdown(byStatus = {}) {
  return TODAY_LABELS.filter(([key]) => byStatus[key] > 0)
    .map(([key, label]) => `${formatCount(byStatus[key])} ${label}`)
    .join(' · ')
}
