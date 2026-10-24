import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import BookDetailPage from './BookDetailPage'
import { AuthProvider } from '../features/auth/AuthContext'
import { getMe } from '../features/auth/authApi'
import { getBook, getBorrowEligibility, getBorrowHistory } from '../features/book/bookApi'

vi.mock('../features/auth/authApi', () => ({ login: vi.fn(), getMe: vi.fn() }))
vi.mock('../features/book/bookApi', () => ({ getBook: vi.fn(), getBorrowHistory: vi.fn(), getBorrowEligibility: vi.fn() }))

const BOOK = {
  id: 7, title: 'Dế Mèn phiêu lưu ký', author: 'Tô Hoài', isbn: '9780306406157', publishYear: 1941,
  description: 'Truyện thiếu nhi', category: { id: 1, name: 'Văn học' }, coverUrl: null,
  totalQuantity: 5, availableQuantity: 2, borrowedQuantity: 3,
}
const USERS = {
  reader: { id: 1, name: 'Độc Giả', role: 'reader' },
  librarian: { id: 2, name: 'Thủ Thư', role: 'librarian' },
  admin: { id: 3, name: 'Quản Trị', role: 'admin' },
}
const apiError = (status, data = {}) => Object.assign(new Error('api'), { response: { status, data } })
const history = (borrows, { page = 1, totalPages = 1 } = {}) => ({
  borrows, pagination: { page, pageSize: 10, total: borrows.length, totalPages },
})
const BORROW = {
  id: 1, reader: { id: 1, name: 'Nguyễn Văn A', email: 'a@example.com' }, status: 'overdue',
  requestedAt: '2026-10-01T03:00:00Z', borrowedAt: '2026-10-02T03:00:00Z', dueDate: '2026-10-16', returnedAt: null,
}

function Spy() {
  const { pathname, search } = useLocation()
  return <span data-testid="location">{pathname + search}</span>
}

function setup({ role, url = '/books/7' } = {}) {
  if (role) {
    localStorage.setItem('token', 't')
    getMe.mockResolvedValue(USERS[role])
  }
  const user = userEvent.setup()
  render(
    <MemoryRouter initialEntries={[url]}>
      <AuthProvider>
        <Routes>
          <Route path="/books/:id" element={<BookDetailPage />} />
          <Route path="*" element={<Spy />} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  )
  return user
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  getBook.mockResolvedValue(BOOK)
  getBorrowHistory.mockResolvedValue(history([]))
  getBorrowEligibility.mockResolvedValue({ canBorrow: true, reason: null, message: null })
})

