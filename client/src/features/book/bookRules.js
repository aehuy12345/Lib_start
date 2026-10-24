import { AVATAR_ERROR, AVATAR_MAX_BYTES, AVATAR_TYPES } from '../profile/profileRules'

// Quy tắc validate 2.2.2, khớp với server/src/modules/book/book.validation.js và src/lib/isbn.js.

// Bỏ gạch ngang, khoảng trắng; x thường đổi thành X (edge 1, 2).
export function normalizeIsbn(value) {
  return String(value ?? '').replace(/[\s-]/g, '').toUpperCase()
}

export function isValidIsbn(isbn) {
  if (/^\d{9}[\dX]$/.test(isbn)) {
    const sum = [...isbn].reduce((acc, ch, i) => acc + (ch === 'X' ? 10 : Number(ch)) * (10 - i), 0)
    return sum % 11 === 0
  }
  if (/^\d{13}$/.test(isbn)) {
    const sum = [...isbn].reduce((acc, ch, i) => acc + Number(ch) * (i % 2 === 0 ? 1 : 3), 0)
    return sum % 10 === 0
  }
  return false
}

const text = (label, max) => ({
  validate: (v) => {
    const value = (v ?? '').trim()
    if (!value) return `${label} không được để trống`
    return value.length <= max || `${label} tối đa ${max} ký tự`
  },
})

// Chuỗi chỉ gồm chữ số (không nhận thập phân, chữ, dấu âm).
const isDigits = (v) => /^\d+$/.test(String(v ?? '').trim())

export const bookRules = {
  title: text('Tên sách', 100),
  author: text('Tác giả', 100),
  description: text('Mô tả', 255),
  publishYear: {
    validate: (v) => {
      const value = String(v ?? '').trim()
      if (!value) return 'Năm xuất bản không được để trống'
      if (!isDigits(value)) return 'Năm xuất bản không hợp lệ'
      const year = Number(value)
      return (year >= 1900 && year <= new Date().getFullYear()) || 'Năm xuất bản phải từ 1900 đến năm hiện tại'
    },
  },
  isbn: {
    validate: (v) => {
      const value = normalizeIsbn(v)
      return !value || isValidIsbn(value) || 'ISBN phải là ISBN-10 hoặc ISBN-13 hợp lệ'
    },
  },
  categoryId: { required: 'Vui lòng chọn thể loại' },
  quantity: {
    validate: (v) => {
      const value = String(v ?? '').trim()
      if (!value) return 'Số lượng không được để trống'
      if (!/^-?\d+$/.test(value)) return 'Số lượng phải là số nguyên'
      return Number(value) > 0 || 'Số lượng phải lớn hơn 0'
    },
  },
}

// Ảnh bìa cùng quy tắc với ảnh đại diện (design/flows/README.md mục "Upload file").
export const COVER_ERROR = AVATAR_ERROR

export function validateCoverFile(file) {
  if (!file) return null
  if (!AVATAR_TYPES.includes(file.type) || file.size > AVATAR_MAX_BYTES) return COVER_ERROR
  return null
}

// 2.2.5: tổng số lượng mới không nhỏ hơn số bản đang mượn + hư hỏng; câu chữ khớp server.
export function minQuantityRule({ borrowedQuantity = 0, damagedQuantity = 0 }) {
  const minimum = borrowedQuantity + damagedQuantity
  const message = damagedQuantity > 0
    ? `Tổng số lượng không được nhỏ hơn ${minimum} (${borrowedQuantity} bản đang mượn, ${damagedQuantity} bản hư hỏng)`
    : `Tổng số lượng không được nhỏ hơn số bản đang mượn (${borrowedQuantity})`
  return (v) => {
    const base = bookRules.quantity.validate(v)
    if (base !== true) return base
    return Number(String(v).trim()) >= minimum || message
  }
}
