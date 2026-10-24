import { INVALID_DAYS, requestedDaysRules } from './borrowRules'

describe('requestedDaysRules (2.3.1)', () => {
  it.each(['1', '14', '30', ' 7 '])('"%s" hợp lệ', (value) => {
    expect(requestedDaysRules.validate(value)).toBe(true)
  })

  it.each(['', '0', '-1', '31', '1.5', 'abc', '1e1', null])('edge 2: %j → lỗi', (value) => {
    expect(requestedDaysRules.validate(value)).toBe(INVALID_DAYS)
  })
})
