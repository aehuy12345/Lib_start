import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import ReturnRequestsPage from './ReturnRequestsPage'
import { AuthProvider } from '../features/auth/AuthContext'
import RequireAuth from '../features/auth/RequireAuth'
import { getMe } from '../features/auth/authApi'
import { REASON_REQUIRED } from '../features/borrow/borrowRules'
import {
  confirmReturnRequest, counterReturn, listCounterOrders, listFineTierOptions, listPendingReturns, rejectReturnRequest,
} from '../features/return/returnApi'
import { NOTE_REQUIRED, TIER_REQUIRED, lateTierRequired, noTierMessage } from '../features/return/returnRules'

vi.mock('../features/auth/authApi', () => ({ login: vi.fn(), getMe: vi.fn() }))
vi.mock('../features/return/returnApi', () => ({
  listPendingReturns: vi.fn(),
  listCounterOrders: vi.fn(),
  confirmReturnRequest: vi.fn(),
  rejectReturnRequest: vi.fn(),
  counterReturn: vi.fn(),
  listFineTierOptions: vi.fn(),
}))

const reader = { id: 1, name: 'Đọc Giả A', email: 'a@example.com' }
const REQUESTS = [
  {
    id: 9, borrowOrderId: 50, createdAt: '2026-10-20T03:00:00Z', borrowedAt: '2026-10-01T03:00:00Z',
    dueDate: '2026-10-30', lateDays: 0, reader, book: { id: 7, title: 'Sách Đúng Hạn', author: 'T1' },
  },
  {
    id: 10, borrowOrderId: 51, createdAt: '2026-10-21T03:00:00Z', borrowedAt: '2026-10-01T03:00:00Z',
    dueDate: '2026-10-22', lateDays: 4, reader, book: { id: 8, title: 'Sách Muộn', author: 'T2' },
  },
]
const TIERS = {
  late: [{ id: 1, name: 'Trả muộn', amount: 10000 }],
  damaged: [{ id: 2, name: 'Hư nhẹ', amount: 50000 }],
  lost: [{ id: 3, name: 'Mất sách', amount: 200000 }],
}
const pageOf = (key, items) => ({ [key]: items, pagination: { page: 1, pageSize: 10, total: items.length, totalPages: 1 } })
const apiError = (status, message, body = {}) => ({ response: { status, data: { message, ...body } } })

