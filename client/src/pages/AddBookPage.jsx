import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { parseApiError } from '../api/client'
import { useAuth } from '../features/auth/AuthContext'
import { dashboardPath } from '../features/auth/session'
import { createBook } from '../features/book/bookApi'
import BookForm from '../features/book/BookForm'
import { listCategories } from '../features/category/categoryApi'

// 2.2.2 Thêm Sách Mới (nhân viên thư viện, Admin).
export default function AddBookPage() {
  const { user } = useAuth()
  const [categories, setCategories] = useState(null)
  const [loadError, setLoadError] = useState('')

  const loadCategories = useCallback(() => listCategories()
    .then((list) => { setCategories(list); setLoadError('') })
    .catch((err) => setLoadError(parseApiError(err).message)), [])

  useEffect(() => { loadCategories() }, [loadCategories])

  const onSubmit = async (values, { cover }) => {
    const data = await createBook(values, cover)
    return { text: data.message, warning: data.warning, reset: true }
  }

  const categoriesPath = `/${user.role}/categories`

  return (
    <main className="min-h-screen bg-slate-50">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
        <h1 className="text-lg font-semibold text-slate-900">Thêm sách mới</h1>
        <Link to={dashboardPath(user.role)} className="text-sm font-medium text-blue-600 hover:underline">Về dashboard</Link>
      </header>

      <section className="mx-auto max-w-2xl p-6">
        {loadError && <p role="alert" className="text-sm text-red-600">{loadError}</p>}
        {!categories && !loadError && <p className="text-sm text-slate-600">Đang tải...</p>}

        {categories?.length === 0 && (
          <p role="alert" className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Chưa có thể loại sách nào. Hãy <Link to={categoriesPath} className="font-medium underline">tạo thể loại</Link> trước khi thêm sách.
          </p>
        )}

        {categories?.length > 0 && (
          <BookForm
            label="Thêm sách mới"
            submitLabel="Thêm sách"
            categories={categories}
            onSubmit={onSubmit}
            onCategoryGone={loadCategories}
          />
        )}
      </section>
    </main>
  )
}
