import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { parseApiError } from '../../api/client'
import { formatDate } from '../book/bookDetail'
import {
  getBookStats, getBorrowsToday, getOverdueReaders, getReaderStats, getTopBooks,
} from './dashboardApi'
import { formatCount, overdueRemainder, todayBreakdown } from './dashboardRules'

// Tải một thẻ; lỗi chỉ ảnh hưởng thẻ đó (flow 2.7.1).
function useSection(load) {
  const [state, setState] = useState({ status: 'loading' })
  const reload = useCallback(() => {
    let cancelled = false
    setState({ status: 'loading' })
    load()
      .then((data) => !cancelled && setState({ status: 'ready', data }))
      .catch((err) => !cancelled && setState({ status: 'error', message: parseApiError(err).message }))
    return () => { cancelled = true }
  }, [load])
  useEffect(() => reload(), [reload])
  return [state, reload]
}

function Card({ title, state, onRetry, className = '', children }) {
  return (
    <section aria-label={title} className={`rounded-lg border border-slate-200 bg-white p-4 ${className}`}>
      <h2 className="mb-3 text-sm font-semibold text-slate-700">{title}</h2>
      {state.status === 'loading' && <p className="text-sm text-slate-500">Đang tải...</p>}
      {state.status === 'error' && (
        <div role="alert" className="text-sm text-red-700">
          <p>{state.message}</p>
          <button type="button" onClick={onRetry} className="mt-2 font-medium text-blue-600 hover:underline">
            Thử lại
          </button>
        </div>
      )}
      {state.status === 'ready' && children(state.data)}
    </section>
  )
}

function Stat({ label, value, tone = 'text-slate-900' }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className={`text-2xl font-semibold ${tone}`}>{formatCount(value)}</dd>
    </div>
  )
}

export default function StaffDashboard() {
  const [books, reloadBooks] = useSection(getBookStats)
  const [readers, reloadReaders] = useSection(getReaderStats)
  const [today, reloadToday] = useSection(getBorrowsToday)
  const [topBooks, reloadTopBooks] = useSection(getTopBooks)
  const [overdue, reloadOverdue] = useSection(getOverdueReaders)

  return (
    <div className="grid gap-4 p-6 md:grid-cols-2 xl:grid-cols-3">
      <Card title="Tổng số sách" state={books} onRetry={reloadBooks}>
        {(data) => (
          <>
            <p className="mb-3 text-sm text-slate-600">
              {formatCount(data.titleCount)} đầu sách · {formatCount(data.totalQuantity)} cuốn
            </p>
            <dl className="grid grid-cols-2 gap-3">
              <Stat label="Có sẵn" value={data.available} tone="text-green-700" />
              <Stat label="Đang mượn" value={data.borrowed} tone="text-blue-700" />
              <Stat label="Bị mất" value={data.lost} tone="text-red-700" />
              <Stat label="Hư hỏng" value={data.damaged} tone="text-amber-700" />
            </dl>
          </>
        )}
      </Card>

      <Card title="Tổng số độc giả" state={readers} onRetry={reloadReaders}>
        {(data) => (
          <dl className="grid grid-cols-2 gap-3">
            <Stat label="Hoạt động" value={data.active} tone="text-green-700" />
            <Stat label="Vô hiệu hóa" value={data.disabled} tone="text-slate-600" />
          </dl>
        )}
      </Card>

      <Card title="Đơn mượn hôm nay" state={today} onRetry={reloadToday}>
        {(data) => (
          <>
            <dl><Stat label={`Ngày ${formatDate(data.date)}`} value={data.total} /></dl>
            {data.total > 0 && <p className="mt-2 text-sm text-slate-600">{todayBreakdown(data.byStatus)}</p>}
          </>
        )}
      </Card>

      <Card title="Top 5 sách phổ biến" state={topBooks} onRetry={reloadTopBooks}>
        {(data) => (data.books.length === 0 ? (
          <p className="text-sm text-slate-500">Chưa có sách nào được mượn.</p>
        ) : (
          <ol className="space-y-2 text-sm">
            {data.books.map((book, index) => (
              <li key={book.id} className="flex items-baseline justify-between gap-3">
                <span>
                  <span className="mr-2 text-slate-400">{index + 1}.</span>
                  {book.deleted ? (
                    <span className="text-slate-700">{book.title} <span className="text-xs text-slate-400">(đã xóa)</span></span>
                  ) : (
                    <Link to={`/books/${book.id}`} className="font-medium text-blue-600 hover:underline">{book.title}</Link>
                  )}
                  <span className="text-slate-500"> — {book.author}</span>
                </span>
                <span className="whitespace-nowrap text-slate-600">{formatCount(book.borrowCount)} lượt</span>
              </li>
            ))}
          </ol>
        ))}
      </Card>

      <Card title="Độc giả nợ quá hạn" state={overdue} onRetry={reloadOverdue} className="md:col-span-2">
        {(data) => (data.readers.length === 0 ? (
          <p className="text-sm text-slate-500">Không có độc giả nào quá hạn.</p>
        ) : (
          <>
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-slate-500">
                <tr>
                  <th className="py-1 pr-4 font-medium">Độc giả</th>
                  <th className="py-1 pr-4 font-medium">Sách quá hạn</th>
                  <th className="py-1 font-medium">Muộn nhất</th>
                </tr>
              </thead>
              <tbody>
                {data.readers.map((reader) => (
                  <tr key={reader.id} aria-label={`Độc giả quá hạn ${reader.email}`} className="border-t border-slate-100 align-top">
                    <td className="py-2 pr-4">
                      <p className="font-medium text-slate-900">{reader.name}</p>
                      <p className="text-xs text-slate-500">{reader.email}</p>
                    </td>
                    <td className="py-2 pr-4">
                      <ul>
                        {reader.books.map((book) => (
                          <li key={book.borrowOrderId}>
                            {book.title} <span className="text-xs text-slate-500">(hạn {formatDate(book.dueDate)}, muộn {book.lateDays} ngày)</span>
                          </li>
                        ))}
                      </ul>
                    </td>
                    <td className="py-2 font-medium text-red-700">{reader.maxLateDays} ngày</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {overdueRemainder(data) && <p className="mt-3 text-sm text-slate-600">{overdueRemainder(data)}</p>}
          </>
        ))}
      </Card>
    </div>
  )
}
