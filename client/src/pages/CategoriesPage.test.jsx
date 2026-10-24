import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import CategoriesPage from './CategoriesPage'
import { AuthProvider } from '../features/auth/AuthContext'
import RequireAuth from '../features/auth/RequireAuth'
import { getMe } from '../features/auth/authApi'
import {
  createCategory, deleteCategory, listCategories, updateCategory,
} from '../features/category/categoryApi'

vi.mock('../features/auth/authApi', () => ({ login: vi.fn(), getMe: vi.fn() }))
vi.mock('../features/category/categoryApi', () => ({
  listCategories: vi.fn(),
  createCategory: vi.fn(),
  updateCategory: vi.fn(),
  deleteCategory: vi.fn(),
}))

const CATEGORIES = [
  { id: 1, name: 'Khoa học', bookCount: 0 },
  { id: 2, name: 'Văn học', bookCount: 3 },
]
const apiError = (status, message, errors) => ({ response: { status, data: { message, errors } } })

async function setup({ role = 'librarian', categories = CATEGORIES } = {}) {
  localStorage.setItem('token', 'saved')
  getMe.mockResolvedValue({ id: 2, email: 'l@example.com', name: 'L', role, status: 'active' })
  listCategories.mockResolvedValue(categories)
  const user = userEvent.setup()
  render(
    <MemoryRouter initialEntries={['/librarian/categories']}>
      <AuthProvider>
        <Routes>
          <Route path="/librarian/categories" element={<RequireAuth roles={['librarian']}><CategoriesPage /></RequireAuth>} />
          <Route path="/reader" element={<p>Reader dashboard</p>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  )
  return user
}

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('CategoriesPage (2.2.1)', () => {
  it('hiển thị bảng thể loại kèm số sách', async () => {
    await setup()
    expect(await screen.findByLabelText('Tên thể loại Khoa học')).toHaveValue('Khoa học')
    const row = screen.getByLabelText('Tên thể loại Văn học').closest('tr')
    expect(within(row).getByText('3')).toBeInTheDocument()
  })

  it('edge 5: chưa có thể loại → bảng trống kèm gợi ý', async () => {
    await setup({ categories: [] })
    expect(await screen.findByText(/Chưa có thể loại nào/)).toBeInTheDocument()
  })

  it('edge 6: reader bị chuyển về dashboard của mình', async () => {
    await setup({ role: 'reader' })
    expect(await screen.findByText('Reader dashboard')).toBeInTheDocument()
    expect(listCategories).not.toHaveBeenCalled()
  })

  it('thêm: tên rỗng báo lỗi, không gọi API', async () => {
    const user = await setup()
    await user.click(await screen.findByRole('button', { name: 'Thêm thể loại sách' }))
    const form = screen.getByRole('form', { name: 'Thêm thể loại sách' })
    await user.type(within(form).getByLabelText('Tên thể loại mới'), '   ')
    await user.click(within(form).getByRole('button', { name: 'Thêm' }))
    expect(within(form).getByText('Tên thể loại không được để trống')).toBeInTheDocument()
    expect(createCategory).not.toHaveBeenCalled()
  })

  it('thêm: quá 50 ký tự báo lỗi', async () => {
    const user = await setup()
    await user.click(await screen.findByRole('button', { name: 'Thêm thể loại sách' }))
    await user.type(screen.getByLabelText('Tên thể loại mới'), 'a'.repeat(51))
    await user.click(screen.getByRole('button', { name: 'Thêm' }))
    expect(screen.getByText('Tên thể loại tối đa 50 ký tự')).toBeInTheDocument()
  })

  it('thêm: trùng tên (409) hiển thị lỗi từ server, giữ form', async () => {
    createCategory.mockRejectedValue(apiError(409, 'Thể loại đã tồn tại', { name: 'Thể loại đã tồn tại' }))
    const user = await setup()
    await user.click(await screen.findByRole('button', { name: 'Thêm thể loại sách' }))
    await user.type(screen.getByLabelText('Tên thể loại mới'), ' văn HỌC ')
    await user.click(screen.getByRole('button', { name: 'Thêm' }))
    expect(createCategory).toHaveBeenCalledWith('văn HỌC')
    expect(await screen.findByText('Thể loại đã tồn tại')).toBeInTheDocument()
    expect(screen.getByRole('form', { name: 'Thêm thể loại sách' })).toBeInTheDocument()
  })

  it('thêm thành công → đóng form, tải lại bảng', async () => {
    createCategory.mockResolvedValue({ category: { id: 3, name: 'Lịch sử', bookCount: 0 } })
    const user = await setup()
    await user.click(await screen.findByRole('button', { name: 'Thêm thể loại sách' }))
    listCategories.mockResolvedValue([...CATEGORIES, { id: 3, name: 'Lịch sử', bookCount: 0 }])
    await user.type(screen.getByLabelText('Tên thể loại mới'), 'Lịch sử')
    await user.click(screen.getByRole('button', { name: 'Thêm' }))

    expect(await screen.findByRole('status')).toHaveTextContent('Đã thêm thể loại "Lịch sử"')
    expect(await screen.findByLabelText('Tên thể loại Lịch sử')).toBeInTheDocument()
    expect(screen.queryByRole('form', { name: 'Thêm thể loại sách' })).not.toBeInTheDocument()
  })

  it('sửa trực tiếp: Lưu chỉ hiện khi đổi tên; lưu thành công', async () => {
    updateCategory.mockResolvedValue({ category: { id: 2, name: 'Văn học Việt Nam', bookCount: 3 } })
    const user = await setup()
    const input = await screen.findByLabelText('Tên thể loại Văn học')
    const row = input.closest('tr')
    expect(within(row).queryByRole('button', { name: 'Lưu' })).not.toBeInTheDocument()

    await user.clear(input)
    await user.type(input, 'Văn học Việt Nam')
    await user.click(within(row).getByRole('button', { name: 'Lưu' }))

    expect(updateCategory).toHaveBeenCalledWith(2, 'Văn học Việt Nam')
    expect(await screen.findByRole('status')).toHaveTextContent('Cập nhật thể loại thành công')
    expect(screen.getByLabelText('Tên thể loại Văn học Việt Nam')).toHaveValue('Văn học Việt Nam')
  })

  it('sửa trực tiếp: tên trùng → lỗi, giữ ô để sửa; Hủy trả lại tên cũ', async () => {
    updateCategory.mockRejectedValue(apiError(409, 'Thể loại đã tồn tại', { name: 'Thể loại đã tồn tại' }))
    const user = await setup()
    const input = await screen.findByLabelText('Tên thể loại Văn học')
    const row = input.closest('tr')
    await user.clear(input)
    await user.type(input, 'khoa học')
    await user.click(within(row).getByRole('button', { name: 'Lưu' }))

    expect(await within(row).findByText('Thể loại đã tồn tại')).toBeInTheDocument()
    expect(input).toHaveValue('khoa học')

    await user.click(within(row).getByRole('button', { name: 'Hủy' }))
    expect(input).toHaveValue('Văn học')
    expect(within(row).queryByText('Thể loại đã tồn tại')).not.toBeInTheDocument()
  })

  it('sửa trực tiếp: tên rỗng → lỗi, không gọi API', async () => {
    const user = await setup()
    const input = await screen.findByLabelText('Tên thể loại Khoa học')
    await user.clear(input)
    await user.click(within(input.closest('tr')).getByRole('button', { name: 'Lưu' }))
    expect(screen.getByText('Tên thể loại không được để trống')).toBeInTheDocument()
    expect(updateCategory).not.toHaveBeenCalled()
  })

  it('xóa thể loại đang có sách → chặn, báo số sách, không hỏi xác nhận', async () => {
    const confirm = vi.spyOn(window, 'confirm')
    const user = await setup()
    await user.click(await screen.findByRole('button', { name: 'Xóa Văn học' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Không thể xóa: còn 3 sách thuộc thể loại này')
    expect(confirm).not.toHaveBeenCalled()
    expect(deleteCategory).not.toHaveBeenCalled()
  })

  it('xóa: Hủy ở hộp thoại xác nhận → không xóa', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    const user = await setup()
    await user.click(await screen.findByRole('button', { name: 'Xóa Khoa học' }))
    expect(deleteCategory).not.toHaveBeenCalled()
  })

  it('xóa: đồng ý → gọi API, tải lại bảng', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    deleteCategory.mockResolvedValue({ message: 'Đã xóa thể loại' })
    const user = await setup()
    const button = await screen.findByRole('button', { name: 'Xóa Khoa học' })
    listCategories.mockResolvedValue([CATEGORIES[1]])
    await user.click(button)

    expect(deleteCategory).toHaveBeenCalledWith(1)
    expect(await screen.findByRole('status')).toHaveTextContent('Đã xóa thể loại "Khoa học"')
    await waitFor(() => expect(screen.queryByLabelText('Tên thể loại Khoa học')).not.toBeInTheDocument())
  })

  it.each([
    [404, 'Không tìm thấy thể loại'],
    [409, 'Không thể xóa: còn 1 sách thuộc thể loại này'],
  ])('edge 2/3: xóa nhận %i → báo lỗi và tải lại bảng', async (status, message) => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    deleteCategory.mockRejectedValue(apiError(status, message))
    const user = await setup()
    await user.click(await screen.findByRole('button', { name: 'Xóa Khoa học' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(message)
    expect(listCategories).toHaveBeenCalledTimes(2)
  })
})