async function setup({ role = 'librarian', requests = REQUESTS, tiers = TIERS, url = '/librarian/return-requests' } = {}) {
  localStorage.setItem('token', 'saved')
  getMe.mockResolvedValue({ id: 9, email: 'l@example.com', name: 'L', role, status: 'active' })
  listPendingReturns.mockResolvedValue(pageOf('returnRequests', requests))
  listFineTierOptions.mockResolvedValue(tiers)
  const user = userEvent.setup()
  render(
    <MemoryRouter initialEntries={[url]}>
      <AuthProvider>
        <Routes>
          <Route path="/librarian/return-requests" element={<RequireAuth roles={['librarian']}><ReturnRequestsPage /></RequireAuth>} />
          <Route path="/reader" element={<p>Reader dashboard</p>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  )
  return user
}

const row = (name) => screen.getByRole('row', { name })

async function openConfirm(user, title = 'Sách Đúng Hạn') {
  await screen.findByRole('row', { name: `Yêu cầu trả ${title} của Đọc Giả A` })
  await waitFor(() => expect(screen.getByRole('button', { name: `Xác nhận trả ${title} của Đọc Giả A` })).toBeEnabled())
  await user.click(screen.getByRole('button', { name: `Xác nhận trả ${title} của Đọc Giả A` }))
  return screen.getByRole('form', { name: `Xác nhận trả ${title}` })
}

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('ReturnRequestsPage (2.4.2)', () => {
  it('tab Chờ xác nhận trả: độc giả, sách, hạn trả, số ngày quá hạn', async () => {
    await setup()
    const late = await screen.findByRole('row', { name: 'Yêu cầu trả Sách Muộn của Đọc Giả A' })
    expect(within(late).getByText('22/10/2026')).toBeInTheDocument()
    expect(within(late).getByText('Quá hạn 4 ngày')).toBeInTheDocument()
    expect(within(row('Yêu cầu trả Sách Đúng Hạn của Đọc Giả A')).queryByText(/Quá hạn/)).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Chờ xác nhận trả' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('Tổng: 2 yêu cầu')).toBeInTheDocument()
  })

  it('độc giả không vào được trang', async () => {
    await setup({ role: 'reader' })
    expect(await screen.findByText('Reader dashboard')).toBeInTheDocument()
    expect(listPendingReturns).not.toHaveBeenCalled()
  })

  it('bình thường, đúng hạn: xác nhận không cần mức phạt, tải lại danh sách', async () => {
    const user = await setup()
    const form = await openConfirm(user)
    confirmReturnRequest.mockResolvedValue({ message: 'Đã xác nhận trả sách' })
    await user.click(within(form).getByRole('button', { name: 'Xác nhận trả' }))
    expect(within(form).getByText('Vui lòng chọn tình trạng sách')).toBeInTheDocument()
    await user.click(within(form).getByLabelText('Bình thường'))
    expect(within(form).queryByLabelText(/Mức phạt/)).not.toBeInTheDocument()
    await user.click(within(form).getByRole('button', { name: 'Xác nhận trả' }))
    expect(confirmReturnRequest).toHaveBeenCalledWith(9, { condition: 'normal' })
    expect(await screen.findByRole('status')).toHaveTextContent('Đã xác nhận trả sách: "Sách Đúng Hạn" của Đọc Giả A')
    expect(listPendingReturns).toHaveBeenCalledTimes(2)
  })

  it('edge 2: hư hỏng thiếu mức phạt và ghi chú → lỗi field, không gọi API', async () => {
    const user = await setup()
    const form = await openConfirm(user)
    await user.click(within(form).getByLabelText('Hư hỏng'))
    await user.click(within(form).getByRole('button', { name: 'Xác nhận trả' }))
    expect(within(form).getByText(TIER_REQUIRED)).toBeInTheDocument()
    expect(within(form).getByText(NOTE_REQUIRED)).toBeInTheDocument()
    expect(confirmReturnRequest).not.toHaveBeenCalled()
    await user.selectOptions(within(form).getByLabelText('Mức phạt Hư hỏng (bắt buộc)'), '2')
    await user.type(within(form).getByLabelText(/Ghi chú/), 'Rách bìa')
    confirmReturnRequest.mockResolvedValue({ message: 'Đã xác nhận trả sách, đã lập 1 phiếu phạt' })
    await user.click(within(form).getByRole('button', { name: 'Xác nhận trả' }))
    expect(confirmReturnRequest).toHaveBeenCalledWith(9, { condition: 'damaged', fineTierId: 2, note: 'Rách bìa' })
  })

  it('trả muộn: bắt buộc mức phạt Trả muộn, gửi kèm mức Mất', async () => {
    const user = await setup()
    const form = await openConfirm(user, 'Sách Muộn')
    expect(within(form).getByText('Trả muộn 4 ngày: cần lập phiếu phạt Trả muộn.')).toBeInTheDocument()
    await user.click(within(form).getByLabelText('Mất'))
    await user.selectOptions(within(form).getByLabelText('Mức phạt Mất (bắt buộc)'), '3')
    await user.type(within(form).getByLabelText(/Ghi chú/), 'Làm mất')
    await user.click(within(form).getByRole('button', { name: 'Xác nhận trả' }))
    expect(within(form).getByText(lateTierRequired(4))).toBeInTheDocument()
    await user.selectOptions(within(form).getByLabelText('Mức phạt Trả muộn (bắt buộc)'), '1')
    confirmReturnRequest.mockResolvedValue({ message: 'Đã xác nhận trả sách, đã lập 2 phiếu phạt' })
    await user.click(within(form).getByRole('button', { name: 'Xác nhận trả' }))
    expect(confirmReturnRequest).toHaveBeenCalledWith(10, { condition: 'lost', fineTierId: 3, lateFineTierId: 1, note: 'Làm mất' })
  })

  it('edge 4: chưa có mức phạt → báo liên hệ Admin, chặn Hư hỏng nhưng vẫn trả đúng hạn bình thường được', async () => {
    const user = await setup({ tiers: { late: [], damaged: [], lost: [] } })
    const form = await openConfirm(user)
    await user.click(within(form).getByLabelText('Hư hỏng'))
    expect(within(form).getByText(noTierMessage('damaged'))).toBeInTheDocument()
    expect(within(form).getByRole('button', { name: 'Xác nhận trả' })).toBeDisabled()
    await user.click(within(form).getByLabelText('Bình thường'))
    expect(within(form).getByRole('button', { name: 'Xác nhận trả' })).toBeEnabled()
  })

  it('lỗi 400 từ server hiện theo field', async () => {
    const user = await setup()
    const form = await openConfirm(user)
    await user.click(within(form).getByLabelText('Hư hỏng'))
    await user.selectOptions(within(form).getByLabelText('Mức phạt Hư hỏng (bắt buộc)'), '2')
    await user.type(within(form).getByLabelText(/Ghi chú/), 'x')
    confirmReturnRequest.mockRejectedValue(apiError(400, 'Dữ liệu không hợp lệ', { errors: { fineTierId: 'Mức phạt đã ngừng áp dụng' } }))
    await user.click(within(form).getByRole('button', { name: 'Xác nhận trả' }))
    expect(await within(form).findByText('Mức phạt đã ngừng áp dụng')).toBeInTheDocument()
  })

  it('edge 1: đã được người khác xử lý → báo lỗi, đóng form, tải lại', async () => {
    const user = await setup()
    const form = await openConfirm(user)
    await user.click(within(form).getByLabelText('Bình thường'))
    confirmReturnRequest.mockRejectedValue(apiError(409, 'Yêu cầu trả đã được xử lý', { reason: 'already_processed' }))
    await user.click(within(form).getByRole('button', { name: 'Xác nhận trả' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Yêu cầu trả đã được xử lý')
    expect(screen.queryByRole('form')).not.toBeInTheDocument()
    await waitFor(() => expect(listPendingReturns).toHaveBeenCalledTimes(2))
  })

  it('từ chối yêu cầu: lý do bắt buộc', async () => {
    const user = await setup()
    await user.click(await screen.findByRole('button', { name: 'Từ chối yêu cầu trả Sách Đúng Hạn của Đọc Giả A' }))
    const form = screen.getByRole('form', { name: 'Từ chối yêu cầu trả Sách Đúng Hạn' })
    await user.click(within(form).getByRole('button', { name: 'Xác nhận từ chối' }))
    expect(within(form).getByText(REASON_REQUIRED)).toBeInTheDocument()
    rejectReturnRequest.mockResolvedValue({ message: 'Đã từ chối yêu cầu trả sách' })
    await user.type(within(form).getByLabelText('Lý do từ chối (bắt buộc)'), ' Chưa mang sách ')
    await user.click(within(form).getByRole('button', { name: 'Xác nhận từ chối' }))
    expect(rejectReturnRequest).toHaveBeenCalledWith(9, 'Chưa mang sách')
    expect(await screen.findByRole('status')).toHaveTextContent('Đã từ chối yêu cầu trả sách')
  })

  it('tab Trả tại quầy: tìm đơn đang mượn và nhận trả', async () => {
    listCounterOrders.mockResolvedValue(pageOf('orders', [{ ...REQUESTS[0], id: 60, createdAt: undefined }]))
    const user = await setup({ url: '/librarian/return-requests?tab=counter' })
    expect(await screen.findByRole('tab', { name: 'Trả tại quầy' })).toHaveAttribute('aria-selected', 'true')
    await screen.findByRole('row', { name: 'Đơn Sách Đúng Hạn của Đọc Giả A' })
    expect(listCounterOrders).toHaveBeenCalledWith({ q: '', page: 1 })
    await user.type(screen.getByRole('searchbox', { name: 'Tìm đơn đang mượn' }), ' An ')
    await user.click(screen.getByRole('button', { name: 'Tìm' }))
    expect(listCounterOrders).toHaveBeenLastCalledWith({ q: 'An', page: 1 })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Nhận trả Sách Đúng Hạn của Đọc Giả A' })).toBeEnabled())
    await user.click(screen.getByRole('button', { name: 'Nhận trả Sách Đúng Hạn của Đọc Giả A' }))
    const form = screen.getByRole('form', { name: 'Xác nhận trả Sách Đúng Hạn' })
    await user.click(within(form).getByLabelText('Bình thường'))
    counterReturn.mockResolvedValue({ message: 'Đã xác nhận trả sách' })
    await user.click(within(form).getByRole('button', { name: 'Xác nhận trả' }))
    expect(counterReturn).toHaveBeenCalledWith(60, { condition: 'normal' })
    expect(await screen.findByRole('status')).toHaveTextContent('Đã xác nhận trả sách')
    expect(screen.queryByRole('button', { name: /Từ chối/ })).not.toBeInTheDocument()
  })

  it('chuyển tab đổi danh sách', async () => {
    listCounterOrders.mockResolvedValue(pageOf('orders', []))
    const user = await setup()
    await screen.findByRole('row', { name: 'Yêu cầu trả Sách Đúng Hạn của Đọc Giả A' })
    await user.click(screen.getByRole('tab', { name: 'Trả tại quầy' }))
    expect(await screen.findByText('Không có đơn đang mượn nào phù hợp.')).toBeInTheDocument()
  })
})
