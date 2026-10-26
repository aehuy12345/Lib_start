// Quy tắc 2.5.1, khớp với server/src/modules/fine/fine.validation.js.
export const NAME_MAX = 25
export const AMOUNT_MAX = 999999999
export const FINE_TYPES = [
  { value: 'late', label: 'Trả muộn' },
  { value: 'damaged', label: 'Hư hỏng' },
  { value: 'lost', label: 'Mất' },
]

export function validateTierName(value) {
  const name = String(value ?? '').trim()
  if (!name) return 'Tên mức phạt không được để trống'
  if (name.length > NAME_MAX) return `Tên mức phạt tối đa ${NAME_MAX} ký tự`
  return ''
}

// Edge 1, 2: số nguyên VND 1..999.999.999. Chỉ nhận chữ số (không nhận "150.000" để khỏi hiểu nhầm thành 150).
export function validateTierAmount(value) {
  const text = String(value ?? '').trim()
  if (!text) return 'Số tiền không được để trống'
  if (!/^-?\d+([.,]\d+)?$/.test(text)) return 'Số tiền phải là số'
  if (/[.,]/.test(text)) return 'Số tiền phải là số nguyên (VND)'
  const amount = Number(text)
  if (amount <= 0) return 'Số tiền phải lớn hơn 0'
  if (amount > AMOUNT_MAX) return 'Số tiền tối đa 999.999.999 đ'
  return ''
}

export function validateTierType(value) {
  return FINE_TYPES.some((t) => t.value === value) ? '' : 'Vui lòng chọn loại mức phạt'
}

// values: { name, type?, amount } (chuỗi từ form). Bỏ qua `type` khi sửa trên bảng.
export function validateTier(values, { withType = false } = {}) {
  const errors = {}
  const name = validateTierName(values.name)
  if (name) errors.name = name
  if (withType) {
    const type = validateTierType(values.type)
    if (type) errors.type = type
  }
  const amount = validateTierAmount(values.amount)
  if (amount) errors.amount = amount
  return errors
}
