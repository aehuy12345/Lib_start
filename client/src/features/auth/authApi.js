import { api } from '../../api/client'

export async function register(payload) {
  const { data } = await api.post('/auth/register', payload)
  return data
}

export async function verifyEmail(token) {
  const { data } = await api.post('/auth/verify-email', { token })
  return data
}

export async function login(payload) {
  const { data } = await api.post('/auth/login', payload)
  return data
}

export async function getMe() {
  const { data } = await api.get('/auth/me')
  return data.user
}
