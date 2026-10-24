import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link } from 'react-router-dom'
import { parseApiError } from '../api/client'
import { useAuth } from '../features/auth/AuthContext'
import { dashboardPath } from '../features/auth/session'
import { createBook } from '../features/book/bookApi'
import { bookRules, validateCoverFile } from '../features/book/bookRules'
import { listCategories } from '../features/category/categoryApi'
import FormField from '../features/profile/FormField'
import { applyServerErrors } from '../features/profile/formErrors'

const EMPTY = { title: '', author: '', publishYear: '', isbn: '', categoryId: '', description: '', quantity: '' }
const CONTROL = 'mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 aria-[invalid=true]:border-red-500'
const BUTTON = 'rounded-md px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60'

function FieldError({ id, error }) {
  return error ? <p id={id} className="mt-1 text-sm text-red-600">{error.message}</p> : null
}

// Chọn ảnh bìa (tùy chọn) với xem trước; lỗi hiển thị ngay tại field ảnh (edge 8).
function CoverPicker({ file, onChange, error, disabled }) {
  const inputRef = useRef(null)
  const preview = useMemo(() => (file ? URL.createObjectURL(file) : null), [file])

  useEffect(() => () => preview && URL.revokeObjectURL(preview), [preview])

  useEffect(() => {
    if (!file && inputRef.current) inputRef.current.value = ''
  }, [file])

  return (
    <div>
      <span className="block text-sm font-medium text-slate-700">Ảnh bìa (không bắt buộc)</span>
      <div className="mt-1 flex items-center gap-4">
        {preview ? (
          <img src={preview} alt="Xem trước ảnh bìa" className="h-32 w-24 rounded border border-slate-200 object-cover" />
        ) : (
          <div className="flex h-32 w-24 items-center justify-center rounded border border-dashed border-slate-300 text-xs text-slate-400">
            Chưa có ảnh
          </div>
        )}
        <div className="space-y-2">
          <input
            ref={inputRef}
            id="cover"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            aria-label="Chọn ảnh bìa"
            aria-invalid={error ? 'true' : 'false'}
            aria-describedby={error ? 'cover-error' : undefined}
            disabled={disabled}
            onChange={(e) => {
              // File bị từ chối thì xóa khỏi ô chọn để có thể chọn lại cùng file.
              if (!onChange(e.target.files?.[0] ?? null)) e.target.value = ''
            }}
            className="block text-sm text-slate-700 file:mr-3 file:rounded-md file:border file:border-slate-300 file:bg-white file:px-3 file:py-1.5 file:text-sm file:font-medium"
          />
          {file && (
            <button type="button" onClick={() => onChange(null)} disabled={disabled} className={`${BUTTON} border border-slate-300 bg-white text-slate-700 hover:bg-slate-50`}>
              Bỏ ảnh
            </button>
          )}
          <p className="text-xs text-slate-500">JPG, PNG hoặc WebP, tối đa 2 MB</p>
        </div>
      </div>
      {error && <p id="cover-error" className="mt-1 text-sm text-red-600">{error}</p>}
    </div>
  )
}

// 2.2.2 Thêm Sách Mới (nhân viên thư viện, Admin).
export default function AddBookPage() {
  const { user } = useAuth()
  const [categories, setCategories] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [cover, setCover] = useState(null)
  const [coverError, setCoverError] = useState('')
  const [notice, setNotice] = useState({ type: '', text: '', warning: '' })
  const {
    register, handleSubmit, reset, setError, formState: { errors, isSubmitting },
  } = useForm({ defaultValues: EMPTY })

  const loadCategories = useCallback(() => listCategories()
    .then((list) => { setCategories(list); setLoadError('') })
    .catch((err) => setLoadError(parseApiError(err).message)), [])

  useEffect(() => { loadCategories() }, [loadCategories])

  const onPickCover = (file) => {
    const invalid = validateCoverFile(file)
    setCoverError(invalid ?? '')
    setCover(invalid ? null : file)
    return !invalid
  }

  const onSubmit = async (values) => {
    setNotice({ type: '', text: '', warning: '' })
    try {
      const data = await createBook(values, cover)
      setNotice({ type: 'success', text: data.message, warning: data.warning ?? '' })
      reset(EMPTY)
      setCover(null)
    } catch (err) {
      // Edge 8: lỗi ảnh hiển thị tại field ảnh, các field khác giữ nguyên.
      const { message, errors: fieldErrors } = parseApiError(err)
      const { cover: coverMsg, ...rest } = fieldErrors
      if (coverMsg) setCoverError(coverMsg)
      // Edge 7: thể loại vừa bị xóa → tải lại danh sách để chọn lại.
      if (rest.categoryId) loadCategories()
      const general = applyServerErrors(setError, { message, errors: rest })
      if (general && !coverMsg) setNotice({ type: 'error', text: general, warning: '' })
    }
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
          <form aria-label="Thêm sách mới" onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4 rounded-lg bg-white p-6 shadow">
            {notice.text && (
              <div
                role={notice.type === 'error' ? 'alert' : 'status'}
                className={`rounded-md px-3 py-2 text-sm ${notice.type === 'error' ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}
              >
                <p>{notice.text}</p>
                {notice.warning && <p className="mt-1 text-amber-700">{notice.warning}</p>}
              </div>
            )}

            <FormField id="title" label="Tên sách" error={errors.title} registration={register('title', bookRules.title)} />
            <FormField id="author" label="Tác giả" error={errors.author} registration={register('author', bookRules.author)} />
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField id="publishYear" label="Năm xuất bản" inputMode="numeric" error={errors.publishYear} registration={register('publishYear', bookRules.publishYear)} />
              <FormField id="isbn" label="ISBN (không bắt buộc)" error={errors.isbn} registration={register('isbn', bookRules.isbn)} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="categoryId" className="block text-sm font-medium text-slate-700">Thể loại</label>
                <select
                  id="categoryId"
                  aria-invalid={errors.categoryId ? 'true' : 'false'}
                  aria-describedby={errors.categoryId ? 'categoryId-error' : undefined}
                  className={CONTROL}
                  {...register('categoryId', bookRules.categoryId)}
                >
                  <option value="">-- Chọn thể loại --</option>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <FieldError id="categoryId-error" error={errors.categoryId} />
              </div>
              <FormField id="quantity" label="Số lượng bản sách" inputMode="numeric" error={errors.quantity} registration={register('quantity', bookRules.quantity)} />
            </div>
            <div>
              <label htmlFor="description" className="block text-sm font-medium text-slate-700">Mô tả</label>
              <textarea
                id="description"
                rows={3}
                aria-invalid={errors.description ? 'true' : 'false'}
                aria-describedby={errors.description ? 'description-error' : undefined}
                className={CONTROL}
                {...register('description', bookRules.description)}
              />
              <FieldError id="description-error" error={errors.description} />
            </div>

            <CoverPicker file={cover} onChange={onPickCover} error={coverError} disabled={isSubmitting} />

            {/* Edge 6: khóa nút khi đang gửi. */}
            <button type="submit" disabled={isSubmitting} className={`${BUTTON} bg-blue-600 px-4 py-2 text-white hover:bg-blue-700`}>
              {isSubmitting ? 'Đang lưu...' : 'Thêm sách'}
            </button>
          </form>
        )}
      </section>
    </main>
  )
}
