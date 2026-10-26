import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import FineTiersPage from './FineTiersPage'
import { AuthProvider } from '../features/auth/AuthContext'
import RequireAuth from '../features/auth/RequireAuth'
import { getMe } from '../features/auth/authApi'
import { createFineTier, deleteFineTier, listFineTiers, updateFineTier } from '../features/fine/fineApi'

vi.mock('../features/auth/authApi', () => ({ login: vi.fn(), getMe: vi.fn() }))
vi.mock('../features/fine/fineApi', () => ({
  listFineTiers: vi.fn(),
  createFineTier: vi.fn(),
  updateFineTier: vi.fn(),
  deleteFineTier: vi.fn(),
}))

const TIERS = [
  { id: 1, name: 'Trả muộn', type: 'late', amount: 10000, ticketCount: 0, updatedAt: '2026-10-26T01:00:00.000Z' },
  { id: 2, name: 'Mất sách', type: 'lost', amount: 150000, ticketCount: 4, updatedAt: '2026-10-26T02:00:00.000Z' },
]
const apiError = (status, message, errors, reason) => ({ response: { status, data: { message, errors, reason } } })

async function setup({ role = 'admin', tiers = TIERS } = {}) {
  localStorage.setItem('token', 'saved')
  getMe.mockResolvedValue({ id: 3, email: 'a@example.com', name: 'A', role, status: 'active' })
  listFineTiers.mockResolvedValue(tiers)
  const user = userEvent.setup()
  render(
    <MemoryRouter initialEntries={['/admin/fine-tiers']}>
      <AuthProvider>
        <Routes>
          <Route path="/admin/fine-tiers" element={<RequireAuth roles={['admin']}><FineTiersPage /></RequireAuth>} />
          <Route path="/librarian" element={<p>Librarian dashboard</p>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  )
  return user
}

const rowOf = (name) => screen.getByLabelText(`Tên mức phạt ${name}`).closest('tr')

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('FineTiersPage (2.5.1)', () => {
  it('hiển thị bảng: tên, loại, số tiền sửa được, số phiếu đã dùng', async () => {
    await setup()
    expect(await screen.findByLabelText('Tên mức phạt Trả muộn')).toHaveValue('Trả muộn')
    expect(screen.getByLabelText('Số tiền Mất sách')).toHaveValue('150000')
    const row = rowOf('Mất sách')
    expect(within(row).getByText('Mất')).toBeInTheDocument()
    expect(within(row).getByText('4')).toBeInTheDocument()
    expect(within(row).getByText(/150\.000 đ/)).toBeInTheDocument()
  })

  it('edge 5: chưa có mức phạt → bảng trống kèm cảnh báo', async () => {
    await setup({ tiers: [] })
    expect(await screen.findByText(/Chưa có mức phạt nào/)).toBeInTheDocument()
  })

  it('edge 6: nhân viên thư viện bị chuyển về dashboard của mình', async () => {
    await setup({ role: 'librarian' })
    expect(await screen.findByText('Librarian dashboard')).toBeInTheDocument()
    expect(listFineTiers).not.toHaveBeenCalled()
  })

  it('thêm: thiếu dữ liệu báo lỗi từng ô, không gọi API', async () => {
    const user = await setup()
    await user.click(await screen.findByRole('button', { name: 'Thêm mức phạt' }))
    const form = screen.getByRole('form', { name: 'Thêm mức phạt' })
    await user.type(within(form).getByLabelText('Số tiền (VND)'), '12.5')
    await user.click(within(form).getByRole('button', { name: 'Thêm' }))
    expect(within(form).getByText('Tên mức phạt không được để trống')).toBeInTheDocument()
    expect(within(form).getByText('Vui lòng chọn loại mức phạt')).toBeInTheDocument()
    expect(within(form).getByText('Số tiền phải là số nguyên (VND)')).toBeInTheDocument()
    expect(createFineTier).not.toHaveBeenCalled()
  })

  it('thêm: trùng tên → lỗi từ server dưới ô tên', async () => {
    const user = await setup()
    createFineTier.mockRejectedValueOnce(apiError(409, 'Tên mức phạt đã tồn tại', { name: 'Tên mức phạt đã tồn tại' }))
    await user.click(await screen.findByRole('button', { name: 'Thêm mức phạt' }))
    const form = screen.getByRole('form', { name: 'Thêm mức phạt' })
    await user.type(within(form).getByLabelText('Tên mức phạt'), 'trả MUỘN')
    await user.selectOptions(within(form).getByLabelText('Loại'), 'late')
    await user.type(within(form).getByLabelText('Số tiền (VND)'), '5000')
    await user.click(within(form).getByRole('button', { name: 'Thêm' }))
    expect(await within(form).findByText('Tên mức phạt đã tồn tại')).toBeInTheDocument()
  })

  it('thêm thành công: gửi tên đã trim + số, đóng form, tải lại bảng', async () => {
    const user = await setup()
    createFineTier.mockResolvedValueOnce({ tier: { id: 3, name: 'Hư hỏng', type: 'damaged', amount: 50000 } })
    await user.click(await screen.findByRole('button', { name: 'Thêm mức phạt' }))
    const form = screen.getByRole('form', { name: 'Thêm mức phạt' })
    await user.type(within(form).getByLabelText('Tên mức phạt'), '  Hư hỏng  ')
    await user.selectOptions(within(form).getByLabelText('Loại'), 'damaged')
    await user.type(within(form).getByLabelText('Số tiền (VND)'), ' 50000 ')
    await user.click(within(form).getByRole('button', { name: 'Thêm' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Đã thêm mức phạt "Hư hỏng"')
    expect(createFineTier).toHaveBeenCalledWith({ name: 'Hư hỏng', type: 'damaged', amount: 50000 })
    expect(screen.queryByRole('form', { name: 'Thêm mức phạt' })).not.toBeInTheDocument()
    expect(listFineTiers).toHaveBeenCalledTimes(2)
  })

  it('sửa trên bảng: Lưu chỉ hiện khi đổi, gửi updatedAt, cập nhật dòng', async () => {
    const user = await setup()
    const amount = await screen.findByLabelText('Số tiền Trả muộn')
    expect(within(rowOf('Trả muộn')).queryByRole('button', { name: 'Lưu' })).not.toBeInTheDocument()
    updateFineTier.mockResolvedValueOnce({ tier: { ...TIERS[0], amount: 20000, updatedAt: '2026-10-26T05:00:00.000Z' } })
    await user.clear(amount)
    await user.type(amount, '20000')
    await user.click(within(rowOf('Trả muộn')).getByRole('button', { name: 'Lưu' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Cập nhật mức phạt thành công')
    expect(updateFineTier).toHaveBeenCalledWith(1, { name: 'Trả muộn', amount: 20000, updatedAt: TIERS[0].updatedAt })
    expect(screen.getByLabelText('Số tiền Trả muộn')).toHaveValue('20000')
  })

  it('sửa: số tiền 0 báo lỗi tại ô, Hủy trả lại giá trị cũ', async () => {
    const user = await setup()
    const amount = await screen.findByLabelText('Số tiền Trả muộn')
    await user.clear(amount)
    await user.type(amount, '0')
    await user.click(within(rowOf('Trả muộn')).getByRole('button', { name: 'Lưu' }))
    expect(within(rowOf('Trả muộn')).getByText('Số tiền phải lớn hơn 0')).toBeInTheDocument()
    expect(updateFineTier).not.toHaveBeenCalled()
    await user.click(within(rowOf('Trả muộn')).getByRole('button', { name: 'Hủy' }))
    expect(amount).toHaveValue('10000')
  })

  it('edge 7: Admin khác đã sửa (409 stale) → báo lỗi và tải lại bảng', async () => {
    const user = await setup()
    const name = await screen.findByLabelText('Tên mức phạt Trả muộn')
    updateFineTier.mockRejectedValueOnce(apiError(409, 'Mức phạt đã được người khác sửa, bảng đã được tải lại', undefined, 'stale'))
    listFineTiers.mockResolvedValueOnce([{ ...TIERS[0], name: 'Muộn hạn', updatedAt: '2026-10-26T06:00:00.000Z' }, TIERS[1]])
    await user.clear(name)
    await user.type(name, 'Quá hạn')
    await user.click(within(rowOf('Trả muộn')).getByRole('button', { name: 'Lưu' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Mức phạt đã được người khác sửa')
    expect(await screen.findByLabelText('Tên mức phạt Muộn hạn')).toHaveValue('Muộn hạn')
  })

  it('xóa mức chưa dùng: hỏi xác nhận, Hủy thì không gọi API', async () => {
    const user = await setup()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false)
    await user.click(await screen.findByRole('button', { name: 'Xóa Trả muộn' }))
    expect(confirm).toHaveBeenCalledWith('Xóa mức phạt "Trả muộn"?')
    expect(deleteFineTier).not.toHaveBeenCalled()
  })

  it('edge 4: xóa mức đã dùng → hộp thoại báo sẽ ẩn, hiện thông báo từ server và tải lại', async () => {
    const user = await setup()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(true)
    deleteFineTier.mockResolvedValueOnce({ hidden: true, message: 'Mức phạt đã được dùng trong phiếu phạt nên chỉ được ẩn' })
    const button = await screen.findByRole('button', { name: 'Xóa Mất sách' })
    // Xếp sau lần tải đầu: chỉ dành cho lần tải lại sau khi xóa.
    listFineTiers.mockResolvedValueOnce([TIERS[0]])
    await user.click(button)
    expect(confirm.mock.calls[0][0]).toMatch(/đã được dùng trong 4 phiếu phạt nên sẽ được ẩn/)
    expect(await screen.findByRole('status')).toHaveTextContent('chỉ được ẩn')
    expect(deleteFineTier).toHaveBeenCalledWith(2)
    await waitFor(() => expect(screen.queryByLabelText('Tên mức phạt Mất sách')).not.toBeInTheDocument())
  })

  it('xóa: 404 (đã bị xóa nơi khác) → báo lỗi', async () => {
    const user = await setup()
    vi.spyOn(window, 'confirm').mockReturnValueOnce(true)
    deleteFineTier.mockRejectedValueOnce(apiError(404, 'Không tìm thấy mức phạt'))
    await user.click(await screen.findByRole('button', { name: 'Xóa Trả muộn' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Không tìm thấy mức phạt')
  })
})
