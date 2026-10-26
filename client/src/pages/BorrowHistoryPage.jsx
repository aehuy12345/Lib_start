import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { parseApiError } from '../api/client'
import { formatDate } from '../features/book/bookDetail'
import Pagination from '../features/book/Pagination'
import { cancelBorrowOrder, extendBorrowOrder, listMyOrders } from '../features/borrow/borrowApi'
import ReturnRequestDialog from '../features/return/ReturnRequestDialog'
import { cancelReturnRequest, createReturnRequest } from '../features/return/returnApi'
import {
  HISTORY_FILTERS, STATUS_LABELS, daysLeftLabel, groupOrders, nextHistoryParams, readHistoryParams,
} from '../features/borrow/borrowHistory'

const BUTTON_CLASS = 'rounded-md px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50'
const STATUS_CLASS = {
  pending: 'bg-amber-100 text-amber-800',
  borrowing: 'bg-blue-100 text-blue-800',
  overdue: 'bg-red-100 text-red-700',
  returned: 'bg-green-100 text-green-800',
  rejected: 'bg-slate-200 text-slate-700',
}

function StatusBadge({ status }) {
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CLASS[status]}`}>{STATUS_LABELS[status]}</span>
}

function BookCell({ book, withAuthor = true }) {
  return (
    <td className="px-4 py-2">
      <Link to={`/books/${book.id}`} className="font-medium text-blue-600 hover:underline">{book.title}</Link>
      {withAuthor && <div className="text-slate-600">{book.author}</div>}
    </td>
  )
}

// Cột theo PRD 2.3.3 cho từng nhóm.
const COLUMNS = {
  pending: ['Sách', 'Thời hạn', 'Ngày gửi', 'Trạng thái', 'Thao tác'],
  borrowing: ['Sách', 'Ngày mượn', 'Hạn trả', 'Số ngày còn lại', 'Trạng thái', 'Thao tác'],
  returned: ['Sách', 'Ngày mượn', 'Ngày trả', 'Trạng thái'],
  rejected: ['Sách', 'Lý do từ chối', 'Trạng thái'],
}

function OrderRow({ group, order, busyId, onExtend, onCancel, onRequestReturn, onCancelReturn }) {
  const busy = busyId === order.id
  const title = order.book.title
  const cells = {
    pending: (
      <>
        <BookCell book={order.book} />
        <td className="px-4 py-2 text-slate-700">{order.requestedDays} ngày</td>
        <td className="px-4 py-2 text-slate-700">{formatDate(order.createdAt)}</td>
        <td className="px-4 py-2"><StatusBadge status={order.status} /></td>
        <td className="px-4 py-2">
          <button
            type="button"
            onClick={() => onCancel(order)}
            disabled={busy}
            aria-label={`Hủy yêu cầu mượn ${title}`}
            className={`${BUTTON_CLASS} border border-slate-300 text-slate-700 hover:bg-slate-50`}
          >
            Hủy yêu cầu
          </button>
        </td>
      </>
    ),
    borrowing: (
      <>
        <BookCell book={order.book} />
        <td className="px-4 py-2 text-slate-700">{formatDate(order.borrowedAt)}</td>
        <td className="px-4 py-2 text-slate-700">
          {formatDate(order.dueDate)}
          {order.extensionCount > 0 && <div className="text-xs text-slate-500">Đã gia hạn</div>}
        </td>
        <td className={`px-4 py-2 ${order.daysLeft < 0 ? 'font-medium text-red-600' : 'text-slate-700'}`}>
          {daysLeftLabel(order.daysLeft)}
        </td>
        <td className="px-4 py-2"><StatusBadge status={order.status} /></td>
        <td className="px-4 py-2">
          <div className="flex flex-wrap items-center gap-2">
            {order.canExtend && (
              <button
                type="button"
                onClick={() => onExtend(order)}
                disabled={busy}
                aria-label={`Gia hạn ${title}`}
                className={`${BUTTON_CLASS} bg-blue-600 text-white hover:bg-blue-700`}
              >
                Gia hạn
              </button>
            )}
            {order.canRequestReturn && (
              <button
                type="button"
                onClick={() => onRequestReturn(order)}
                disabled={busy}
                aria-label={`Xin trả sách ${title}`}
                className={`${BUTTON_CLASS} border border-blue-600 text-blue-700 hover:bg-blue-50`}
              >
                Xin trả sách
              </button>
            )}
            {order.hasPendingReturn && (
              <>
                <span className="text-sm text-slate-600">Đang chờ xác nhận trả</span>
                <button
                  type="button"
                  onClick={() => onCancelReturn(order)}
                  disabled={busy}
                  aria-label={`Hủy yêu cầu trả ${title}`}
                  className={`${BUTTON_CLASS} border border-slate-300 text-slate-700 hover:bg-slate-50`}
                >
                  Hủy yêu cầu trả
                </button>
              </>
            )}
          </div>
        </td>
      </>
    ),
    returned: (
      <>
        <BookCell book={order.book} withAuthor={false} />
        <td className="px-4 py-2 text-slate-700">{formatDate(order.borrowedAt)}</td>
        <td className="px-4 py-2 text-slate-700">{formatDate(order.returnedAt)}</td>
        <td className="px-4 py-2"><StatusBadge status={order.status} /></td>
      </>
    ),
    rejected: (
      <>
        <BookCell book={order.book} />
        <td className="whitespace-pre-line break-words px-4 py-2 text-slate-700">{order.rejectReason}</td>
        <td className="px-4 py-2"><StatusBadge status={order.status} /></td>
      </>
    ),
  }
  return <tr aria-label={`Đơn ${title}`} className="border-t border-slate-200 align-top">{cells[group]}</tr>
}

// 2.3.3 Lịch sử mượn sách (độc giả). Bộ lọc và trang nằm trên URL như danh sách sách (2.2.3).
export default function BorrowHistoryPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { status, page } = readHistoryParams(searchParams)
  const [data, setData] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [notice, setNotice] = useState({ type: '', text: '' })
  const [busyId, setBusyId] = useState(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [returnTarget, setReturnTarget] = useState(null)

  useEffect(() => {
    let cancelled = false
    listMyOrders({ status, page })
      .then((result) => {
        if (cancelled) return
        setData(result)
        setLoadError('')
      })
      .catch((err) => !cancelled && setLoadError(parseApiError(err).message))
    return () => { cancelled = true }
  }, [status, page, reloadKey])

  const reload = useCallback(() => setReloadKey((k) => k + 1), [])
  const go = (changes) => {
    setNotice({ type: '', text: '' })
    setSearchParams(nextHistoryParams({ status, page, ...changes }))
  }

  const run = async (order, action, success) => {
    setNotice({ type: '', text: '' })
    setBusyId(order.id)
    try {
      const result = await action()
      setNotice({ type: 'success', text: success(result) })
    } catch (err) {
      // Lỗi nghiệp vụ (vd đã gia hạn, vừa quá hạn, đã có yêu cầu trả) → tải lại để thấy trạng thái mới.
      setNotice({ type: 'error', text: parseApiError(err).message })
    } finally {
      setBusyId(null)
      reload()
    }
  }

  const onExtend = (order) => run(order, () => extendBorrowOrder(order.id),
    ({ order: extended }) => `Đã gia hạn "${order.book.title}", hạn trả mới ${formatDate(extended.dueDate)}`)

  const onCancel = (order) => {
    if (!window.confirm(`Hủy yêu cầu mượn "${order.book.title}"?`)) return
    run(order, () => cancelBorrowOrder(order.id), () => `Đã hủy yêu cầu mượn "${order.book.title}"`)
  }

  const closeReturnDialog = useCallback(() => setReturnTarget(null), [])

  // 2.4.1: gửi xong (kể cả lỗi) thì đóng modal, thông báo hiện trên trang.
  const onConfirmReturn = async () => {
    const order = returnTarget
    await run(order, () => createReturnRequest(order.id), ({ message }) => message)
    setReturnTarget(null)
  }

  const onCancelReturn = (order) => {
    if (!window.confirm(`Hủy yêu cầu trả "${order.book.title}"?`)) return
    run(order, () => cancelReturnRequest(order.pendingReturnId), () => `Đã hủy yêu cầu trả "${order.book.title}"`)
  }

  const groups = groupOrders(data?.orders ?? [])

  return (
    <main className="min-h-screen bg-slate-50">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
        <h1 className="text-lg font-semibold text-slate-900">Lịch sử mượn sách</h1>
        <Link to="/reader" className="text-sm font-medium text-blue-600 hover:underline">Về dashboard</Link>
      </header>

      <section className="mx-auto max-w-5xl p-6">
        <nav aria-label="Lọc theo trạng thái" className="mb-4 flex flex-wrap gap-2">
          {HISTORY_FILTERS.map((f) => (
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

        {data && groups.length === 0 && (
          <div className="rounded-md border border-slate-200 bg-white p-6 text-center text-sm text-slate-600">
            {status === 'all' ? 'Bạn chưa có đơn mượn nào.' : 'Không có đơn nào ở trạng thái này.'}{' '}
            <Link to="/books" className="font-medium text-blue-600 hover:underline">Xem danh sách sách</Link>
          </div>
        )}

        {data && groups.length > 0 && (
          <>
            <p className="mb-2 text-sm text-slate-600">Tổng: {data.pagination.total} đơn</p>
            {groups.map((group) => (
              <section key={group.key} aria-labelledby={`group-${group.key}`} className="mb-6">
                <h2 id={`group-${group.key}`} className="mb-2 font-semibold text-slate-900">{group.title}</h2>
                <div className="overflow-x-auto rounded-md border border-slate-200 bg-white">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-slate-100 text-slate-700">
                      <tr>{COLUMNS[group.key].map((c) => <th key={c} className="px-4 py-2 font-medium">{c}</th>)}</tr>
                    </thead>
                    <tbody>
                      {group.orders.map((order) => (
                        <OrderRow
                          key={order.id}
                          group={group.key}
                          order={order}
                          busyId={busyId}
                          onExtend={onExtend}
                          onCancel={onCancel}
                          onRequestReturn={setReturnTarget}
                          onCancelReturn={onCancelReturn}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ))}
            <Pagination
              page={data.pagination.page}
              totalPages={data.pagination.totalPages}
              onPage={(p) => go({ page: p })}
              label="Phân trang lịch sử mượn"
            />
          </>
        )}
      </section>

      {returnTarget && (
        <ReturnRequestDialog
          order={returnTarget}
          busy={busyId === returnTarget.id}
          onConfirm={onConfirmReturn}
          onClose={closeReturnDialog}
        />
      )}
    </main>
  )
}
