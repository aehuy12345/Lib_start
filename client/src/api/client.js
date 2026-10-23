import axios from 'axios'

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:5000/api',
})

// Lấy thông báo lỗi và lỗi theo field từ response chuẩn { message, errors }.
export function parseApiError(err) {
  const data = err?.response?.data
  if (data?.message) return { message: data.message, errors: data.errors ?? {} }
  return { message: 'Không kết nối được máy chủ, vui lòng thử lại', errors: {} }
}
