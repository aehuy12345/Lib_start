import { api } from '../../api/client'

// 2.5.1 (Admin): mức phạt đang áp dụng, kèm `ticketCount` (số phiếu phạt đã dùng).
export async function listFineTiers() {
  const { data } = await api.get('/fine-tiers')
  return data.tiers
}

// body: { name, type, amount }. 409 kèm errors.name khi trùng tên.
export async function createFineTier(body) {
  const { data } = await api.post('/fine-tiers', body)
  return data
}

// body: { name, amount, updatedAt }. 409 `reason: 'stale'` khi Admin khác đã sửa trước (edge 7).
export async function updateFineTier(id, body) {
  const { data } = await api.patch(`/fine-tiers/${encodeURIComponent(id)}`, body)
  return data
}

// Trả về { hidden, message }: hidden = true khi mức phạt đã được dùng nên chỉ bị ẩn (edge 4).
export async function deleteFineTier(id) {
  const { data } = await api.delete(`/fine-tiers/${encodeURIComponent(id)}`)
  return data
}
