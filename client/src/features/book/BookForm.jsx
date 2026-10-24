import { useEffect, useMemo, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { parseApiError } from '../../api/client'
import FormField from '../profile/FormField'
import { applyServerErrors } from '../profile/formErrors'
import { bookRules, validateCoverFile } from './bookRules'

const EMPTY_BOOK = { title: '', author: '', publishYear: '', isbn: '', categoryId: '', description: '', quantity: '' }
const FIELDS = Object.keys(EMPTY_BOOK)
const CONTROL = 'mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 aria-[invalid=true]:border-red-500'
const BUTTON = 'rounded-md px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60'
const SECONDARY = `${BUTTON} border border-slate-300 bg-white text-slate-700 hover:bg-slate-50`

function FieldError({ id, error }) {
  return error ? <p id={id} className="mt-1 text-sm text-red-600">{error.message}</p> : null
}

// Chọn ảnh bìa (tùy chọn) với xem trước; lỗi hiển thị ngay tại field ảnh (2.2.2 edge 8).
// Khi sửa (2.2.5): currentUrl là ảnh hiện tại; có thể giữ nguyên, chọn ảnh mới hoặc xóa ảnh.
function CoverPicker({ file, onChange, currentUrl, removed, onRemovedChange, error, disabled }) {
  const inputRef = useRef(null)
  const preview = useMemo(() => (file ? URL.createObjectURL(file) : null), [file])
  const shown = preview ?? (removed ? null : currentUrl)

  useEffect(() => () => preview && URL.revokeObjectURL(preview), [preview])

  useEffect(() => {
    if (!file && inputRef.current) inputRef.current.value = ''
  }, [file])

  return (
    <div>
      <span className="block text-sm font-medium text-slate-700">Ảnh bìa (không bắt buộc)</span>
      <div className="mt-1 flex items-center gap-4">
        {shown ? (
          <img src={shown} alt={preview ? 'Xem trước ảnh bìa' : 'Ảnh bìa hiện tại'} className="h-32 w-24 rounded border border-slate-200 object-cover" />
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
          <div className="flex gap-2">
            {file && (
              <button type="button" onClick={() => onChange(null)} disabled={disabled} className={SECONDARY}>
                Bỏ ảnh
              </button>
            )}
            {!file && currentUrl && !removed && (
              <button type="button" onClick={() => onRemovedChange(true)} disabled={disabled} className={SECONDARY}>
                Xóa ảnh bìa
              </button>
            )}
            {!file && currentUrl && removed && (
              <button type="button" onClick={() => onRemovedChange(false)} disabled={disabled} className={SECONDARY}>
                Giữ ảnh cũ
              </button>
            )}
          </div>
          {!file && currentUrl && removed && <p className="text-xs text-amber-700">Ảnh bìa sẽ bị xóa khi lưu</p>}
          <p className="text-xs text-slate-500">JPG, PNG hoặc WebP, tối đa 2 MB</p>
        </div>
      </div>
      {error && <p id="cover-error" className="mt-1 text-sm text-red-600">{error}</p>}
    </div>
  )
}

// Form sách dùng cho 2.2.2 (thêm) và 2.2.5 (sửa).
// onSubmit(values, { cover, removeCover }) trả { text, warning?, reset? } để hiện thông báo thành công.
// onError(parsedError) trả true nếu trang tự xử lý lỗi (vd xung đột phiên bản khi sửa).
export default function BookForm({
  label, submitLabel, categories, defaultValues = EMPTY_BOOK, currentCoverUrl = null,
  quantityRule = bookRules.quantity, quantityHint, onSubmit, onError, onCategoryGone, disabled = false,
}) {
  const [cover, setCover] = useState(null)
  const [removeCover, setRemoveCover] = useState(false)
  const [coverError, setCoverError] = useState('')
  const [notice, setNotice] = useState({ type: '', text: '', warning: '' })
  const {
    register, handleSubmit, reset, setError, formState: { errors, isSubmitting },
  } = useForm({ defaultValues })

  const onPickCover = (file) => {
    const invalid = validateCoverFile(file)
    setCoverError(invalid ?? '')
    setCover(invalid ? null : file)
    return !invalid
  }

  const submit = async (values) => {
    setNotice({ type: '', text: '', warning: '' })
    try {
      const result = await onSubmit(values, { cover, removeCover })
      if (!result) return
      setNotice({ type: 'success', text: result.text, warning: result.warning ?? '' })
      if (result.reset) {
        reset(EMPTY_BOOK)
        setCover(null)
        setRemoveCover(false)
      }
    } catch (err) {
      const parsed = parseApiError(err)
      if (onError?.(parsed, err)) return
      // 2.2.2 edge 8: lỗi ảnh hiển thị tại field ảnh, các field khác giữ nguyên.
      const { cover: coverMsg, ...rest } = parsed.errors
      if (coverMsg) setCoverError(coverMsg)
      // Thể loại vừa bị xóa → trang tải lại danh sách để chọn lại (2.2.2 edge 7, 2.2.5 edge 4).
      if (rest.categoryId) onCategoryGone?.()
      const fieldErrors = Object.fromEntries(Object.entries(rest).filter(([field]) => FIELDS.includes(field)))
      const general = applyServerErrors(setError, { message: parsed.message, errors: fieldErrors })
      if (general && !coverMsg) setNotice({ type: 'error', text: general, warning: '' })
    }
  }

  const locked = isSubmitting || disabled

  return (
    <form aria-label={label} onSubmit={handleSubmit(submit)} noValidate className="space-y-4 rounded-lg bg-white p-6 shadow">
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
        <div>
          <FormField id="quantity" label="Số lượng bản sách" inputMode="numeric" error={errors.quantity} registration={register('quantity', quantityRule)} />
          {quantityHint && <p className="mt-1 text-xs text-slate-500">{quantityHint}</p>}
        </div>
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

      <CoverPicker
        file={cover}
        onChange={onPickCover}
        currentUrl={currentCoverUrl}
        removed={removeCover}
        onRemovedChange={setRemoveCover}
        error={coverError}
        disabled={locked}
      />

      {/* 2.2.2 edge 6: khóa nút khi đang gửi. */}
      <button type="submit" disabled={locked} className={`${BUTTON} bg-blue-600 px-4 py-2 text-white hover:bg-blue-700`}>
        {isSubmitting ? 'Đang lưu...' : submitLabel}
      </button>
    </form>
  )
}
