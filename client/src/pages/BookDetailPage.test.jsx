import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import BookDetailPage from './BookDetailPage'
import { AuthProvider } from '../features/auth/AuthContext'
import { getMe } from '../features/auth/authApi'
import { deleteBook, getBook, getBorrowEligibility, getBorrowHistory, getDeleteCheck } from '../features/book/bookApi'
import { cancelBorrowOrder, createBorrowOrder } from '../features/borrow/borrowApi'

vi.mock('../features/auth/authApi', () => ({ login: vi.fn(), getMe: vi.fn() }))
vi.mock('../features/book/bookApi', () => ({
  getBook: vi.fn(), getBorrowHistory: vi.fn(), getBorrowEligibility: vi.fn(), getDeleteCheck: vi.fn(), deleteBook: vi.fn(),
}))
vi.mock('../features/borrow/borrowApi', () => ({ createBorrowOrder: vi.fn(), cancelBorrowOrder: vi.fn() }))

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

function setup({ role, url = '/books/7', state } = {}) {
  if (role) {
    localStorage.setItem('token', 't')
    getMe.mockResolvedValue(USERS[role])
  }
  const user = userEvent.setup()
  render(
    <MemoryRouter initialEntries={[state ? { pathname: url, state } : url]}>
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
    expect(screen.getByRole('form', { name: 'Yêu cầu mượn sách' })).toBeInTheDocument()
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

describe('BookDetailPage — Sửa & Xóa (2.2.5)', () => {
  const location = () => screen.getByTestId('location')

  it.each(['reader', undefined])('%s: không thấy nút Sửa/Xóa', async (role) => {
    setup({ role })
    await screen.findByRole('heading', { name: BOOK.title })
    expect(screen.queryByRole('link', { name: 'Sửa' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Xóa' })).not.toBeInTheDocument()
  })

  it.each(['librarian', 'admin'])('%s: nút Sửa mở trang sửa theo vai trò', async (role) => {
    const user = setup({ role })
    await user.click(await screen.findByRole('link', { name: 'Sửa' }))
    expect(location()).toHaveTextContent(`/${role}/books/7/edit`)
  })

  it('còn đơn hoạt động → chặn xóa, báo số đơn, không hỏi xác nhận', async () => {
    getDeleteCheck.mockResolvedValue({ canDelete: false, activeBorrowCount: 2 })
    const confirm = vi.spyOn(window, 'confirm')
    const user = setup({ role: 'librarian' })
    await user.click(await screen.findByRole('button', { name: 'Xóa' }))
    expect(await screen.findByText(/sách đang có 2 đơn mượn hoạt động/)).toBeInTheDocument()
    expect(confirm).not.toHaveBeenCalled()
    expect(deleteBook).not.toHaveBeenCalled()
  })

  it('hủy hộp thoại xác nhận → ở lại trang chi tiết', async () => {
    getDeleteCheck.mockResolvedValue({ canDelete: true, activeBorrowCount: 0 })
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    const user = setup({ role: 'librarian' })
    await user.click(await screen.findByRole('button', { name: 'Xóa' }))
    expect(window.confirm).toHaveBeenCalledWith('Xóa sách "Dế Mèn phiêu lưu ký"?')
    expect(deleteBook).not.toHaveBeenCalled()
    expect(screen.getByRole('heading', { name: BOOK.title })).toBeInTheDocument()
  })

  it('đồng ý → xóa và về danh sách (giữ bộ lọc)', async () => {
    getDeleteCheck.mockResolvedValue({ canDelete: true, activeBorrowCount: 0 })
    deleteBook.mockResolvedValue({ message: 'Đã xóa sách' })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const user = setup({ role: 'librarian', state: { listSearch: '?q=de' } })
    await user.click(await screen.findByRole('button', { name: 'Xóa' }))
    expect(deleteBook).toHaveBeenCalledWith(7)
    expect(await screen.findByTestId('location')).toHaveTextContent('/books?q=de')
  })

  it('có đơn mới trong lúc xác nhận (409) → hiện lỗi của server', async () => {
    getDeleteCheck.mockResolvedValue({ canDelete: true, activeBorrowCount: 0 })
    deleteBook.mockRejectedValue(apiError(409, { message: 'Không thể xóa: sách đang có 1 đơn mượn hoạt động' }))
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const user = setup({ role: 'librarian' })
    await user.click(await screen.findByRole('button', { name: 'Xóa' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('1 đơn mượn hoạt động')
  })

  it('hiện thông báo cập nhật thành công (kèm cảnh báo) khi đến từ trang sửa', async () => {
    setup({ role: 'librarian', state: { notice: { text: 'Cập nhật sách thành công', warning: 'Lưu ý: đã có sách cùng tên và tác giả' } } })
    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent('Cập nhật sách thành công')
    expect(status).toHaveTextContent('Lưu ý: đã có sách cùng tên và tác giả')
  })
})

describe('BookDetailPage – gửi yêu cầu mượn (2.3.1)', () => {
  const ELIGIBLE = { canBorrow: true, reason: null, message: null, activeOrder: null }
  const PENDING = {
    canBorrow: false, reason: 'already_requested', message: 'Bạn đang mượn hoặc đã gửi yêu cầu mượn sách này',
    activeOrder: { id: 50, status: 'pending' },
  }

  async function openForm() {
    const user = setup({ role: 'reader' })
    const button = await screen.findByRole('button', { name: 'Mượn sách' })
    await vi.waitFor(() => expect(button).toBeEnabled())
    await user.click(button)
    return { user, input: screen.getByLabelText(/Thời hạn mượn/) }
  }

  beforeEach(() => {
    getBorrowEligibility.mockResolvedValue(ELIGIBLE)
  })

  it('mặc định 14 ngày; gửi → thông báo chờ xác nhận và tải lại điều kiện mượn', async () => {
    createBorrowOrder.mockResolvedValue({ message: 'Đã gửi yêu cầu mượn, chờ nhân viên xác nhận', order: { id: 50 } })
    const { user, input } = await openForm()
    expect(input).toHaveValue(14)
    getBorrowEligibility.mockResolvedValue(PENDING)
    await user.click(screen.getByRole('button', { name: 'Gửi yêu cầu' }))
    expect(createBorrowOrder).toHaveBeenCalledWith(7, 14)
    expect(await screen.findByRole('status')).toHaveTextContent('Đã gửi yêu cầu mượn, chờ nhân viên xác nhận')
    expect(screen.queryByRole('form', { name: 'Yêu cầu mượn sách' })).not.toBeInTheDocument()
    expect(getBorrowEligibility).toHaveBeenCalledTimes(2)
    expect(await screen.findByRole('button', { name: 'Hủy yêu cầu mượn' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Mượn sách' })).toBeDisabled()
  })

  it('chọn 30 ngày → gửi đúng số ngày', async () => {
    createBorrowOrder.mockResolvedValue({ message: 'ok' })
    const { user, input } = await openForm()
    await user.clear(input)
    await user.type(input, '30')
    await user.click(screen.getByRole('button', { name: 'Gửi yêu cầu' }))
    expect(createBorrowOrder).toHaveBeenCalledWith(7, 30)
  })

  it.each(['0', '31', '-3'])('edge 2: %s ngày → lỗi tại chỗ, không gọi API', async (value) => {
    const { user, input } = await openForm()
    await user.clear(input)
    await user.type(input, value)
    await user.click(screen.getByRole('button', { name: 'Gửi yêu cầu' }))
    expect(await screen.findByText('Thời hạn phải từ 1 đến 30 ngày')).toBeInTheDocument()
    expect(createBorrowOrder).not.toHaveBeenCalled()
  })

  it('server từ chối (vd vừa có phiếu phạt) → đóng form, báo lỗi, khóa nút theo điều kiện mới', async () => {
    const message = 'Cần thanh toán phiếu phạt trước khi mượn'
    createBorrowOrder.mockRejectedValue(apiError(409, { message, reason: 'unpaid_fine' }))
    const { user } = await openForm()
    getBorrowEligibility.mockResolvedValue({ canBorrow: false, reason: 'unpaid_fine', message, activeOrder: null })
    await user.click(screen.getByRole('button', { name: 'Gửi yêu cầu' }))
    const button = screen.getByRole('button', { name: 'Mượn sách' })
    await vi.waitFor(() => expect(button).toHaveAccessibleDescription(message))
    expect(button).toBeDisabled()
    expect(screen.queryByRole('form', { name: 'Yêu cầu mượn sách' })).not.toBeInTheDocument()
  })

  it('lỗi mạng → báo lỗi trong form, giữ form để gửi lại', async () => {
    createBorrowOrder.mockRejectedValue(new Error('network'))
    const { user } = await openForm()
    await user.click(screen.getByRole('button', { name: 'Gửi yêu cầu' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Không kết nối được máy chủ')
    expect(screen.getByRole('form', { name: 'Yêu cầu mượn sách' })).toBeInTheDocument()
  })

  it('Đóng → ẩn form', async () => {
    const { user } = await openForm()
    await user.click(screen.getByRole('button', { name: 'Đóng' }))
    expect(screen.queryByRole('form', { name: 'Yêu cầu mượn sách' })).not.toBeInTheDocument()
  })

  it('đơn đang chờ → Hủy yêu cầu mượn (xác nhận) → hủy và tải lại', async () => {
    getBorrowEligibility.mockResolvedValue(PENDING)
    cancelBorrowOrder.mockResolvedValue({ message: 'Đã hủy yêu cầu mượn' })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const user = setup({ role: 'reader' })
    const cancel = await screen.findByRole('button', { name: 'Hủy yêu cầu mượn' })
    getBorrowEligibility.mockResolvedValue(ELIGIBLE)
    await user.click(cancel)
    expect(cancelBorrowOrder).toHaveBeenCalledWith(50)
    expect(await screen.findByRole('status')).toHaveTextContent('Đã hủy yêu cầu mượn')
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Mượn sách' })).toBeEnabled())
    expect(screen.queryByRole('button', { name: 'Hủy yêu cầu mượn' })).not.toBeInTheDocument()
  })

  it('không đồng ý hủy → không gọi API', async () => {
    getBorrowEligibility.mockResolvedValue(PENDING)
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    const user = setup({ role: 'reader' })
    await user.click(await screen.findByRole('button', { name: 'Hủy yêu cầu mượn' }))
    expect(cancelBorrowOrder).not.toHaveBeenCalled()
  })

  it('đơn đang mượn (không còn chờ) → không có nút hủy', async () => {
    getBorrowEligibility.mockResolvedValue({ ...PENDING, activeOrder: { id: 50, status: 'borrowing' } })
    setup({ role: 'reader' })
    const button = await screen.findByRole('button', { name: 'Mượn sách' })
    await vi.waitFor(() => expect(button).toHaveAccessibleDescription(PENDING.message))
    expect(screen.queryByRole('button', { name: 'Hủy yêu cầu mượn' })).not.toBeInTheDocument()
  })

  it('nhân viên vừa xử lý đơn (409) → báo lỗi và tải lại', async () => {
    getBorrowEligibility.mockResolvedValue(PENDING)
    cancelBorrowOrder.mockRejectedValue(apiError(409, { message: 'Chỉ hủy được đơn đang chờ xác nhận' }))
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const user = setup({ role: 'reader' })
    await user.click(await screen.findByRole('button', { name: 'Hủy yêu cầu mượn' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Chỉ hủy được đơn đang chờ xác nhận')
    expect(getBorrowEligibility).toHaveBeenCalledTimes(2)
  })
})
