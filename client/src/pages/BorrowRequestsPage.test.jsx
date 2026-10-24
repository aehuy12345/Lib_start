import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import BorrowRequestsPage from './BorrowRequestsPage'
import { AuthProvider } from '../features/auth/AuthContext'
import RequireAuth from '../features/auth/RequireAuth'
import { getMe } from '../features/auth/authApi'
import { confirmBorrowOrder, listPendingOrders, rejectBorrowOrder } from '../features/borrow/borrowApi'
import { REASON_REQUIRED } from '../features/borrow/borrowRules'

vi.mock('../features/auth/authApi', () => ({ login: vi.fn(), getMe: vi.fn() }))
vi.mock('../features/borrow/borrowApi', () => ({
  listPendingOrders: vi.fn(),
  confirmBorrowOrder: vi.fn(),
  rejectBorrowOrder: vi.fn(),
}))

const ORDERS = [
  {
    id: 50, requestedDays: 14, createdAt: '2026-10-20T03:00:00Z',
    reader: { id: 1, name: 'Đọc Giả A', email: 'a@example.com' },
    book: { id: 7, title: 'Sách Còn', author: 'Tác giả 1', availableQuantity: 2 },
  },
  {
    id: 51, requestedDays: 30, createdAt: '2026-10-21T03:00:00Z',
    reader: { id: 2, name: 'Đọc Giả B', email: 'b@example.com' },
    book: { id: 8, title: 'Sách Hết', author: 'Tác giả 2', availableQuantity: 0 },
  },
]
const page = (orders, extra = {}) => ({
  orders, pagination: { page: 1, pageSize: 10, total: orders.length, totalPages: 1, ...extra },
})
const apiError = (status, message, body = {}) => ({ response: { status, data: { message, ...body } } })

