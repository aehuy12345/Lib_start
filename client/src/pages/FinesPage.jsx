import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { parseApiError } from '../api/client'
import { formatDate } from '../features/book/bookDetail'
import Pagination from '../features/book/Pagination'
import PaymentDialog from '../features/fine/PaymentDialog'
import { getFineReceiptUrl, listMyFineTickets, payFineTicket } from '../features/fine/fineTicketApi'
import {
  TICKET_FILTERS, TICKET_STATUS_LABELS, emptyMessage, nextTicketParams, readTicketParams,
} from '../features/fine/fineTicketRules'
import { FINE_TYPE_LABELS, formatAmount } from '../features/return/returnRules'

const BUTTON_CLASS = 'rounded-md px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50'
const STATUS_CLASS = {
  unpaid: 'bg-red-100 text-red-700',
  pending: 'bg-amber-100 text-amber-800',
  paid: 'bg-green-100 text-green-800',
  rejected: 'bg-slate-200 text-slate-700',
}
const COLUMNS = ['Mã', 'Nguyên nhân phạt', 'Số tiền', 'Ngày phạt', 'Trạng thái', 'Thao tác']

function TicketRow({ ticket, busyId, onPay, onViewReceipt }) {
  const busy = busyId === ticket.id
  return (
    <tr aria-label={`Phiếu phạt ${ticket.id}`} className="border-t border-slate-200 align-top">
      <td className="px-4 py-2 text-slate-700">#{ticket.id}</td>
      <td className="px-4 py-2">
        <div className="font-medium text-slate-900">{FINE_TYPE_LABELS[ticket.type]}: {ticket.tierName}</div>
        {ticket.bookTitle && <div className="text-slate-600">Sách: {ticket.bookTitle}</div>}
        {ticket.note && <div className="whitespace-pre-line break-words text-slate-600">Ghi chú: {ticket.note}</div>}
      </td>
      <td className="whitespace-nowrap px-4 py-2 font-medium text-slate-900">{formatAmount(ticket.amount)}</td>
      <td className="px-4 py-2 text-slate-700">{formatDate(ticket.issuedAt)}</td>
      <td className="px-4 py-2">
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CLASS[ticket.status]}`}>
          {TICKET_STATUS_LABELS[ticket.status]}
        </span>
        {ticket.status === 'rejected' && ticket.rejectReason && (
          <div className="mt-1 whitespace-pre-line break-words text-xs text-red-700">Lý do từ chối: {ticket.rejectReason}</div>
        )}
        {ticket.status === 'pending' && ticket.submittedAt && (
          <div className="mt-1 text-xs text-slate-500">Gửi ngày {formatDate(ticket.submittedAt)}</div>
        )}
      </td>
      <td className="px-4 py-2">
        <div className="flex flex-wrap items-center gap-2">
          {ticket.canPay && (
            <button
              type="button"
              onClick={() => onPay(ticket)}
              disabled={busy}
              aria-label={`Thanh toán phiếu ${ticket.id}`}
              className={`${BUTTON_CLASS} bg-blue-600 text-white hover:bg-blue-700`}
            >
              {ticket.status === 'rejected' ? 'Thanh toán lại' : 'Thanh toán'}
            </button>
          )}
          {ticket.hasReceipt && (
            <button
              type="button"
              onClick={() => onViewReceipt(ticket)}
              disabled={busy}
              aria-label={`Xem biên lai phiếu ${ticket.id}`}
              className={`${BUTTON_CLASS} border border-slate-300 text-slate-700 hover:bg-slate-50`}
            >
              Xem biên lai
            </button>
          )}
        </div>
      </td>
    </tr>
  )
}

// 2.5.2 Xem & thanh toán khoản phạt (độc giả). Bộ lọc và trang nằm trên URL như lịch sử mượn (2.3.3).
export default function FinesPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { status, page } = readTicketParams(searchParams)
  const [data, setData] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [notice, setNotice] = useState({ type: '', text: '' })
  const [busyId, setBusyId] = useState(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [payTarget, setPayTarget] = useState(null)

  useEffect(() => {
    let cancelled = false
    listMyFineTickets({ status, page })
      .then((result) => {
        if (cancelled) return
        setData(result)
        setLoadError('')
      })
      .catch((err) => !cancelled && setLoadError(parseApiError(err).message))
    return () => { cancelled = true }
  }, [status, page, reloadKey])

  const go = (changes) => {
    setNotice({ type: '', text: '' })
    setSearchParams(nextTicketParams({ status, page, ...changes }))
  }

  const closePayment = useCallback(() => setPayTarget(null), [])

  // Gửi xong (kể cả lỗi, vd edge 1 đã gửi rồi) thì đóng modal và tải lại để thấy trạng thái mới.
  const onSubmitPayment = async (file) => {
    const ticket = payTarget
    setNotice({ type: '', text: '' })
    setBusyId(ticket.id)
    try {
      const { message } = await payFineTicket(ticket.id, file)
      setNotice({ type: 'success', text: `Phiếu #${ticket.id}: ${message}` })
    } catch (err) {
      setNotice({ type: 'error', text: parseApiError(err).message })
    } finally {
      setBusyId(null)
      setPayTarget(null)
      setReloadKey((k) => k + 1)
    }
  }

  const onViewReceipt = async (ticket) => {
    setBusyId(ticket.id)
    try {
      window.open(await getFineReceiptUrl(ticket.id), '_blank', 'noopener')
    } catch (err) {
      setNotice({ type: 'error', text: parseApiError(err).message })
    } finally {
      setBusyId(null)
    }
  }

  const tickets = data?.tickets ?? []

  return (
    <main className="min-h-screen bg-slate-50">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
        <h1 className="text-lg font-semibold text-slate-900">Khoản phạt</h1>
        <Link to="/reader" className="text-sm font-medium text-blue-600 hover:underline">Về dashboard</Link>
      </header>

      <section className="mx-auto max-w-5xl p-6">
        {data && (
          <div aria-label="Tổng quan khoản phạt" className="mb-4 rounded-md border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
            {data.summary.dueCount > 0 ? (
              <>
                Cần thanh toán: <span className="font-semibold text-red-700">{formatAmount(data.summary.dueAmount)}</span>
                {' '}({data.summary.dueCount} phiếu). Bạn chưa thể mượn sách mới cho tới khi các phiếu phạt được xác nhận đã thanh toán.
              </>
            ) : (
              'Bạn không có khoản phạt nào cần thanh toán.'
            )}
            {data.summary.pendingCount > 0 && (
              <div className="mt-1">{data.summary.pendingCount} phiếu đang chờ nhân viên xác nhận.</div>
            )}
          </div>
        )}

        <nav aria-label="Lọc theo trạng thái" className="mb-4 flex flex-wrap gap-2">
          {TICKET_FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              aria-pressed={status === f.value}
              onClick={() => go({ status: f.value, page: 1 })}
              className={`${BUTTON_CLASS} border ${status === f.value ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}`}
            >
              {f.label}
            </button>
          ))}
        </nav>

        {notice.text && (
          <p
            role={notice.type === 'error' ? 'alert' : 'status'}
            className={`mb-4 rounded-md px-3 py-2 text-sm ${notice.type === 'error' ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}
          >
            {notice.text}
          </p>
        )}

        {loadError && <p role="alert" className="text-sm text-red-600">{loadError}</p>}
        {!data && !loadError && <p className="text-sm text-slate-600">Đang tải...</p>}

        {data && tickets.length === 0 && (
          <div className="rounded-md border border-slate-200 bg-white p-6 text-center text-sm text-slate-600">
            {emptyMessage(status)}
          </div>
        )}

        {data && tickets.length > 0 && (
          <>
            <div className="overflow-x-auto rounded-md border border-slate-200 bg-white">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-100 text-slate-700">
                  <tr>{COLUMNS.map((c) => <th key={c} className="px-4 py-2 font-medium">{c}</th>)}</tr>
                </thead>
                <tbody>
                  {tickets.map((ticket) => (
                    <TicketRow
                      key={ticket.id}
                      ticket={ticket}
                      busyId={busyId}
                      onPay={setPayTarget}
                      onViewReceipt={onViewReceipt}
                    />
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              page={data.pagination.page}
              totalPages={data.pagination.totalPages}
              onPage={(p) => go({ page: p })}
              label="Phân trang khoản phạt"
            />
          </>
        )}
      </section>

      {payTarget && (
        <PaymentDialog
          ticket={payTarget}
          bank={data?.bank}
          busy={busyId === payTarget.id}
          onSubmit={onSubmitPayment}
          onClose={closePayment}
        />
      )}
    </main>
  )
}
