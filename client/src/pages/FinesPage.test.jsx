import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import FinesPage from './FinesPage'
import { AuthProvider } from '../features/auth/AuthContext'
import RequireAuth from '../features/auth/RequireAuth'
import { getMe } from '../features/auth/authApi'
import { getFineReceiptUrl, listMyFineTickets, payFineTicket } from '../features/fine/fineTicketApi'

vi.mock('../features/auth/authApi', () => ({ login: vi.fn(), getMe: vi.fn() }))
vi.mock('../features/fine/fineTicketApi', () => ({
  listMyFineTickets: vi.fn(),
  payFineTicket: vi.fn(),
  getFineReceiptUrl: vi.fn(),
}))

const base = {
  bookTitle: 'Sách A', note: null, issuedAt: '2026-10-20T03:00:00Z', submittedAt: null, rejectReason: null,
  rejectedAt: null, confirmedAt: null, hasReceipt: false,
}
const ticket = (id, patch) => ({
  ...base, id, type: 'late', tierName: 'Trả muộn', amount: 10000, status: 'unpaid', canPay: true,
  transferContent: `THU VIEN PHAT ${id}`, ...patch,
})
const TICKETS = [
  ticket(1),
  ticket(2, { type: 'damaged', tierName: 'Hư hỏng', amount: 50000, status: 'rejected', rejectReason: 'Chưa nhận được tiền', note: 'Rách bìa', hasReceipt: true }),
]
const BANK = { bankName: 'Vietcombank', accountNumber: '0123456789', accountHolder: 'THU VIEN' }
const result = (tickets, extra = {}) => ({
  tickets,
  pagination: { page: 1, pageSize: 10, total: tickets.length, totalPages: 1 },
  summary: { dueCount: 2, dueAmount: 60000, pendingCount: 0 },
  bank: BANK,
  ...extra,
})
const apiError = (status, message, body = {}) => ({ response: { status, data: { message, ...body } } })

function LocationProbe() {
  const location = useLocation()
  return <p data-testid="location">{location.pathname + location.search}</p>
}

async function setup({ tickets = TICKETS, extra, url = '/reader/fines', role = 'reader' } = {}) {
  localStorage.setItem('token', 'saved')
  getMe.mockResolvedValue({ id: 1, email: 'r@example.com', name: 'R', role, status: 'active' })
  listMyFineTickets.mockResolvedValue(result(tickets, extra))
  const user = userEvent.setup()
  render(
    <MemoryRouter initialEntries={[url]}>
      <AuthProvider>
        <Routes>
          <Route path="/reader/fines" element={<RequireAuth roles={['reader']}><FinesPage /><LocationProbe /></RequireAuth>} />
          <Route path="/librarian" element={<p>Librarian dashboard</p>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  )
  return { user }
}

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
})

