import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { parseApiError } from '../api/client'
import { useAuth } from '../features/auth/AuthContext'
import { dashboardPath } from '../features/auth/session'
import { createCategory, deleteCategory, listCategories, updateCategory } from '../features/category/categoryApi'
import { NAME_MAX, validateCategoryName } from '../features/category/categoryRules'

const INPUT_CLASS = 'w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 aria-[invalid=true]:border-red-500'
const BUTTON_CLASS = 'rounded-md px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50'

// Lỗi trên một field: lấy lỗi của `name` nếu có, không thì thông báo chung.
function nameError(err) {
  const { message, errors } = parseApiError(err)
  return errors.name ?? message
}

function AddCategoryForm({ onAdded, onCancel }) {
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const onSubmit = async (e) => {
    e.preventDefault()
    const invalid = validateCategoryName(name)
    if (invalid) return setError(invalid)
    setBusy(true)
    try {
      const { category } = await createCategory(name.trim())
      onAdded(category)
    } catch (err) {
      setError(nameError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form aria-label="Thêm thể loại sách" onSubmit={onSubmit} noValidate className="mb-4 rounded-md border border-slate-200 bg-white p-4">
      <label htmlFor="new-category" className="block text-sm font-medium text-slate-700">Tên thể loại mới</label>
      <div className="mt-1 flex gap-2">
        <input
          id="new-category"
          autoFocus
          value={name}
          maxLength={NAME_MAX + 20}
          onChange={(e) => { setName(e.target.value); setError('') }}
          aria-invalid={error ? 'true' : 'false'}
          aria-describedby={error ? 'new-category-error' : undefined}
          className={INPUT_CLASS}
        />
        <button type="submit" disabled={busy} className={`${BUTTON_CLASS} bg-blue-600 text-white hover:bg-blue-700`}>Thêm</button>
        <button type="button" onClick={onCancel} className={`${BUTTON_CLASS} border border-slate-300 text-slate-700 hover:bg-slate-50`}>Hủy</button>
      </div>
      {error && <p id="new-category-error" className="mt-1 text-sm text-red-600">{error}</p>}
    </form>
  )
}

// Sửa trực tiếp trên bảng; lỗi thì giữ ô để sửa tiếp, Hủy trả lại tên cũ.
function CategoryRow({ category, onSaved, onDelete, busyDelete }) {
  const [name, setName] = useState(category.name)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const inputId = `category-${category.id}`
  const dirty = name.trim() !== category.name

  const reset = () => { setName(category.name); setError('') }

  const onSave = async () => {
    const invalid = validateCategoryName(name)
    if (invalid) return setError(invalid)
    setBusy(true)
    try {
      const { category: saved } = await updateCategory(category.id, name.trim())
      setError('')
      onSaved(saved)
    } catch (err) {
      const status = err?.response?.status
      if (status === 404) return onSaved(null, parseApiError(err).message)
      setError(nameError(err))
    } finally {
      setBusy(false)
    }
  }

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && dirty) onSave()
    if (e.key === 'Escape') reset()
  }

  return (
    <tr className="border-t border-slate-200 align-top">
      <td className="px-4 py-2">
        <input
          id={inputId}
          aria-label={`Tên thể loại ${category.name}`}
          value={name}
          onChange={(e) => { setName(e.target.value); setError('') }}
          onKeyDown={onKeyDown}
          aria-invalid={error ? 'true' : 'false'}
          aria-describedby={error ? `${inputId}-error` : undefined}
          className={INPUT_CLASS}
        />
        {error && <p id={`${inputId}-error`} className="mt-1 text-sm text-red-600">{error}</p>}
      </td>
      <td className="px-4 py-2 text-sm text-slate-700">{category.bookCount}</td>
      <td className="px-4 py-2">
        <div className="flex gap-2">
          {dirty && (
            <>
              <button type="button" onClick={onSave} disabled={busy} className={`${BUTTON_CLASS} bg-blue-600 text-white hover:bg-blue-700`}>Lưu</button>
              <button type="button" onClick={reset} disabled={busy} className={`${BUTTON_CLASS} border border-slate-300 text-slate-700 hover:bg-slate-50`}>Hủy</button>
            </>
          )}
          <button
            type="button"
            onClick={() => onDelete(category)}
            disabled={busyDelete}
            aria-label={`Xóa ${category.name}`}
            className={`${BUTTON_CLASS} border border-red-300 text-red-600 hover:bg-red-50`}
          >
            Xóa
          </button>
        </div>
      </td>
    </tr>
  )
}

