import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { parseApiError } from '../api/client'
import { useAuth } from '../features/auth/AuthContext'
import { dashboardPath } from '../features/auth/session'
import { formatDate } from '../features/book/bookDetail'
import Pagination from '../features/book/Pagination'
import { activateUser, disableUser, listUsers } from '../features/user/userApi'
import {
  ROLE_FILTERS, ROLE_LABELS, SEARCH_MAX, USER_STATUS_LABELS,
  disableBlockedHint, disableConfirmMessage, emptyMessage, nextUserListParams, readUserListParams,
} from '../features/user/userRules'

const BUTTON_CLASS = 'rounded-md px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50'
const STATUS_CLASS = {
  pending: 'bg-amber-100 text-amber-800',
  active: 'bg-green-100 text-green-800',
  disabled: 'bg-slate-200 text-slate-700',
}
const COLUMNS = ['Email', 'Tên', 'Vai trò', 'Ngày tham gia', 'Trạng thái', 'Thao tác']

// 2.6.1 Danh sách người dùng (Admin). Bộ lọc vai trò, tìm kiếm, trang nằm trên URL.
export default function UsersPage() {
  const { user: me } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const { role, q, page } = readUserListParams(searchParams)
  const [query, setQuery] = useState(q)
  const [data, setData] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [notice, setNotice] = useState({ type: '', text: '' })
  const [reloadKey, setReloadKey] = useState(0)
  const [busyId, setBusyId] = useState(null)

  useEffect(() => {
    let cancelled = false
    listUsers({ role, q, page })
      .then((result) => {
        if (cancelled) return
        setData(result)
        setLoadError('')
      })
      .catch((err) => !cancelled && setLoadError(parseApiError(err).message))
    return () => { cancelled = true }
  }, [role, q, page, reloadKey])

  const go = (changes) => {
    setNotice({ type: '', text: '' })
    setSearchParams(nextUserListParams({ role, q, page, ...changes }))
  }

  const onSearch = (e) => {
    e.preventDefault()
    go({ q: query.trim(), page: 1 })
  }

  const run = async (target, action) => {
    setNotice({ type: '', text: '' })
    setBusyId(target.id)
    try {
      const res = await action(target.id)
      setNotice({ type: 'success', text: `${res.message}: ${target.name} (${target.email}).` })
      setReloadKey((k) => k + 1)
    } catch (err) {
      setNotice({ type: 'error', text: parseApiError(err).message })
      // Người khác đã đổi trạng thái (409) hoặc tài khoản không còn (404) → tải lại danh sách.
      if (err?.response?.status === 404 || err?.response?.status === 409) setReloadKey((k) => k + 1)
    } finally {
      setBusyId(null)
    }
  }

  const onDisable = (target) => {
    if (!window.confirm(disableConfirmMessage(target))) return
    run(target, disableUser)
  }

  const users = data?.users ?? []

  return (
    <main className="min-h-screen bg-slate-50">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
        <h1 className="text-lg font-semibold text-slate-900">Người dùng</h1>
        <Link to={dashboardPath(me.role)} className="text-sm font-medium text-blue-600 hover:underline">Về dashboard</Link>
      </header>

      <section className="mx-auto max-w-6xl p-6">
        <nav aria-label="Lọc theo vai trò" className="mb-4 flex flex-wrap gap-2">
          {ROLE_FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              aria-pressed={role === f.value}
              onClick={() => go({ role: f.value, page: 1 })}
              className={`${BUTTON_CLASS} border ${role === f.value ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}`}
            >
              {f.label}
            </button>
          ))}
        </nav>

        <form role="search" onSubmit={onSearch} className="mb-4 flex gap-2">
          <input
            type="search"
            aria-label="Tìm người dùng"
            placeholder="Email hoặc tên"
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

        {data && users.length === 0 && (
          <div className="rounded-md border border-slate-200 bg-white p-6 text-center text-sm text-slate-600">
            {emptyMessage(role, q)}
          </div>
        )}

        {data && users.length > 0 && (
          <>
            <p className="mb-2 text-sm text-slate-600">Tổng: {data.pagination.total} người dùng</p>
            <div className="overflow-x-auto rounded-md border border-slate-200 bg-white">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-100 text-slate-700">
                  <tr>{COLUMNS.map((c) => <th key={c} className="px-4 py-2 font-medium">{c}</th>)}</tr>
                </thead>
                <tbody>
                  {users.map((u) => {
                    const hint = disableBlockedHint(u)
                    return (
                      <tr key={u.id} aria-label={`Người dùng ${u.email}`} className="border-t border-slate-200 align-top">
                        <td className="break-all px-4 py-2 text-slate-900">{u.email}</td>
                        <td className="px-4 py-2">
                          <div className="font-medium text-slate-900">{u.name}{u.isSelf && ' (bạn)'}</div>
                          {u.activeBorrowCount > 0 && (
                            <div className="text-slate-600">Đang mượn {u.activeBorrowCount} cuốn</div>
                          )}
                        </td>
                        <td className="px-4 py-2 text-slate-700">{ROLE_LABELS[u.role]}</td>
                        <td className="px-4 py-2 text-slate-700">{formatDate(u.createdAt)}</td>
                        <td className="px-4 py-2">
                          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CLASS[u.status]}`}>
                            {USER_STATUS_LABELS[u.status]}
                          </span>
                        </td>
                        <td className="px-4 py-2">
                          <div className="flex flex-wrap items-center gap-2">
                            {u.canActivate && (
                              <button
                                type="button"
                                onClick={() => run(u, activateUser)}
                                disabled={busyId === u.id}
                                aria-label={`Kích hoạt ${u.email}`}
                                className={`${BUTTON_CLASS} bg-green-600 text-white hover:bg-green-700`}
                              >
                                Kích hoạt
                              </button>
                            )}
                            {u.canDisable && (
                              <button
                                type="button"
                                onClick={() => onDisable(u)}
                                disabled={busyId === u.id}
                                aria-label={`Vô hiệu hóa ${u.email}`}
                                className={`${BUTTON_CLASS} border border-red-300 text-red-600 hover:bg-red-50`}
                              >
                                Vô hiệu hóa
                              </button>
                            )}
                            {hint && <span className="text-xs text-slate-500">{hint}</span>}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <Pagination
              page={data.pagination.page}
              totalPages={data.pagination.totalPages}
              onPage={(p) => go({ page: p })}
              label="Phân trang người dùng"
            />
          </>
        )}
      </section>
    </main>
  )
}
