import { useCallback, useEffect, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { parseApiError } from '../api/client'
import { getBook, updateBook } from '../features/book/bookApi'
import BookForm from '../features/book/BookForm'
import { minQuantityRule } from '../features/book/bookRules'
import { listCategories } from '../features/category/categoryApi'

function toFormValues(book) {
  return {
    title: book.title,
    author: book.author,
    publishYear: String(book.publishYear),
    isbn: book.isbn ?? '',
    categoryId: String(book.category.id),
    description: book.description,
    quantity: String(book.totalQuantity),
  }
}

// PRD 2.2.5 Sửa sách (nhân viên thư viện, Admin). Flow: design/flows/2.2.5-sua-xoa-sach.md.
export default function EditBookPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const [book, setBook] = useState(null)
  const [categories, setCategories] = useState(null)
  const [error, setError] = useState(null) // { message, notFound }
  // Edge 5: dữ liệu đã bị người khác sửa/xóa từ lúc mở form → khóa form, yêu cầu tải lại.
  const [stale, setStale] = useState(null) // { message, gone }
  const [reloadKey, setReloadKey] = useState(0)
  const detailPath = `/books/${id}`
  const listSearch = location.state?.listSearch

  const loadCategories = useCallback(() => listCategories()
    .then(setCategories)
    .catch((err) => setError({ message: parseApiError(err).message })), [])

  useEffect(() => {
    let ignore = false
    setBook(null)
    setError(null)
    setStale(null)
    Promise.all([getBook(id), listCategories()])
      .then(([data, list]) => {
        if (ignore) return
        setBook(data)
        setCategories(list)
      })
      .catch((err) => {
        if (ignore) return
        const notFound = err?.response?.status === 404
        setError({ message: notFound ? 'Không tìm thấy sách' : parseApiError(err).message, notFound })
      })
    return () => { ignore = true }
  }, [id, reloadKey])

  const onSubmit = async (values, { cover, removeCover }) => {
    const data = await updateBook(id, values, { version: book.version, cover, removeCover })
    navigate(detailPath, { state: { notice: { text: data.message, warning: data.warning }, listSearch } })
    return null
  }

  const onError = (parsed, err) => {
    if (err?.response?.status === 404) {
      setStale({ message: 'Sách không còn tồn tại, có thể đã bị xóa', gone: true })
      return true
    }
    if (parsed.errors.version) {
      setStale({ message: parsed.errors.version, gone: false })
      return true
    }
    return false
  }

  return (
    <main className="min-h-screen bg-slate-50">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
        <h1 className="text-lg font-semibold text-slate-900">Sửa sách</h1>
        <Link to={detailPath} state={{ listSearch }} className="text-sm font-medium text-blue-600 hover:underline">← Chi tiết sách</Link>
      </header>

      <section className="mx-auto max-w-2xl p-6">
        {error && (
          <div role="alert" className="flex items-center gap-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            <span>{error.message}</span>
            {error.notFound
              ? <Link to="/books" className="font-medium underline">Về danh sách sách</Link>
              : <button type="button" onClick={() => setReloadKey((k) => k + 1)} className="font-medium underline">Thử lại</button>}
          </div>
        )}
        {!book && !error && <p className="text-sm text-slate-600">Đang tải...</p>}

        {stale && (
          <div role="alert" className="mb-4 flex flex-wrap items-center gap-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
            <span>{stale.message}</span>
            {stale.gone
              ? <Link to="/books" className="font-medium underline">Về danh sách sách</Link>
              : <button type="button" onClick={() => setReloadKey((k) => k + 1)} className="font-medium underline">Tải lại dữ liệu mới</button>}
          </div>
        )}

        {book && categories && (
          <BookForm
            key={book.version}
            label="Sửa sách"
            submitLabel="Lưu thay đổi"
            categories={categories}
            defaultValues={toFormValues(book)}
            currentCoverUrl={book.coverUrl}
            quantityRule={{ validate: minQuantityRule(book) }}
            quantityHint={`Tổng số bản; hiện có ${book.availableQuantity} bản sẵn, ${book.borrowedQuantity} bản đang mượn${book.damagedQuantity ? `, ${book.damagedQuantity} bản hư hỏng` : ''}`}
            onSubmit={onSubmit}
            onError={onError}
            onCategoryGone={loadCategories}
            disabled={Boolean(stale)}
          />
        )}
      </section>
    </main>
  )
}
