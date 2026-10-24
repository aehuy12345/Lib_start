// Quy tắc 2.3.1, khớp với server/src/modules/borrow/borrow.validation.js.
export const DEFAULT_BORROW_DAYS = 14
export const MAX_BORROW_DAYS = 30
export const INVALID_DAYS = `Thời hạn phải từ 1 đến ${MAX_BORROW_DAYS} ngày`

// Edge 2: 0, âm, 31+, thập phân, chữ đều bị từ chối.
export const requestedDaysRules = {
  validate: (v) => {
    const value = String(v ?? '').trim()
    if (!/^\d+$/.test(value)) return INVALID_DAYS
    const days = Number(value)
    return (days >= 1 && days <= MAX_BORROW_DAYS) || INVALID_DAYS
  },
}
