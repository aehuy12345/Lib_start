import { Fragment, useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { parseApiError } from '../api/client'
import { useAuth } from '../features/auth/AuthContext'
import { dashboardPath } from '../features/auth/session'
import { formatDate } from '../features/book/bookDetail'
import Pagination from '../features/book/Pagination'
import { REJECT_REASON_MAX, validateRejectReason } from '../features/borrow/borrowRules'
import ReturnConfirmForm from '../features/return/ReturnConfirmForm'
import {
  confirmReturnRequest, counterReturn, listCounterOrders, listFineTierOptions, listPendingReturns, rejectReturnRequest,
} from '../features/return/returnApi'

const BUTTON_CLASS = 'rounded-md px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50'
const TABS = [
  { value: 'pending', label: 'Chờ xác nhận trả' },
  // README điểm 10: độc giả mang sách đến mà chưa gửi yêu cầu.
  { value: 'counter', label: 'Trả tại quầy' },
]
const EMPTY_TIERS = { late: [], damaged: [], lost: [] }

function RejectForm({ item, onDone, onError, onCancel }) {
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const inputId = `reject-return-${item.key}`

  const onSubmit = async (e) => {
    e.preventDefault()
    const invalid = validateRejectReason(reason)
    if (invalid) return setError(invalid)
    setBusy(true)
    try {
      onDone(await rejectReturnRequest(item.id, reason.trim()))
    } catch (err) {
      const { message, errors } = parseApiError(err)
      if (err?.response?.status === 400) setError(errors.reason ?? message)
      else onError(err, message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form aria-label={`Từ chối yêu cầu trả ${item.book.title}`} onSubmit={onSubmit} noValidate className="space-y-2">
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

function DueCell({ item }) {
  return (
    <td className="px-4 py-2 text-slate-700">
      {formatDate(item.dueDate)}
      {item.lateDays > 0 && <div className="font-medium text-red-600">Quá hạn {item.lateDays} ngày</div>}
    </td>
  )
}

// 2.4.2 Xác nhận trả sách (nhân viên thư viện, Admin): tab Chờ xác nhận trả và Trả tại quầy.
export default function ReturnRequestsPage() {
  const { user } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const tab = searchParams.get('tab') === 'counter' ? 'counter' : 'pending'
  const [page, setPage] = useState(1)
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState('')
  const [data, setData] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [tiers, setTiers] = useState(null)
  const [notice, setNotice] = useState({ type: '', text: '' })
  // Dòng đang mở form: { key, mode: 'confirm' | 'reject' }.
  const [open, setOpen] = useState(null)

  const fetchList = useCallback((target, q) => (tab === 'counter'
    ? listCounterOrders({ q, page: target }).then((r) => ({
      items: r.orders.map((o) => ({ ...o, key: `o${o.id}` })), pagination: r.pagination,
    }))
    : listPendingReturns(target).then((r) => ({
      items: r.returnRequests.map((rr) => ({ ...rr, key: `r${rr.id}` })), pagination: r.pagination,
    }))), [tab])

  const load = useCallback((target, q = search) => fetchList(target, q)
    .then((result) => {
      setData(result)
      setPage(result.pagination.page)
      setLoadError('')
    })
    .catch((err) => setLoadError(parseApiError(err).message)), [fetchList, search])

  useEffect(() => {
    let cancelled = false
    fetchList(1, '')
      .then((result) => { if (!cancelled) { setData(result); setPage(1); setLoadError('') } })
      .catch((err) => !cancelled && setLoadError(parseApiError(err).message))
    return () => { cancelled = true }
  }, [fetchList])

  useEffect(() => {
    let cancelled = false
    listFineTierOptions()
      .then((result) => !cancelled && setTiers(result))
      // Không tải được mức phạt: vẫn xác nhận được trả đúng hạn, bình thường (như edge 4).
      .catch(() => !cancelled && setTiers(EMPTY_TIERS))
    return () => { cancelled = true }
  }, [])

  const switchTab = (value) => {
    if (value === tab) return
    setData(null)
    setOpen(null)
    setNotice({ type: '', text: '' })
    setQuery('')
    setSearch('')
    setSearchParams(value === 'counter' ? { tab: 'counter' } : {})
  }

  const onSearch = (e) => {
    e.preventDefault()
    setOpen(null)
    setSearch(query.trim())
    load(1, query.trim())
  }

  const onDone = (item) => (res) => {
    setOpen(null)
    setNotice({ type: 'success', text: `${res.message}: "${item.book.title}" của ${item.reader.name}` })
    load(page)
  }

  const onError = (err, message) => {
    setNotice({ type: 'error', text: message })
    // Edge 1: đã được nhân viên khác xử lý, độc giả đã hủy hoặc đơn đã trả → tải lại danh sách.
    if (err?.response?.status === 404 || err?.response?.status === 409) {
      setOpen(null)
      load(page)
    }
  }

  const items = data?.items ?? []
  const counter = tab === 'counter'
  const columns = counter ? 5 : 6

  return (
    <main className="min-h-screen bg-slate-50">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
        <h1 className="text-lg font-semibold text-slate-900">Quản lý trả sách</h1>
        <Link to={dashboardPath(user.role)} className="text-sm font-medium text-blue-600 hover:underline">Về dashboard</Link>
      </header>

      <section className="mx-auto max-w-5xl p-6">
        <div role="tablist" aria-label="Quản lý trả sách" className="mb-4 flex gap-2 border-b border-slate-200">
          {TABS.map((t) => (
            <button
              key={t.value}
              type="button"
              role="tab"
              aria-selected={tab === t.value}
              onClick={() => switchTab(t.value)}
              className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${tab === t.value ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-600 hover:text-slate-900'}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {notice.text && (
          <p
            role={notice.type === 'error' ? 'alert' : 'status'}
            className={`mb-4 rounded-md px-3 py-2 text-sm ${notice.type === 'error' ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}
          >
            {notice.text}
          </p>
        )}

        {counter && (
          <form role="search" onSubmit={onSearch} className="mb-4 flex gap-2">
            <input
              type="search"
              aria-label="Tìm đơn đang mượn"
              placeholder="Tên, email độc giả hoặc tên sách"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              maxLength={100}
              className="w-full max-w-md rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <button type="submit" className={`${BUTTON_CLASS} bg-blue-600 text-white hover:bg-blue-700`}>Tìm</button>
          </form>
        )}

        {loadError && <p role="alert" className="text-sm text-red-600">{loadError}</p>}
        {!data && !loadError && <p className="text-sm text-slate-600">Đang tải...</p>}

        {data && (
          <>
            <p className="mb-2 text-sm text-slate-600">
              Tổng: {data.pagination.total} {counter ? 'đơn đang mượn' : 'yêu cầu'}
            </p>
            <div className="overflow-x-auto rounded-md border border-slate-200 bg-white">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-100 text-slate-700">
                  <tr>
                    <th className="px-4 py-2 font-medium">Độc giả</th>
                    <th className="px-4 py-2 font-medium">Sách</th>
                    <th className="px-4 py-2 font-medium">Ngày mượn</th>
                    <th className="px-4 py-2 font-medium">Hạn trả</th>
                    {!counter && <th className="px-4 py-2 font-medium">Ngày gửi yêu cầu</th>}
                    <th className="w-56 px-4 py-2 font-medium">Thao tác</th>
                  </tr>
                </thead>
                <tbody>
                  {items.length === 0 ? (
                    <tr>
                      <td colSpan={columns} className="px-4 py-6 text-center text-slate-600">
                        {counter ? 'Không có đơn đang mượn nào phù hợp.' : 'Không có yêu cầu trả nào chờ xác nhận.'}
                      </td>
                    </tr>
                  ) : items.map((item) => {
                    const label = `${item.book.title} của ${item.reader.name}`
                    const isOpen = open?.key === item.key
                    return (
                      <Fragment key={item.key}>
                        <tr aria-label={`${counter ? 'Đơn' : 'Yêu cầu trả'} ${label}`} className="border-t border-slate-200 align-top">
                          <td className="px-4 py-2">
                            <div className="font-medium text-slate-900">{item.reader.name}</div>
                            <div className="text-slate-600">{item.reader.email}</div>
                          </td>
                          <td className="px-4 py-2">
                            <Link to={`/books/${item.book.id}`} className="font-medium text-blue-600 hover:underline">{item.book.title}</Link>
                            <div className="text-slate-600">{item.book.author}</div>
                          </td>
                          <td className="px-4 py-2 text-slate-700">{formatDate(item.borrowedAt)}</td>
                          <DueCell item={item} />
                          {!counter && <td className="px-4 py-2 text-slate-700">{formatDate(item.createdAt)}</td>}
                          <td className="px-4 py-2">
                            <div className="flex gap-2">
                              <button
                                type="button"
                                onClick={() => { setNotice({ type: '', text: '' }); setOpen({ key: item.key, mode: 'confirm' }) }}
                                disabled={!tiers}
                                aria-label={`${counter ? 'Nhận trả' : 'Xác nhận trả'} ${label}`}
                                className={`${BUTTON_CLASS} bg-blue-600 text-white hover:bg-blue-700`}
                              >
                                {counter ? 'Nhận trả' : 'Xác nhận trả'}
                              </button>
                              {!counter && (
                                <button
                                  type="button"
                                  onClick={() => { setNotice({ type: '', text: '' }); setOpen({ key: item.key, mode: 'reject' }) }}
                                  aria-label={`Từ chối yêu cầu trả ${label}`}
                                  className={`${BUTTON_CLASS} border border-red-300 text-red-600 hover:bg-red-50`}
                                >
                                  Từ chối
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                        {isOpen && (
                          <tr className={open.mode === 'reject' ? 'bg-red-50/40' : 'bg-blue-50/40'}>
                            <td colSpan={columns} className="px-4 py-3">
                              {open.mode === 'reject' ? (
                                <RejectForm item={item} onDone={onDone(item)} onError={onError} onCancel={() => setOpen(null)} />
                              ) : (
                                <ReturnConfirmForm
                                  item={item}
                                  tiers={tiers}
                                  submit={(payload) => (counter ? counterReturn(item.id, payload) : confirmReturnRequest(item.id, payload))}
                                  onDone={onDone(item)}
                                  onError={onError}
                                  onCancel={() => setOpen(null)}
                                />
                              )}
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
              onPage={(p) => { setOpen(null); load(p) }}
              label={counter ? 'Phân trang đơn đang mượn' : 'Phân trang yêu cầu trả'}
            />
          </>
        )}
      </section>
    </main>
  )
}