describe('FinesPage (2.5.2)', () => {
  it('nhân viên bị chuyển về dashboard của mình', async () => {
    await setup({ role: 'librarian' })
    expect(await screen.findByText('Librarian dashboard')).toBeInTheDocument()
    expect(listMyFineTickets).not.toHaveBeenCalled()
  })

  it('hiển thị nguyên nhân, số tiền, ngày phạt, trạng thái, lý do từ chối và tổng cần thanh toán', async () => {
    await setup()
    const row1 = await screen.findByRole('row', { name: 'Phiếu phạt 1' })
    expect(listMyFineTickets).toHaveBeenCalledWith({ status: 'due', page: 1 })
    expect(within(row1).getByText('Trả muộn: Trả muộn')).toBeInTheDocument()
    expect(within(row1).getByText('Sách: Sách A')).toBeInTheDocument()
    expect(within(row1).getByText(/10\.000 đ/)).toBeInTheDocument()
    expect(within(row1).getByText('Chưa thanh toán')).toBeInTheDocument()
    expect(within(row1).getByRole('button', { name: 'Thanh toán phiếu 1' })).toHaveTextContent('Thanh toán')

    const row2 = screen.getByRole('row', { name: 'Phiếu phạt 2' })
    expect(within(row2).getByText('Từ chối')).toBeInTheDocument()
    expect(within(row2).getByText('Lý do từ chối: Chưa nhận được tiền')).toBeInTheDocument()
    expect(within(row2).getByText('Ghi chú: Rách bìa')).toBeInTheDocument()
    // Edge 2: phiếu bị từ chối được thanh toán lại.
    expect(within(row2).getByRole('button', { name: 'Thanh toán phiếu 2' })).toHaveTextContent('Thanh toán lại')
    expect(screen.getByLabelText('Tổng quan khoản phạt')).toHaveTextContent('60.000 đ')
  })

  it('không có phiếu → thông báo', async () => {
    await setup({ tickets: [], extra: { summary: { dueCount: 0, dueAmount: 0, pendingCount: 0 } } })
    expect(await screen.findAllByText('Bạn không có khoản phạt nào cần thanh toán.')).toHaveLength(2)
  })

  it('phiếu chờ xác nhận / đã thanh toán không có nút Thanh toán', async () => {
    await setup({
      url: '/reader/fines?status=all',
      tickets: [ticket(3, { status: 'pending', canPay: false, submittedAt: '2026-10-25T03:00:00Z' }), ticket(4, { status: 'paid', canPay: false })],
    })
    const row3 = await screen.findByRole('row', { name: 'Phiếu phạt 3' })
    expect(listMyFineTickets).toHaveBeenCalledWith({ status: 'all', page: 1 })
    expect(within(row3).getByText('Chờ xác nhận')).toBeInTheDocument()
    expect(within(row3).queryByRole('button')).not.toBeInTheDocument()
    expect(within(screen.getByRole('row', { name: 'Phiếu phạt 4' })).queryByRole('button')).not.toBeInTheDocument()
  })

  it('đổi bộ lọc cập nhật URL và tải lại', async () => {
    const { user } = await setup()
    await screen.findByRole('row', { name: 'Phiếu phạt 1' })
    await user.click(screen.getByRole('button', { name: 'Đã thanh toán' }))
    expect(screen.getByTestId('location')).toHaveTextContent('/reader/fines?status=paid')
    await waitFor(() => expect(listMyFineTickets).toHaveBeenLastCalledWith({ status: 'paid', page: 1 }))
  })

  it('thanh toán: modal hiện tài khoản, số tiền, nội dung chuyển khoản; gửi xong báo chờ xác nhận và tải lại', async () => {
    payFineTicket.mockResolvedValue({ message: 'Đã gửi, chờ nhân viên thư viện xác nhận' })
    const { user } = await setup()
    await user.click(await screen.findByRole('button', { name: 'Thanh toán phiếu 1' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('0123456789')).toBeInTheDocument()
    expect(within(dialog).getByText('Vietcombank')).toBeInTheDocument()
    expect(within(dialog).getByText('THU VIEN PHAT 1')).toBeInTheDocument()
    expect(within(dialog).getByText('10.000 đ')).toBeInTheDocument()
    listMyFineTickets.mockClear()
    await user.click(within(dialog).getByRole('button', { name: 'Đã thanh toán' }))
    expect(payFineTicket).toHaveBeenCalledWith(1, null)
    expect(await screen.findByRole('status')).toHaveTextContent('Phiếu #1: Đã gửi, chờ nhân viên thư viện xác nhận')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(listMyFineTickets).toHaveBeenCalled()
  })

  it('đính kèm ảnh biên lai hợp lệ; ảnh quá 2 MB báo lỗi và không gửi kèm', async () => {
    payFineTicket.mockResolvedValue({ message: 'ok' })
    const { user } = await setup()
    await user.click(await screen.findByRole('button', { name: 'Thanh toán phiếu 1' }))
    const input = screen.getByLabelText('Ảnh biên lai (tùy chọn)')
    await user.upload(input, new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'big.png', { type: 'image/png' }))
    expect(screen.getByText('Chỉ nhận ảnh JPG, PNG, WebP tối đa 2 MB')).toBeInTheDocument()
    const png = new File(['x'], 'a.png', { type: 'image/png' })
    await user.upload(input, png)
    expect(screen.queryByText('Chỉ nhận ảnh JPG, PNG, WebP tối đa 2 MB')).not.toBeInTheDocument()
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Đã thanh toán' }))
    expect(payFineTicket).toHaveBeenCalledWith(1, png)
  })

  it('edge 1: phiếu đã gửi rồi → hiện lỗi và tải lại', async () => {
    payFineTicket.mockRejectedValue(apiError(409, 'Phiếu phạt đã được gửi, đang chờ nhân viên xác nhận', { reason: 'already_submitted' }))
    const { user } = await setup()
    await user.click(await screen.findByRole('button', { name: 'Thanh toán phiếu 1' }))
    listMyFineTickets.mockClear()
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Đã thanh toán' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Phiếu phạt đã được gửi, đang chờ nhân viên xác nhận')
    expect(listMyFineTickets).toHaveBeenCalled()
  })

  it('chưa cấu hình tài khoản ngân hàng → báo liên hệ thư viện', async () => {
    const { user } = await setup({ extra: { bank: null } })
    await user.click(await screen.findByRole('button', { name: 'Thanh toán phiếu 1' }))
    expect(screen.getByRole('dialog')).toHaveTextContent('chưa cấu hình tài khoản nhận chuyển khoản')
  })

  it('Xem biên lai mở signed URL', async () => {
    getFineReceiptUrl.mockResolvedValue('https://signed')
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    const { user } = await setup()
    await user.click(await screen.findByRole('button', { name: 'Xem biên lai phiếu 2' }))
    expect(getFineReceiptUrl).toHaveBeenCalledWith(2)
    expect(open).toHaveBeenCalledWith('https://signed', '_blank', 'noopener')
    open.mockRestore()
  })
})
