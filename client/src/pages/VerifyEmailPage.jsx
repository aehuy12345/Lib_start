import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { parseApiError } from '../api/client'
import { verifyEmail } from '../features/auth/authApi'
import { AuthCard } from './RegisterPage'

export default function VerifyEmailPage() {
  const [params] = useSearchParams()
  const token = params.get('token')
  const [state, setState] = useState(() =>
    token ? { status: 'loading' } : { status: 'error', message: 'Thiếu mã xác thực' },
  )
  // StrictMode chạy effect hai lần; token chỉ dùng được một lần nên chỉ gọi API một lần.
  const called = useRef(false)

  useEffect(() => {
    if (!token || called.current) return
    called.current = true
    verifyEmail(token)
      .then((data) => setState({ status: 'success', message: data.message }))
      .catch((err) => setState({ status: 'error', message: parseApiError(err).message }))
  }, [token])

  return (
    <AuthCard title="Xác nhận email">
      {state.status === 'loading' && <p className="text-sm text-slate-700">Đang xác nhận...</p>}
      {state.status === 'success' && <p role="status" className="text-sm text-green-700">{state.message}</p>}
      {state.status === 'error' && <p role="alert" className="text-sm text-red-700">{state.message}</p>}
      {state.status !== 'loading' && (
        <Link to="/login" className="mt-4 inline-block text-sm font-medium text-blue-600 hover:underline">
          Về trang đăng nhập
        </Link>
      )}
    </AuthCard>
  )
}
