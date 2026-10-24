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
