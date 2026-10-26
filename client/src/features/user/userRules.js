// 2.6.1: bộ lọc vai trò, khớp listUsersQuerySchema ở server/src/modules/user/user.validation.js.
export const ROLE_FILTERS = [
  { value: 'all', label: 'Tất cả' },
  { value: 'reader', label: 'Độc giả' },
  { value: 'librarian', label: 'Nhân viên thư viện' },
  { value: 'admin', label: 'Quản lý viên' },
]
const FILTER_VALUES = ROLE_FILTERS.map((f) => f.value)
export const SEARCH_MAX = 100

export const ROLE_LABELS = { reader: 'Độc giả', librarian: 'Nhân viên thư viện', admin: 'Quản lý viên' }
// 2.6.2: khớp changeRoleSchema ở server.
export const ROLES = ['reader', 'librarian', 'admin']
export const USER_STATUS_LABELS = { pending: 'Chờ xác nhận', active: 'Kích hoạt', disabled: 'Vô hiệu hóa' }

// Giá trị lạ trên URL được thay bằng mặc định, giống server.
export function readUserListParams(searchParams) {
  const role = FILTER_VALUES.includes(searchParams.get('role')) ? searchParams.get('role') : 'all'
  const q = (searchParams.get('q') ?? '').trim().slice(0, SEARCH_MAX)
  const page = Number(searchParams.get('page'))
  return { role, q, page: Number.isInteger(page) && page > 0 ? page : 1 }
}

export function nextUserListParams({ role, q, page }) {
  const out = {}
  if (role && role !== 'all') out.role = role
  if (q) out.q = q
  if (page > 1) out.page = String(page)
  return out
}

export function emptyMessage(role, q) {
  if (q || role !== 'all') return 'Không tìm thấy người dùng.'
  return 'Chưa có người dùng nào.'
}

// Edge 1, 2: lý do không có nút Vô hiệu hóa với tài khoản đang hoạt động.
export function disableBlockedHint(user) {
  if (user.canDisable || user.status === 'disabled') return ''
  if (user.isSelf) return 'Tài khoản của bạn'
  return 'Admin cuối cùng đang hoạt động'
}

// 2.6.2: cảnh báo khi người dùng còn đơn mượn hoặc phiếu phạt; dữ liệu cũ giữ nguyên. Edge 3: tài khoản
// chưa kích hoạt thì vai trò mới chỉ có hiệu lực khi được kích hoạt.
export function roleConfirmMessage(user, role) {
  const lines = [`Đổi vai trò của ${user.name} (${user.email}) từ ${ROLE_LABELS[user.role]} thành ${ROLE_LABELS[role]}?`]
  const open = [
    user.activeBorrowCount && `đang mượn ${user.activeBorrowCount} cuốn sách`,
    user.pendingBorrowCount && `có ${user.pendingBorrowCount} yêu cầu mượn chờ duyệt`,
    user.unpaidFineCount && `có ${user.unpaidFineCount} phiếu phạt chưa thanh toán xong`,
  ].filter(Boolean)
  if (open.length) {
    lines.push(`Lưu ý: người dùng ${open.join(', ')}. Dữ liệu này vẫn giữ nguyên sau khi đổi vai trò.`)
  }
  if (user.status !== 'active') {
    lines.push('Tài khoản chưa được kích hoạt nên vai trò mới chỉ có hiệu lực sau khi kích hoạt.')
  }
  return lines.join('\n\n')
}

// Edge 3: vẫn cho vô hiệu hóa người đang mượn sách nhưng cảnh báo trước.
export function disableConfirmMessage(user) {
  const text = `Vô hiệu hóa tài khoản ${user.name} (${user.email})? Người dùng sẽ không đăng nhập được nữa.`
  if (!user.activeBorrowCount) return text
  return `${text}\n\nLưu ý: người dùng đang mượn ${user.activeBorrowCount} cuốn sách. `
    + 'Đơn mượn vẫn giữ nguyên, sách vẫn phải trả và nhân viên vẫn xử lý được trả sách, phiếu phạt.'
}
