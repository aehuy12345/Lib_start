import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link } from 'react-router-dom'
import dayjs from 'dayjs'
import { parseApiError } from '../api/client'
import { useAuth } from '../features/auth/AuthContext'
import AvatarSection from '../features/profile/AvatarSection'
import ChangePasswordForm from '../features/profile/ChangePasswordForm'
import FormField from '../features/profile/FormField'
import { applyServerErrors } from '../features/profile/formErrors'
import { getProfile, updateProfile } from '../features/profile/profileApi'
import { profileRules } from '../features/profile/profileRules'

const money = (amount) => `${new Intl.NumberFormat('vi-VN').format(amount)} đ`

const toForm = (p) => ({ name: p.name, phone: p.phone ?? '', address: p.address ?? '' })

// 2.1.3 Hồ sơ cá nhân (Độc giả).
export default function ProfilePage() {
  const { user, logout, updateUser } = useAuth()
  const [profile, setProfile] = useState(null)
  const [loadError, setLoadError] = useState('')

  useEffect(() => {
    let cancelled = false
    getProfile()
      .then((p) => !cancelled && setProfile(p))
      .catch((err) => !cancelled && setLoadError(parseApiError(err).message))
    return () => { cancelled = true }
  }, [])

  return (
    <main className="min-h-screen bg-slate-50">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
        <h1 className="text-lg font-semibold text-slate-900">Hồ sơ cá nhân</h1>
        <div className="flex items-center gap-4 text-sm">
          <Link to="/reader" className="font-medium text-blue-600 hover:underline">Dashboard</Link>
          <span className="text-slate-700">{user.name}</span>
          <button type="button" onClick={logout} className="font-medium text-blue-600 hover:underline">
            Đăng xuất
          </button>
        </div>
      </header>

      {loadError && <p role="alert" className="p-6 text-sm text-red-700">{loadError}</p>}
      {!profile && !loadError && <p className="p-6 text-sm text-slate-600">Đang tải...</p>}
      {profile && (
        <div className="mx-auto grid max-w-4xl gap-6 p-6 md:grid-cols-[16rem_1fr]">
          <section className="space-y-4 rounded-lg bg-white p-6 shadow">
            <AvatarSection
              url={profile.avatarUrl}
              name={profile.name}
              onChange={(avatarUrl) => setProfile((p) => ({ ...p, avatarUrl }))}
            />
            <dl className="space-y-2 text-sm">
              <Stat label="Email" value={profile.email} />
              <Stat label="Ngày tham gia" value={dayjs(profile.createdAt).format('DD/MM/YYYY')} />
              <Stat label="Số lần mượn" value={profile.borrowCount} />
              <Stat label="Tổng tiền phạt" value={money(profile.totalFine)} />
              <Stat label="Chưa thanh toán" value={money(profile.unpaidFine)} />
            </dl>
          </section>

          <div className="space-y-6">
            <section className="rounded-lg bg-white p-6 shadow">
              <h2 className="mb-4 text-base font-semibold text-slate-900">Thông tin cá nhân</h2>
              <ProfileForm
                profile={profile}
                onSaved={(p) => {
                  setProfile(p)
                  updateUser({ name: p.name })
                }}
              />
            </section>
            <section className="rounded-lg bg-white p-6 shadow">
              <h2 className="mb-4 text-base font-semibold text-slate-900">Đổi mật khẩu</h2>
              <ChangePasswordForm />
            </section>
          </div>
        </div>
      )}
    </main>
  )
}

function Stat({ label, value }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-slate-500">{label}</dt>
      <dd className="break-all text-right font-medium text-slate-900">{value}</dd>
    </div>
  )
}

const FIELDS = [
  { name: 'name', label: 'Tên', autoComplete: 'name' },
  { name: 'phone', label: 'Số điện thoại', autoComplete: 'tel', type: 'tel' },
  { name: 'address', label: 'Địa chỉ', autoComplete: 'street-address' },
]

function ProfileForm({ profile, onSaved }) {
  const [serverError, setServerError] = useState('')
  const [notice, setNotice] = useState('')
  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors, isSubmitting },
  } = useForm({ defaultValues: toForm(profile) })

  // Edge 1: SĐT/Địa chỉ trống chỉ bị validate khi bấm Lưu.
  const onSubmit = async (values) => {
    setServerError('')
    setNotice('')
    try {
      const data = await updateProfile({
        name: values.name.trim(),
        phone: values.phone.trim(),
        address: values.address.trim(),
      })
      reset(toForm(data.profile))
      onSaved(data.profile)
      setNotice(data.message)
    } catch (err) {
      setServerError(applyServerErrors(setError, parseApiError(err)))
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4" aria-label="Thông tin cá nhân">
      {/* Edge 4: email chỉ hiển thị, không sửa được. */}
      <FormField id="profile-email" label="Email" type="email" value={profile.email} disabled readOnly />
      {FIELDS.map((field) => (
        <FormField
          key={field.name}
          id={field.name}
          label={field.label}
          type={field.type ?? 'text'}
          autoComplete={field.autoComplete}
          error={errors[field.name]}
          registration={register(field.name, profileRules[field.name])}
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
        {isSubmitting ? 'Đang lưu...' : 'Lưu thông tin'}
      </button>
    </form>
  )
}
