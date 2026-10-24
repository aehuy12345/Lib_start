import { api } from '../../api/client'

// Gửi multipart để kèm ảnh bìa (field `cover`) khi có.
export async function createBook(values, cover) {
  const form = new FormData()
  Object.entries(values).forEach(([key, value]) => form.append(key, value))
  if (cover) form.append('cover', cover)
  const { data } = await api.post('/books', form)
  return data
}

// 2.2.3: công khai. params: { q, categoryId, sort, page } (đã bỏ giá trị rỗng).
export async function listBooks(params) {
  const { data } = await api.get('/books', { params })
  return data
}

// 2.2.4: chi tiết sách, công khai.
export async function getBook(id) {
  const { data } = await api.get(`/books/${encodeURIComponent(id)}`)
  return data.book
}

// 2.2.4: lịch sử mượn, chỉ nhân viên (server trả 401/403 cho người khác).
export async function getBorrowHistory(id, page) {
  const { data } = await api.get(`/books/${encodeURIComponent(id)}/borrow-history`, { params: { page } })
  return data
}

// 2.2.4: độc giả có mượn được sách này không; server kiểm tra lại khi tạo đơn (2.3.1).
export async function getBorrowEligibility(id) {
  const { data } = await api.get(`/books/${encodeURIComponent(id)}/borrow-eligibility`)
  return data
}

// 2.2.5: sửa sách (multipart như createBook). version cho khóa lạc quan; removeCover xóa ảnh hiện tại.
export async function updateBook(id, values, { version, cover, removeCover }) {
  const form = new FormData()
  Object.entries(values).forEach(([key, value]) => form.append(key, value))
  form.append('version', version)
  form.append('removeCover', removeCover ? 'true' : 'false')
  if (cover) form.append('cover', cover)
  const { data } = await api.put(`/books/${encodeURIComponent(id)}`, form)
  return data
}

// 2.2.5: số đơn mượn hoạt động, kiểm tra trước khi hỏi xác nhận xóa.
export async function getDeleteCheck(id) {
  const { data } = await api.get(`/books/${encodeURIComponent(id)}/delete-check`)
  return data
}

export async function deleteBook(id) {
  const { data } = await api.delete(`/books/${encodeURIComponent(id)}`)
  return data
}
