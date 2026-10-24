import { borrowButtonState, formatDate, isStaff } from './bookDetail'

describe('borrowButtonState (2.2.4)', () => {
  it('đang khôi phục phiên → ẩn', () => {
    expect(borrowButtonState({ authStatus: 'loading' })).toEqual({ kind: 'hidden' })
  })

  it('khách → dẫn tới đăng nhập', () => {
    expect(borrowButtonState({ authStatus: 'anonymous' })).toEqual({ kind: 'login' })
  })

  it.each(['librarian', 'admin'])('%s → ẩn', (role) => {
    expect(borrowButtonState({ authStatus: 'authenticated', role })).toEqual({ kind: 'hidden' })
  })

  it('reader: đang kiểm tra → checking; đủ điều kiện → enabled', () => {
    const base = { authStatus: 'authenticated', role: 'reader' }
    expect(borrowButtonState(base)).toEqual({ kind: 'checking' })
    expect(borrowButtonState({ ...base, eligibility: { canBorrow: true } })).toEqual({ kind: 'enabled' })
  })

  it('reader không đủ điều kiện → khóa kèm lý do từ server', () => {
    const eligibility = { canBorrow: false, reason: 'limit_reached', message: 'Đã đạt giới hạn mượn tối đa 5 cuốn' }
    expect(borrowButtonState({ authStatus: 'authenticated', role: 'reader', eligibility }))
      .toEqual({ kind: 'disabled', reason: 'limit_reached', message: 'Đã đạt giới hạn mượn tối đa 5 cuốn' })
  })

  it('lỗi khi kiểm tra → khóa kèm thông báo lỗi', () => {
    expect(borrowButtonState({ authStatus: 'authenticated', role: 'reader', eligibility: { error: 'Sách không còn tồn tại' } }))
      .toEqual({ kind: 'disabled', message: 'Sách không còn tồn tại' })
  })
})

describe('formatDate / isStaff', () => {
  it('định dạng DD/MM/YYYY, rỗng → —', () => {
    expect(formatDate('2026-11-07')).toBe('07/11/2026')
    expect(formatDate(null)).toBe('—')
  })

  it('chỉ librarian và admin là nhân viên', () => {
    expect(['reader', 'librarian', 'admin', undefined].map(isStaff)).toEqual([false, true, true, false])
  })
})
