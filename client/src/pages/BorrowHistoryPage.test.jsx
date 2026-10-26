import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import BorrowHistoryPage from './BorrowHistoryPage'
import { AuthProvider } from '../features/auth/AuthContext'
import RequireAuth from '../features/auth/RequireAuth'
import { getMe } from '../features/auth/authApi'
import { cancelBorrowOrder, extendBorrowOrder, listMyOrders } from '../features/borrow/borrowApi'
import { cancelReturnRequest, createReturnRequest } from '../features/return/returnApi'

vi.mock('../features/auth/authApi', () => ({ login: vi.fn(), getMe: vi.fn() }))
vi.mock('../features/return/returnApi', () => ({ createReturnRequest: vi.fn(), cancelReturnRequest: vi.fn() }))
vi.mock('../features/borrow/borrowApi', () => ({
  listMyOrders: vi.fn(),
  extendBorrowOrder: vi.fn(),
  cancelBorrowOrder: vi.fn(),
}))

const base = {
  requestedDays: 14, createdAt: '2026-10-20T03:00:00Z', borrowedAt: null, dueDate: null, daysLeft: null,
  extensionCount: 0, canExtend: false, hasPendingReturn: false, canRequestReturn: false, pendingReturnId: null,
  returnedAt: null, rejectReason: null,
}
const order = (id, title, patch) => ({ ...base, id, book: { id: id + 100, title, author: `Tác giả ${id}` }, ...patch })
const ORDERS = [
  order(1, 'Sách Chờ', { status: 'pending' }),
  order(2, 'Sách Mượn', {
    status: 'borrowing', borrowedAt: '2026-10-20T03:00:00Z', dueDate: '2026-11-03', daysLeft: 9, canExtend: true, canRequestReturn: true,
  }),
  order(3, 'Sách Đã Gia Hạn', {
    status: 'borrowing', borrowedAt: '2026-10-01T03:00:00Z', dueDate: '2026-10-28', daysLeft: 3, extensionCount: 1,
  }),
  order(4, 'Sách Quá Hạn', {
    status: 'overdue', borrowedAt: '2026-09-01T03:00:00Z', dueDate: '2026-10-15', daysLeft: -10, canRequestReturn: true,
  }),
  order(5, 'Sách Đã Trả', { status: 'returned', borrowedAt: '2026-09-01T03:00:00Z', returnedAt: '2026-09-10T03:00:00Z' }),
  order(6, 'Sách Bị Từ Chối', { status: 'rejected', rejectReason: 'Hết sách' }),
  order(7, 'Sách Chờ Trả', {
    status: 'borrowing', borrowedAt: '2026-10-10T03:00:00Z', dueDate: '2026-10-30', daysLeft: 5, hasPendingReturn: true, pendingReturnId: 70,
  }),
]
const page = (orders, extra = {}) => ({
  orders, pagination: { page: 1, pageSize: 10, total: orders.length, totalPages: 1, ...extra }, today: '2026-10-25',
})
const apiError = (status, message, body = {}) => ({ response: { status, data: { message, ...body } } })

