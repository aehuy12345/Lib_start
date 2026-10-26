import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { parseApiError } from '../api/client'
import { useAuth } from '../features/auth/AuthContext'
import { dashboardPath } from '../features/auth/session'
import { createFineTier, deleteFineTier, listFineTiers, updateFineTier } from '../features/fine/fineApi'
import { FINE_TYPES, NAME_MAX, validateTier } from '../features/fine/fineRules'
import { formatAmount } from '../features/return/returnRules'

const INPUT_CLASS = 'w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 aria-[invalid=true]:border-red-500'
const BUTTON_CLASS = 'rounded-md px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50'
const TYPE_LABELS = Object.fromEntries(FINE_TYPES.map((t) => [t.value, t.label]))
const EMPTY_FORM = { name: '', type: '', amount: '' }

function FieldError({ id, error }) {
  return error ? <p id={id} className="mt-1 text-sm text-red-600">{error}</p> : null
}

function AddTierForm({ onAdded, onCancel }) {
  const [values, setValues] = useState(EMPTY_FORM)
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState('')
  const [busy, setBusy] = useState(false)

  const set = (field) => (e) => {
    setValues((v) => ({ ...v, [field]: e.target.value }))
    setErrors((e) => ({ ...e, [field]: '' }))
    setFormError('')
  }

  const onSubmit = async (e) => {
    e.preventDefault()
    const invalid = validateTier(values, { withType: true })
    if (Object.keys(invalid).length) return setErrors(invalid)
    setBusy(true)
    try {
      const { tier } = await createFineTier({ name: values.name.trim(), type: values.type, amount: Number(values.amount.trim()) })
      onAdded(tier)
    } catch (err) {
      const { message, errors: fieldErrors } = parseApiError(err)
      if (Object.keys(fieldErrors).length) setErrors(fieldErrors)
      else setFormError(message)
    } finally {
      setBusy(false)
    }
  }

  const field = (name) => ({
    'aria-invalid': errors[name] ? 'true' : 'false',
    'aria-describedby': errors[name] ? `new-tier-${name}-error` : undefined,
  })

  return (
    <form aria-label="Thêm mức phạt" onSubmit={onSubmit} noValidate className="mb-4 rounded-md border border-slate-200 bg-white p-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label htmlFor="new-tier-name" className="block text-sm font-medium text-slate-700">Tên mức phạt</label>
          <input id="new-tier-name" autoFocus value={values.name} maxLength={NAME_MAX + 20} onChange={set('name')} className={`mt-1 ${INPUT_CLASS}`} {...field('name')} />
          <FieldError id="new-tier-name-error" error={errors.name} />
        </div>
        <div>
          <label htmlFor="new-tier-type" className="block text-sm font-medium text-slate-700">Loại</label>
          <select id="new-tier-type" value={values.type} onChange={set('type')} className={`mt-1 ${INPUT_CLASS}`} {...field('type')}>
            <option value="">-- Chọn loại --</option>
            {FINE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          <FieldError id="new-tier-type-error" error={errors.type} />
        </div>
        <div>
          <label htmlFor="new-tier-amount" className="block text-sm font-medium text-slate-700">Số tiền (VND)</label>
          <input id="new-tier-amount" inputMode="numeric" value={values.amount} onChange={set('amount')} className={`mt-1 ${INPUT_CLASS}`} {...field('amount')} />
          <FieldError id="new-tier-amount-error" error={errors.amount} />
        </div>
      </div>
      {formError && <p role="alert" className="mt-2 text-sm text-red-600">{formError}</p>}
      <div className="mt-3 flex gap-2">
        <button type="submit" disabled={busy} className={`${BUTTON_CLASS} bg-blue-600 text-white hover:bg-blue-700`}>Thêm</button>
        <button type="button" onClick={onCancel} className={`${BUTTON_CLASS} border border-slate-300 text-slate-700 hover:bg-slate-50`}>Hủy</button>
      </div>
    </form>
  )
}

// Sửa trực tiếp Tên và Số tiền trên bảng; lỗi thì giữ ô để sửa tiếp, Hủy trả lại giá trị cũ.
function TierRow({ tier, onSaved, onConflict, onDelete, busyDelete }) {
  const initial = { name: tier.name, amount: String(tier.amount) }
  const [values, setValues] = useState(initial)
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(false)
  const idPrefix = `tier-${tier.id}`
  const dirty = values.name.trim() !== tier.name || values.amount.trim() !== String(tier.amount)

  const set = (field) => (e) => {
    setValues((v) => ({ ...v, [field]: e.target.value }))
    setErrors((e) => ({ ...e, [field]: '' }))
  }
  const reset = () => { setValues(initial); setErrors({}) }

  const onSave = async () => {
    const invalid = validateTier(values)
    if (Object.keys(invalid).length) return setErrors(invalid)
    setBusy(true)
    try {
      const { tier: saved } = await updateFineTier(tier.id, {
        name: values.name.trim(), amount: Number(values.amount.trim()), updatedAt: tier.updatedAt,
      })
      onSaved(saved)
    } catch (err) {
      const { message, errors: fieldErrors } = parseApiError(err)
      const status = err?.response?.status
      // 404: đã bị xóa; 409 stale (edge 7): Admin khác vừa sửa → tải lại bảng.
      if (status === 404 || (status === 409 && err.response.data?.reason === 'stale')) return onConflict(message)
      setErrors(Object.keys(fieldErrors).length ? fieldErrors : { name: message })
    } finally {
      setBusy(false)
    }
  }

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && dirty) onSave()
    if (e.key === 'Escape') reset()
  }

  const field = (name) => ({
    id: `${idPrefix}-${name}`,
    onChange: set(name),
    onKeyDown,
    'aria-invalid': errors[name] ? 'true' : 'false',
    'aria-describedby': errors[name] ? `${idPrefix}-${name}-error` : undefined,
    className: INPUT_CLASS,
  })

  return (
    <tr className="border-t border-slate-200 align-top">
      <td className="px-4 py-2">
        <input aria-label={`Tên mức phạt ${tier.name}`} value={values.name} {...field('name')} />
        <FieldError id={`${idPrefix}-name-error`} error={errors.name} />
      </td>
      <td className="px-4 py-2 text-sm text-slate-700">{TYPE_LABELS[tier.type] ?? tier.type}</td>
      <td className="px-4 py-2">
        <input aria-label={`Số tiền ${tier.name}`} inputMode="numeric" value={values.amount} {...field('amount')} />
        <FieldError id={`${idPrefix}-amount-error`} error={errors.amount} />
        {!errors.amount && <p className="mt-1 text-xs text-slate-500">Hiện tại: {formatAmount(tier.amount)}</p>}
      </td>
      <td className="px-4 py-2 text-sm text-slate-700">{tier.ticketCount}</td>
      <td className="px-4 py-2">
        <div className="flex gap-2">
          {dirty && (
            <>
              <button type="button" onClick={onSave} disabled={busy} className={`${BUTTON_CLASS} bg-blue-600 text-white hover:bg-blue-700`}>Lưu</button>
              <button type="button" onClick={reset} disabled={busy} className={`${BUTTON_CLASS} border border-slate-300 text-slate-700 hover:bg-slate-50`}>Hủy</button>
            </>
          )}
          <button
            type="button"
            onClick={() => onDelete(tier)}
            disabled={busyDelete}
            aria-label={`Xóa ${tier.name}`}
            className={`${BUTTON_CLASS} border border-red-300 text-red-600 hover:bg-red-50`}
          >
            Xóa
          </button>
        </div>
      </td>
    </tr>
  )
}

