import { api } from '../../api/client'

export async function getProfile() {
  const { data } = await api.get('/profile')
  return data.profile
}

export async function updateProfile(payload) {
  const { data } = await api.patch('/profile', payload)
  return data
}

export async function changePassword(payload) {
  const { data } = await api.put('/profile/password', payload)
  return data
}

// Gửi ngay khi người dùng xác nhận, không đi chung nút Lưu thông tin.
export async function uploadAvatar(file) {
  const form = new FormData()
  form.append('avatar', file)
  const { data } = await api.put('/profile/avatar', form)
  return data
}

export async function deleteAvatar() {
  const { data } = await api.delete('/profile/avatar')
  return data
}
