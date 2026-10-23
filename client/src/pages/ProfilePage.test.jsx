import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import ProfilePage from './ProfilePage'
import { AuthProvider } from '../features/auth/AuthContext'
import RequireAuth from '../features/auth/RequireAuth'
import { getMe } from '../features/auth/authApi'
import {
  changePassword, deleteAvatar, getProfile, updateProfile, uploadAvatar,
} from '../features/profile/profileApi'
import { validateAvatarFile } from '../features/profile/profileRules'

vi.mock('../features/auth/authApi', () => ({ login: vi.fn(), getMe: vi.fn() }))
vi.mock('../features/profile/profileApi', () => ({
  getProfile: vi.fn(),
  updateProfile: vi.fn(),
  changePassword: vi.fn(),
  uploadAvatar: vi.fn(),
  deleteAvatar: vi.fn(),
}))

const PROFILE = {
  id: 1,
  email: 'r@example.com',
  name: 'Độc Giả',
  phone: null,
  address: null,
  avatarUrl: null,
  createdAt: '2026-10-01T03:00:00.000Z',
  borrowCount: 3,
  totalFine: 70000,
  unpaidFine: 20000,
}

async function setup(profile = PROFILE) {
  localStorage.setItem('token', 'saved')
  getMe.mockResolvedValue({ id: 1, email: profile.email, name: profile.name, role: 'reader', status: 'active' })
  getProfile.mockResolvedValue(profile)
  const user = userEvent.setup()
  render(
    <MemoryRouter initialEntries={['/reader/profile']}>
      <AuthProvider>
        <Routes>
          <Route path="/reader/profile" element={<RequireAuth roles={['reader']}><ProfilePage /></RequireAuth>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  )
  await screen.findByRole('form', { name: 'Thông tin cá nhân' })
  return user
}

const infoForm = () => within(screen.getByRole('form', { name: 'Thông tin cá nhân' }))
const pwForm = () => within(screen.getByRole('form', { name: 'Đổi mật khẩu' }))
const png = (size = 10) => new File([new Uint8Array(size)], 'a.png', { type: 'image/png' })

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  URL.createObjectURL = vi.fn(() => 'blob:preview')
  URL.revokeObjectURL = vi.fn()
})

