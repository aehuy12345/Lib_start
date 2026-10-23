import axios from 'axios'
import { getToken } from '../features/auth/session'

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:5000/api',
})

let onUnauthorized = () => {}

// AuthProvider đăng ký hàm xử lý khi phiên hết hạn (2.1.2 edge 3, 5).
export function setUnauthorizedHandler(handler) {
  onUnauthorized = handler
}

api.interceptors.request.use((config) => {
  const token = getToken()
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// Chỉ coi là hết phiên khi request có gửi token; 401 của form đăng nhập là sai mật khẩu.
api.interceptors.response.use(undefined, (err) => {
  if (err?.response?.status === 401 && err.config?.headers?.Authorization) onUnauthorized()
  return Promise.reject(err)
})

// Lấy thông báo lỗi và lỗi theo field từ response chuẩn { message, errors }.
export function parseApiError(err) {
  const data = err?.response?.data
  if (data?.message) return { message: data.message, errors: data.errors ?? {} }
  return { message: 'Không kết nối được máy chủ, vui lòng thử lại', errors: {} }
}
