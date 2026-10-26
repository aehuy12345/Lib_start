import { api } from '../../api/client'

// 2.5.2 (độc giả): phiếu phạt của chính mình. Trả về { tickets, pagination, summary, bank }.
export async function listMyFineTickets({ status, page } = {}) {
  const { data } = await api.get('/fine-tickets/mine', { params: { status, page } })
  return data
}

// Bấm "Đã thanh toán", ảnh biên lai tùy chọn. 409 kèm `reason`: already_submitted, already_paid.
export async function payFineTicket(id, receipt) {
  let body
  if (receipt) {
    body = new FormData()
    body.append('receipt', receipt)
  }
  const { data } = await api.post(`/fine-tickets/${encodeURIComponent(id)}/pay`, body)
  return data
}

// Bucket receipts là private: server cấp signed URL ngắn hạn.
export async function getFineReceiptUrl(id) {
  const { data } = await api.get(`/fine-tickets/${encodeURIComponent(id)}/receipt`)
  return data.url
}
