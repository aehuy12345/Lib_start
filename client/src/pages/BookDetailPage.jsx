import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { parseApiError } from '../api/client'
import { useAuth } from '../features/auth/AuthContext'
import { dashboardPath } from '../features/auth/session'
import { getBook, getBorrowEligibility, getBorrowHistory } from '../features/book/bookApi'
import BookCover from '../features/book/BookCover'
import Pagination from '../features/book/Pagination'
import { BORROW_STATUS_LABELS, borrowButtonState, formatDate, isStaff } from '../features/book/bookDetail'

const BUTTON_CLASS = 'rounded-md px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50'

function BorrowAction({ book, eligibility }) {
  const { status, user } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [notice, setNotice] = useState(null)
  const state = borrowButtonState({ authStatus: status, role: user?.role, eligibility })

  if (state.kind === 'hidden') return null

  // Khách: đăng nhập xong quay lại đúng trang này.
  const onClick = () => {
    if (state.kind === 'login') {
      navigate(`/login?redirect=${encodeURIComponent(location.pathname)}`)
      return
    }
    // TODO 2.3.1: mở form chọn thời hạn và gửi yêu cầu mượn.
    setNotice(`Chức năng gửi yêu cầu mượn "${book.title}" đang được phát triển`)
  }

  return (
    <div className="mt-6">
      <button
        type="button"
        onClick={onClick}
        disabled={state.kind === 'disabled' || state.kind === 'checking'}
        aria-describedby={state.message ? 'borrow-blocked' : undefined}
        className={`${BUTTON_CLASS} bg-blue-600 text-white hover:bg-blue-700`}
      >
        Mượn sách
      </button>
      {state.kind === 'login' && <p className="mt-2 text-xs text-slate-500">Bạn cần đăng nhập để mượn sách</p>}
      {state.message && <p id="borrow-blocked" className="mt-2 text-sm text-red-700">{state.message}</p>}
      {notice && <p role="status" className="mt-2 text-sm text-slate-600">{notice}</p>}
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
  const isReader = status === 'authenticated' && user.role === 'reader'
  // Quay lại danh sách giữ nguyên bộ lọc nếu đi từ trang danh sách.
  const backTo = `/books${location.state?.listSearch ?? ''}`

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
  }, [isReader, book])

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
                <BorrowAction book={book} eligibility={eligibility} />
              </div>
            </article>
            {/* TODO 2.2.5: nút Sửa và Xóa cho nhân viên. */}
            {status === 'authenticated' && isStaff(user.role) && <BorrowHistory bookId={book.id} />}
          </>
        )}
      </section>
    </main>
  )
}
