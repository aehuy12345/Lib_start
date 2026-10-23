import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link } from 'react-router-dom'
import { parseApiError } from '../api/client'
import { register as registerApi } from '../features/auth/authApi'
import { registerRules } from '../features/auth/registerRules'

const FIELDS = [
  { name: 'email', label: 'Email', type: 'email', autoComplete: 'email' },
  { name: 'name', label: 'Tên', type: 'text', autoComplete: 'name' },
  { name: 'password', label: 'Mật khẩu', type: 'password', autoComplete: 'new-password' },
  { name: 'confirmPassword', label: 'Xác nhận mật khẩu', type: 'password', autoComplete: 'new-password' },
]

export default function RegisterPage() {
  const [serverError, setServerError] = useState('')
  const [success, setSuccess] = useState('')
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({
    defaultValues: { email: '', name: '', password: '', confirmPassword: '' },
    mode: 'onTouched',
  })

  // Confirm không khớp bị chặn ở client nên không gọi API (edge 4).
  const onSubmit = async (values) => {
    setServerError('')
    try {
      const data = await registerApi({
        ...values,
        email: values.email.trim(),
        name: values.name.trim(),
      })
      setSuccess(data.message)
    } catch (err) {
      const { message, errors: fieldErrors } = parseApiError(err)
      const entries = Object.entries(fieldErrors)
      entries.forEach(([field, msg]) => setError(field, { type: 'server', message: msg }))
      if (entries.length === 0) setServerError(message)
    }
  }

  if (success) {
    return (
      <AuthCard title="Đăng ký thành công">
        <p role="status" className="text-sm text-slate-700">{success}</p>
        <Link to="/login" className="mt-4 inline-block text-sm font-medium text-blue-600 hover:underline">
          Về trang đăng nhập
        </Link>
      </AuthCard>
    )
  }

  return (
    <AuthCard title="Đăng ký tài khoản">
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
              {...register(field.name, registerRules[field.name])}
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

        {/* Khóa nút khi đang gửi để tránh bấm nhiều lần (edge 6). */}
        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSubmitting ? 'Đang gửi...' : 'Đăng ký'}
        </button>
      </form>
      <p className="mt-4 text-center text-sm text-slate-600">
        Đã có tài khoản?{' '}
        <Link to="/login" className="font-medium text-blue-600 hover:underline">Đăng nhập</Link>
      </p>
    </AuthCard>
  )
}

export function AuthCard({ title, children }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-md rounded-lg bg-white p-6 shadow">
        <h1 className="mb-6 text-xl font-semibold text-slate-900">{title}</h1>
        {children}
      </div>
    </main>
  )
}
