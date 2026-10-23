import { dashboardPath, safeRedirect } from './session'

describe('session helpers (2.1.2)', () => {
  it('dashboardPath theo vai trò', () => {
    expect(dashboardPath('reader')).toBe('/reader')
    expect(dashboardPath('librarian')).toBe('/librarian')
    expect(dashboardPath('admin')).toBe('/admin')
    expect(dashboardPath(undefined)).toBe('/login')
  })

  it.each([
    ['/reader/books?page=2', '/reader/books?page=2'],
    ['//evil.com', null],
    ['/\\evil.com', null],
    ['https://evil.com', null],
    ['/login?redirect=/x', null],
    [null, null],
  ])('safeRedirect(%s) → %s', (input, expected) => {
    expect(safeRedirect(input)).toBe(expected)
  })
})
