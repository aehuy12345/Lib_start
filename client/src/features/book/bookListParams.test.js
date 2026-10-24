import { hasFilters, nextListParams, readListParams } from './bookListParams'

const read = (query) => readListParams(new URLSearchParams(query))

describe('readListParams (2.2.3)', () => {
  it('mặc định: trang 1, Tên A-Z, không lọc', () => {
    expect(read('')).toEqual({ q: '', categoryId: '', sort: 'name', page: 1 })
  })

  it('đọc đủ tham số, từ khóa được trim', () => {
    expect(read('q=%20T%C3%B4%20&categoryId=3&sort=popular&page=2'))
      .toEqual({ q: 'Tô', categoryId: '3', sort: 'popular', page: 2 })
  })

  it.each(['page=0', 'page=-1', 'page=1.5', 'page=abc'])('%s → trang 1', (query) => {
    expect(read(query).page).toBe(1)
  })

  it('sort lạ → name', () => {
    expect(read('sort=hack').sort).toBe('name')
  })
})

describe('nextListParams', () => {
  const current = { q: 'dế', categoryId: '3', sort: 'newest', page: 4 }

  it.each([
    [{ q: 'mèn' }, { q: 'mèn', categoryId: '3', sort: 'newest' }],
    [{ categoryId: '' }, { q: 'dế', sort: 'newest' }],
    [{ sort: 'popular' }, { q: 'dế', categoryId: '3', sort: 'popular' }],
  ])('đổi bộ lọc %j → về trang 1', (changes, expected) => {
    expect(nextListParams(current, changes)).toEqual(expected)
  })

  it('chuyển trang giữ bộ lọc', () => {
    expect(nextListParams(current, { page: 5 })).toEqual({ q: 'dế', categoryId: '3', sort: 'newest', page: '5' })
  })

  it('giá trị mặc định và từ khóa chỉ có khoảng trắng không ghi lên URL (edge 4)', () => {
    expect(nextListParams(current, { q: '   ', categoryId: '', sort: 'name', page: 1 })).toEqual({})
  })
})

describe('hasFilters', () => {
  it('có từ khóa hoặc thể loại mới tính là đang lọc; sắp xếp thì không', () => {
    expect(hasFilters({ q: '', categoryId: '' })).toBe(false)
    expect(hasFilters({ q: 'a', categoryId: '' })).toBe(true)
    expect(hasFilters({ q: '', categoryId: '2' })).toBe(true)
  })
})
