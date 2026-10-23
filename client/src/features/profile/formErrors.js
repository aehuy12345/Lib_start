// Gán lỗi theo field từ server vào form; không có field nào thì trả thông báo chung.
export function applyServerErrors(setError, { message, errors }) {
  const entries = Object.entries(errors)
  entries.forEach(([field, msg]) => setError(field, { type: 'server', message: msg }))
  return entries.length === 0 ? message : ''
}
