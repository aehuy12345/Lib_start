import { useEffect, useRef, useState } from 'react'
import { parseApiError } from '../../api/client'
import { deleteAvatar, uploadAvatar } from './profileApi'
import { validateAvatarFile } from './profileRules'

// Ảnh vuông, object-cover để ảnh lớn hoặc khác tỉ lệ vẫn hiển thị gọn (edge 10).
export function Avatar({ url, name, size = 'h-24 w-24' }) {
  if (url) {
    return <img src={url} alt="Ảnh đại diện" className={`${size} rounded-full object-cover`} />
  }
  return (
    <div
      role="img"
      aria-label="Ảnh đại diện mặc định"
      className={`${size} flex items-center justify-center rounded-full bg-slate-200 text-3xl font-semibold text-slate-500`}
    >
      {name?.trim().charAt(0).toUpperCase() || '?'}
    </div>
  )
}

// Flow ảnh đại diện 2.1.3: chọn → xem trước → xác nhận mới gửi; xóa có hộp thoại xác nhận.
export default function AvatarSection({ url, name, onChange }) {
  const inputRef = useRef(null)
  const [pending, setPending] = useState(null) // { file, preview }
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => () => pending && URL.revokeObjectURL(pending.preview), [pending])

  const reset = () => {
    setPending(null)
    if (inputRef.current) inputRef.current.value = ''
  }

  const onPick = (e) => {
    const file = e.target.files?.[0]
    setNotice('')
    if (!file) return
    const invalid = validateAvatarFile(file)
    if (invalid) {
      setError(invalid)
      reset()
      return
    }
    setError('')
    setPending({ file, preview: URL.createObjectURL(file) })
  }

  // Edge 13: khóa nút khi đang gửi.
  const run = async (action, success) => {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const data = await action()
      onChange(data.avatarUrl)
      setNotice(success)
      reset()
    } catch (err) {
      setError(parseApiError(err).message)
    } finally {
      setBusy(false)
    }
  }

  const onConfirm = () => run(() => uploadAvatar(pending.file), 'Cập nhật ảnh đại diện thành công')
  const onDelete = () => {
    if (!window.confirm('Xóa ảnh đại diện?')) return
    run(deleteAvatar, 'Đã xóa ảnh đại diện')
  }

  return (
    <div className="flex flex-col items-center gap-3">
      {pending ? (
        <img src={pending.preview} alt="Xem trước ảnh đại diện" className="h-24 w-24 rounded-full object-cover" />
      ) : (
        <Avatar url={url} name={name} />
      )}

      <input
        ref={inputRef}
        id="avatar-input"
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        aria-label="Chọn ảnh đại diện"
        onChange={onPick}
        disabled={busy}
      />

      {pending ? (
        <div className="flex gap-2">
          <button type="button" onClick={onConfirm} disabled={busy} className={PRIMARY}>
            {busy ? 'Đang tải...' : 'Xác nhận'}
          </button>
          <button type="button" onClick={reset} disabled={busy} className={SECONDARY}>Hủy</button>
        </div>
      ) : (
        <div className="flex gap-2">
          <label htmlFor="avatar-input" className={`${SECONDARY} cursor-pointer`}>
            {url ? 'Đổi ảnh' : 'Tải ảnh lên'}
          </label>
          {url && (
            <button type="button" onClick={onDelete} disabled={busy} className={DANGER}>Xóa ảnh</button>
          )}
        </div>
      )}

      <p className="text-xs text-slate-500">JPG, PNG hoặc WebP, tối đa 2 MB</p>
      {error && <p role="alert" className="text-center text-sm text-red-600">{error}</p>}
      {notice && <p role="status" className="text-sm text-green-700">{notice}</p>}
    </div>
  )
}

const BUTTON = 'rounded-md px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60'
const PRIMARY = `${BUTTON} bg-blue-600 text-white hover:bg-blue-700`
const SECONDARY = `${BUTTON} border border-slate-300 bg-white text-slate-700 hover:bg-slate-50`
const DANGER = `${BUTTON} border border-red-200 bg-white text-red-600 hover:bg-red-50`
