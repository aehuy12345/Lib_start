import dayjs from 'dayjs'

// Trạng thái đơn mượn; `overdue` do server suy ra từ hạn trả.
export const BORROW_STATUS_LABELS = {
  pending: 'Chờ xác nhận',
  borrowing: 'Đang mượn',
  overdue: 'Quá hạn',
  returned: 'Đã trả',
  rejected: 'Bị từ chối',
  cancelled: 'Đã hủy',
}

export function formatDate(value) {
  return value ? dayjs(value).format('DD/MM/YYYY') : '—'
}

export function isStaff(role) {
  return role === 'librarian' || role === 'admin'
}

// Nút "Mượn sách" theo flow 2.2.4. eligibility: undefined (đang kiểm tra), { error } hoặc kết quả API.
// kind: 'hidden' | 'login' | 'checking' | 'disabled' | 'enabled'
export function borrowButtonState({ authStatus, role, eligibility }) {
  if (authStatus === 'loading') return { kind: 'hidden' }
  if (authStatus !== 'authenticated') return { kind: 'login' }
  if (role !== 'reader') return { kind: 'hidden' }
  if (!eligibility) return { kind: 'checking' }
  if (eligibility.error) return { kind: 'disabled', message: eligibility.error }
  if (eligibility.canBorrow) return { kind: 'enabled' }
  return { kind: 'disabled', reason: eligibility.reason, message: eligibility.message }
}
