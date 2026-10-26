import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { parseApiError } from '../api/client'
import { useAuth } from '../features/auth/AuthContext'
import { dashboardPath } from '../features/auth/session'
import { formatDate } from '../features/book/bookDetail'
import Pagination from '../features/book/Pagination'
import ReportChart from '../features/report/ReportChart'
import { downloadReportCsv, getReport } from '../features/report/reportApi'
import {
  CONDITION_LABELS, FINE_TYPE_LABELS, businessToday, GROUP_BY, PERIODS, REPORT_TYPES,
  csvFileName, formatMoney, formatNumber, nextReportParams, periodLabel, periodRange, rangeError, readReportParams, reportQuery,
} from '../features/report/reportRules'

const BUTTON_CLASS = 'rounded-md px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50'
const INPUT_CLASS = 'rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500'
const TH = 'px-3 py-2 font-medium'
const TD = 'px-3 py-2'

function Stat({ label, value, tone = 'text-slate-900' }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className={`text-2xl font-semibold ${tone}`}>{value}</dd>
    </div>
  )
}

function Table({ label, columns, children }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table aria-label={label} className="w-full text-left text-sm">
        <thead className="bg-slate-50 text-xs text-slate-500">
          <tr>{columns.map((c) => <th key={c} className={TH}>{c}</th>)}</tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

function BooksReport({ data }) {
  const s = data.summary
  return (
    <>
      <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Đầu sách / tổng số bản" value={`${formatNumber(s.titleCount)} / ${formatNumber(s.totalQuantity)}`} />
        <Stat label="Có sẵn · Đang mượn · Hư hỏng (hiện tại)" value={`${formatNumber(s.available)} · ${formatNumber(s.borrowed)} · ${formatNumber(s.damaged)}`} />
        <Stat label="Lượt mượn trong kỳ" value={formatNumber(s.borrowsInRange)} tone="text-blue-700" />
        <Stat label="Mất · Hư hỏng trong kỳ" value={`${formatNumber(s.lostInRange)} · ${formatNumber(s.damagedInRange)}`} tone="text-red-700" />
      </dl>
      {data.chart.length > 0 && (
        <ReportChart label="Sách được mượn nhiều nhất trong kỳ" data={data.chart} xKey="title" horizontal
          bars={[{ key: 'borrows', name: 'Lượt mượn', color: '#2563eb' }]} />
      )}
      <Table label="Báo cáo sách" columns={['Sách', 'Thể loại', 'Tổng', 'Có sẵn', 'Đang mượn', 'Hư hỏng', 'Lượt mượn trong kỳ', 'Mất / hư trong kỳ']}>
        {data.rows.map((b) => (
          <tr key={b.id} className="border-t border-slate-100">
            <td className={TD}>
              <Link to={`/books/${b.id}`} className="font-medium text-blue-600 hover:underline">{b.title}</Link>
              <p className="text-xs text-slate-500">{b.author}{b.isbn && ` · ISBN ${b.isbn}`}</p>
            </td>
            <td className={TD}>{b.category}</td>
            <td className={TD}>{b.totalQuantity}</td>
            <td className={TD}>{b.available}</td>
            <td className={TD}>{b.borrowed}</td>
            <td className={TD}>{b.damaged}</td>
            <td className={`${TD} font-medium`}>{b.borrowsInRange}</td>
            <td className={TD}>{b.lostInRange} / {b.damagedInRange}</td>
          </tr>
        ))}
      </Table>
    </>
  )
}

function BorrowsReport({ data }) {
  const rows = data.rows.map((r) => ({ ...r, label: periodLabel(r.period, data.groupBy) }))
  return (
    <>
      <dl className="grid grid-cols-2 gap-3">
        <Stat label="Lượt mượn" value={formatNumber(data.summary.borrowed)} tone="text-blue-700" />
        <Stat label="Lượt trả" value={formatNumber(data.summary.returned)} tone="text-green-700" />
      </dl>
      <ReportChart label="Lượt mượn và trả" data={rows} xKey="label" bars={[
        { key: 'borrowed', name: 'Lượt mượn', color: '#2563eb' },
        { key: 'returned', name: 'Lượt trả', color: '#16a34a' },
      ]} />
      <Table label="Báo cáo mượn trả" columns={['Thời gian', 'Lượt mượn', 'Lượt trả']}>
        {rows.map((r) => (
          <tr key={r.period} className="border-t border-slate-100">
            <td className={TD}>{r.label}</td>
            <td className={TD}>{r.borrowed}</td>
            <td className={TD}>{r.returned}</td>
          </tr>
        ))}
      </Table>
    </>
  )
}

function FinesReport({ data, onPage }) {
  const s = data.summary
  const byType = data.byType.map((t) => ({ ...t, label: FINE_TYPE_LABELS[t.type] }))
  return (
    <>
      <dl className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Stat label={`Phát sinh (${formatNumber(s.issuedCount)} phiếu)`} value={formatMoney(s.issuedAmount)} />
        <Stat label={`Doanh thu phạt đã thu (${formatNumber(s.collectedCount)} phiếu)`} value={formatMoney(s.collectedAmount)} tone="text-green-700" />
        <Stat label={`Chưa thu (${formatNumber(s.outstandingCount)} phiếu)`} value={formatMoney(s.outstandingAmount)} tone="text-red-700" />
      </dl>
      <ReportChart label="Tiền phạt theo loại" data={byType} xKey="label" format={formatMoney} bars={[
        { key: 'collectedAmount', name: 'Đã thu', color: '#16a34a' },
        { key: 'outstandingAmount', name: 'Chưa thu', color: '#dc2626' },
      ]} />
      <h2 className="text-sm font-semibold text-slate-700">
        Độc giả nợ tại ngày {formatDate(data.date)} <span className="font-normal text-slate-500">(không phụ thuộc khoảng thời gian)</span>
      </h2>
      {data.debtors.length === 0 ? (
        <p className="text-sm text-slate-500">Không có độc giả nào nợ phạt hoặc quá hạn.</p>
      ) : (
        <Table label="Độc giả nợ" columns={['Độc giả', 'Phiếu phạt chưa thanh toán', 'Tiền phạt chưa thanh toán', 'Sách quá hạn', 'Quá hạn lâu nhất']}>
          {data.debtors.map((d) => (
            <tr key={d.id} aria-label={`Độc giả nợ ${d.email}`} className="border-t border-slate-100">
              <td className={TD}>
                <p className="font-medium text-slate-900">{d.name}</p>
                <p className="text-xs text-slate-500">{d.email}</p>
              </td>
              <td className={TD}>{d.unpaidCount}</td>
              <td className={`${TD} font-medium text-red-700`}>{d.unpaidAmount > 0 ? formatMoney(d.unpaidAmount) : '—'}</td>
              <td className={TD}>{d.overdueCount}</td>
              <td className={TD}>{d.maxLateDays > 0 ? `${d.maxLateDays} ngày` : '—'}</td>
            </tr>
          ))}
        </Table>
      )}
      <Pagination page={data.pagination.page} totalPages={data.pagination.totalPages} onPage={onPage} label="Phân trang độc giả nợ" />
    </>
  )
}

function DamagedLostReport({ data }) {
  return (
    <>
      <dl className="grid grid-cols-3 gap-3">
        <Stat label="Bản cần thay" value={formatNumber(data.summary.copies)} />
        <Stat label="Mất" value={formatNumber(data.summary.lost)} tone="text-red-700" />
        <Stat label="Hư hỏng" value={formatNumber(data.summary.damaged)} tone="text-amber-700" />
      </dl>
      <ReportChart label="Số bản mất / hư" data={[
        { label: 'Mất', copies: data.summary.lost }, { label: 'Hư hỏng', copies: data.summary.damaged },
      ]} xKey="label" bars={[{ key: 'copies', name: 'Số bản', color: '#d97706' }]} />
      <Table label="Sách cần thay thế" columns={['Sách', 'ISBN', 'Thể loại', 'Loại', 'Số bản', 'Ngày ghi nhận gần nhất']}>
        {data.rows.map((b) => (
          <tr key={`${b.bookId}-${b.condition}`} className="border-t border-slate-100">
            <td className={TD}>
              <Link to={`/books/${b.bookId}`} className="font-medium text-blue-600 hover:underline">{b.title}</Link>
              <p className="text-xs text-slate-500">{b.author}</p>
            </td>
            <td className={TD}>{b.isbn ?? '—'}</td>
            <td className={TD}>{b.category}</td>
            <td className={TD}>{CONDITION_LABELS[b.condition]}</td>
            <td className={TD}>{b.copies}</td>
            <td className={TD}>{formatDate(b.lastRecordedAt)}</td>
          </tr>
        ))}
      </Table>
    </>
  )
}

// Khoảng tùy chọn: chỉ áp dụng khi bấm Áp dụng, để kiểm tra cả hai ngày cùng lúc.
function CustomRangeForm({ from, to, onApply }) {
  const [draft, setDraft] = useState({ from, to })
  const onSubmit = (e) => {
    e.preventDefault()
    onApply(draft)
  }
  return (
    <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-3">
      <label className="text-sm text-slate-700">
        <span className="mb-1 block text-xs text-slate-500">Từ ngày</span>
        <input type="date" value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} className={INPUT_CLASS} />
      </label>
      <label className="text-sm text-slate-700">
        <span className="mb-1 block text-xs text-slate-500">Đến ngày</span>
        <input type="date" value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} className={INPUT_CLASS} />
      </label>
      <button type="submit" className={`${BUTTON_CLASS} bg-blue-600 text-white hover:bg-blue-700`}>Áp dụng</button>
    </form>
  )
}

