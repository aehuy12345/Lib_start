import {
  disableBlockedHint, disableConfirmMessage, emptyMessage, nextUserListParams, readUserListParams,
} from './userRules'

describe('userRules (2.6.1)', () => {
  it.each([
    ['', { role: 'all', q: '', page: 1 }],
    ['role=admin&q=%20an%20&page=2', { role: 'admin', q: 'an', page: 2 }],
    [`role=boss&q=${'x'.repeat(120)}&page=-3`, { role: 'all', q: 'x'.repeat(100), page: 1 }],
  ])('đọc URL "%s"', (search, expected) => {
    expect(readUserListParams(new URLSearchParams(search))).toEqual(expected)
  })

  it('chỉ ghi lên URL giá trị khác mặc định', () => {
    expect(nextUserListParams({ role: 'all', q: '', page: 1 })).toEqual({})
    expect(nextUserListParams({ role: 'reader', q: 'an', page: 3 })).toEqual({ role: 'reader', q: 'an', page: '3' })
  })

  it('thông báo khi không có kết quả', () => {
    expect(emptyMessage('all', 'zzz')).toBe('Không tìm thấy người dùng.')
    expect(emptyMessage('librarian', '')).toBe('Không tìm thấy người dùng.')
    expect(emptyMessage('all', '')).toBe('Chưa có người dùng nào.')
  })

  it('edge 1, 2: lý do không vô hiệu hóa được', () => {
    expect(disableBlockedHint({ canDisable: true, status: 'active' })).toBe('')
    expect(disableBlockedHint({ canDisable: false, status: 'disabled' })).toBe('')
    expect(disableBlockedHint({ canDisable: false, status: 'active', isSelf: true })).toBe('Tài khoản của bạn')
    expect(disableBlockedHint({ canDisable: false, status: 'active', isSelf: false })).toBe('Admin cuối cùng đang hoạt động')
  })

  it('edge 3: cảnh báo khi người dùng đang mượn sách', () => {
    const user = { name: 'An', email: 'an@example.com', activeBorrowCount: 0 }
    expect(disableConfirmMessage(user)).not.toContain('đang mượn')
    expect(disableConfirmMessage({ ...user, activeBorrowCount: 2 })).toContain('đang mượn 2 cuốn sách')
  })
})
