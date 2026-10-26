import { useState } from 'react'
import { parseApiError } from '../../api/client'
import {
  CONDITIONS, FINE_TYPE_LABELS, NOTE_MAX, buildReturnPayload, formatAmount, needsFine, noTierMessage,
  requiredFineTypes, validateReturnForm,
} from './returnRules'

const BUTTON_CLASS = 'rounded-md px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50'
const FIELD_CLASS = 'w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 aria-[invalid=true]:border-red-500'

function TierSelect({ id, label, type, tiers, value, error, onChange }) {
  const options = tiers[type] ?? []
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-slate-700">{label}</label>
      {options.length === 0 ? (
        <p role="alert" className="mt-1 text-sm text-red-600">{noTierMessage(type)}</p>
      ) : (
        <select
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={error ? 'true' : 'false'}
          aria-describedby={error ? `${id}-error` : undefined}
          className={`mt-1 ${FIELD_CLASS}`}
        >
          <option value="">-- Chọn mức phạt --</option>
          {options.map((tier) => (
            <option key={tier.id} value={tier.id}>{tier.name} ({formatAmount(tier.amount)})</option>
          ))}
        </select>
      )}
      {error && options.length > 0 && <p id={`${id}-error`} className="mt-1 text-sm text-red-600">{error}</p>}
    </div>
  )
}

// 2.4.2 bước 4: chọn tình trạng sách, mức phạt và ghi chú. `submit(payload)` gọi API;
// lỗi 400 hiện theo field, lỗi khác giao cho `onError`.
export default function ReturnConfirmForm({ item, tiers, submit, onDone, onError, onCancel }) {
  const [values, setValues] = useState({ condition: '', fineTierId: '', lateFineTierId: '', note: '' })
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(false)
  const { lateDays } = item
  const prefix = `return-${item.key}`
  const fineTypes = requiredFineTypes(values.condition, lateDays)
  // Edge 4: thiếu mức phạt cần dùng thì không xác nhận được; trả đúng hạn, bình thường vẫn được.
  const missingTier = fineTypes.some((type) => !(tiers[type]?.length))

  const set = (field) => (value) => {
    setValues((v) => ({ ...v, [field]: value }))
    setErrors((e) => ({ ...e, [field]: undefined }))
  }

  const onSubmit = async (e) => {
    e.preventDefault()
    const found = validateReturnForm(values, lateDays)
    if (Object.keys(found).length) return setErrors(found)
    setBusy(true)
    try {
      onDone(await submit(buildReturnPayload(values, lateDays)))
    } catch (err) {
      const { message, errors: fieldErrors } = parseApiError(err)
      if (err?.response?.status === 400 && fieldErrors && Object.keys(fieldErrors).length) setErrors(fieldErrors)
      else onError(err, message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form aria-label={`Xác nhận trả ${item.book.title}`} onSubmit={onSubmit} noValidate className="space-y-3">
      {lateDays > 0 && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Trả muộn {lateDays} ngày: cần lập phiếu phạt Trả muộn.
        </p>
      )}
      <fieldset>
        <legend className="text-sm font-medium text-slate-700">Tình trạng sách (bắt buộc)</legend>
        <div className="mt-1 flex gap-4">
          {CONDITIONS.map((c) => (
            <label key={c.value} className="flex items-center gap-1.5 text-sm text-slate-700">
              <input
                type="radio"
                name={`${prefix}-condition`}
                value={c.value}
                checked={values.condition === c.value}
                onChange={() => set('condition')(c.value)}
              />
              {c.label}
            </label>
          ))}
        </div>
        {errors.condition && <p className="mt-1 text-sm text-red-600">{errors.condition}</p>}
      </fieldset>

      {needsFine(values.condition) && (
        <TierSelect
          id={`${prefix}-tier`}
          label={`Mức phạt ${FINE_TYPE_LABELS[values.condition]} (bắt buộc)`}
          type={values.condition}
          tiers={tiers}
          value={values.fineTierId}
          error={errors.fineTierId}
          onChange={set('fineTierId')}
        />
      )}
      {lateDays > 0 && (
        <TierSelect
          id={`${prefix}-late-tier`}
          label="Mức phạt Trả muộn (bắt buộc)"
          type="late"
          tiers={tiers}
          value={values.lateFineTierId}
          error={errors.lateFineTierId}
          onChange={set('lateFineTierId')}
        />
      )}

      {values.condition && (
        <div>
          <label htmlFor={`${prefix}-note`} className="block text-sm font-medium text-slate-700">
            Ghi chú {needsFine(values.condition) ? '(bắt buộc' : '(tùy chọn'}, tối đa {NOTE_MAX} ký tự)
          </label>
          <textarea
            id={`${prefix}-note`}
            rows={2}
            value={values.note}
            maxLength={NOTE_MAX + 20}
            onChange={(e) => set('note')(e.target.value)}
            aria-invalid={errors.note ? 'true' : 'false'}
            aria-describedby={errors.note ? `${prefix}-note-error` : undefined}
            className={`mt-1 ${FIELD_CLASS}`}
          />
          {errors.note && <p id={`${prefix}-note-error`} className="mt-1 text-sm text-red-600">{errors.note}</p>}
        </div>
      )}

      <div className="flex gap-2">
        <button type="submit" disabled={busy || missingTier} className={`${BUTTON_CLASS} bg-blue-600 text-white hover:bg-blue-700`}>
          {busy ? 'Đang xử lý...' : 'Xác nhận trả'}
        </button>
        <button type="button" onClick={onCancel} disabled={busy} className={`${BUTTON_CLASS} border border-slate-300 text-slate-700 hover:bg-slate-50`}>Hủy</button>
      </div>
    </form>
  )
}
