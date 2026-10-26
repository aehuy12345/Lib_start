import { nextStaffTicketParams, readStaffTicketParams, reviewNotice, staffEmptyMessage } from './fineReviewRules'

describe('fineReviewRules (2.5.3)', () => {
  it.each([
    ['', { status: 'pending', q: '', page: 1 }],
    ['status=paid&q=%20An%20&page=3', { status: 'paid', q: 'An', page: 3 }],
    ['status=due&page=-2', { status: 'pending', q: '', page: 1 }],
  ])('đọc URL "%s"', (search, expected) => {
    expect(readStaffTicketParams(new URLSearchParams(search))).toEqual(expected)
  })

  it('bỏ giá trị mặc định khỏi URL', () => {
    expect(nextStaffTicketParams({ status: 'pending', q: '', page: 1 })).toEqual({})
    expect(nextStaffTicketParams({ status: 'all', q: 'An', page: 2 })).toEqual({ status: 'all', q: 'An', page: '2' })
  })

  it('thông báo trống theo tab và khi tìm kiếm', () => {
    expect(staffEmptyMessage('pending', '')).toBe('Không có phiếu phạt nào chờ xác nhận.')
    expect(staffEmptyMessage('pending', 'xyz')).toBe('Không có phiếu phạt nào phù hợp.')
  })

  it('edge 5: báo độc giả hết bị chặn mượn khi không còn phiếu', () => {
    const ticket = { id: 7, reader: { name: 'An' } }
    expect(reviewNotice(ticket, { message: 'Đã xác nhận thanh toán', readerOutstanding: 0 }))
      .toBe('Phiếu #7 của An: Đã xác nhận thanh toán. Độc giả không còn khoản phạt nào và có thể mượn sách lại.')
    expect(reviewNotice(ticket, { message: 'Đã từ chối thanh toán', readerOutstanding: 2 }))
      .toMatch(/còn 2 phiếu phạt/)
  })
})
