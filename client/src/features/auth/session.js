const TOKEN_KEY = 'token'

// localStorage có thể bị chặn (chế độ riêng tư) nên mọi truy cập đều bọc try/catch.
export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function setToken(token) {
  try {
    localStorage.setItem(TOKEN_KEY, token)
  } catch {
    // Không lưu được thì phiên chỉ sống tới khi tải lại trang.
  }
}

export function clearToken() {
  try {
    localStorage.removeItem(TOKEN_KEY)
  } catch {
    // bỏ qua
  }
}

// [Giả định] Admin có dashboard riêng (flow 2.1.2, điểm cần làm rõ).
const DASHBOARDS = { reader: '/reader', librarian: '/librarian', admin: '/admin' }

export function dashboardPath(role) {
  return DASHBOARDS[role] ?? '/login'
}

// Chỉ nhận đường dẫn nội bộ để tránh open redirect qua ?redirect=.
export function safeRedirect(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) {
    return null
  }
  return value.startsWith('/login') ? null : value
}
