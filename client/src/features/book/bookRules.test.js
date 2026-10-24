import { bookRules, isValidIsbn, normalizeIsbn, validateCoverFile } from './bookRules'

const check = (field, value) => bookRules[field].validate(value)

describe('ISBN (2.2.2)', () => {
  it('edge 1, 2: chuẩn hóa gạch ngang, khoảng trắng, x thường', () => {
    expect(normalizeIsbn(' 978-0-306 40615-7 ')).toBe('9780306406157')
    expect(normalizeIsbn('080442957x')).toBe('080442957X')
  })

  it.each(['0306406152', '080442957X', '9780306406157'])('%s hợp lệ', (isbn) => {
    expect(isValidIsbn(isbn)).toBe(true)
  })

  it.each(['0306406153', '9780306406158', '12345', 'X306406152'])('%s không hợp lệ', (isbn) => {
    expect(isValidIsbn(isbn)).toBe(false)
  })

  it('bỏ trống được, có gạch ngang vẫn hợp lệ', () => {
    expect(check('isbn', '')).toBe(true)
    expect(check('isbn', '978-0-306-40615-7')).toBe(true)
    expect(check('isbn', '978-0-306-40615-8')).toBe('ISBN phải là ISBN-10 hoặc ISBN-13 hợp lệ')
  })
})

describe('bookRules (2.2.2)', () => {
  const year = new Date().getFullYear()

  it.each([
    ['title', '  ', 'Tên sách không được để trống'],
    ['title', 'a'.repeat(101), 'Tên sách tối đa 100 ký tự'],
    ['title', 'a'.repeat(100), true],
    ['author', '', 'Tác giả không được để trống'],
    ['description', 'a'.repeat(256), 'Mô tả tối đa 255 ký tự'],
    ['description', 'a'.repeat(255), true],
    ['publishYear', '', 'Năm xuất bản không được để trống'],
    ['publishYear', '1899', 'Năm xuất bản phải từ 1900 đến năm hiện tại'],
    ['publishYear', String(year + 1), 'Năm xuất bản phải từ 1900 đến năm hiện tại'],
    ['publishYear', '2000.5', 'Năm xuất bản không hợp lệ'],
    ['publishYear', '1900', true],
    ['publishYear', String(year), true],
    ['quantity', '0', 'Số lượng phải lớn hơn 0'],
    ['quantity', '-2', 'Số lượng phải lớn hơn 0'],
    ['quantity', '1.5', 'Số lượng phải là số nguyên'],
    ['quantity', 'abc', 'Số lượng phải là số nguyên'],
    ['quantity', '1', true],
  ])('%s = %j → %j', (field, value, expected) => {
    expect(check(field, value)).toBe(expected)
  })
})

describe('validateCoverFile', () => {
  it('không chọn ảnh là hợp lệ', () => expect(validateCoverFile(null)).toBeNull())
  it('PNG nhỏ hợp lệ', () => expect(validateCoverFile({ type: 'image/png', size: 100 })).toBeNull())
  it.each([
    { type: 'image/gif', size: 100 },
    { type: 'image/jpeg', size: 2 * 1024 * 1024 + 1 },
  ])('%j → lỗi', (file) => expect(validateCoverFile(file)).toBe('Chỉ nhận ảnh JPG, PNG, WebP tối đa 2 MB'))
})
