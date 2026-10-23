import { validateCategoryName } from './categoryRules'

describe('validateCategoryName (2.2.1)', () => {
  it.each([
    ['', 'Tên thể loại không được để trống'],
    ['   ', 'Tên thể loại không được để trống'],
    [undefined, 'Tên thể loại không được để trống'],
    ['a'.repeat(51), 'Tên thể loại tối đa 50 ký tự'],
    ['a'.repeat(50), ''],
    [`  ${'a'.repeat(50)}  `, ''],
    ['Văn học', ''],
  ])('%j → "%s"', (value, expected) => {
    expect(validateCategoryName(value)).toBe(expected)
  })
})
