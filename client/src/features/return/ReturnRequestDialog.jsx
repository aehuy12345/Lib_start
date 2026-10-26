import { useEffect, useRef } from 'react'
import { formatDate } from '../book/bookDetail'

// 2.4.1 bước 4: modal xác nhận kèm nhắc mang sách đến thư viện.
export default function ReturnRequestDialog({ order, busy, onConfirm, onClose }) {
  const confirmRef = useRef(null)

  useEffect(() => {
    confirmRef.current?.focus()
    const onKey = (e) => e.key === 'Escape' && !busy && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  return (
    <div className="fixed inset-0 z-10 flex items-center justify-center bg-slate-900/40 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="return-dialog-title"
        className="w-full max-w-md rounded-lg bg-white p-6 shadow-lg"
      >
        <h2 id="return-dialog-title" className="text-lg font-semibold text-slate-900">Xin trả sách</h2>
        <p className="mt-3 text-sm text-slate-700">
          Gửi yêu cầu trả <span className="font-medium">"{order.book.title}"</span> (hạn trả {formatDate(order.dueDate)})?
        </p>
        <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Vui lòng mang sách đến thư viện để nhân viên kiểm tra và xác nhận. Đơn chỉ được tính là đã trả sau khi nhân viên xác nhận.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Hủy
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {busy ? 'Đang gửi...' : 'Đồng ý'}
          </button>
        </div>
      </div>
    </div>
  )
}
