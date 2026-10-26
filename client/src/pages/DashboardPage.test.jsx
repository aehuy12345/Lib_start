import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import DashboardPage from './DashboardPage'
import { AuthProvider } from '../features/auth/AuthContext'
import RequireAuth from '../features/auth/RequireAuth'
import { getMe } from '../features/auth/authApi'
import {
  getBookStats, getBorrowsToday, getOverdueReaders, getReaderStats, getTopBooks,
} from '../features/dashboard/dashboardApi'
import { overdueRemainder, todayBreakdown } from '../features/dashboard/dashboardRules'

vi.mock('../features/auth/authApi', () => ({ login: vi.fn(), getMe: vi.fn() }))
vi.mock('../features/dashboard/dashboardApi', () => ({
  getBookStats: vi.fn(), getReaderStats: vi.fn(), getBorrowsToday: vi.fn(), getTopBooks: vi.fn(), getOverdueReaders: vi.fn(),
}))

const EMPTY = {
  books: { titleCount: 0, totalQuantity: 0, available: 0, borrowed: 0, lost: 0, damaged: 0 },
  readers: { active: 0, disabled: 0 },
  today: { date: '2026-10-26', total: 0, byStatus: { pending: 0, borrowing: 0, returned: 0, rejected: 0, cancelled: 0 } },
  top: { books: [] },
  overdue: { total: 0, limit: 10, readers: [] },
}

function mockApis(data = {}) {
  const d = { ...EMPTY, ...data }
  getBookStats.mockResolvedValue(d.books)
  getReaderStats.mockResolvedValue(d.readers)
  getBorrowsToday.mockResolvedValue(d.today)
  getTopBooks.mockResolvedValue(d.top)
  getOverdueReaders.mockResolvedValue(d.overdue)
}

