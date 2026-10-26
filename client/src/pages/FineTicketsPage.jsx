import { Fragment, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { parseApiError } from '../api/client'
import { useAuth } from '../features/auth/AuthContext'
import { dashboardPath } from '../features/auth/session'
import { formatDate } from '../features/book/bookDetail'
import Pagination from '../features/book/Pagination'
import { REJECT_REASON_MAX, validateRejectReason } from '../features/borrow/borrowRules'
import { confirmFineTicket, getFineReceiptUrl, listFineTickets, rejectFineTicket } from '../features/fine/fineTicketApi'
import {
  SEARCH_MAX, STAFF_TICKET_FILTERS, nextStaffTicketParams, readStaffTicketParams, reviewNotice, staffEmptyMessage,
} from '../features/fine/fineReviewRules'
import { TICKET_STATUS_LABELS } from '../features/fine/fineTicketRules'
import { FINE_TYPE_LABELS, formatAmount } from '../features/return/returnRules'

const BUTTON_CLASS = 'rounded-md px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50'
const STATUS_CLASS = {
  unpaid: 'bg-red-100 text-red-700',
  pending: 'bg-amber-100 text-amber-800',
  paid: 'bg-green-100 text-green-800',
  rejected: 'bg-slate-200 text-slate-700',
}
const COLUMNS = ['Mã', 'Độc giả', 'Nguyên nhân phạt', 'Số tiền', 'Ngày phạt', 'Trạng thái', 'Thao tác']

function RejectForm({ ticket, onDone, onError, onCancel }) {
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const inputId = `reject-fine-${ticket.id}`

  const onSubmit = async (e) => {
    e.preventDefault()
    const invalid = validateRejectReason(reason)
    if (invalid) return setError(invalid)
    setBusy(true)
    try {
      onDone(await rejectFineTicket(ticket.id, reason.trim()))
    } catch (err) {
      const { message, errors } = parseApiError(err)
      if (err?.response?.status === 400) setError(errors.reason ?? message)
      else onError(err, message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form aria-label={`Từ chối phiếu ${ticket.id}`} onSubmit={onSubmit} noValidate className="mt-3 space-y-2">
      <label htmlFor={inputId} className="block text-sm font-medium text-slate-700">Lý do từ chối (bắt buộc)</label>
      <textarea
        id={inputId}
        autoFocus
        rows={2}
        value={reason}
        maxLength={REJECT_REASON_MAX + 20}
        placeholder="Ví dụ: Chưa nhận được tiền, chuyển thiếu 10.000 đ"
        onChange={(e) => { setReason(e.target.value); setError('') }}
        aria-invalid={error ? 'true' : 'false'}
        aria-describedby={error ? `${inputId}-error` : undefined}
        className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 aria-[invalid=true]:border-red-500"
      />
      {error && <p id={`${inputId}-error`} className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className={`${BUTTON_CLASS} bg-red-600 text-white hover:bg-red-700`}>Xác nhận từ chối</button>
        <button type="button" onClick={onCancel} disabled={busy} className={`${BUTTON_CLASS} border border-slate-300 text-slate-700 hover:bg-slate-50`}>Hủy</button>
      </div>
    </form>
  )
}

function DetailItem({ label, children }) {
  return (
    <div>
      <dt className="text-slate-500">{label}</dt>
      <dd className="whitespace-pre-line break-words text-slate-900">{children}</dd>
    </div>
  )
}

// Bước 2: chi tiết để đối chiếu sao kê ngân hàng (nội dung chuyển khoản chứa mã phiếu, 2.5.2 edge 5).
function TicketDetail({ ticket, busy, rejecting, onConfirm, onStartReject, onViewReceipt, children }) {
  return (
    <div aria-label={`Chi tiết phiếu ${ticket.id}`} className="text-sm">
      <dl className="grid gap-3 sm:grid-cols-3">
        <DetailItem label="Độc giả">{ticket.reader.name} ({ticket.reader.email})</DetailItem>
        <DetailItem label="Đơn mượn">#{ticket.borrowOrderId}</DetailItem>
        <DetailItem label="Sách">
          <Link to={`/books/${ticket.book.id}`} className="text-blue-600 hover:underline">{ticket.book.title}</Link>
        </DetailItem>
        <DetailItem label="Nguyên nhân">{FINE_TYPE_LABELS[ticket.type]}: {ticket.tierName}</DetailItem>
        <DetailItem label="Số tiền">{formatAmount(ticket.amount)}</DetailItem>
        <DetailItem label="Ngày phạt">{formatDate(ticket.issuedAt)}</DetailItem>
        <DetailItem label="Ghi chú">{ticket.note || '—'}</DetailItem>
        <DetailItem label="Nội dung chuyển khoản">{ticket.transferContent}</DetailItem>
        <DetailItem label="Ngày gửi thanh toán">{ticket.submittedAt ? formatDate(ticket.submittedAt) : '—'}</DetailItem>
        {ticket.rejectReason && <DetailItem label="Lý do từ chối">{ticket.rejectReason}</DetailItem>}
        {ticket.status === 'paid' && (
          <DetailItem label="Xác nhận">
            {formatDate(ticket.confirmedAt)}{ticket.confirmedByName ? ` bởi ${ticket.confirmedByName}` : ''}
          </DetailItem>
        )}
      </dl>
      <div className="mt-3 flex flex-wrap gap-2">
        {ticket.hasReceipt ? (
          <button
            type="button"
            onClick={onViewReceipt}
            disabled={busy}
            aria-label={`Xem biên lai phiếu ${ticket.id}`}
            className={`${BUTTON_CLASS} border border-slate-300 text-slate-700 hover:bg-slate-50`}
          >
            Xem biên lai
          </button>
        ) : (
          ticket.status === 'pending' && <span className="self-center text-slate-600">Độc giả không đính kèm biên lai.</span>
        )}
        {ticket.canReview && !rejecting && (
          <>
            <button
              type="button"
              onClick={onConfirm}
              disabled={busy}
              aria-label={`Đã thanh toán phiếu ${ticket.id}`}
              className={`${BUTTON_CLASS} bg-green-600 text-white hover:bg-green-700`}
            >
              Đã thanh toán
            </button>
            <button
              type="button"
              onClick={onStartReject}
              disabled={busy}
              aria-label={`Từ chối phiếu ${ticket.id}`}
              className={`${BUTTON_CLASS} border border-red-300 text-red-600 hover:bg-red-50`}
            >
              Từ chối
            </button>
          </>
        )}
        {ticket.status === 'unpaid' && (
          <span className="self-center text-slate-600">Độc giả chưa gửi thanh toán, chỉ theo dõi.</span>
        )}
      </div>
      {children}
    </div>
  )
}

// 2.5.3 Xác nhận thanh toán khoản phạt (nhân viên thư viện, Admin). Bộ lọc, tìm kiếm, trang nằm trên URL.
export default function FineTicketsPage() {
  const { user } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const { status, q, page } = readStaffTicketParams(searchParams)
  const [query, setQuery] = useState(q)
  const [data, setData] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [notice, setNotice] = useState({ type: '', text: '' })
  const [reloadKey, setReloadKey] = useState(0)
  // Phiếu đang mở chi tiết: { id, rejecting }.
  const [open, setOpen] = useState(null)
  const [busyId, setBusyId] = useState(null)

  useEffect(() => {
    let cancelled = false
    listFineTickets({ status, q, page })
      .then((result) => {
        if (cancelled) return
        setData(result)
        setLoadError('')
      })
      .catch((err) => !cancelled && setLoadError(parseApiError(err).message))
    return () => { cancelled = true }
  }, [status, q, page, reloadKey])

  const go = (changes) => {
    setNotice({ type: '', text: '' })
    setOpen(null)
    setSearchParams(nextStaffTicketParams({ status, q, page, ...changes }))
  }

  const onSearch = (e) => {
    e.preventDefault()
    go({ q: query.trim(), page: 1 })
  }

  const reload = () => {
    setOpen(null)
    setReloadKey((k) => k + 1)
  }

  const onDone = (ticket) => (res) => {
    setNotice({ type: 'success', text: reviewNotice(ticket, res) })
    reload()
  }

  // Edge 1: người khác đã xử lý (409) hoặc phiếu không còn (404) → tải lại danh sách.
  const onError = (err, message) => {
    setNotice({ type: 'error', text: message })
    if (err?.response?.status === 404 || err?.response?.status === 409) reload()
  }

  // Edge 7: Đã thanh toán là trạng thái cuối nên hỏi lại trước khi xác nhận.
  const onConfirm = async (ticket) => {
    if (!window.confirm(`Xác nhận đã nhận đủ ${formatAmount(ticket.amount)} cho phiếu #${ticket.id}? Không thể hoàn tác.`)) return
    setNotice({ type: '', text: '' })
    setBusyId(ticket.id)
    try {
      onDone(ticket)(await confirmFineTicket(ticket.id))
    } catch (err) {
      onError(err, parseApiError(err).message)
    } finally {
      setBusyId(null)
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
        <h1 className="text-lg font-semibold text-slate-900">Quản lý phạt</h1>
        <Link to={dashboardPath(user.role)} className="text-sm font-medium text-blue-600 hover:underline">Về dashboard</Link>
      </header>

      <section className="mx-auto max-w-6xl p-6">
        {data && (
          <p aria-label="Tổng quan phiếu chờ xác nhận" className="mb-4 rounded-md border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
            {data.summary.pendingCount > 0 ? (
              <>
                Chờ xác nhận: <span className="font-semibold text-amber-800">{data.summary.pendingCount} phiếu</span>,
                tổng {formatAmount(data.summary.pendingAmount)}. Đối chiếu sao kê ngân hàng theo nội dung chuyển khoản trước khi xác nhận.
              </>
            ) : (
              'Không có phiếu phạt nào chờ xác nhận.'
            )}
          </p>
        )}

        <nav aria-label="Lọc theo trạng thái" className="mb-4 flex flex-wrap gap-2">
          {STAFF_TICKET_FILTERS.map((f) => (
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

        <form role="search" onSubmit={onSearch} className="mb-4 flex gap-2">
          <input
            type="search"
            aria-label="Tìm phiếu phạt"
            placeholder="Tên, email độc giả, tên sách hoặc mã phiếu"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            maxLength={SEARCH_MAX}
            className="w-full max-w-md rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <button type="submit" className={`${BUTTON_CLASS} bg-blue-600 text-white hover:bg-blue-700`}>Tìm</button>
        </form>

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
            {staffEmptyMessage(status, q)}
          </div>
        )}

        {data && tickets.length > 0 && (
          <>
            <p className="mb-2 text-sm text-slate-600">Tổng: {data.pagination.total} phiếu</p>
            <div className="overflow-x-auto rounded-md border border-slate-200 bg-white">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-100 text-slate-700">
                  <tr>{COLUMNS.map((c) => <th key={c} className="px-4 py-2 font-medium">{c}</th>)}</tr>
                </thead>
                <tbody>
                  {tickets.map((ticket) => {
                    const isOpen = open?.id === ticket.id
                    return (
                      <Fragment key={ticket.id}>
                        <tr aria-label={`Phiếu phạt ${ticket.id}`} className="border-t border-slate-200 align-top">
                          <td className="px-4 py-2 text-slate-700">#{ticket.id}</td>
                          <td className="px-4 py-2">
                            <div className="font-medium text-slate-900">{ticket.reader.name}</div>
                            <div className="text-slate-600">{ticket.reader.email}</div>
                          </td>
                          <td className="px-4 py-2">
                            <div className="font-medium text-slate-900">{FINE_TYPE_LABELS[ticket.type]}: {ticket.tierName}</div>
                            <div className="text-slate-600">Sách: {ticket.book.title}</div>
                          </td>
                          <td className="whitespace-nowrap px-4 py-2 font-medium text-slate-900">{formatAmount(ticket.amount)}</td>
                          <td className="px-4 py-2 text-slate-700">{formatDate(ticket.issuedAt)}</td>
                          <td className="px-4 py-2">
                            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CLASS[ticket.status]}`}>
                              {TICKET_STATUS_LABELS[ticket.status]}
                            </span>
                            {ticket.status === 'pending' && ticket.submittedAt && (
                              <div className="mt-1 text-xs text-slate-500">Gửi ngày {formatDate(ticket.submittedAt)}</div>
                            )}
                          </td>
                          <td className="px-4 py-2">
                            <button
                              type="button"
                              aria-expanded={isOpen}
                              aria-label={`${isOpen ? 'Đóng' : 'Xem'} chi tiết phiếu ${ticket.id}`}
                              onClick={() => { setNotice({ type: '', text: '' }); setOpen(isOpen ? null : { id: ticket.id, rejecting: false }) }}
                              className={`${BUTTON_CLASS} border border-slate-300 text-slate-700 hover:bg-slate-50`}
                            >
                              {isOpen ? 'Đóng' : 'Chi tiết'}
                            </button>
                          </td>
                        </tr>
                        {isOpen && (
                          <tr className="bg-blue-50/40">
                            <td colSpan={COLUMNS.length} className="px-4 py-3">
                              <TicketDetail
                                ticket={ticket}
                                busy={busyId === ticket.id}
                                rejecting={open.rejecting}
                                onConfirm={() => onConfirm(ticket)}
                                onStartReject={() => setOpen({ id: ticket.id, rejecting: true })}
                                onViewReceipt={() => onViewReceipt(ticket)}
                              >
                                {open.rejecting && (
                                  <RejectForm
                                    ticket={ticket}
                                    onDone={onDone(ticket)}
                                    onError={onError}
                                    onCancel={() => setOpen({ id: ticket.id, rejecting: false })}
                                  />
                                )}
                              </TicketDetail>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <Pagination
              page={data.pagination.page}
              totalPages={data.pagination.totalPages}
              onPage={(p) => go({ page: p })}
              label="Phân trang phiếu phạt"
            />
          </>
        )}
      </section>
    </main>
  )
}
