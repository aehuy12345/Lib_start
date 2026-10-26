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

// 2.4.2 (nhân viên, Admin): yêu cầu trả Chờ xác nhận, cũ nhất trước, kèm số ngày muộn.
export async function listPendingReturns(page = 1) {
  const { data } = await api.get('/return-requests/pending', { params: { page } })
  return data
}

// Trả tại quầy: đơn đang mượn chưa có yêu cầu trả chờ, tìm theo độc giả hoặc tên sách.
export async function listCounterOrders({ q, page } = {}) {
  const params = { page }
  if (q) params.q = q
  const { data } = await api.get('/return-requests/counter-orders', { params })
  return data
}

// body: { condition, fineTierId?, note?, lateFineTierId? }. 400 kèm `errors` theo field,
// 409 `already_processed` khi nhân viên khác đã xử lý.
export async function confirmReturnRequest(id, body) {
  const { data } = await api.post(`/return-requests/${encodeURIComponent(id)}/confirm`, body)
  return data
}

export async function rejectReturnRequest(id, reason) {
  const { data } = await api.post(`/return-requests/${encodeURIComponent(id)}/reject`, { reason })
  return data
}

// 409 kèm `reason`: not_borrowing, pending_return, already_processed.
export async function counterReturn(borrowOrderId, body) {
  const { data } = await api.post('/return-requests/counter', { borrowOrderId, ...body })
  return data
}

// Mức phạt đang áp dụng, nhóm theo loại: { late: [], damaged: [], lost: [] }.
export async function listFineTierOptions() {
  const { data } = await api.get('/fine-tiers/options')
  return data.tiers
}