describe('BookDetailPage (2.2.4)', () => {
  it('khách: hiển thị đủ thông tin PRD, ảnh mặc định, không gọi lịch sử hay điều kiện mượn', async () => {
    setup()
    const article = await screen.findByRole('article', { name: BOOK.title })
    expect(getBook).toHaveBeenCalledWith('7')
    for (const text of ['Tô Hoài', '9780306406157', '1941', 'Văn học', 'Truyện thiếu nhi']) {
      expect(article).toHaveTextContent(text)
    }
    expect(article).toHaveTextContent('Có sẵn2')
    expect(article).toHaveTextContent('Đang mượn3')
    expect(within(article).getByRole('img', { name: 'Ảnh bìa mặc định' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Lịch sử mượn' })).not.toBeInTheDocument()
    expect(getBorrowHistory).not.toHaveBeenCalled()
    expect(getBorrowEligibility).not.toHaveBeenCalled()
  })

  it('khách bấm Mượn sách → đăng nhập kèm redirect về trang này', async () => {
    const user = setup()
    await user.click(await screen.findByRole('button', { name: 'Mượn sách' }))
    expect(screen.getByTestId('location')).toHaveTextContent('/login?redirect=%2Fbooks%2F7')
  })

  it('sách không có ISBN → "Chưa có"; hết sách có nhãn', async () => {
    getBook.mockResolvedValue({ ...BOOK, isbn: null, availableQuantity: 0 })
    setup()
    const article = await screen.findByRole('article', { name: BOOK.title })
    expect(article).toHaveTextContent('ISBNChưa có')
    expect(within(article).getByText('Hết sách')).toBeInTheDocument()
  })

  it('edge 1: 404 → trang Không tìm thấy sách', async () => {
    getBook.mockRejectedValue(apiError(404, { message: 'Không tìm thấy sách' }))
    setup({ url: '/books/abc' })
    const alert = await screen.findByRole('alert')
    expect(within(alert).getByRole('heading', { name: 'Không tìm thấy sách' })).toBeInTheDocument()
    expect(within(alert).getByRole('link', { name: 'Về danh sách sách' })).toHaveAttribute('href', '/books')
  })

  it('lỗi mạng → thông báo và Thử lại', async () => {
    getBook.mockRejectedValueOnce(new Error('network'))
    const user = setup()
    await user.click(await screen.findByRole('button', { name: 'Thử lại' }))
    expect(await screen.findByRole('article', { name: BOOK.title })).toBeInTheDocument()
    expect(getBook).toHaveBeenCalledTimes(2)
  })

  it('reader đủ điều kiện: nút Mượn hoạt động, không thấy lịch sử', async () => {
    const user = setup({ role: 'reader' })
    const button = await screen.findByRole('button', { name: 'Mượn sách' })
    await vi.waitFor(() => expect(button).toBeEnabled())
    expect(getBorrowEligibility).toHaveBeenCalledWith(7)
    expect(getBorrowHistory).not.toHaveBeenCalled()
    await user.click(button)
    expect(screen.getByRole('status')).toHaveTextContent('đang được phát triển')
  })

  it.each([
    ['out_of_stock', 'Hết sách'],
    ['limit_reached', 'Đã đạt giới hạn mượn tối đa 5 cuốn'],
    ['unpaid_fine', 'Cần thanh toán phiếu phạt trước khi mượn'],
    ['already_requested', 'Bạn đang mượn hoặc đã gửi yêu cầu mượn sách này'],
  ])('reader không đủ điều kiện (%s) → nút khóa kèm lý do', async (reason, message) => {
    getBorrowEligibility.mockResolvedValue({ canBorrow: false, reason, message })
    setup({ role: 'reader' })
    const button = await screen.findByRole('button', { name: 'Mượn sách' })
    await vi.waitFor(() => expect(button).toHaveAccessibleDescription(message))
    expect(button).toBeDisabled()
  })

  it('edge 2: sách bị xóa khi đang xem → nút khóa, báo sách không còn tồn tại', async () => {
    getBorrowEligibility.mockRejectedValue(apiError(404, { message: 'Không tìm thấy sách' }))
    setup({ role: 'reader' })
    expect(await screen.findByText('Sách không còn tồn tại')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Mượn sách' })).toBeDisabled()
  })

  it.each(['librarian', 'admin'])('%s: thấy bảng lịch sử mượn, không có nút Mượn', async (role) => {
    getBorrowHistory.mockResolvedValue(history([BORROW, { ...BORROW, id: 2, status: 'pending', borrowedAt: null, dueDate: null }]))
    setup({ role })
    const table = await screen.findByRole('table')
    const rows = within(table).getAllByRole('row')
    expect(rows[0]).toHaveTextContent('Độc giảNgày yêu cầuNgày mượnNgày hết hạnTrạng thái')
    expect(rows[1]).toHaveTextContent('Nguyễn Văn A')
    expect(rows[1]).toHaveTextContent('02/10/2026')
    expect(rows[1]).toHaveTextContent('16/10/2026')
    expect(rows[1]).toHaveTextContent('Quá hạn')
    expect(rows[2]).toHaveTextContent('Chờ xác nhận')
    expect(rows[2]).toHaveTextContent('—')
    expect(getBorrowHistory).toHaveBeenCalledWith(7, 1)
    expect(screen.queryByRole('button', { name: 'Mượn sách' })).not.toBeInTheDocument()
    expect(getBorrowEligibility).not.toHaveBeenCalled()
  })

  it('edge 5: sách chưa từng được mượn → lịch sử trống', async () => {
    setup({ role: 'librarian' })
    expect(await screen.findByText('Sách chưa từng được mượn')).toBeInTheDocument()
  })

  it('edge 6: lịch sử nhiều trang → phân trang', async () => {
    getBorrowHistory.mockResolvedValue(history([BORROW], { page: 1, totalPages: 2 }))
    const user = setup({ role: 'librarian' })
    const nav = await screen.findByRole('navigation', { name: 'Phân trang lịch sử mượn' })
    expect(nav).toHaveTextContent('Trang 1 / 2')
    await user.click(within(nav).getByRole('button', { name: 'Trang sau' }))
    expect(getBorrowHistory).toHaveBeenLastCalledWith(7, 2)
  })
})
