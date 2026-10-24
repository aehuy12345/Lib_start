import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { parseApiError } from '../api/client'
import { useAuth } from '../features/auth/AuthContext'
import { dashboardPath } from '../features/auth/session'
import { deleteBook, getBook, getBorrowEligibility, getBorrowHistory, getDeleteCheck } from '../features/book/bookApi'
import BookCover from '../features/book/BookCover'
import { cancelBorrowOrder } from '../features/borrow/borrowApi'
import BorrowForm from '../features/borrow/BorrowForm'
import Pagination from '../features/book/Pagination'
import { BORROW_STATUS_LABELS, borrowButtonState, formatDate, isStaff } from '../features/book/bookDetail'

const BUTTON_CLASS = 'rounded-md px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50'

// 2.3.1: onChanged() tải lại điều kiện mượn sau khi gửi/hủy yêu cầu hoặc khi server từ chối.
function BorrowAction({ book, eligibility, onChanged }) {
  const { status, user } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [formOpen, setFormOpen] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [cancelling, setCancelling] = useState(false)
  const state = borrowButtonState({ authStatus: status, role: user?.role, eligibility })
  const pendingOrder = eligibility?.activeOrder?.status === 'pending' ? eligibility.activeOrder : null

  if (state.kind === 'hidden') return null

  // Khách: đăng nhập xong quay lại đúng trang này.
  const onClick = () => {
    if (state.kind === 'login') {
      navigate(`/login?redirect=${encodeURIComponent(location.pathname)}`)
      return
    }
    setNotice('')
    setError('')
    setFormOpen(true)
  }

  // Gửi xong hoặc bị server từ chối (điều kiện đã đổi từ lúc mở trang): đóng form, tải lại điều kiện.
  const onDone = (message) => {
    setFormOpen(false)
    setNotice(message)
    onChanged()
  }
  const onRejected = (message) => {
    setFormOpen(false)
    setError(message)
    onChanged()
  }

  const onCancelOrder = async () => {
    if (!window.confirm(`Hủy yêu cầu mượn "${book.title}"?`)) return
    setError('')
    setNotice('')
    setCancelling(true)
    try {
      const data = await cancelBorrowOrder(pendingOrder.id)
      setNotice(data.message)
    } catch (err) {
      // 409: nhân viên vừa xử lý đơn; tải lại để thấy trạng thái mới.
      setError(parseApiError(err).message)
    } finally {
      setCancelling(false)
      onChanged()
    }
  }

  return (
    <div className="mt-6">
      <button
        type="button"
        onClick={onClick}
        disabled={state.kind === 'disabled' || state.kind === 'checking' || formOpen}
        aria-describedby={state.message ? 'borrow-blocked' : undefined}
        className={`${BUTTON_CLASS} bg-blue-600 text-white hover:bg-blue-700`}
      >
        Mượn sách
      </button>
      {state.kind === 'login' && <p className="mt-2 text-xs text-slate-500">Bạn cần đăng nhập để mượn sách</p>}
      {state.message && <p id="borrow-blocked" className="mt-2 text-sm text-red-700">{state.message}</p>}
      {pendingOrder && (
        <button
          type="button"
          onClick={onCancelOrder}
          disabled={cancelling}
          className={`${BUTTON_CLASS} mt-2 border border-slate-300 bg-white text-slate-700 hover:bg-slate-50`}
        >
          Hủy yêu cầu mượn
        </button>
      )}
      {error && error !== state.message && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
      {formOpen && state.kind === 'enabled' && (
        <BorrowForm bookId={book.id} onDone={onDone} onRejected={onRejected} onCancel={() => setFormOpen(false)} />
      )}
      {notice && <p role="status" className="mt-2 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">{notice}</p>}
    </div>
  )
}

// 2.2.5: chỉ nhân viên thấy; server cũng chặn độc giả (edge 6).
function StaffActions({ book, role, listSearch, backTo }) {
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // Flow xóa: kiểm tra đơn hoạt động trước khi hỏi xác nhận; server kiểm tra lại khi xóa.
  const onDelete = async () => {
    setError('')
    setBusy(true)
    try {
      const check = await getDeleteCheck(book.id)
      if (!check.canDelete) {
        setError(`Không thể xóa: sách đang có ${check.activeBorrowCount} đơn mượn hoạt động (chờ xác nhận, đang mượn hoặc quá hạn)`)
        return
      }
      if (!window.confirm(`Xóa sách "${book.title}"?`)) return
      await deleteBook(book.id)
      navigate(backTo, { state: { notice: `Đã xóa sách "${book.title}"` } })
    } catch (err) {
      setError(err?.response?.status === 404 ? 'Sách không còn tồn tại, có thể đã bị xóa' : parseApiError(err).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-6">
      <div className="flex gap-2">
        <Link
          to={`/${role}/books/${book.id}/edit`}
          state={{ listSearch }}
          className={`${BUTTON_CLASS} border border-slate-300 bg-white text-slate-700 hover:bg-slate-50`}
        >
          Sửa
        </Link>
        <button type="button" onClick={onDelete} disabled={busy} className={`${BUTTON_CLASS} bg-red-600 text-white hover:bg-red-700`}>
          Xóa
        </button>
      </div>
      {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
    </div>
  )
}

// Chỉ nhân viên thấy; server cũng chặn khách và độc giả (edge 4).
function BorrowHistory({ bookId }) {
  const [page, setPage] = useState(1)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let ignore = false
    getBorrowHistory(bookId, page)
      .then((data) => {
        if (ignore) return
        setError(null)
        setResult(data)
      })
      .catch((err) => {
        if (!ignore) setError(parseApiError(err).message)
      })
    return () => { ignore = true }
  }, [bookId, page])

  const borrows = result?.borrows ?? []
  return (
    <section aria-labelledby="borrow-history-title" className="mt-8 rounded-lg bg-white p-6 shadow-sm">
      <h2 id="borrow-history-title" className="text-base font-semibold text-slate-900">Lịch sử mượn</h2>
      {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
      {!result && !error && <p className="mt-3 text-sm text-slate-600">Đang tải...</p>}
      {result && borrows.length === 0 && <p className="mt-3 text-sm text-slate-600">Sách chưa từng được mượn</p>}
      {borrows.length > 0 && (
        <>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 text-slate-600">
                <tr>
                  <th className="py-2 pr-4 font-medium">Độc giả</th>
                  <th className="py-2 pr-4 font-medium">Ngày yêu cầu</th>
                  <th className="py-2 pr-4 font-medium">Ngày mượn</th>
                  <th className="py-2 pr-4 font-medium">Ngày hết hạn</th>
                  <th className="py-2 pr-4 font-medium">Trạng thái</th>
                </tr>
              </thead>
              <tbody>
                {borrows.map((b) => (
                  <tr key={b.id} className="border-b border-slate-100 last:border-0">
                    <td className="py-2 pr-4">
                      <div className="text-slate-900">{b.reader.name}</div>
                      <div className="text-xs text-slate-500">{b.reader.email}</div>
                    </td>
                    <td className="py-2 pr-4">{formatDate(b.requestedAt)}</td>
                    <td className="py-2 pr-4">{formatDate(b.borrowedAt)}</td>
                    <td className="py-2 pr-4">{formatDate(b.dueDate)}</td>
                    <td className={`py-2 pr-4 ${b.status === 'overdue' ? 'font-medium text-red-700' : ''}`}>
                      {BORROW_STATUS_LABELS[b.status] ?? b.status}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination label="Phân trang lịch sử mượn" page={result.pagination.page} totalPages={result.pagination.totalPages} onPage={setPage} />
        </>
      )}
    </section>
  )
}

// PRD 2.2.4: công khai. Flow: design/flows/2.2.4-xem-chi-tiet-sach.md.
export default function BookDetailPage() {
  const { id } = useParams()
  const location = useLocation()
  const { status, user } = useAuth()
  const [book, setBook] = useState(null)
  const [error, setError] = useState(null) // { message, notFound }
  const [eligibility, setEligibility] = useState(undefined)
  const [reloadKey, setReloadKey] = useState(0)
  const [eligibilityKey, setEligibilityKey] = useState(0)
  const isReader = status === 'authenticated' && user.role === 'reader'
  const staff = status === 'authenticated' && isStaff(user.role)
  // 2.2.5: thông báo sau khi lưu ở trang sửa.
  const notice = location.state?.notice
  // Quay lại danh sách giữ nguyên bộ lọc nếu đi từ trang danh sách.
  const listSearch = location.state?.listSearch
  const backTo = `/books${listSearch ?? ''}`

  useEffect(() => {
    let ignore = false
    setBook(null)
    setError(null)
    getBook(id)
      .then((data) => !ignore && setBook(data))
      .catch((err) => {
        if (ignore) return
        // Edge 1: id sai cũng nhận 404 như sách không tồn tại.
        const notFound = err?.response?.status === 404
        setError({ message: notFound ? 'Không tìm thấy sách' : parseApiError(err).message, notFound })
      })
    return () => { ignore = true }
  }, [id, reloadKey])

  // Kết quả chỉ là gợi ý; server kiểm tra lại khi tạo đơn (edge 3).
  useEffect(() => {
    if (!isReader || !book) return
    let ignore = false
    setEligibility(undefined)
    getBorrowEligibility(book.id)
      .then((data) => !ignore && setEligibility(data))
      .catch((err) => {
        if (ignore) return
        // Edge 2: sách bị xóa trong lúc xem.
        const message = err?.response?.status === 404 ? 'Sách không còn tồn tại' : parseApiError(err).message
        setEligibility({ error: message })
      })
    return () => { ignore = true }
  }, [isReader, book, eligibilityKey])

  return (
    <main className="min-h-screen bg-slate-50">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
        <Link to={backTo} className="text-sm font-medium text-blue-600 hover:underline">← Danh sách sách</Link>
        <div className="flex items-center gap-4 text-sm">
          {status === 'authenticated' && (
            <>
              <span className="text-slate-700">{user.name}</span>
              <Link to={dashboardPath(user.role)} className="font-medium text-blue-600 hover:underline">Về dashboard</Link>
            </>
          )}
          {status === 'anonymous' && (
            <>
              <Link to="/login" className="font-medium text-blue-600 hover:underline">Đăng nhập</Link>
              <Link to="/register" className="font-medium text-blue-600 hover:underline">Đăng ký</Link>
            </>
          )}
        </div>
      </header>

      <section className="mx-auto max-w-4xl p-6">
        {error?.notFound && (
          <div role="alert" className="rounded-lg bg-white p-8 text-center shadow-sm">
            <p className="text-4xl font-bold text-slate-300">404</p>
            <h1 className="mt-2 text-lg font-semibold text-slate-900">Không tìm thấy sách</h1>
            <p className="mt-1 text-sm text-slate-600">Sách không tồn tại hoặc đã bị xóa.</p>
            <Link to="/books" className="mt-4 inline-block text-sm font-medium text-blue-600 hover:underline">Về danh sách sách</Link>
          </div>
        )}
        {error && !error.notFound && (
          <div role="alert" className="flex items-center gap-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            <span>{error.message}</span>
            <button type="button" onClick={() => setReloadKey((k) => k + 1)} className="font-medium underline">Thử lại</button>
          </div>
        )}
        {!book && !error && <p className="text-sm text-slate-600">Đang tải...</p>}

        {book && (
          <>
            {notice && (
              <div role="status" className="mb-4 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">
                <p>{notice.text}</p>
                {notice.warning && <p className="mt-1 text-amber-700">{notice.warning}</p>}
              </div>
            )}
            <article aria-labelledby="book-title" className="flex flex-col gap-6 rounded-lg bg-white p-6 shadow-sm sm:flex-row">
              <div className="w-full max-w-[200px] shrink-0">
                <BookCover url={book.coverUrl} title={book.title} lazy={false} />
              </div>
              <div className="min-w-0 flex-1">
                <h1 id="book-title" className="text-xl font-semibold text-slate-900">{book.title}</h1>
                <dl className="mt-3 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
                  <dt className="text-slate-500">Tác giả</dt><dd className="text-slate-900">{book.author}</dd>
                  <dt className="text-slate-500">ISBN</dt><dd className="text-slate-900">{book.isbn || 'Chưa có'}</dd>
                  <dt className="text-slate-500">Năm xuất bản</dt><dd className="text-slate-900">{book.publishYear}</dd>
                  <dt className="text-slate-500">Thể loại</dt><dd className="text-slate-900">{book.category?.name}</dd>
                  <dt className="text-slate-500">Có sẵn</dt>
                  <dd className="text-slate-900">
                    {book.availableQuantity}
                    {book.availableQuantity === 0 && <span className="ml-2 rounded bg-red-600 px-2 py-0.5 text-xs font-semibold text-white">Hết sách</span>}
                  </dd>
                  <dt className="text-slate-500">Đang mượn</dt><dd className="text-slate-900">{book.borrowedQuantity}</dd>
                </dl>
                <h2 className="mt-4 text-sm font-semibold text-slate-900">Mô tả</h2>
                <p className="mt-1 whitespace-pre-line break-words text-sm text-slate-700">{book.description}</p>
                <BorrowAction book={book} eligibility={eligibility} onChanged={() => setEligibilityKey((k) => k + 1)} />
                {staff && <StaffActions book={book} role={user.role} listSearch={listSearch} backTo={backTo} />}
              </div>
            </article>
            {staff && <BorrowHistory bookId={book.id} />}
          </>
        )}
      </section>
    </main>
  )
}
