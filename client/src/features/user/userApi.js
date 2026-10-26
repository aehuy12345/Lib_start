import { api } from '../../api/client'

// 2.6.1 (Admin): danh sách người dùng. Trả về { users, pagination }.
export async function listUsers({ role, q, page } = {}) {
  const { data } = await api.get('/users', { params: { role, q: q || undefined, page } })
  return data
}

// 409 kèm `reason`: self, last_admin, already_disabled. Trả về { message, user }.
export async function disableUser(id) {
  const { data } = await api.post(`/users/${encodeURIComponent(id)}/disable`)
  return data
}

// 409 kèm `reason`: already_active.
export async function activateUser(id) {
  const { data } = await api.post(`/users/${encodeURIComponent(id)}/activate`)
  return data
}