async function setup({ role = 'reader', orders = ORDERS, pagination, url = '/reader/borrow-history' } = {}) {
  localStorage.setItem('token', 'saved')
  getMe.mockResolvedValue({ id: 1, email: 'r@example.com', name: 'R', role, status: 'active' })
  listMyOrders.mockResolvedValue(page(orders, pagination))
  const user = userEvent.setup()
  render(
    <MemoryRouter initialEntries={[url]}>
      <AuthProvider>
        <Routes>
          <Route path="/reader/borrow-history" element={<RequireAuth roles={['reader']}><BorrowHistoryPage /></RequireAuth>} />
          <Route path="/librarian" element={<p>Librarian dashboard</p>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  )
  return user
}

const row = (title) => screen.getByRole('row', { name: `Đơn ${title}` })

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('BorrowHistoryPage (2.3.3)', () => {
  it('nhân viên bị chuyển về dashboard của mình', async () => {
    await setup({ role: 'librarian' })
    expect(await screen.findByText('Librarian dashboard')).toBeInTheDocument()
    expect(listMyOrders).not.toHaveBeenCalled()
  })

  it('hiển thị theo nhóm với cột theo PRD', async () => {
    await setup()
    const borrowing = await screen.findByRole('region', { name: 'Đang mượn' })
    expect(within(borrowing).getAllByRole('columnheader').map((h) => h.textContent))
      .toEqual(['Sách', 'Ngày mượn', 'Hạn trả', 'Số ngày còn lại', 'Trạng thái', 'Thao tác'])
    expect(within(row('Sách Mượn')).getByText('03/11/2026')).toBeInTheDocument()
    expect(within(row('Sách Mượn')).getByText('9 ngày')).toBeInTheDocument()
    // Quá hạn nằm trong nhóm Đang mượn.
    expect(within(borrowing).getByRole('row', { name: 'Đơn Sách Quá Hạn' })).toBeInTheDocument()
    expect(within(row('Sách Quá Hạn')).getByText('Quá 10 ngày')).toBeInTheDocument()
    expect(within(row('Sách Quá Hạn')).getByText('Quá hạn')).toBeInTheDocument()

    expect(within(row('Sách Đã Trả')).getByText('10/09/2026')).toBeInTheDocument()
    expect(within(row('Sách Bị Từ Chối')).getByText('Hết sách')).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent))
      .toEqual(['Chờ xác nhận', 'Đang mượn', 'Đã trả', 'Bị từ chối'])
  })

  it('nút Gia hạn chỉ hiện khi đơn đủ điều kiện', async () => {
    await setup()
    await screen.findByRole('row', { name: 'Đơn Sách Mượn' })
    expect(screen.getAllByRole('button', { name: /^Gia hạn/ })).toHaveLength(1)
    expect(within(row('Sách Đã Gia Hạn')).getByText('Đã gia hạn')).toBeInTheDocument()
  })

  it('gia hạn thành công → thông báo hạn mới và tải lại', async () => {
    const user = await setup()
    extendBorrowOrder.mockResolvedValue({ order: { id: 2, dueDate: '2026-11-10', extensionCount: 1 } })
    await user.click(await screen.findByRole('button', { name: 'Gia hạn Sách Mượn' }))
    expect(extendBorrowOrder).toHaveBeenCalledWith(2)
    expect(await screen.findByRole('status')).toHaveTextContent('Đã gia hạn "Sách Mượn", hạn trả mới 10/11/2026')
    await waitFor(() => expect(listMyOrders).toHaveBeenCalledTimes(2))
  })

  it('edge 2/3: gia hạn bị từ chối → báo lỗi server và tải lại', async () => {
    const user = await setup()
    extendBorrowOrder.mockRejectedValue(apiError(409, 'Mỗi đơn chỉ được gia hạn 1 lần', { reason: 'already_extended' }))
    await user.click(await screen.findByRole('button', { name: 'Gia hạn Sách Mượn' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Mỗi đơn chỉ được gia hạn 1 lần')
    await waitFor(() => expect(listMyOrders).toHaveBeenCalledTimes(2))
  })

  it('hủy yêu cầu chờ xác nhận sau khi hỏi lại', async () => {
    const user = await setup()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    cancelBorrowOrder.mockResolvedValue({ message: 'ok' })
    const button = await screen.findByRole('button', { name: 'Hủy yêu cầu mượn Sách Chờ' })
    await user.click(button)
    expect(cancelBorrowOrder).not.toHaveBeenCalled()
    await user.click(button)
    expect(confirm).toHaveBeenCalledWith('Hủy yêu cầu mượn "Sách Chờ"?')
    expect(cancelBorrowOrder).toHaveBeenCalledWith(1)
    expect(await screen.findByRole('status')).toHaveTextContent('Đã hủy yêu cầu mượn "Sách Chờ"')
  })

  it('lọc theo trạng thái gọi API với status và quay về trang 1', async () => {
    const user = await setup({ url: '/reader/borrow-history?page=2', pagination: { page: 2, totalPages: 3 } })
    await screen.findByRole('row', { name: 'Đơn Sách Mượn' })
    expect(listMyOrders).toHaveBeenLastCalledWith({ status: 'all', page: 2 })
    await user.click(screen.getByRole('button', { name: 'Quá hạn' }))
    await waitFor(() => expect(listMyOrders).toHaveBeenLastCalledWith({ status: 'overdue', page: 1 }))
    expect(screen.getByRole('button', { name: 'Quá hạn' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('phân trang', async () => {
    const user = await setup({ pagination: { totalPages: 2, total: 15 } })
    await user.click(await screen.findByRole('button', { name: 'Trang sau' }))
    await waitFor(() => expect(listMyOrders).toHaveBeenLastCalledWith({ status: 'all', page: 2 }))
  })

  it('chưa có đơn → trạng thái trống kèm liên kết tới danh sách sách', async () => {
    await setup({ orders: [] })
    expect(await screen.findByText(/Bạn chưa có đơn mượn nào/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Xem danh sách sách' })).toHaveAttribute('href', '/books')
  })

  it('lọc không có kết quả → thông báo riêng', async () => {
    await setup({ orders: [], url: '/reader/borrow-history?status=rejected' })
    expect(await screen.findByText(/Không có đơn nào ở trạng thái này/)).toBeInTheDocument()
  })

  it('lỗi tải danh sách → báo lỗi', async () => {
    await setup()
    // Trang chỉ gọi API sau khi RequireAuth tải xong phiên.
    listMyOrders.mockRejectedValue(apiError(500, 'Lỗi máy chủ'))
    expect(await screen.findByRole('alert')).toHaveTextContent('Lỗi máy chủ')
  })
})

describe('BorrowHistoryPage – Xin trả sách (2.4.1)', () => {
  it('edge 2/7: nút chỉ hiện ở đơn đang mượn/quá hạn chưa có yêu cầu chờ', async () => {
    await setup()
    await screen.findByRole('row', { name: 'Đơn Sách Mượn' })
    expect(screen.getAllByRole('button', { name: /^Xin trả sách/ }).map((b) => b.getAttribute('aria-label')))
      .toEqual(['Xin trả sách Sách Mượn', 'Xin trả sách Sách Quá Hạn'])
    expect(within(row('Sách Chờ Trả')).getByText('Đang chờ xác nhận trả')).toBeInTheDocument()
    expect(within(row('Sách Chờ')).queryByRole('button', { name: /Xin trả/ })).not.toBeInTheDocument()
  })

  it('modal nhắc mang sách đến thư viện; Hủy đóng modal mà không gửi', async () => {
    const user = await setup()
    await user.click(await screen.findByRole('button', { name: 'Xin trả sách Sách Mượn' }))
    const dialog = screen.getByRole('dialog', { name: 'Xin trả sách' })
    expect(dialog).toHaveTextContent('"Sách Mượn" (hạn trả 03/11/2026)')
    expect(dialog).toHaveTextContent('mang sách đến thư viện')
    await user.click(within(dialog).getByRole('button', { name: 'Hủy' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(createReturnRequest).not.toHaveBeenCalled()
  })

  it('Escape đóng modal', async () => {
    const user = await setup()
    await user.click(await screen.findByRole('button', { name: 'Xin trả sách Sách Mượn' }))
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('Đồng ý → gửi yêu cầu, thông báo từ server và tải lại', async () => {
    const user = await setup()
    createReturnRequest.mockResolvedValue({
      message: 'Đã gửi yêu cầu trả sách, vui lòng mang sách đến thư viện để nhân viên xác nhận',
      returnRequest: { id: 80 },
    })
    await user.click(await screen.findByRole('button', { name: 'Xin trả sách Sách Quá Hạn' }))
    await user.click(screen.getByRole('button', { name: 'Đồng ý' }))
    expect(createReturnRequest).toHaveBeenCalledWith(4)
    expect(await screen.findByRole('status')).toHaveTextContent('Đã gửi yêu cầu trả sách')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await waitFor(() => expect(listMyOrders).toHaveBeenCalledTimes(2))
  })

  it('edge 1/3: server từ chối → báo lỗi, đóng modal và tải lại', async () => {
    const user = await setup()
    createReturnRequest.mockRejectedValue(
      apiError(409, 'Đơn này đã có yêu cầu trả sách đang chờ xác nhận', { reason: 'pending_return' }),
    )
    await user.click(await screen.findByRole('button', { name: 'Xin trả sách Sách Mượn' }))
    await user.click(screen.getByRole('button', { name: 'Đồng ý' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Đơn này đã có yêu cầu trả sách đang chờ xác nhận')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await waitFor(() => expect(listMyOrders).toHaveBeenCalledTimes(2))
  })

  it('edge 5: hủy yêu cầu trả đang chờ sau khi hỏi lại', async () => {
    const user = await setup()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    cancelReturnRequest.mockResolvedValue({ message: 'Đã hủy yêu cầu trả sách' })
    const button = await screen.findByRole('button', { name: 'Hủy yêu cầu trả Sách Chờ Trả' })
    await user.click(button)
    expect(cancelReturnRequest).not.toHaveBeenCalled()
    await user.click(button)
    expect(confirm).toHaveBeenCalledWith('Hủy yêu cầu trả "Sách Chờ Trả"?')
    expect(cancelReturnRequest).toHaveBeenCalledWith(70)
    expect(await screen.findByRole('status')).toHaveTextContent('Đã hủy yêu cầu trả "Sách Chờ Trả"')
  })
})
