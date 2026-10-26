import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import FineTicketsPage from './FineTicketsPage'
import { AuthProvider } from '../features/auth/AuthContext'
import RequireAuth from '../features/auth/RequireAuth'
import { getMe } from '../features/auth/authApi'
import {
  confirmFineTicket, getFineReceiptUrl, listFineTickets, rejectFineTicket,
} from '../features/fine/fineTicketApi'

vi.mock('../features/auth/authApi', () => ({ login: vi.fn(), getMe: vi.fn() }))
vi.mock('../features/fine/fineTicketApi', () => ({
  listFineTickets: vi.fn(),
  confirmFineTicket: vi.fn(),
  rejectFineTicket: vi.fn(),
  getFineReceiptUrl: vi.fn(),
}))

const ticket = (id, patch) => ({
  id, type: 'late', tierName: 'Trả muộn', amount: 10000, note: null, status: 'pending',
  issuedAt: '2026-10-20T03:00:00Z', submittedAt: '2026-10-21T03:00:00Z', rejectReason: null, rejectedAt: null,
  confirmedAt: null, hasReceipt: false, transferContent: `THU VIEN PHAT ${id}`,
  reader: { id: 5, name: 'Nguyễn An', email: 'an@example.com' }, borrowOrderId: 30,
  book: { id: 9, title: 'Sách A' }, confirmedByName: null, canReview: true, ...patch,
})
const TICKETS = [
  ticket(1, { hasReceipt: true }),
  ticket(2, { type: 'damaged', tierName: 'Hư hỏng', amount: 50000, note: 'Rách bìa' }),
]
const result = (tickets) => ({
  tickets,
  pagination: { page: 1, pageSize: 10, total: tickets.length, totalPages: 1 },
  summary: { pendingCount: 2, pendingAmount: 60000 },
})
const apiError = (status, message, body = {}) => ({ response: { status, data: { message, ...body } } })

function LocationProbe() {
  const location = useLocation()
  return <p data-testid="location">{location.pathname + location.search}</p>
}

async function setup({ tickets = TICKETS, url = '/librarian/fine-tickets', role = 'librarian' } = {}) {
  localStorage.setItem('token', 'saved')
  getMe.mockResolvedValue({ id: 2, email: 'l@example.com', name: 'L', role, status: 'active' })
  listFineTickets.mockResolvedValue(result(tickets))
  const user = userEvent.setup()
  render(
    <MemoryRouter initialEntries={[url]}>
      <AuthProvider>
        <Routes>
          <Route path="/librarian/fine-tickets" element={<RequireAuth roles={['librarian']}><FineTicketsPage /><LocationProbe /></RequireAuth>} />
          <Route path="/reader" element={<p>Reader dashboard</p>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  )
  return { user }
}

async function openDetail(user, id) {
  const row = await screen.findByRole('row', { name: `Phiếu phạt ${id}` })
  await user.click(within(row).getByRole('button', { name: `Xem chi tiết phiếu ${id}` }))
  return screen.getByLabelText(`Chi tiết phiếu ${id}`)
}

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
})

