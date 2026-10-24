import { api } from '../../api/client'

export async function listCategories() {
  const { data } = await api.get('/categories')
  return data.categories
}

export async function createCategory(name) {
  const { data } = await api.post('/categories', { name })
  return data
}

export async function updateCategory(id, name) {
  const { data } = await api.patch(`/categories/${id}`, { name })
  return data
}

export async function deleteCategory(id) {
  const { data } = await api.delete(`/categories/${id}`)
  return data
}

// Công khai, cho bộ lọc ở trang danh sách sách (2.2.3).
export async function listCategoryOptions() {
  const { data } = await api.get('/categories/options')
  return data.categories
}
