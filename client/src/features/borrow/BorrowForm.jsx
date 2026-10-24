import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { parseApiError } from '../../api/client'
import FormField from '../profile/FormField'
import { createBorrowOrder } from './borrowApi'
import { DEFAULT_BORROW_DAYS, MAX_BORROW_DAYS, requestedDaysRules } from './borrowRules'

// PRD 2.3.1 bước 3–4: chọn thời hạn (mặc định 14, tối đa 30) rồi gửi yêu cầu.
// onDone(message) khi tạo đơn xong; onRejected(message) khi server từ chối vì không đủ điều kiện.
export default function BorrowForm({ bookId, onDone, onRejected, onCancel }) {
  const [serverError, setServerError] = useState('')
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({ defaultValues: { requestedDays: String(DEFAULT_BORROW_DAYS) } })

  const onSubmit = async ({ requestedDays }) => {
    setServerError('')
    try {
      const data = await createBorrowOrder(bookId, Number(requestedDays))
      onDone(data.message)
    } catch (err) {
      const { message, errors: fieldErrors } = parseApiError(err)
      if (fieldErrors.requestedDays) {
        setError('requestedDays', { message: fieldErrors.requestedDays })
        return
      }
      // Có `reason`: điều kiện đã đổi kể từ lúc mở trang (hết sách, đạt giới hạn, ...).
      if (err?.response?.data?.reason) onRejected(message)
      else setServerError(message)
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate aria-label="Yêu cầu mượn sách" className="mt-3 max-w-xs space-y-3 rounded-md border border-slate-200 p-4">
      <FormField
        id="requestedDays"
        label={`Thời hạn mượn (ngày, tối đa ${MAX_BORROW_DAYS})`}
        type="number"
        inputMode="numeric"
        min={1}
        max={MAX_BORROW_DAYS}
        error={errors.requestedDays}
        registration={register('requestedDays', requestedDaysRules)}
      />
      <p className="text-xs text-slate-500">Hạn trả tính từ ngày nhân viên xác nhận.</p>
      {serverError && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{serverError}</p>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={isSubmitting}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSubmitting ? 'Đang gửi...' : 'Gửi yêu cầu'}
        </button>
        <button type="button" onClick={onCancel} className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
          Đóng
        </button>
      </div>
    </form>
  )
}
