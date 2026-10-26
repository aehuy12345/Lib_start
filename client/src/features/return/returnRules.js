// Quy tắc 2.4.2, khớp với server/src/modules/return/return.validation.js và return.rules.js.
export const CONDITIONS = [
  { value: 'normal', label: 'Bình thường' },
  { value: 'damaged', label: 'Hư hỏng' },
  { value: 'lost', label: 'Mất' },
]
export const FINE_TYPE_LABELS = { late: 'Trả muộn', damaged: 'Hư hỏng', lost: 'Mất' }
export const NOTE_MAX = 500
export const CONDITION_REQUIRED = 'Vui lòng chọn tình trạng sách'
export const TIER_REQUIRED = 'Vui lòng chọn mức phạt'
export const NOTE_REQUIRED = 'Ghi chú là bắt buộc khi sách hư hỏng hoặc mất'
export const NOTE_TOO_LONG = `Ghi chú tối đa ${NOTE_MAX} ký tự`
export const lateTierRequired = (lateDays) => `Sách trả muộn ${lateDays} ngày, vui lòng chọn mức phạt Trả muộn`

// Edge 4: Admin chưa cấu hình mức phạt cho loại cần dùng.
export const noTierMessage = (type) =>
  `Chưa có mức phạt "${FINE_TYPE_LABELS[type]}" nào được cấu hình, vui lòng liên hệ Admin`

export const needsFine = (condition) => condition === 'damaged' || condition === 'lost'

// Trả muộn áp dụng cho mọi tình trạng (README điểm 9), cộng hư hỏng hoặc mất.
export function requiredFineTypes(condition, lateDays) {
  const types = []
  if (lateDays > 0) types.push('late')
  if (needsFine(condition)) types.push(condition)
  return types
}

// values: { condition, fineTierId, lateFineTierId, note } (chuỗi từ form). Trả về lỗi theo field.
export function validateReturnForm(values, lateDays) {
  const errors = {}
  const note = String(values.note ?? '').trim()
  if (!CONDITIONS.some((c) => c.value === values.condition)) errors.condition = CONDITION_REQUIRED
  if (needsFine(values.condition)) {
    if (!values.fineTierId) errors.fineTierId = TIER_REQUIRED
    if (!note) errors.note = NOTE_REQUIRED
  }
  if (note.length > NOTE_MAX) errors.note = NOTE_TOO_LONG
  if (lateDays > 0 && !values.lateFineTierId) errors.lateFineTierId = lateTierRequired(lateDays)
  return errors
}

// Body gửi server: chỉ gửi mức phạt cần dùng.
export function buildReturnPayload(values, lateDays) {
  const payload = { condition: values.condition }
  const note = String(values.note ?? '').trim()
  if (note) payload.note = note
  if (needsFine(values.condition)) payload.fineTierId = Number(values.fineTierId)
  if (lateDays > 0) payload.lateFineTierId = Number(values.lateFineTierId)
  return payload
}

const amountFormatter = new Intl.NumberFormat('vi-VN')
export const formatAmount = (amount) => `${amountFormatter.format(amount)} đ`
