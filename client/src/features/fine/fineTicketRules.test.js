import { emptyMessage, nextTicketParams, readTicketParams, validateReceiptFile, RECEIPT_ERROR } from './fineTicketRules'

describe('fineTicketRules (2.5.2)', () => {
  it.each([
    ['', { status: 'due', page: 1 }],
    ['status=paid&page=2', { status: 'paid', page: 2 }],
    ['status=xyz&page=0', { status: 'due', page: 1 }],
    ['status=all&page=1.5', { status: 'all', page: 1 }],
  ])('readTicketParams(%s)', (query, expected) => {
    expect(readTicketParams(new URLSearchParams(query))).toEqual(expected)
  })

  it('nextTicketParams bỏ giá trị mặc định', () => {
    expect(nextTicketParams({ status: 'due', page: 1 })).toEqual({})
    expect(nextTicketParams({ status: 'pending', page: 3 })).toEqual({ status: 'pending', page: '3' })
  })

  it('ảnh biên lai tùy chọn: không chọn → hợp lệ; sai định dạng hoặc > 2 MB → lỗi', () => {
    expect(validateReceiptFile(null)).toBeNull()
    expect(validateReceiptFile({ type: 'image/png', size: 100 })).toBeNull()
    expect(validateReceiptFile({ type: 'application/pdf', size: 100 })).toBe(RECEIPT_ERROR)
    expect(validateReceiptFile({ type: 'image/jpeg', size: 2 * 1024 * 1024 + 1 })).toBe(RECEIPT_ERROR)
  })

  it('emptyMessage theo bộ lọc', () => {
    expect(emptyMessage('all')).toBe('Bạn không có khoản phạt nào.')
    expect(emptyMessage('due')).toBe('Bạn không có khoản phạt nào cần thanh toán.')
  })
})