describe('ProfilePage (2.1.3) hiển thị', () => {
  it('hiện email, ngày tham gia, số lần mượn, tiền phạt và ảnh mặc định', async () => {
    await setup()
    expect(screen.getByText('01/10/2026')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText(/70\.000 đ/)).toBeInTheDocument()
    expect(screen.getByText(/20\.000 đ/)).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Ảnh đại diện mặc định' })).toHaveTextContent('Đ')
  })

  it('edge 1, 4: SĐT/địa chỉ trống hiển thị rỗng; email không sửa được', async () => {
    await setup()
    expect(infoForm().getByLabelText('Số điện thoại')).toHaveValue('')
    expect(infoForm().getByLabelText('Địa chỉ')).toHaveValue('')
    expect(infoForm().getByLabelText('Email')).toBeDisabled()
  })

  it('có ảnh → hiện ảnh, có nút Đổi ảnh và Xóa ảnh', async () => {
    await setup({ ...PROFILE, avatarUrl: 'https://cdn/a.png' })
    expect(screen.getByRole('img', { name: 'Ảnh đại diện' })).toHaveAttribute('src', 'https://cdn/a.png')
    expect(screen.getByText('Đổi ảnh')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Xóa ảnh' })).toBeInTheDocument()
  })
})

describe('Cập nhật thông tin', () => {
  it('hợp lệ → gửi đã trim, báo thành công, tên trên header đổi theo', async () => {
    updateProfile.mockResolvedValue({
      message: 'Cập nhật thông tin thành công',
      profile: { ...PROFILE, name: 'Tên Mới', phone: '0912345678', address: 'HN' },
    })
    const user = await setup()
    const name = infoForm().getByLabelText('Tên')
    await user.clear(name)
    await user.type(name, '  Tên Mới ')
    await user.type(infoForm().getByLabelText('Số điện thoại'), '0912345678')
    await user.type(infoForm().getByLabelText('Địa chỉ'), ' HN ')
    await user.click(infoForm().getByRole('button', { name: 'Lưu thông tin' }))

    expect(await infoForm().findByRole('status')).toHaveTextContent('Cập nhật thông tin thành công')
    expect(updateProfile).toHaveBeenCalledWith({ name: 'Tên Mới', phone: '0912345678', address: 'HN' })
    expect(within(document.querySelector('header')).getByText('Tên Mới')).toBeInTheDocument()
  })

  it('edge 1-3: tên trống, SĐT sai, địa chỉ trống → lỗi tại field, không gọi API', async () => {
    const user = await setup()
    await user.clear(infoForm().getByLabelText('Tên'))
    await user.type(infoForm().getByLabelText('Số điện thoại'), '12345')
    await user.click(infoForm().getByRole('button', { name: 'Lưu thông tin' }))

    expect(await screen.findByText('Tên không được để trống')).toBeInTheDocument()
    expect(screen.getByText('Số điện thoại không đúng định dạng')).toBeInTheDocument()
    expect(screen.getByText('Địa chỉ không được để trống')).toBeInTheDocument()
    expect(updateProfile).not.toHaveBeenCalled()
  })

  it('edge 3: địa chỉ quá 255 ký tự → lỗi', async () => {
    const user = await setup()
    const address = infoForm().getByLabelText('Địa chỉ')
    await user.click(address)
    await user.paste('a'.repeat(256))
    await user.click(infoForm().getByRole('button', { name: 'Lưu thông tin' }))
    expect(await screen.findByText('Địa chỉ tối đa 255 ký tự')).toBeInTheDocument()
  })

  it('lỗi theo field từ server hiển thị tại field', async () => {
    updateProfile.mockRejectedValue({
      response: { status: 400, data: { message: 'Dữ liệu không hợp lệ', errors: { phone: 'Lỗi SĐT từ server' } } },
    })
    const user = await setup()
    await user.type(infoForm().getByLabelText('Địa chỉ'), 'HN')
    await user.click(infoForm().getByRole('button', { name: 'Lưu thông tin' }))
    expect(await screen.findByText('Lỗi SĐT từ server')).toBeInTheDocument()
  })
})

describe('Đổi mật khẩu', () => {
  async function fillPw(user, { current = 'oldpass123', next = 'newpass123', confirm = next } = {}) {
    if (current) await user.type(pwForm().getByLabelText('Mật khẩu hiện tại'), current)
    if (next) await user.type(pwForm().getByLabelText('Mật khẩu mới'), next)
    if (confirm) await user.type(pwForm().getByLabelText('Xác nhận mật khẩu mới'), confirm)
    await user.click(pwForm().getByRole('button', { name: 'Đổi mật khẩu' }))
  }

  it('hợp lệ → gọi API, xóa form, báo thành công', async () => {
    changePassword.mockResolvedValue({ message: 'Đổi mật khẩu thành công' })
    const user = await setup()
    await fillPw(user)

    expect(await pwForm().findByRole('status')).toHaveTextContent('Đổi mật khẩu thành công')
    expect(changePassword).toHaveBeenCalledWith({
      currentPassword: 'oldpass123', newPassword: 'newpass123', confirmPassword: 'newpass123',
    })
    expect(pwForm().getByLabelText('Mật khẩu hiện tại')).toHaveValue('')
  })

  it('mật khẩu mới ngoài 8-16 và confirm không khớp → lỗi, không gọi API', async () => {
    const user = await setup()
    await fillPw(user, { next: 'short', confirm: 'other' })
    expect(await screen.findByText('Mật khẩu tối thiểu 8 ký tự')).toBeInTheDocument()
    expect(screen.getByText('Xác nhận mật khẩu không khớp')).toBeInTheDocument()
    expect(changePassword).not.toHaveBeenCalled()
  })

  it.each([
    ['currentPassword', 'Mật khẩu hiện tại không đúng'],
    ['newPassword', 'Mật khẩu mới phải khác mật khẩu cũ'],
  ])('server báo lỗi tại %s → hiển thị tại field', async (field, message) => {
    changePassword.mockRejectedValue({ response: { status: 400, data: { message, errors: { [field]: message } } } })
    const user = await setup()
    await fillPw(user)
    expect(await pwForm().findByText(message)).toBeInTheDocument()
  })
})

describe('Ảnh đại diện', () => {
  const input = () => screen.getByLabelText('Chọn ảnh đại diện')

  it('chọn ảnh → xem trước → Xác nhận mới gửi; xong hiện ảnh mới', async () => {
    uploadAvatar.mockResolvedValue({ message: 'ok', avatarUrl: 'https://cdn/new.png' })
    const user = await setup()
    const file = png()
    await user.upload(input(), file)

    expect(screen.getByRole('img', { name: 'Xem trước ảnh đại diện' })).toHaveAttribute('src', 'blob:preview')
    expect(uploadAvatar).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Xác nhận' }))

    expect(await screen.findByText('Cập nhật ảnh đại diện thành công')).toBeInTheDocument()
    expect(uploadAvatar).toHaveBeenCalledWith(file)
    expect(screen.getByRole('img', { name: 'Ảnh đại diện' })).toHaveAttribute('src', 'https://cdn/new.png')
  })

  it('Hủy xem trước → giữ ảnh cũ, không gửi', async () => {
    const user = await setup()
    await user.upload(input(), png())
    await user.click(screen.getByRole('button', { name: 'Hủy' }))
    expect(screen.getByRole('img', { name: 'Ảnh đại diện mặc định' })).toBeInTheDocument()
    expect(uploadAvatar).not.toHaveBeenCalled()
  })

  it('edge 9: file quá 2 MB → lỗi ngay ở client, không gửi', async () => {
    const user = await setup()
    await user.upload(input(), png(2 * 1024 * 1024 + 1))
    expect(screen.getByRole('alert')).toHaveTextContent('Chỉ nhận ảnh JPG, PNG, WebP tối đa 2 MB')
    expect(screen.queryByRole('button', { name: 'Xác nhận' })).not.toBeInTheDocument()
  })

  it('upload lỗi → báo lỗi, ảnh cũ giữ nguyên', async () => {
    uploadAvatar.mockRejectedValue({ response: { status: 502, data: { message: 'Không tải được ảnh, vui lòng thử lại' } } })
    const user = await setup({ ...PROFILE, avatarUrl: 'https://cdn/old.png' })
    await user.upload(input(), png())
    await user.click(screen.getByRole('button', { name: 'Xác nhận' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Không tải được ảnh, vui lòng thử lại')
  })

  it('edge 13: đang gửi thì khóa nút', async () => {
    let resolve
    uploadAvatar.mockReturnValue(new Promise((r) => { resolve = r }))
    const user = await setup()
    await user.upload(input(), png())
    await user.click(screen.getByRole('button', { name: 'Xác nhận' }))
    expect(screen.getByRole('button', { name: 'Đang tải...' })).toBeDisabled()
    resolve({ avatarUrl: 'https://cdn/x.png' })
    expect(await screen.findByRole('img', { name: 'Ảnh đại diện' })).toBeInTheDocument()
  })

  it('xóa ảnh có hộp thoại xác nhận; đồng ý → về ảnh mặc định', async () => {
    deleteAvatar.mockResolvedValue({ avatarUrl: null })
    const confirm = vi.spyOn(window, 'confirm')
    const user = await setup({ ...PROFILE, avatarUrl: 'https://cdn/old.png' })

    confirm.mockReturnValueOnce(false)
    await user.click(screen.getByRole('button', { name: 'Xóa ảnh' }))
    expect(deleteAvatar).not.toHaveBeenCalled()

    confirm.mockReturnValueOnce(true)
    await user.click(screen.getByRole('button', { name: 'Xóa ảnh' }))
    expect(await screen.findByRole('img', { name: 'Ảnh đại diện mặc định' })).toBeInTheDocument()
    expect(deleteAvatar).toHaveBeenCalledTimes(1)
  })
})

describe('validateAvatarFile', () => {
  it.each([
    [new File(['x'], 'a.jpg', { type: 'image/jpeg' }), null],
    [new File(['x'], 'a.webp', { type: 'image/webp' }), null],
    [new File(['x'], 'a.gif', { type: 'image/gif' }), 'Chỉ nhận ảnh JPG, PNG, WebP tối đa 2 MB'],
    [new File(['x'], 'a.exe', { type: 'application/x-msdownload' }), 'Chỉ nhận ảnh JPG, PNG, WebP tối đa 2 MB'],
    [undefined, 'Chỉ nhận ảnh JPG, PNG, WebP tối đa 2 MB'],
  ])('%#', (file, expected) => {
    expect(validateAvatarFile(file)).toBe(expected)
  })
})
