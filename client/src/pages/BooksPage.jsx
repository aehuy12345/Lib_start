import { useEffect, useState } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { parseApiError } from '../api/client'
import { useAuth } from '../features/auth/AuthContext'
import { dashboardPath } from '../features/auth/session'
import { listBooks } from '../features/book/bookApi'
import BookCover from '../features/book/BookCover'
import Pagination from '../features/book/Pagination'
import { SORT_OPTIONS, hasFilters, nextListParams, readListParams } from '../features/book/bookListParams'
import { listCategoryOptions } from '../features/category/categoryApi'

const INPUT_CLASS = 'rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500'
const BUTTON_CLASS = 'rounded-md px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50'

function BookCard({ book }) {
  const { search } = useLocation()
  const soldOut = book.availableQuantity === 0
  return (
    <li className="flex flex-col rounded-lg bg-white p-3 shadow-sm">
      <article aria-label={book.title} className="flex h-full flex-col">
        <div className="relative">
          <BookCover url={book.coverUrl} title={book.title} />
          {soldOut && (
            <span className="absolute left-2 top-2 rounded bg-red-600 px-2 py-0.5 text-xs font-semibold text-white">Hết sách</span>
          )}
        </div>
        <h2 className="mt-2 line-clamp-2 text-sm font-semibold text-slate-900">
          {/* 2.2.4: tên sách mở trang chi tiết. */}
          <Link to={`/books/${book.id}`} state={{ listSearch: search }} className="hover:text-blue-600 hover:underline">{book.title}</Link>
        </h2>
        <dl className="mt-1 space-y-0.5 text-xs text-slate-600">
          <div><dt className="inline">Tác giả: </dt><dd className="inline">{book.author}</dd></div>
          <div><dt className="inline">Năm XB: </dt><dd className="inline">{book.publishYear}</dd></div>
          <div><dt className="inline">Thể loại: </dt><dd className="inline">{book.category.name}</dd></div>
          <div><dt className="inline">Có sẵn: </dt><dd className="inline">{book.availableQuantity}</dd></div>
          <div><dt className="inline">Đang mượn: </dt><dd className="inline">{book.borrowedQuantity}</dd></div>
        </dl>
      </article>
    </li>
  )
}


// PRD 2.2.3: công khai, không cần đăng nhập. Flow: design/flows/2.2.3-xem-danh-sach-sach.md.
export default function BooksPage() {
  const { status, user } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  // 2.2.5: thông báo sau khi xóa sách ở trang chi tiết.
  const deletedNotice = useLocation().state?.notice
  const params = readListParams(searchParams)
  const { q, categoryId, sort, page } = params
  const [keyword, setKeyword] = useState(q)
  const [syncedQ, setSyncedQ] = useState(q)
  const [categories, setCategories] = useState([])
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null) // { message, filter }
  const [reloadKey, setReloadKey] = useState(0)

  // Nút Back đổi URL thì ô tìm kiếm cũng theo (chỉnh state ngay khi render, không qua effect).
  if (q !== syncedQ) {
    setSyncedQ(q)
    setKeyword(q)
  }

  // Bộ lọc thể loại lỗi thì trang vẫn dùng được, chỉ mất danh sách chọn.
  useEffect(() => {
    listCategoryOptions().then(setCategories).catch(() => setCategories([]))
  }, [])

  useEffect(() => {
    let ignore = false
    listBooks(nextListParams({ q, categoryId, sort, page }, { page }))
      .then((data) => {
        if (ignore) return
        setError(null)
        setResult(data)
        // Trang yêu cầu vượt tổng số trang → server trả trang cuối; sửa URL cho khớp.
        if (data.pagination.page !== page) {
          setSearchParams(nextListParams({ q, categoryId, sort }, { page: data.pagination.page }), { replace: true })
        }
      })
      .catch((err) => {
        if (ignore) return
        const { message, errors } = parseApiError(err)
        setResult(null)
        setError({ message: errors.categoryId ?? message, filter: Boolean(errors.categoryId) })
      })
    return () => { ignore = true }
  }, [q, categoryId, sort, page, reloadKey, setSearchParams])

  const update = (changes) => setSearchParams(nextListParams(params, changes))
  const clearFilters = () => setSearchParams(nextListParams(params, { q: '', categoryId: '' }))

  const onSearch = (e) => {
    e.preventDefault()
    update({ q: keyword })
  }

  const onPage = (next) => {
    update({ page: next })
    window.scrollTo?.({ top: 0 })
  }

  const filtered = hasFilters(params)
  const books = result?.books ?? []

  return (
    <main className="min-h-screen bg-slate-50">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
        <h1 className="text-lg font-semibold text-slate-900">Danh sách sách</h1>
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

      <section className="mx-auto max-w-6xl p-6">
        {deletedNotice && <p role="status" className="mb-4 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">{deletedNotice}</p>}
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <form role="search" aria-label="Tìm sách" onSubmit={onSearch} className="flex flex-1 gap-2">
            <label htmlFor="book-search" className="sr-only">Tìm theo tên sách hoặc tác giả</label>
            <input
              id="book-search"
              type="search"
              value={keyword}
              maxLength={100}
              placeholder="Tìm theo tên sách hoặc tác giả"
              onChange={(e) => setKeyword(e.target.value)}
              className={`${INPUT_CLASS} min-w-0 flex-1`}
            />
            <button type="submit" className={`${BUTTON_CLASS} bg-blue-600 text-white hover:bg-blue-700`}>Tìm</button>
          </form>
          <label className="text-sm text-slate-700">
            <span className="mr-2">Thể loại</span>
            <select value={categoryId} onChange={(e) => update({ categoryId: e.target.value })} className={INPUT_CLASS}>
              <option value="">Tất cả thể loại</option>
              {categories.map((c) => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
            </select>
          </label>
          <label className="text-sm text-slate-700">
            <span className="mr-2">Sắp xếp</span>
            <select value={sort} onChange={(e) => update({ sort: e.target.value })} className={INPUT_CLASS}>
              {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
        </div>

        {error && (
          <div role="alert" className="flex items-center gap-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            <span>{error.message}</span>
            {error.filter
              ? <button type="button" onClick={clearFilters} className="font-medium underline">Xóa bộ lọc</button>
              : <button type="button" onClick={() => setReloadKey((k) => k + 1)} className="font-medium underline">Thử lại</button>}
          </div>
        )}

        {!result && !error && <p className="text-sm text-slate-600">Đang tải...</p>}

        {result && books.length === 0 && (
          <div role="status" className="rounded-md bg-white p-6 text-center text-sm text-slate-600 shadow-sm">
            {filtered ? (
              <>
                <p>Không tìm thấy sách phù hợp</p>
                <button type="button" onClick={clearFilters} className="mt-2 font-medium text-blue-600 hover:underline">Xóa bộ lọc</button>
              </>
            ) : <p>Chưa có sách nào</p>}
          </div>
        )}

        {books.length > 0 && (
          <>
            <p className="mb-3 text-sm text-slate-600">Tìm thấy {result.pagination.total} sách</p>
            <ul aria-label="Kết quả sách" className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
              {books.map((book) => <BookCard key={book.id} book={book} />)}
            </ul>
            <Pagination page={result.pagination.page} totalPages={result.pagination.totalPages} onPage={onPage} />
          </>
        )}
      </section>
    </main>
  )
}
