import { validateTier, validateTierAmount, validateTierName } from './fineRules'

describe('validateTierName (2.5.1)', () => {
  it.each([
    ['', 'Tên mức phạt không được để trống'],
    ['   ', 'Tên mức phạt không được để trống'],
    [undefined, 'Tên mức phạt không được để trống'],
    ['a'.repeat(26), 'Tên mức phạt tối đa 25 ký tự'],
    ['a'.repeat(25), ''],
    [`  ${'a'.repeat(25)}  `, ''],
  ])('%j → "%s"', (value, expected) => {
    expect(validateTierName(value)).toBe(expected)
  })
})

describe('validateTierAmount (edge 1, 2)', () => {
  it.each([
    ['', 'Số tiền không được để trống'],
    ['abc', 'Số tiền phải là số'],
    ['1e3', 'Số tiền phải là số'],
    ['150.000', 'Số tiền phải là số nguyên (VND)'],
    ['1000,5', 'Số tiền phải là số nguyên (VND)'],
    ['0', 'Số tiền phải lớn hơn 0'],
    ['-5000', 'Số tiền phải lớn hơn 0'],
    ['1000000000', 'Số tiền tối đa 999.999.999 đ'],
    ['99999999999999999999', 'Số tiền tối đa 999.999.999 đ'],
    ['1', ''],
    [' 150000 ', ''],
    ['999999999', ''],
    [50000, ''],
  ])('%j → "%s"', (value, expected) => {
    expect(validateTierAmount(value)).toBe(expected)
  })
})

describe('validateTier', () => {
  it('chỉ kiểm tra loại khi thêm mới', () => {
    expect(validateTier({ name: 'Muộn', amount: '1000' })).toEqual({})
    expect(validateTier({ name: 'Muộn', amount: '1000', type: '' }, { withType: true }))
      .toEqual({ type: 'Vui lòng chọn loại mức phạt' })
    expect(validateTier({ name: '', amount: '0', type: 'lost' }, { withType: true }))
      .toEqual({ name: 'Tên mức phạt không được để trống', amount: 'Số tiền phải lớn hơn 0' })
  })
})
