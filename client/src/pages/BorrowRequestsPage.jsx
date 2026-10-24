import { Fragment, useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { parseApiError } from '../api/client'
import { useAuth } from '../features/auth/AuthContext'
import { dashboardPath } from '../features/auth/session'
import { formatDate } from '../features/book/bookDetail'
import Pagination from '../features/book/Pagination'
import { confirmBorrowOrder, listPendingOrders, rejectBorrowOrder } from '../features/borrow/borrowApi'
import { OUT_OF_STOCK_REASON, REJECT_REASON_MAX, validateRejectReason } from '../features/borrow/borrowRules'

const BUTTON_CLASS = 'rounded-md px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50'

function RejectForm({ order, initialReason, onRejected, onCancel }) {
  const [reason, setReason] = useState(initialReason)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const inputId = `reject-reason-${order.id}`

  const onSubmit = async (e) => {
    e.preventDefault()
    const invalid = validateRejectReason(reason)
    if (invalid) return setError(invalid)
    setBusy(true)
    try {
      await rejectBorrowOrder(order.id, reason.trim())
      onRejected(order)
    } catch (err) {
      const { message, errors } = parseApiError(err)
      if (err?.response?.status === 400) return setError(errors.reason ?? message)
      onRejected(order, message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form aria-label={`Từ chối đơn ${order.book.title}`} onSubmit={onSubmit} noValidate className="space-y-2">
      <label htmlFor={inputId} className="block text-sm font-medium text-slate-700">Lý do từ chối (bắt buộc)</label>
      <textarea
        id={inputId}
        autoFocus
        rows={2}
        value={reason}
        maxLength={REJECT_REASON_MAX + 20}
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

// 2.3.2 Duyệt đơn mượn (nhân viên thư viện, Admin).
export default function BorrowRequestsPage() {
  const { user } = useAuth()
  const [page, setPage] = useState(1)
  const [data, setData] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [notice, setNotice] = useState({ type: '', text: '' })
  // Đơn đang mở form từ chối, kèm lý do gợi ý (vd "Hết sách" khi kho về 0, edge 2).
  const [rejecting, setRejecting] = useState(null)
  const [confirmingId, setConfirmingId] = useState(null)

  const load = useCallback((target) => listPendingOrders(target)
    .then((result) => {
      setData(result)
      setPage(result.pagination.page)
      setLoadError('')
    })
    .catch((err) => setLoadError(parseApiError(err).message)), [])

  useEffect(() => {
    let cancelled = false
    listPendingOrders(1)
      .then((result) => !cancelled && setData(result))
      .catch((err) => !cancelled && setLoadError(parseApiError(err).message))
    return () => { cancelled = true }
  }, [])

  const showError = (text) => setNotice({ type: 'error', text })
  const showSuccess = (text) => setNotice({ type: 'success', text })

  const onConfirm = async (order) => {
    setNotice({ type: '', text: '' })
    setRejecting(null)
    setConfirmingId(order.id)
    try {
      const { order: confirmed } = await confirmBorrowOrder(order.id)
      showSuccess(`Đã xác nhận đơn mượn "${order.book.title}" của ${order.reader.name}, hạn trả ${formatDate(confirmed.dueDate)}`)
      load(page)
    } catch (err) {
      const { message } = parseApiError(err)
      const { status, data: body } = err?.response ?? {}
      showError(message)
      // Edge 1: đơn đã được người khác xử lý hoặc độc giả đã hủy → tải lại danh sách.
      if (status === 404 || body?.reason === 'already_processed') return load(page)
      // Không xác nhận được (hết sách, độc giả không đủ điều kiện): chỉ còn từ chối.
      if (status === 409) {
        setRejecting({ id: order.id, reason: body?.reason === 'out_of_stock' ? OUT_OF_STOCK_REASON : '' })
      }
    } finally {
      setConfirmingId(null)
    }
  }

  const onRejected = (order, error) => {
    setRejecting(null)
    if (error) showError(error)
    else showSuccess(`Đã từ chối đơn mượn "${order.book.title}" của ${order.reader.name}`)
    load(page)
  }

  const orders = data?.orders ?? []

  return (
    <main className="min-h-screen bg-slate-50">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
        <h1 className="text-lg font-semibold text-slate-900">Đơn mượn chờ xác nhận</h1>
        <Link to={dashboardPath(user.role)} className="text-sm font-medium text-blue-600 hover:underline">Về dashboard</Link>
      </header>

      <section className="mx-auto max-w-5xl p-6">
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

        {data && (
          <>
            <p className="mb-2 text-sm text-slate-600">Tổng: {data.pagination.total} đơn</p>
            <div className="overflow-x-auto rounded-md border border-slate-200 bg-white">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-100 text-slate-700">
                  <tr>
                    <th className="px-4 py-2 font-medium">Độc giả</th>
                    <th className="px-4 py-2 font-medium">Sách</th>
                    <th className="px-4 py-2 font-medium">Có sẵn</th>
                    <th className="px-4 py-2 font-medium">Thời hạn</th>
                    <th className="px-4 py-2 font-medium">Ngày gửi</th>
                    <th className="w-56 px-4 py-2 font-medium">Thao tác</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-6 text-center text-slate-600">Không có đơn mượn nào chờ xác nhận.</td>
                    </tr>
                  ) : orders.map((order) => {
                    const outOfStock = order.book.availableQuantity <= 0
                    const label = `${order.book.title} của ${order.reader.name}`
                    return (
                      <Fragment key={order.id}>
                        <tr aria-label={`Đơn ${label}`} className="border-t border-slate-200 align-top">
                          <td className="px-4 py-2">
                            <div className="font-medium text-slate-900">{order.reader.name}</div>
                            <div className="text-slate-600">{order.reader.email}</div>
                          </td>
                          <td className="px-4 py-2">
                            <Link to={`/books/${order.book.id}`} className="font-medium text-blue-600 hover:underline">{order.book.title}</Link>
                            <div className="text-slate-600">{order.book.author}</div>
                          </td>
                          <td className={`px-4 py-2 ${outOfStock ? 'font-medium text-red-600' : 'text-slate-700'}`}>
                            {outOfStock ? 'Hết sách' : order.book.availableQuantity}
                          </td>
                          <td className="px-4 py-2 text-slate-700">{order.requestedDays} ngày</td>
                          <td className="px-4 py-2 text-slate-700">{formatDate(order.createdAt)}</td>
                          <td className="px-4 py-2">
                            <div className="flex gap-2">
                              <button
                                type="button"
                                onClick={() => onConfirm(order)}
                                disabled={confirmingId === order.id}
                                aria-label={`Xác nhận đơn ${label}`}
                                className={`${BUTTON_CLASS} bg-blue-600 text-white hover:bg-blue-700`}
                              >
                                Xác nhận
                              </button>
                              <button
                                type="button"
                                onClick={() => { setNotice({ type: '', text: '' }); setRejecting({ id: order.id, reason: outOfStock ? OUT_OF_STOCK_REASON : '' }) }}
                                disabled={confirmingId === order.id}
                                aria-label={`Từ chối đơn ${label}`}
                                className={`${BUTTON_CLASS} border border-red-300 text-red-600 hover:bg-red-50`}
                              >
                                Từ chối
                              </button>
                            </div>
                          </td>
                        </tr>
                        {rejecting?.id === order.id && (
                          <tr className="bg-red-50/40">
                            <td colSpan={6} className="px-4 py-3">
                              <RejectForm
                                key={rejecting.reason}
                                order={order}
                                initialReason={rejecting.reason}
                                onRejected={onRejected}
                                onCancel={() => setRejecting(null)}
                              />
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
              onPage={(p) => { setRejecting(null); load(p) }}
              label="Phân trang đơn mượn"
            />
          </>
        )}
      </section>
    </main>
  )
}
