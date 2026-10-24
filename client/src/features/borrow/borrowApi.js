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