const REPORTS = { books: BooksReport, borrows: BorrowsReport, fines: FinesReport, 'damaged-lost': DamagedLostReport }

// 2.7.2 Báo cáo chi tiết (Librarian + Admin). Loại báo cáo, khoảng thời gian, cách gom nhóm và trang nằm trên URL.
export default function ReportsPage() {
  const { user } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const params = readReportParams(searchParams)
  const { type, period, from, to, groupBy, page } = params
  const invalidRange = rangeError(from, to)
  const [draftError, setDraftError] = useState('')
  const [state, setState] = useState({ status: 'loading' })
  const [csv, setCsv] = useState({ busy: false, error: '' })

  useEffect(() => {
    if (invalidRange) return undefined
    let cancelled = false
    setState({ status: 'loading' })
    getReport(type, reportQuery({ type, from, to, groupBy, page }))
      .then((data) => {
        if (cancelled) return
        setState({ status: 'ready', data })
      })
      .catch((err) => {
        if (cancelled) return
        const { message, errors } = parseApiError(err)
        setState({ status: 'error', message: errors.to ?? errors.from ?? message })
      })
    return () => { cancelled = true }
  }, [type, from, to, groupBy, page, invalidRange])

  const go = (changes) => {
    setCsv({ busy: false, error: '' })
    setDraftError('')
    setSearchParams(nextReportParams({ ...params, page: 1, ...changes }))
  }

  const onPeriod = (value) => {
    if (value === 'custom') return go({ period: value })
    go({ period: value, ...periodRange(value, invalidRange ? businessToday() : from) })
  }

  // Edge 1: chặn khi từ ngày > đến ngày, không gửi request.
  const onApplyCustom = (draft) => {
    const error = rangeError(draft.from, draft.to)
    if (error) return setDraftError(error)
    go({ from: draft.from, to: draft.to })
  }

  const onExport = async () => {
    setCsv({ busy: true, error: '' })
    try {
      await downloadReportCsv(type, reportQuery({ type, from, to, groupBy }), csvFileName(type, from, to))
      setCsv({ busy: false, error: '' })
    } catch (err) {
      setCsv({ busy: false, error: parseApiError(err).message })
    }
  }

  const ready = !invalidRange && state.status === 'ready'
  // Vừa đổi loại báo cáo: dữ liệu cũ thuộc loại khác, chưa hiển thị.
  const data = ready && state.data.type === type ? state.data : null
  const Report = REPORTS[type]

  return (
    <main className="min-h-screen bg-slate-50">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
        <h1 className="text-lg font-semibold text-slate-900">Báo cáo chi tiết</h1>
        <Link to={dashboardPath(user.role)} className="text-sm font-medium text-blue-600 hover:underline">Về dashboard</Link>
      </header>

      <section className="mx-auto max-w-6xl space-y-4 p-6">
        <nav aria-label="Loại báo cáo" className="flex flex-wrap gap-2">
          {REPORT_TYPES.map((t) => (
            <button
              key={t.value}
              type="button"
              aria-pressed={type === t.value}
              onClick={() => go({ type: t.value })}
              className={`${BUTTON_CLASS} border ${type === t.value ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}`}
            >
              {t.label}
            </button>
          ))}
        </nav>

        <div className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4">
          <label className="text-sm text-slate-700">
            <span className="mb-1 block text-xs text-slate-500">Khoảng thời gian</span>
            <select value={period} onChange={(e) => onPeriod(e.target.value)} className={INPUT_CLASS}>
              {PERIODS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </label>

          {period === 'custom' ? (
            // key: URL đổi khoảng thì ô nhập lấy lại giá trị mới.
            <CustomRangeForm key={`${from}|${to}`} from={from} to={to} onApply={onApplyCustom} />
          ) : (
            <label className="text-sm text-slate-700">
              <span className="mb-1 block text-xs text-slate-500">Mốc thời gian</span>
              <input
                type="date"
                value={from}
                onChange={(e) => e.target.value && go(periodRange(period, e.target.value))}
                className={INPUT_CLASS}
              />
            </label>
          )}

          {type === 'borrows' && (
            <label className="text-sm text-slate-700">
              <span className="mb-1 block text-xs text-slate-500">Gom nhóm</span>
              <select value={groupBy || data?.groupBy || ''} onChange={(e) => go({ groupBy: e.target.value })} className={INPUT_CLASS}>
                {!groupBy && !data && <option value="">Tự động</option>}
                {GROUP_BY.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
              </select>
            </label>
          )}

          <button
            type="button"
            onClick={onExport}
            disabled={!data?.hasData || csv.busy}
            className={`${BUTTON_CLASS} ml-auto border border-slate-300 bg-white text-slate-700 hover:bg-slate-50`}
          >
            {csv.busy ? 'Đang xuất...' : 'Xuất CSV'}
          </button>
        </div>

        {!invalidRange && <p className="text-sm text-slate-600">Từ {formatDate(from)} đến {formatDate(to)}</p>}
        {(draftError || invalidRange) && <p role="alert" className="text-sm text-red-700">{draftError || invalidRange}</p>}
        {csv.error && <p role="alert" className="text-sm text-red-700">Không xuất được CSV: {csv.error}</p>}

        {!invalidRange && state.status === 'loading' && <p className="text-sm text-slate-500">Đang tải...</p>}
        {!invalidRange && state.status === 'error' && <p role="alert" className="text-sm text-red-700">{state.message}</p>}
        {data && !data.hasData && <p className="rounded-lg border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">Không có dữ liệu trong khoảng này.</p>}
        {data?.hasData && <Report data={data} onPage={(p) => go({ page: p })} />}
        {data?.hasData && data.pagination && type !== 'fines' && (
          <Pagination page={data.pagination.page} totalPages={data.pagination.totalPages} onPage={(p) => go({ page: p })} />
        )}
      </section>
    </main>
  )
}