async function setup({ role = 'librarian', orders = ORDERS, pagination } = {}) {
  localStorage.setItem('token', 'saved')
  getMe.mockResolvedValue({ id: 9, email: 'l@example.com', name: 'L', role, status: 'active' })
  listPendingOrders.mockResolvedValue(page(orders, pagination))
  const user = userEvent.setup()
  render(
    <MemoryRouter initialEntries={['/librarian/borrow-orders']}>
      <AuthProvider>
        <Routes>
          <Route path="/librarian/borrow-orders" element={<RequireAuth roles={['librarian']}><BorrowRequestsPage /></RequireAuth>} />
          <Route path="/reader" element={<p>Reader dashboard</p>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  )
  return user
}

const row = (name) => screen.getByRole('row', { name: `Đơn ${name}` })

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('BorrowRequestsPage (2.3.2)', () => {
  it('hiển thị đơn chờ: độc giả, sách, SL có sẵn, thời hạn, ngày gửi', async () => {
    await setup()
    const first = await screen.findByRole('row', { name: 'Đơn Sách Còn của Đọc Giả A' })
    expect(within(first).getByText('a@example.com')).toBeInTheDocument()
    expect(within(first).getByRole('link', { name: 'Sách Còn' })).toHaveAttribute('href', '/books/7')
    expect(within(first).getByText('14 ngày')).toBeInTheDocument()
    expect(within(first).getByText('20/10/2026')).toBeInTheDocument()
    expect(within(row('Sách Hết của Đọc Giả B')).getByText('Hết sách')).toBeInTheDocument()
    expect(screen.getByText('Tổng: 2 đơn')).toBeInTheDocument()
  })

  it('không có đơn → trạng thái trống', async () => {
    await setup({ orders: [] })
    expect(await screen.findByText('Không có đơn mượn nào chờ xác nhận.')).toBeInTheDocument()
  })

  it('độc giả không vào được trang', async () => {
    await setup({ role: 'reader' })
    expect(await screen.findByText('Reader dashboard')).toBeInTheDocument()
    expect(listPendingOrders).not.toHaveBeenCalled()
  })

  it('Xác nhận → thông báo kèm hạn trả và tải lại danh sách', async () => {
    const user = await setup()
    confirmBorrowOrder.mockResolvedValue({ message: 'ok', order: { id: 50, dueDate: '2026-11-08' } })
    await screen.findByRole('row', { name: 'Đơn Sách Còn của Đọc Giả A' })
    listPendingOrders.mockResolvedValue(page([ORDERS[1]]))
    await user.click(screen.getByRole('button', { name: 'Xác nhận đơn Sách Còn của Đọc Giả A' }))
    expect(confirmBorrowOrder).toHaveBeenCalledWith(50)
    expect(await screen.findByRole('status')).toHaveTextContent('Đã xác nhận đơn mượn "Sách Còn" của Đọc Giả A, hạn trả 08/11/2026')
    await waitFor(() => expect(screen.queryByRole('row', { name: 'Đơn Sách Còn của Đọc Giả A' })).not.toBeInTheDocument())
  })

  it('edge 2: xác nhận khi kho về 0 → báo lỗi, mở form từ chối gợi ý "Hết sách"', async () => {
    const user = await setup()
    confirmBorrowOrder.mockRejectedValue(apiError(409, 'Sách đã hết, chỉ có thể từ chối đơn này', { reason: 'out_of_stock' }))
    await screen.findByRole('row', { name: 'Đơn Sách Còn của Đọc Giả A' })
    await user.click(screen.getByRole('button', { name: 'Xác nhận đơn Sách Còn của Đọc Giả A' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Sách đã hết, chỉ có thể từ chối đơn này')
    const form = screen.getByRole('form', { name: 'Từ chối đơn Sách Còn' })
    expect(within(form).getByLabelText('Lý do từ chối (bắt buộc)')).toHaveValue('Hết sách')
  })

  it('edge 6: độc giả không đủ điều kiện → mở form từ chối trống', async () => {
    const user = await setup()
    confirmBorrowOrder.mockRejectedValue(apiError(409, 'Tài khoản độc giả không còn hoạt động', { reason: 'reader_inactive' }))
    await screen.findByRole('row', { name: 'Đơn Sách Còn của Đọc Giả A' })
    await user.click(screen.getByRole('button', { name: 'Xác nhận đơn Sách Còn của Đọc Giả A' }))
    expect(await screen.findByLabelText('Lý do từ chối (bắt buộc)')).toHaveValue('')
  })

  it('edge 1: đơn đã được người khác xử lý → báo lỗi và tải lại, không mở form', async () => {
    const user = await setup()
    confirmBorrowOrder.mockRejectedValue(apiError(409, 'Đơn đã được xử lý hoặc đã bị hủy', { reason: 'already_processed' }))
    await screen.findByRole('row', { name: 'Đơn Sách Còn của Đọc Giả A' })
    await user.click(screen.getByRole('button', { name: 'Xác nhận đơn Sách Còn của Đọc Giả A' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Đơn đã được xử lý hoặc đã bị hủy')
    expect(screen.queryByRole('form')).not.toBeInTheDocument()
    await waitFor(() => expect(listPendingOrders).toHaveBeenCalledTimes(2))
  })

  it('Từ chối: lý do trống/khoảng trắng bị chặn; nhập lý do → gửi bản đã trim', async () => {
    const user = await setup()
    rejectBorrowOrder.mockResolvedValue({ message: 'ok' })
    await screen.findByRole('row', { name: 'Đơn Sách Còn của Đọc Giả A' })
    await user.click(screen.getByRole('button', { name: 'Từ chối đơn Sách Còn của Đọc Giả A' }))
    const form = screen.getByRole('form', { name: 'Từ chối đơn Sách Còn' })
    const input = within(form).getByLabelText('Lý do từ chối (bắt buộc)')
    await user.type(input, '   ')
    await user.click(within(form).getByRole('button', { name: 'Xác nhận từ chối' }))
    expect(within(form).getByText(REASON_REQUIRED)).toBeInTheDocument()
    expect(rejectBorrowOrder).not.toHaveBeenCalled()

    await user.clear(input)
    await user.type(input, '  Sách đang sửa chữa ')
    await user.click(within(form).getByRole('button', { name: 'Xác nhận từ chối' }))
    expect(rejectBorrowOrder).toHaveBeenCalledWith(50, 'Sách đang sửa chữa')
    expect(await screen.findByRole('status')).toHaveTextContent('Đã từ chối đơn mượn "Sách Còn" của Đọc Giả A')
  })

  it('Từ chối đơn sách đã hết → gợi ý sẵn lý do "Hết sách"; Hủy đóng form', async () => {
    const user = await setup()
    await screen.findByRole('row', { name: 'Đơn Sách Hết của Đọc Giả B' })
    await user.click(screen.getByRole('button', { name: 'Từ chối đơn Sách Hết của Đọc Giả B' }))
    expect(screen.getByLabelText('Lý do từ chối (bắt buộc)')).toHaveValue('Hết sách')
    await user.click(screen.getByRole('button', { name: 'Hủy' }))
    expect(screen.queryByRole('form')).not.toBeInTheDocument()
  })

  it('từ chối đơn đã được xử lý → báo lỗi và tải lại', async () => {
    const user = await setup()
    rejectBorrowOrder.mockRejectedValue(apiError(409, 'Đơn đã được xử lý hoặc đã bị hủy', { reason: 'already_processed' }))
    await screen.findByRole('row', { name: 'Đơn Sách Còn của Đọc Giả A' })
    await user.click(screen.getByRole('button', { name: 'Từ chối đơn Sách Còn của Đọc Giả A' }))
    await user.type(screen.getByLabelText('Lý do từ chối (bắt buộc)'), 'x')
    await user.click(screen.getByRole('button', { name: 'Xác nhận từ chối' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Đơn đã được xử lý hoặc đã bị hủy')
    await waitFor(() => expect(listPendingOrders).toHaveBeenCalledTimes(2))
  })

  it('phân trang: chuyển trang và giữ trang hiện tại khi tải lại sau xác nhận', async () => {
    const user = await setup({ pagination: { total: 12, totalPages: 2 } })
    await screen.findByRole('row', { name: 'Đơn Sách Còn của Đọc Giả A' })
    expect(listPendingOrders).toHaveBeenCalledWith(1)
    listPendingOrders.mockResolvedValue(page([ORDERS[1]], { page: 2, total: 12, totalPages: 2 }))
    await user.click(screen.getByRole('button', { name: 'Trang sau' }))
    expect(await screen.findByText('Trang 2 / 2')).toBeInTheDocument()
    expect(listPendingOrders).toHaveBeenLastCalledWith(2)

    confirmBorrowOrder.mockResolvedValue({ message: 'ok', order: { id: 51, dueDate: '2026-11-24' } })
    await user.click(screen.getByRole('button', { name: 'Xác nhận đơn Sách Hết của Đọc Giả B' }))
    await waitFor(() => expect(listPendingOrders).toHaveBeenCalledTimes(3))
    expect(listPendingOrders).toHaveBeenLastCalledWith(2)
  })
})
