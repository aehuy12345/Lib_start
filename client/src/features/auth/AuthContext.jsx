import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { setUnauthorizedHandler } from '../../api/client'
import { getMe, login as loginApi } from './authApi'
import { clearToken, getToken, setToken } from './session'

const AuthContext = createContext(null)

// status: 'loading' (đang kiểm tra token đã lưu) | 'authenticated' | 'anonymous'
export function AuthProvider({ children }) {
  const navigate = useNavigate()
  const [state, setState] = useState(() =>
    getToken() ? { status: 'loading', user: null } : { status: 'anonymous', user: null },
  )

  // Khôi phục phiên khi tải lại trang; role lấy từ server, không đọc từ token.
  useEffect(() => {
    if (state.status !== 'loading') return
    let cancelled = false
    getMe()
      .then((user) => !cancelled && setState({ status: 'authenticated', user }))
      .catch(() => {
        if (cancelled) return
        clearToken()
        setState({ status: 'anonymous', user: null })
      })
    return () => { cancelled = true }
  }, [state.status])

  // Phiên hết hạn giữa chừng: xóa token, về trang đăng nhập kèm URL cũ để quay lại sau.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      clearToken()
      setState({ status: 'anonymous', user: null })
      const { pathname, search } = window.location
      const redirect = encodeURIComponent(pathname + search)
      navigate(`/login?redirect=${redirect}&expired=1`, { replace: true })
    })
    return () => setUnauthorizedHandler(() => {})
  }, [navigate])

  const login = useCallback(async (credentials) => {
    const data = await loginApi(credentials)
    setToken(data.token)
    setState({ status: 'authenticated', user: data.user })
    return data.user
  }, [])

  // [Giả định] JWT không lưu phía server nên đăng xuất chỉ cần xóa token ở client.
  // loggedOut: RequireAuth không gắn ?redirect để người đăng nhập sau không bị đưa về trang cũ.
  const logout = useCallback(() => {
    clearToken()
    setState({ status: 'anonymous', user: null, loggedOut: true })
    navigate('/login', { replace: true })
  }, [navigate])

  // Hồ sơ đổi tên (2.1.3) thì cập nhật luôn user trong phiên để header hiện tên mới.
  const updateUser = useCallback((patch) => {
    setState((prev) => (prev.user ? { ...prev, user: { ...prev.user, ...patch } } : prev))
  }, [])

  const value = useMemo(
    () => ({ ...state, login, logout, updateUser }),
    [state, login, logout, updateUser],
  )
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth phải dùng bên trong AuthProvider')
  return ctx
}
