import { useEffect, useRef, useState } from 'react'
import { formatAmount } from '../return/returnRules'
import { validateReceiptFile } from './fineTicketRules'

function InfoRow({ label, value }) {
  return (
    <div className="flex justify-between gap-4 py-1">
      <dt className="text-slate-600">{label}</dt>
      <dd className="text-right font-medium text-slate-900">{value}</dd>
    </div>
  )
}

// 2.5.2: thông tin chuyển khoản + nút "Đã thanh toán". Hệ thống không tự kiểm tra giao dịch (edge 3).
export default function PaymentDialog({ ticket, bank, busy, onSubmit, onClose }) {
  const [file, setFile] = useState(null)
  const [fileError, setFileError] = useState('')
  const submitRef = useRef(null)

  useEffect(() => {
    submitRef.current?.focus()
    const onKey = (e) => e.key === 'Escape' && !busy && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  const onFile = (e) => {
    const picked = e.target.files?.[0] ?? null
    const error = validateReceiptFile(picked)
    setFileError(error ?? '')
    setFile(error ? null : picked)
  }

  return (
    <div className="fixed inset-0 z-10 flex items-center justify-center bg-slate-900/40 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="payment-dialog-title"
        className="w-full max-w-md rounded-lg bg-white p-6 shadow-lg"
      >
        <h2 id="payment-dialog-title" className="text-lg font-semibold text-slate-900">Thanh toán phiếu phạt #{ticket.id}</h2>

        {bank ? (
          <dl className="mt-3 rounded-md border border-slate-200 px-3 py-2 text-sm">
            {bank.bankName && <InfoRow label="Ngân hàng" value={bank.bankName} />}
            <InfoRow label="Số tài khoản" value={bank.accountNumber} />
            {bank.accountHolder && <InfoRow label="Chủ tài khoản" value={bank.accountHolder} />}
            <InfoRow label="Số tiền" value={formatAmount(ticket.amount)} />
            <InfoRow label="Nội dung chuyển khoản" value={ticket.transferContent} />
          </dl>
        ) : (
          <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Thư viện chưa cấu hình tài khoản nhận chuyển khoản, vui lòng liên hệ thư viện. Số tiền: {formatAmount(ticket.amount)}.
          </p>
        )}

        <p className="mt-3 text-sm text-slate-700">
          Chuyển khoản đúng số tiền và nội dung trên, rồi bấm <span className="font-medium">Đã thanh toán</span>.
          Nhân viên thư viện sẽ đối chiếu sao kê trước khi xác nhận.
        </p>

        <label htmlFor="receipt" className="mt-4 block text-sm font-medium text-slate-700">Ảnh biên lai (tùy chọn)</label>
        <input
          id="receipt"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={onFile}
          disabled={busy}
          aria-invalid={!!fileError}
          aria-describedby={fileError ? 'receipt-error' : undefined}
          className="mt-1 block w-full text-sm"
        />
        {fileError && <p id="receipt-error" className="mt-1 text-sm text-red-600">{fileError}</p>}

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
            ref={submitRef}
            type="button"
            onClick={() => onSubmit(file)}
            disabled={busy}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {busy ? 'Đang gửi...' : 'Đã thanh toán'}
          </button>
        </div>
      </div>
    </div>
  )
}