// 2.2.1 Quản lý thể loại sách (nhân viên thư viện, Admin).
export default function CategoriesPage() {
  const { user } = useAuth()
  const [categories, setCategories] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [adding, setAdding] = useState(false)
  const [notice, setNotice] = useState({ type: '', text: '' })
  const [deletingId, setDeletingId] = useState(null)

  const reload = useCallback(() => listCategories()
    .then((list) => {
      setCategories(list)
      setLoadError('')
    })
    .catch((err) => setLoadError(parseApiError(err).message)), [])

  useEffect(() => {
    let cancelled = false
    listCategories()
      .then((list) => !cancelled && setCategories(list))
      .catch((err) => !cancelled && setLoadError(parseApiError(err).message))
    return () => { cancelled = true }
  }, [])

  const showError = (text) => setNotice({ type: 'error', text })
  const showSuccess = (text) => setNotice({ type: 'success', text })

  const onAdded = (category) => {
    setAdding(false)
    showSuccess(`Đã thêm thể loại "${category.name}"`)
    reload()
  }

  // saved = null: thể loại đã bị xóa ở nơi khác (404) → tải lại bảng.
  const onSaved = (saved, error) => {
    if (!saved) {
      showError(error)
      return reload()
    }
    showSuccess('Cập nhật thể loại thành công')
    setCategories((list) => list.map((c) => (c.id === saved.id ? saved : c)))
  }

  const onDelete = async (category) => {
    setNotice({ type: '', text: '' })
    if (category.bookCount > 0) {
      return showError(`Không thể xóa: còn ${category.bookCount} sách thuộc thể loại này`)
    }
    if (!window.confirm(`Xóa thể loại "${category.name}"?`)) return
    setDeletingId(category.id)
    try {
      await deleteCategory(category.id)
      showSuccess(`Đã xóa thể loại "${category.name}"`)
    } catch (err) {
      // 404 (edge 2) và 409 (edge 3): báo lỗi rồi tải lại để thấy dữ liệu mới.
      showError(parseApiError(err).message)
    } finally {
      setDeletingId(null)
      reload()
    }
  }

  return (
    <main className="min-h-screen bg-slate-50">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
        <h1 className="text-lg font-semibold text-slate-900">Quản lý thể loại sách</h1>
        <Link to={dashboardPath(user.role)} className="text-sm font-medium text-blue-600 hover:underline">Về dashboard</Link>
      </header>

      <section className="mx-auto max-w-3xl p-6">
        <div className="mb-4 flex justify-end">
          {!adding && (
            <button
              type="button"
              onClick={() => { setAdding(true); setNotice({ type: '', text: '' }) }}
              className={`${BUTTON_CLASS} bg-blue-600 text-white hover:bg-blue-700`}
            >
              Thêm thể loại sách
            </button>
          )}
        </div>

        {adding && <AddCategoryForm onAdded={onAdded} onCancel={() => setAdding(false)} />}

        {notice.text && (
          <p
            role={notice.type === 'error' ? 'alert' : 'status'}
            className={`mb-4 rounded-md px-3 py-2 text-sm ${notice.type === 'error' ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}
          >
            {notice.text}
          </p>
        )}

        {loadError && <p role="alert" className="text-sm text-red-600">{loadError}</p>}
        {!categories && !loadError && <p className="text-sm text-slate-600">Đang tải...</p>}

        {categories && (
          <div className="overflow-x-auto rounded-md border border-slate-200 bg-white">
            <table className="w-full text-left">
              <thead className="bg-slate-100 text-sm text-slate-700">
                <tr>
                  <th className="px-4 py-2 font-medium">Tên thể loại</th>
                  <th className="w-24 px-4 py-2 font-medium">Số sách</th>
                  <th className="w-48 px-4 py-2 font-medium">Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {categories.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="px-4 py-6 text-center text-sm text-slate-600">
                      Chưa có thể loại nào. Hãy bấm "Thêm thể loại sách" để tạo thể loại đầu tiên.
                    </td>
                  </tr>
                ) : (
                  categories.map((c) => (
                    // Key gồm cả tên: tên trên server đổi thì dòng được tạo lại với giá trị mới.
                    <CategoryRow
                      key={`${c.id}:${c.name}`}
                      category={c}
                      onSaved={onSaved}
                      onDelete={onDelete}
                      busyDelete={deletingId === c.id}
                    />
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  )
}
