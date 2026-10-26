import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import UsersPage from './UsersPage'
import { AuthProvider } from '../features/auth/AuthContext'
import RequireAuth from '../features/auth/RequireAuth'
import { getMe } from '../features/auth/authApi'
import { activateUser, disableUser, listUsers } from '../features/user/userApi'

vi.mock('../features/auth/authApi', () => ({ login: vi.fn(), getMe: vi.fn() }))
vi.mock('../features/user/userApi', () => ({ listUsers: vi.fn(), disableUser: vi.fn(), activateUser: vi.fn() }))

const person = (id, patch) => ({
  id, email: `u${id}@example.com`, name: `Người ${id}`, role: 'reader', status: 'active',
  createdAt: '2026-10-20T03:00:00Z', activeBorrowCount: 0, isSelf: false, canDisable: true, canActivate: false, ...patch,
})
const USERS = [
  person(3, { email: 'a@example.com', name: 'Admin', role: 'admin', isSelf: true, canDisable: false }),
  person(5, { name: 'Nguyễn An', activeBorrowCount: 2 }),
  person(6, { status: 'pending', canActivate: true }),
  person(7, { role: 'librarian', status: 'disabled', canDisable: false, canActivate: true }),
]
const result = (users) => ({ users, pagination: { page: 1, pageSize: 10, total: users.length, totalPages: 1 } })
const apiError = (status, message, body = {}) => ({ response: { status, data: { message, ...body } } })

function LocationProbe() {
  const location = useLocation()
  return <p data-testid="location">{location.pathname + location.search}</p>
}

async function setup({ users = USERS, url = '/admin/users', role = 'admin' } = {}) {
  localStorage.setItem('token', 'saved')
  getMe.mockResolvedValue({ id: 3, email: 'a@example.com', name: 'Admin', role, status: 'active' })
  listUsers.mockResolvedValue(result(users))
  const user = userEvent.setup()
  render(
    <MemoryRouter initialEntries={[url]}>
      <AuthProvider>
        <Routes>
          <Route path="/admin/users" element={<RequireAuth roles={['admin']}><UsersPage /><LocationProbe /></RequireAuth>} />
          <Route path="/librarian" element={<p>Librarian dashboard</p>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  )
  return { user }
}

const row = (email) => screen.getByRole('row', { name: `Người dùng ${email}` })

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('UsersPage (2.6.1)', () => {
  it('hiển thị Email, Tên, Vai trò, Ngày tham gia, Trạng thái', async () => {
    await setup()
    const an = await screen.findByRole('row', { name: 'Người dùng u5@example.com' })
    expect(within(an).getByText('Nguyễn An')).toBeInTheDocument()
    expect(within(an).getByText('Độc giả')).toBeInTheDocument()
    expect(within(an).getByText('20/10/2026')).toBeInTheDocument()
    expect(within(an).getByText('Kích hoạt')).toBeInTheDocument()
    expect(within(an).getByText('Đang mượn 2 cuốn')).toBeInTheDocument()
    expect(within(row('u6@example.com')).getByText('Chờ xác nhận')).toBeInTheDocument()
    expect(within(row('u7@example.com')).getByText('Nhân viên thư viện')).toBeInTheDocument()
    expect(listUsers).toHaveBeenCalledWith({ role: 'all', q: '', page: 1 })
  })

  it('edge 1: tài khoản của chính mình không có nút Vô hiệu hóa', async () => {
    await setup()
    const self = await screen.findByRole('row', { name: 'Người dùng a@example.com' })
    expect(within(self).getByText('Admin (bạn)')).toBeInTheDocument()
    expect(within(self).queryByRole('button', { name: /Vô hiệu hóa/ })).not.toBeInTheDocument()
    expect(within(self).getByText('Tài khoản của bạn')).toBeInTheDocument()
  })

  it('tìm theo email/tên và lọc theo vai trò, giữ trên URL', async () => {
    const { user } = await setup()
    await screen.findByRole('row', { name: 'Người dùng u5@example.com' })
    await user.type(screen.getByRole('searchbox', { name: 'Tìm người dùng' }), '  an ')
    await user.click(screen.getByRole('button', { name: 'Tìm' }))
    await waitFor(() => expect(listUsers).toHaveBeenLastCalledWith({ role: 'all', q: 'an', page: 1 }))
    await user.click(screen.getByRole('button', { name: 'Quản lý viên' }))
    await waitFor(() => expect(listUsers).toHaveBeenLastCalledWith({ role: 'admin', q: 'an', page: 1 }))
    expect(screen.getByTestId('location')).toHaveTextContent('/admin/users?role=admin&q=an')
    expect(screen.getByRole('button', { name: 'Quản lý viên' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('không có kết quả → Không tìm thấy người dùng', async () => {
    await setup({ users: [], url: '/admin/users?q=zzz' })
    expect(await screen.findByText('Không tìm thấy người dùng.')).toBeInTheDocument()
  })

  it('edge 3: vô hiệu hóa người đang mượn sách có cảnh báo, Hủy thì không gọi API', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const { user } = await setup()
    await user.click(await screen.findByRole('button', { name: 'Vô hiệu hóa u5@example.com' }))
    expect(confirm.mock.calls[0][0]).toContain('đang mượn 2 cuốn sách')
    expect(disableUser).not.toHaveBeenCalled()
  })

  it('đồng ý vô hiệu hóa → thông báo và tải lại', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    disableUser.mockResolvedValue({ message: 'Đã vô hiệu hóa tài khoản', user: person(5, { status: 'disabled' }) })
    const { user } = await setup()
    await user.click(await screen.findByRole('button', { name: 'Vô hiệu hóa u5@example.com' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Đã vô hiệu hóa tài khoản: Nguyễn An (u5@example.com).')
    expect(disableUser).toHaveBeenCalledWith(5)
    await waitFor(() => expect(listUsers).toHaveBeenCalledTimes(2))
  })

  it('edge 5: kích hoạt tài khoản Chờ xác nhận và Vô hiệu hóa', async () => {
    activateUser.mockResolvedValue({ message: 'Đã kích hoạt tài khoản', user: person(6) })
    const { user } = await setup()
    await user.click(await screen.findByRole('button', { name: 'Kích hoạt u6@example.com' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Đã kích hoạt tài khoản')
    expect(activateUser).toHaveBeenCalledWith(6)
    expect(within(row('u7@example.com')).getByRole('button', { name: 'Kích hoạt u7@example.com' })).toBeInTheDocument()
  })

  it('edge 2: server chặn (409) → báo lỗi và tải lại danh sách', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    disableUser.mockRejectedValue(apiError(409, 'Không thể vô hiệu hóa Admin cuối cùng đang hoạt động', { reason: 'last_admin' }))
    const { user } = await setup()
    await user.click(await screen.findByRole('button', { name: 'Vô hiệu hóa u5@example.com' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Admin cuối cùng')
    await waitFor(() => expect(listUsers).toHaveBeenCalledTimes(2))
  })

  it('Admin cuối cùng (không phải mình) hiện lý do thay cho nút', async () => {
    await setup({ users: [person(9, { role: 'admin', canDisable: false })] })
    expect(await screen.findByText('Admin cuối cùng đang hoạt động')).toBeInTheDocument()
  })

  it('edge 8: nhân viên thư viện bị chuyển về dashboard', async () => {
    await setup({ role: 'librarian' })
    expect(await screen.findByText('Librarian dashboard')).toBeInTheDocument()
    expect(listUsers).not.toHaveBeenCalled()
  })
})
