import { api } from '../../api/client'

// 2.4.1 (độc giả): gửi yêu cầu trả cho đơn đang mượn. 409 kèm `reason`: not_borrowing, pending_return.
export async function createReturnRequest(borrowOrderId) {
  const { data } = await api.post('/return-requests', { borrowOrderId })
  return data
}

// 2.4.1 (đề xuất edge 5 đã duyệt): hủy yêu cầu trả còn Chờ xác nhận.
export async function cancelReturnRequest(id) {
  const { data } = await api.post(`/return-requests/${encodeURIComponent(id)}/cancel`)
  return data
}
