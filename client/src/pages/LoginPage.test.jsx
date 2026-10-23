import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import LoginPage from './LoginPage'
import { AuthProvider, useAuth } from '../features/auth/AuthContext'
import RequireAuth from '../features/auth/RequireAuth'
import { getMe, login } from '../features/auth/authApi'

vi.mock('../features/auth/authApi', () => ({ login: vi.fn(), getMe: vi.fn() }))

function Where() {
  const { pathname, search } = useLocation()
  const { logout } = useAuth()
  return (
    <>
      <p data-testid="where">{pathname + search}</p>
      <button type="button" onClick={logout}>Đăng xuất</button>
    </>
  )
}

function LoginWhere() {
  const { pathname, search } = useLocation()
  return <><p data-testid="login-where">{pathname + search}</p><LoginPage /></>
}

function setup(path = '/login') {
  const user = userEvent.setup()
  render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginWhere />} />
          <Route path="/reader/*" element={<RequireAuth roles={['reader']}><Where /></RequireAuth>} />
          <Route path="/librarian" element={<RequireAuth roles={['librarian']}><Where /></RequireAuth>} />
          <Route path="/admin" element={<RequireAuth roles={['admin']}><Where /></RequireAuth>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  )
  return user
}

async function fill(user, { email = 'reader@example.com', password = 'secret123' } = {}) {
  if (email) await user.type(screen.getByLabelText('Email'), email)
  if (password) await user.type(screen.getByLabelText('Mật khẩu'), password)
}

const submit = (user) => user.click(screen.getByRole('button', { name: 'Đăng nhập' }))
const account = (role) => ({ id: 1, email: 'x@example.com', name: 'X', role, status: 'active' })

beforeEach(() => {
  login.mockReset()
  getMe.mockReset()
  localStorage.clear()
})

describe('LoginPage (2.1.2)', () => {
  it.each([
    ['reader', '/reader'],
    ['librarian', '/librarian'],
    ['admin', '/admin'],
  ])('đăng nhập %s → lưu token, chuyển tới %s', async (role, path) => {
    login.mockResolvedValue({ token: 'jwt-token', user: account(role) })
    const user = setup()
    await fill(user, { email: '  Reader@Example.com ' })
    await submit(user)

    expect(await screen.findByTestId('where')).toHaveTextContent(path)
    expect(login).toHaveBeenCalledWith({ email: 'Reader@Example.com', password: 'secret123' })
    expect(localStorage.getItem('token')).toBe('jwt-token')
  })

  it('bỏ trống → lỗi tại từng field, không gọi API', async () => {
    const user = setup()
    await submit(user)

    expect(await screen.findByText('Email không được để trống')).toBeInTheDocument()
    expect(screen.getByText('Mật khẩu không được để trống')).toBeInTheDocument()
    expect(login).not.toHaveBeenCalled()
  })

  it('sai định dạng email, mật khẩu ngoài 8-16 → lỗi validate', async () => {
    const user = setup()
    await fill(user, { email: 'abc', password: '1234567' })
    await submit(user)

    expect(await screen.findByText('Email không đúng định dạng')).toBeInTheDocument()
    expect(screen.getByText('Mật khẩu tối thiểu 8 ký tự')).toBeInTheDocument()
    expect(login).not.toHaveBeenCalled()
  })

  it.each([
    'Email hoặc mật khẩu không đúng',
    'Tài khoản chưa được xác nhận',
    'Tài khoản đã bị vô hiệu hóa',
    'Bạn đã nhập sai quá nhiều lần, vui lòng thử lại sau 15 phút',
  ])('server báo "%s" → hiển thị, ở lại trang', async (message) => {
    login.mockRejectedValue({ response: { status: 401, data: { message } } })
    const user = setup()
    await fill(user)
    await submit(user)

    expect(await screen.findByRole('alert')).toHaveTextContent(message)
    expect(localStorage.getItem('token')).toBeNull()
  })

  it('edge 5: có ?redirect → quay lại URL cũ sau khi đăng nhập', async () => {
    login.mockResolvedValue({ token: 't', user: account('reader') })
    const user = setup('/login?redirect=%2Freader%2Fbooks%3Fpage%3D2&expired=1')
    expect(screen.getByRole('status')).toHaveTextContent('Phiên đăng nhập đã hết hạn')
    await fill(user)
    await submit(user)

    expect(await screen.findByTestId('where')).toHaveTextContent('/reader/books?page=2')
  })

  it('redirect ra ngoài site bị bỏ qua', async () => {
    login.mockResolvedValue({ token: 't', user: account('admin') })
    const user = setup('/login?redirect=%2F%2Fevil.com')
    await fill(user)
    await submit(user)

    expect(await screen.findByTestId('where')).toHaveTextContent('/admin')
  })

  it('redirect tới trang không đúng vai trò → về dashboard của mình', async () => {
    login.mockResolvedValue({ token: 't', user: account('reader') })
    const user = setup('/login?redirect=%2Fadmin')
    await fill(user)
    await submit(user)

    expect(await screen.findByTestId('where')).toHaveTextContent(/^\/reader$/)
  })

  it('edge 6: đã đăng nhập mà vào /login → chuyển thẳng tới dashboard', async () => {
    localStorage.setItem('token', 'saved')
    getMe.mockResolvedValue(account('librarian'))
    setup('/login')

    expect(await screen.findByTestId('where')).toHaveTextContent('/librarian')
    expect(login).not.toHaveBeenCalled()
  })
})

describe('RequireAuth', () => {
  it('chưa đăng nhập → về /login kèm URL cũ', async () => {
    setup('/reader/books')
    expect(await screen.findByTestId('login-where')).toHaveTextContent('/login?redirect=%2Freader%2Fbooks')
  })

  it('đăng xuất → xóa token, về /login không kèm redirect', async () => {
    localStorage.setItem('token', 'saved')
    getMe.mockResolvedValue(account('admin'))
    const user = setup('/admin')
    await user.click(await screen.findByRole('button', { name: 'Đăng xuất' }))

    expect(await screen.findByTestId('login-where')).toHaveTextContent(/^\/login$/)
    expect(localStorage.getItem('token')).toBeNull()
  })

  it('token đã lưu nhưng server từ chối (hết hạn/bị khóa) → xóa token, về /login', async () => {
    localStorage.setItem('token', 'expired')
    getMe.mockRejectedValue({ response: { status: 401 } })
    setup('/reader')

    expect(await screen.findByLabelText('Email')).toBeInTheDocument()
    expect(localStorage.getItem('token')).toBeNull()
  })

  it('edge 4: role lấy từ server, sai vai trò → về dashboard của mình', async () => {
    localStorage.setItem('token', 'saved')
    getMe.mockResolvedValue(account('reader'))
    setup('/admin')

    expect(await screen.findByTestId('where')).toHaveTextContent(/^\/reader$/)
  })
})
