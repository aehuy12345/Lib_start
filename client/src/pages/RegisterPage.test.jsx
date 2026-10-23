import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import RegisterPage from './RegisterPage'
import { register } from '../features/auth/authApi'

vi.mock('../features/auth/authApi', () => ({ register: vi.fn() }))

function setup() {
  const user = userEvent.setup()
  render(
    <MemoryRouter>
      <RegisterPage />
    </MemoryRouter>,
  )
  return user
}

async function fill(user, values) {
  const v = { email: 'reader@example.com', name: 'Nguyễn Văn A', password: 'secret123', confirm: 'secret123', ...values }
  if (v.email) await user.type(screen.getByLabelText('Email'), v.email)
  if (v.name) await user.type(screen.getByLabelText('Tên'), v.name)
  if (v.password) await user.type(screen.getByLabelText('Mật khẩu'), v.password)
  if (v.confirm) await user.type(screen.getByLabelText('Xác nhận mật khẩu'), v.confirm)
}

const submit = (user) => user.click(screen.getByRole('button', { name: 'Đăng ký' }))

beforeEach(() => {
  register.mockReset()
})

describe('RegisterPage (2.1.1)', () => {
  it('đăng ký thành công hiển thị thông báo chờ xác nhận', async () => {
    register.mockResolvedValue({ message: 'Đăng ký thành công. Tài khoản đang chờ xác nhận, vui lòng kiểm tra email.' })
    const user = setup()
    await fill(user, { email: '  Reader@Example.com ' })
    await submit(user)

    expect(await screen.findByRole('status')).toHaveTextContent('chờ xác nhận')
    expect(register).toHaveBeenCalledWith({
      email: 'Reader@Example.com',
      name: 'Nguyễn Văn A',
      password: 'secret123',
      confirmPassword: 'secret123',
    })
  })

  it('bỏ trống mọi field hiển thị lỗi cạnh từng field, không gọi API', async () => {
    const user = setup()
    await submit(user)

    expect(await screen.findByText('Email không được để trống')).toBeInTheDocument()
    expect(screen.getByText('Tên không được để trống')).toBeInTheDocument()
    expect(screen.getByText('Mật khẩu không được để trống')).toBeInTheDocument()
    expect(screen.getByText('Xác nhận mật khẩu không được để trống')).toBeInTheDocument()
    expect(register).not.toHaveBeenCalled()
  })

  it('edge 4: confirm không khớp báo lỗi tại field confirm, không gọi API', async () => {
    const user = setup()
    await fill(user, { confirm: 'secret999' })
    await submit(user)

    expect(await screen.findByText('Xác nhận mật khẩu không khớp')).toBeInTheDocument()
    expect(register).not.toHaveBeenCalled()
  })

  it('edge 3: mật khẩu 7 ký tự bị từ chối', async () => {
    const user = setup()
    await fill(user, { password: '1234567', confirm: '1234567' })
    await submit(user)

    expect(await screen.findByText('Mật khẩu tối thiểu 8 ký tự')).toBeInTheDocument()
    expect(register).not.toHaveBeenCalled()
  })

  it('edge 5: tên chỉ có khoảng trắng bị từ chối', async () => {
    const user = setup()
    await fill(user, { name: '    ' })
    await submit(user)

    expect(await screen.findByText('Tên không được để trống')).toBeInTheDocument()
  })

  it('email sai định dạng bị từ chối', async () => {
    const user = setup()
    await fill(user, { email: 'abc@' })
    await submit(user)

    expect(await screen.findByText('Email không đúng định dạng')).toBeInTheDocument()
  })

  it('email đã tồn tại: hiển thị lỗi server tại field email', async () => {
    register.mockRejectedValue({
      response: { data: { message: 'Email đã được sử dụng', errors: { email: 'Email đã được sử dụng' } } },
    })
    const user = setup()
    await fill(user)
    await submit(user)

    expect(await screen.findByText('Email đã được sử dụng')).toBeInTheDocument()
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true')
  })

  it('lỗi hệ thống hiển thị thông báo chung', async () => {
    register.mockRejectedValue({ response: { data: { message: 'Lỗi hệ thống, vui lòng thử lại sau' } } })
    const user = setup()
    await fill(user)
    await submit(user)

    expect(await screen.findByRole('alert')).toHaveTextContent('Lỗi hệ thống')
  })

  it('edge 6: nút bị khóa khi đang gửi', async () => {
    let resolve
    register.mockReturnValue(new Promise((r) => { resolve = r }))
    const user = setup()
    await fill(user)
    await submit(user)

    const button = screen.getByRole('button', { name: 'Đang gửi...' })
    expect(button).toBeDisabled()
    await user.click(button)
    expect(register).toHaveBeenCalledTimes(1)
    resolve({ message: 'ok' })
    expect(await screen.findByRole('status')).toBeInTheDocument()
  })
})
