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

// 2.5.3 (nhân viên, Admin): mọi phiếu phạt. Trả về { tickets, pagination, summary }.
export async function listFineTickets({ status, q, page } = {}) {
  const { data } = await api.get('/fine-tickets', { params: { status, q: q || undefined, page } })
  return data
}

// 409 kèm `reason`: not_submitted, already_processed. Trả về { message, ticket, readerOutstanding }.
export async function confirmFineTicket(id) {
  const { data } = await api.post(`/fine-tickets/${encodeURIComponent(id)}/confirm`)
  return data
}

export async function rejectFineTicket(id, reason) {
  const { data } = await api.post(`/fine-tickets/${encodeURIComponent(id)}/reject`, { reason })
  return data
}

// Bucket receipts là private: server cấp signed URL ngắn hạn (độc giả: phiếu của mình; nhân viên: mọi phiếu).
export async function getFineReceiptUrl(id) {
  const { data } = await api.get(`/fine-tickets/${encodeURIComponent(id)}/receipt`)
  return data.url
}
