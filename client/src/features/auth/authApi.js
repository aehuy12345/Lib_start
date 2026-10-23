import { api } from '../../api/client'

export async function register(payload) {
  const { data } = await api.post('/auth/register', payload)
  return data
}

export async function verifyEmail(token) {
  const { data } = await api.post('/auth/verify-email', { token })
  return data
}