function setup(role = 'librarian') {
  localStorage.setItem('token', 'saved')
  getMe.mockResolvedValue({ id: 2, email: 'l@example.com', name: 'Thủ Thư', role, status: 'active' })
  render(
    <MemoryRouter initialEntries={[`/${role}`]}>
      <AuthProvider>
        <Routes>
          <Route path="/:role" element={<RequireAuth roles={[role]}><DashboardPage /></RequireAuth>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  )
  return userEvent.setup()
}

const card = (name) => screen.findByRole('region', { name })

afterEach(() => {
  localStorage.clear()
  vi.resetAllMocks()
})

describe('DashboardPage (2.7.1)', () => {
  it('hiển thị các chỉ số tổng quan', async () => {
    mockApis({
      books: { titleCount: 12, totalQuantity: 1500, available: 1200, borrowed: 280, lost: 3, damaged: 17 },
      readers: { active: 40, disabled: 2 },
      today: { date: '2026-10-26', total: 4, byStatus: { pending: 1, borrowing: 3, returned: 0, rejected: 0, cancelled: 0 } },
      top: { books: [
        { id: 1, title: 'Mắt Biếc', author: 'Nguyễn Nhật Ánh', borrowCount: 9, deleted: false },
        { id: 2, title: 'Sách Cũ', author: 'X', borrowCount: 5, deleted: true },
      ] },
      overdue: { total: 1, limit: 10, readers: [{
        id: 5, name: 'An', email: 'an@example.com', maxLateDays: 6,
        books: [{ borrowOrderId: 11, bookId: 1, title: 'Mắt Biếc', dueDate: '2026-10-20', lateDays: 6 }],
      }] },
    })
    setup()

    const books = await card('Tổng số sách')
    expect(await within(books).findByText('12 đầu sách · 1.500 cuốn')).toBeInTheDocument()
    expect(within(books).getByText('Có sẵn').nextSibling).toHaveTextContent('1.200')
    expect(within(books).getByText('Đang mượn').nextSibling).toHaveTextContent('280')
    expect(within(books).getByText('Bị mất').nextSibling).toHaveTextContent('3')
    expect(within(books).getByText('Hư hỏng').nextSibling).toHaveTextContent('17')

    const readers = await card('Tổng số độc giả')
    expect(within(readers).getByText('Hoạt động').nextSibling).toHaveTextContent('40')
    expect(within(readers).getByText('Vô hiệu hóa').nextSibling).toHaveTextContent('2')

    const today = await card('Đơn mượn hôm nay')
    expect(within(today).getByText('Ngày 26/10/2026').nextSibling).toHaveTextContent('4')
    expect(within(today).getByText('1 chờ xác nhận · 3 đang mượn')).toBeInTheDocument()

    const top = await card('Top 5 sách phổ biến')
    expect(within(top).getByRole('link', { name: 'Mắt Biếc' })).toHaveAttribute('href', '/books/1')
    expect(within(top).getByText('9 lượt')).toBeInTheDocument()
    // Edge 7: sách đã xóa vẫn có trong thống kê mượn nhưng không có liên kết.
    expect(within(top).queryByRole('link', { name: /Sách Cũ/ })).toBeNull()
    expect(within(top).getByText('(đã xóa)')).toBeInTheDocument()

    const row = within(await card('Độc giả nợ quá hạn')).getByRole('row', { name: 'Độc giả quá hạn an@example.com' })
    expect(row).toHaveTextContent('An')
    expect(row).toHaveTextContent('Mắt Biếc (hạn 20/10/2026, muộn 6 ngày)')
    expect(row).toHaveTextContent('6 ngày')
  })

  it('edge 1: chưa có dữ liệu → 0 và trạng thái trống', async () => {
    mockApis()
    setup('admin')
    const books = await card('Tổng số sách')
    expect(await within(books).findByText('0 đầu sách · 0 cuốn')).toBeInTheDocument()
    expect(await screen.findByText('Chưa có sách nào được mượn.')).toBeInTheDocument()
    expect(screen.getByText('Không có độc giả nào quá hạn.')).toBeInTheDocument()
  })

  it('một thẻ lỗi hiển thị lỗi cục bộ kèm Thử lại, các thẻ khác vẫn hiển thị', async () => {
    mockApis()
    getTopBooks.mockRejectedValueOnce({ response: { status: 500, data: { message: 'Lỗi máy chủ' } } })
    const user = setup()
    const top = await card('Top 5 sách phổ biến')
    expect(await within(top).findByRole('alert')).toHaveTextContent('Lỗi máy chủ')
    expect(await screen.findByText('Không có độc giả nào quá hạn.')).toBeInTheDocument()

    await user.click(within(top).getByRole('button', { name: 'Thử lại' }))
    expect(await within(top).findByText('Chưa có sách nào được mượn.')).toBeInTheDocument()
    expect(getTopBooks).toHaveBeenCalledTimes(2)
    expect(getBookStats).toHaveBeenCalledTimes(1)
  })

  it('edge 3: quá 10 độc giả quá hạn → liên kết Xem tất cả tới báo cáo Phạt (2.7.2); có liên kết Báo cáo', async () => {
    mockApis({ overdue: { total: 12, limit: 10, readers: [{
      id: 5, name: 'An', email: 'an@example.com', maxLateDays: 6, books: [],
    }] } })
    setup('admin')
    const overdue = await card('Độc giả nợ quá hạn')
    expect(await within(overdue).findByText(/Còn 11 độc giả quá hạn khác/)).toBeInTheDocument()
    expect(within(overdue).getByRole('link', { name: 'Xem tất cả' })).toHaveAttribute('href', '/admin/reports?type=fines')
    expect(screen.getByRole('link', { name: 'Báo cáo' })).toHaveAttribute('href', '/admin/reports')
  })

  it('reader không thấy báo cáo và không gọi API', async () => {
    mockApis()
    setup('reader')
    expect(await screen.findByText('Xin chào, Thủ Thư.')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Tổng số sách' })).toBeNull()
    expect(getBookStats).not.toHaveBeenCalled()
  })
})

describe('dashboardRules', () => {
  it('edge 3: báo số độc giả quá hạn còn lại ngoài 10 dòng đầu', () => {
    const readers = Array.from({ length: 10 }, (_, i) => ({ id: i }))
    expect(overdueRemainder({ total: 25, readers })).toBe('Còn 15 độc giả quá hạn khác.')
    expect(overdueRemainder({ total: 10, readers })).toBeNull()
  })

  it('bỏ trạng thái bằng 0 khỏi dòng phụ đơn hôm nay', () => {
    expect(todayBreakdown({ pending: 0, borrowing: 2, rejected: 1 })).toBe('2 đang mượn · 1 bị từ chối')
    expect(todayBreakdown({})).toBe('')
  })
})
