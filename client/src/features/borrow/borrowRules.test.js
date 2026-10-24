import { INVALID_DAYS, REASON_REQUIRED, REASON_TOO_LONG, requestedDaysRules, validateRejectReason } from './borrowRules'

describe('requestedDaysRules (2.3.1)', () => {
  it.each(['1', '14', '30', ' 7 '])('"%s" hợp lệ', (value) => {
    expect(requestedDaysRules.validate(value)).toBe(true)
  })

  it.each(['', '0', '-1', '31', '1.5', 'abc', '1e1', null])('edge 2: %j → lỗi', (value) => {
    expect(requestedDaysRules.validate(value)).toBe(INVALID_DAYS)
  })
})

describe('validateRejectReason (2.3.2 edge 3)', () => {
  it.each(['', '   ', null, undefined])('%j → bắt buộc', (value) => {
    expect(validateRejectReason(value)).toBe(REASON_REQUIRED)
  })

  it('500 ký tự (sau trim) hợp lệ, 501 → quá dài', () => {
    expect(validateRejectReason(`  ${'a'.repeat(500)}  `)).toBeNull()
    expect(validateRejectReason('a'.repeat(501))).toBe(REASON_TOO_LONG)
  })
})