describe('FineTicketsPage (2.5.3)', () => {
  it('edge 6: độc giả bị chuyển về dashboard của mình', async () => {
    await setup({ role: 'reader' })
    expect(await screen.findByText('Reader dashboard')).toBeInTheDocument()
    expect(listFineTickets).not.toHaveBeenCalled()
  })

  it('mặc định tải phiếu Chờ xác nhận và hiện tổng', async () => {
    await setup()
    expect(await screen.findByRole('row', { name: 'Phiếu phạt 1' })).toBeInTheDocument()
    expect(listFineTickets).toHaveBeenCalledWith({ status: 'pending', q: '', page: 1 })
    expect(screen.getByLabelText('Tổng quan phiếu chờ xác nhận')).toHaveTextContent('2 phiếu')
    expect(screen.getByRole('button', { name: 'Chờ xác nhận' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('đổi tab và tìm kiếm ghi lên URL', async () => {
    const { user } = await setup()
    await screen.findByRole('row', { name: 'Phiếu phạt 1' })
    await user.click(screen.getByRole('button', { name: 'Chưa thanh toán' }))
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/librarian/fine-tickets?status=unpaid'))
    await user.type(screen.getByRole('searchbox', { name: 'Tìm phiếu phạt' }), ' An ')
    await user.click(screen.getByRole('button', { name: 'Tìm' }))
    await waitFor(() => expect(listFineTickets).toHaveBeenLastCalledWith({ status: 'unpaid', q: 'An', page: 1 }))
  })

  it('bước 2: chi tiết gồm độc giả, đơn mượn, sách, nguyên nhân, số tiền, ghi chú, nội dung chuyển khoản', async () => {
    const { user } = await setup()
    const detail = await openDetail(user, 2)
    for (const text of ['an@example.com', '#30', 'Sách A', 'Hư hỏng: Hư hỏng', '50.000 đ', 'Rách bìa', 'THU VIEN PHAT 2']) {
      expect(within(detail).getByText(text, { exact: false })).toBeInTheDocument()
    }
    expect(within(detail).getByText('Độc giả không đính kèm biên lai.')).toBeInTheDocument()
  })

  it('xem biên lai mở signed URL', async () => {
    getFineReceiptUrl.mockResolvedValue('https://signed')
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    const { user } = await setup()
    const detail = await openDetail(user, 1)
    await user.click(within(detail).getByRole('button', { name: 'Xem biên lai phiếu 1' }))
    await waitFor(() => expect(open).toHaveBeenCalledWith('https://signed', '_blank', 'noopener'))
  })

  it('Đã thanh toán: hỏi lại, gửi, báo độc giả hết bị chặn (edge 5) và tải lại', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    confirmFineTicket.mockResolvedValue({ message: 'Đã xác nhận thanh toán', readerOutstanding: 0 })
    const { user } = await setup()
    const detail = await openDetail(user, 1)
    await user.click(within(detail).getByRole('button', { name: 'Đã thanh toán phiếu 1' }))
    expect(confirm.mock.calls[0][0]).toMatch(/10\.000 đ cho phiếu #1\? Không thể hoàn tác/)
    expect(confirmFineTicket).toHaveBeenCalledWith(1)
    expect(await screen.findByRole('status')).toHaveTextContent('có thể mượn sách lại')
    await waitFor(() => expect(listFineTickets).toHaveBeenCalledTimes(2))
  })

  it('bỏ hộp thoại xác nhận thì không gửi', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    const { user } = await setup()
    const detail = await openDetail(user, 1)
    await user.click(within(detail).getByRole('button', { name: 'Đã thanh toán phiếu 1' }))
    expect(confirmFineTicket).not.toHaveBeenCalled()
  })

  it('edge 1: phiếu đã được người khác xử lý → báo lỗi và tải lại', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    confirmFineTicket.mockRejectedValue(apiError(409, 'Phiếu phạt đã được xử lý bởi người khác', { reason: 'already_processed' }))
    const { user } = await setup()
    const detail = await openDetail(user, 1)
    await user.click(within(detail).getByRole('button', { name: 'Đã thanh toán phiếu 1' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('đã được xử lý bởi người khác')
    await waitFor(() => expect(listFineTickets).toHaveBeenCalledTimes(2))
    expect(screen.queryByLabelText('Chi tiết phiếu 1')).not.toBeInTheDocument()
  })

  it('từ chối: lý do bắt buộc (edge 4: trim), gửi lý do đã trim', async () => {
    rejectFineTicket.mockResolvedValue({ message: 'Đã từ chối thanh toán', readerOutstanding: 2 })
    const { user } = await setup()
    const detail = await openDetail(user, 2)
    await user.click(within(detail).getByRole('button', { name: 'Từ chối phiếu 2' }))
    const form = screen.getByRole('form', { name: 'Từ chối phiếu 2' })
    await user.type(within(form).getByLabelText('Lý do từ chối (bắt buộc)'), '   ')
    await user.click(within(form).getByRole('button', { name: 'Xác nhận từ chối' }))
    expect(within(form).getByText('Lý do từ chối là bắt buộc')).toBeInTheDocument()
    expect(rejectFineTicket).not.toHaveBeenCalled()
    await user.type(within(form).getByLabelText('Lý do từ chối (bắt buộc)'), 'Chuyển thiếu 10.000 đ ')
    await user.click(within(form).getByRole('button', { name: 'Xác nhận từ chối' }))
    expect(rejectFineTicket).toHaveBeenCalledWith(2, 'Chuyển thiếu 10.000 đ')
    expect(await screen.findByRole('status')).toHaveTextContent('Độc giả còn 2 phiếu phạt')
  })

  it('edge 2: phiếu Chưa thanh toán chỉ để theo dõi, không có nút xác nhận', async () => {
    const { user } = await setup({ tickets: [ticket(3, { status: 'unpaid', submittedAt: null, canReview: false })] })
    const detail = await openDetail(user, 3)
    expect(within(detail).getByText('Độc giả chưa gửi thanh toán, chỉ theo dõi.')).toBeInTheDocument()
    expect(within(detail).queryByRole('button', { name: /Đã thanh toán/ })).not.toBeInTheDocument()
  })

  it('không có phiếu → trạng thái trống', async () => {
    await setup({ tickets: [] })
    expect(await screen.findByText('Không có phiếu phạt nào chờ xác nhận.', { selector: 'div' })).toBeInTheDocument()
  })
})
