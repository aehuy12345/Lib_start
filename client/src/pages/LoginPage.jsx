import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { parseApiError } from '../api/client'
import { useAuth } from '../features/auth/AuthContext'
import { loginRules } from '../features/auth/loginRules'
import { dashboardPath, safeRedirect } from '../features/auth/session'
import { AuthCard } from './RegisterPage'

const FIELDS = [
  { name: 'email', label: 'Email', type: 'email', autoComplete: 'email' },
  { name: 'password', label: 'Mật khẩu', type: 'password', autoComplete: 'current-password' },
]

export default function LoginPage() {
  const { status, user, login } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const redirect = safeRedirect(params.get('redirect'))
  const [serverError, setServerError] = useState('')
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({ defaultValues: { email: '', password: '' }, mode: 'onTouched' })

  const onSubmit = async (values) => {
    setServerError('')
    try {
      const loggedIn = await login({ email: values.email.trim(), password: values.password })
      navigate(redirect ?? dashboardPath(loggedIn.role), { replace: true })
    } catch (err) {
      const { message, errors: fieldErrors } = parseApiError(err)
      const entries = Object.entries(fieldErrors)
      entries.forEach(([field, msg]) => setError(field, { type: 'server', message: msg }))
      if (entries.length === 0) setServerError(message)
    }
  }

  // Edge 6: đã đăng nhập mà vào lại /login thì chuyển thẳng tới dashboard.
  if (status === 'authenticated' && !isSubmitting) {
    return <Navigate to={redirect ?? dashboardPath(user.role)} replace />
  }
  if (status === 'loading') {
    return <p className="p-6 text-sm text-slate-600">Đang tải...</p>
  }

  return (
    <AuthCard title="Đăng nhập">
      {params.get('expired') && (
        <p role="status" className="mb-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại.
        </p>
      )}
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
        {FIELDS.map((field) => (
          <div key={field.name}>
            <label htmlFor={field.name} className="block text-sm font-medium text-slate-700">
              {field.label}
            </label>
            <input
              id={field.name}
              type={field.type}
              autoComplete={field.autoComplete}
              aria-invalid={errors[field.name] ? 'true' : 'false'}
              aria-describedby={errors[field.name] ? `${field.name}-error` : undefined}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 aria-[invalid=true]:border-red-500"
              {...register(field.name, loginRules[field.name])}
            />
            {errors[field.name] && (
              <p id={`${field.name}-error`} className="mt-1 text-sm text-red-600">
                {errors[field.name].message}
              </p>
            )}
          </div>
        ))}

        {serverError && (
          <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{serverError}</p>
        )}

        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSubmitting ? 'Đang đăng nhập...' : 'Đăng nhập'}
        </button>
      </form>
      <p className="mt-4 text-center text-sm text-slate-600">
        Chưa có tài khoản?{' '}
        <Link to="/register" className="font-medium text-blue-600 hover:underline">Đăng ký</Link>
      </p>
    </AuthCard>
  )
}
