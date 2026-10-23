import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from './AuthContext'
import { dashboardPath } from './session'

// Chưa đăng nhập → về /login kèm URL hiện tại; sai vai trò → về dashboard của mình.
export default function RequireAuth({ roles, children }) {
  const { status, user, loggedOut } = useAuth()
  const location = useLocation()

  if (status === 'loading') {
    return <p className="p-6 text-sm text-slate-600">Đang tải...</p>
  }
  if (status !== 'authenticated') {
    if (loggedOut) return <Navigate to="/login" replace />
    const redirect = encodeURIComponent(location.pathname + location.search)
    return <Navigate to={`/login?redirect=${redirect}`} replace />
  }
  if (roles && !roles.includes(user.role)) {
    return <Navigate to={dashboardPath(user.role)} replace />
  }
  return children
}