// 2.5.1 Quản lý mức phạt (chỉ Admin).
export default function FineTiersPage() {
  const { user } = useAuth()
  const [tiers, setTiers] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [adding, setAdding] = useState(false)
  const [notice, setNotice] = useState({ type: '', text: '' })
  const [deletingId, setDeletingId] = useState(null)

  const reload = useCallback(() => listFineTiers()
    .then((list) => {
      setTiers(list)
      setLoadError('')
    })
    .catch((err) => setLoadError(parseApiError(err).message)), [])

  useEffect(() => {
    let cancelled = false
    listFineTiers()
      .then((list) => !cancelled && setTiers(list))
      .catch((err) => !cancelled && setLoadError(parseApiError(err).message))
    return () => { cancelled = true }
  }, [])

  const showError = (text) => setNotice({ type: 'error', text })
  const showSuccess = (text) => setNotice({ type: 'success', text })

  const onAdded = (tier) => {
    setAdding(false)
    showSuccess(`Đã thêm mức phạt "${tier.name}"`)
    reload()
  }

  const onSaved = (saved) => {
    showSuccess('Cập nhật mức phạt thành công')
    setTiers((list) => list.map((t) => (t.id === saved.id ? saved : t)))
  }

  const onConflict = (message) => {
    showError(message)
    reload()
  }

  const onDelete = async (tier) => {
    setNotice({ type: '', text: '' })
    const question = tier.ticketCount > 0
      ? `Mức phạt "${tier.name}" đã được dùng trong ${tier.ticketCount} phiếu phạt nên sẽ được ẩn: không chọn được khi lập phiếu mới, phiếu cũ giữ nguyên. Tiếp tục?`
      : `Xóa mức phạt "${tier.name}"?`
    if (!window.confirm(question)) return
    setDeletingId(tier.id)
    try {
      const { message } = await deleteFineTier(tier.id)
      showSuccess(message)
    } catch (err) {
      showError(parseApiError(err).message)
    } finally {
      setDeletingId(null)
      reload()
    }
  }

  return (
    <main className="min-h-screen bg-slate-50">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
        <h1 className="text-lg font-semibold text-slate-900">Quản lý mức phạt</h1>
        <Link to={dashboardPath(user.role)} className="text-sm font-medium text-blue-600 hover:underline">Về dashboard</Link>
      </header>

      <section className="mx-auto max-w-4xl p-6">
        <div className="mb-4 flex justify-end">
          {!adding && (
            <button
              type="button"
              onClick={() => { setAdding(true); setNotice({ type: '', text: '' }) }}
              className={`${BUTTON_CLASS} bg-blue-600 text-white hover:bg-blue-700`}
            >
              Thêm mức phạt
            </button>
          )}
        </div>

        {adding && <AddTierForm onAdded={onAdded} onCancel={() => setAdding(false)} />}

        {notice.text && (
          <p
            role={notice.type === 'error' ? 'alert' : 'status'}
            className={`mb-4 rounded-md px-3 py-2 text-sm ${notice.type === 'error' ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}
          >
            {notice.text}
          </p>
        )}

        {loadError && <p role="alert" className="text-sm text-red-600">{loadError}</p>}
        {!tiers && !loadError && <p className="text-sm text-slate-600">Đang tải...</p>}

        {tiers && (
          <div className="overflow-x-auto rounded-md border border-slate-200 bg-white">
            <table className="w-full text-left">
              <thead className="bg-slate-100 text-sm text-slate-700">
                <tr>
                  <th className="px-4 py-2 font-medium">Tên mức phạt</th>
                  <th className="w-28 px-4 py-2 font-medium">Loại</th>
                  <th className="w-44 px-4 py-2 font-medium">Số tiền (VND)</th>
                  <th className="w-28 px-4 py-2 font-medium">Phiếu đã dùng</th>
                  <th className="w-48 px-4 py-2 font-medium">Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {tiers.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-center text-sm text-slate-600">
                      Chưa có mức phạt nào. Nhân viên sẽ không xác nhận được các lần trả cần phạt cho tới khi có mức phạt.
                    </td>
                  </tr>
                ) : (
                  tiers.map((t) => (
                    // Key gồm updatedAt: dữ liệu trên server đổi thì dòng được tạo lại với giá trị mới.
                    <TierRow
                      key={`${t.id}:${t.updatedAt}`}
                      tier={t}
                      onSaved={onSaved}
                      onConflict={onConflict}
                      onDelete={onDelete}
                      busyDelete={deletingId === t.id}
                    />
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
        {tiers && tiers.length > 0 && (
          <p className="mt-2 text-xs text-slate-500">
            Sửa số tiền không ảnh hưởng phiếu phạt đã lập (phiếu lưu số tiền tại thời điểm lập).
          </p>
        )}
      </section>
    </main>
  )
}
