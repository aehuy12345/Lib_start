import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { parseApiError } from '../../api/client'
import FormField from './FormField'
import { applyServerErrors } from './formErrors'
import { changePassword } from './profileApi'
import { passwordRules } from './profileRules'

const FIELDS = [
  { name: 'currentPassword', label: 'Mật khẩu hiện tại', autoComplete: 'current-password' },
  { name: 'newPassword', label: 'Mật khẩu mới', autoComplete: 'new-password' },
  { name: 'confirmPassword', label: 'Xác nhận mật khẩu mới', autoComplete: 'new-password' },
]
const EMPTY = { currentPassword: '', newPassword: '', confirmPassword: '' }

export default function ChangePasswordForm() {
  const [serverError, setServerError] = useState('')
  const [notice, setNotice] = useState('')
  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors, isSubmitting },
  } = useForm({ defaultValues: EMPTY })

  const onSubmit = async (values) => {
    setServerError('')
    setNotice('')
    try {
      const data = await changePassword(values)
      reset(EMPTY)
      setNotice(data.message)
    } catch (err) {
      setServerError(applyServerErrors(setError, parseApiError(err)))
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4" aria-label="Đổi mật khẩu">
      {FIELDS.map((field) => (
        <FormField
          key={field.name}
          id={field.name}
          label={field.label}
          type="password"
          autoComplete={field.autoComplete}
          error={errors[field.name]}
          registration={register(field.name, passwordRules[field.name])}
        />
      ))}
      {serverError && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{serverError}</p>
      )}
      {notice && <p role="status" className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">{notice}</p>}
      <button
        type="submit"
        disabled={isSubmitting}
        className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isSubmitting ? 'Đang lưu...' : 'Đổi mật khẩu'}
      </button>
    </form>
  )
}
