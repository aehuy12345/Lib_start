import { api } from '../../api/client'

// 2.3.1: gửi yêu cầu mượn; server kiểm tra lại mọi điều kiện (409 kèm `reason` khi không đủ).
export async function createBorrowOrder(bookId, requestedDays) {
  const { data } = await api.post('/borrow-orders', { bookId, requestedDays })
  return data
}

// 2.3.1 (đề xuất đã duyệt): độc giả hủy đơn còn Chờ xác nhận.
export async function cancelBorrowOrder(id) {
  const { data } = await api.post(`/borrow-orders/${encodeURIComponent(id)}/cancel`)
  return data
}

// 2.3.2 (nhân viên, Admin): danh sách đơn Chờ xác nhận, cũ nhất trước.
export async function listPendingOrders(page = 1) {
  const { data } = await api.get('/borrow-orders/pending', { params: { page } })
  return data
}

// 409 kèm `reason`: already_processed, out_of_stock, reader_inactive, limit_reached, unpaid_fine, overdue.
export async function confirmBorrowOrder(id) {
  const { data } = await api.post(`/borrow-orders/${encodeURIComponent(id)}/confirm`)
  return data
}

export async function rejectBorrowOrder(id, reason) {
  const { data } = await api.post(`/borrow-orders/${encodeURIComponent(id)}/reject`, { reason })
  return data
}
