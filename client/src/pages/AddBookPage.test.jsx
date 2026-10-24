import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import AddBookPage from './AddBookPage'
import { AuthProvider } from '../features/auth/AuthContext'
import RequireAuth from '../features/auth/RequireAuth'
import { getMe } from '../features/auth/authApi'
import { createBook } from '../features/book/bookApi'
import { listCategories } from '../features/category/categoryApi'

vi.mock('../features/auth/authApi', () => ({ login: vi.fn(), getMe: vi.fn() }))
vi.mock('../features/book/bookApi', () => ({ createBook: vi.fn() }))
vi.mock('../features/category/categoryApi', () => ({ listCategories: vi.fn() }))

const CATEGORIES = [{ id: 1, name: 'Văn học', bookCount: 0 }, { id: 2, name: 'Khoa học', bookCount: 1 }]
const apiError = (status, data) => Object.assign(new Error('api'), { response: { status, data } })
const png = (size = 10) => new File([new Uint8Array(size)], 'c.png', { type: 'image/png' })

async function setup({ categories = CATEGORIES, role = 'librarian' } = {}) {
  localStorage.setItem('token', 'saved')
  getMe.mockResolvedValue({ id: 2, email: 'l@example.com', name: 'Thủ thư', role, status: 'active' })
  listCategories.mockResolvedValue(categories)
  const user = userEvent.setup()
  render(
    <MemoryRouter initialEntries={[`/${role}/books/new`]}>
      <AuthProvider>
        <Routes>
          <Route path={`/${role}/books/new`} element={<RequireAuth roles={[role]}><AddBookPage /></RequireAuth>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  )
  return user
}

async function fillValid(user) {
  const form = within(await screen.findByRole('form', { name: 'Thêm sách mới' }))
  await user.type(form.getByLabelText('Tên sách'), 'Dế Mèn')
  await user.type(form.getByLabelText('Tác giả'), 'Tô Hoài')
  await user.type(form.getByLabelText('Năm xuất bản'), '1941')
  await user.type(form.getByLabelText('ISBN (không bắt buộc)'), '978-0-306-40615-7')
  await user.selectOptions(form.getByLabelText('Thể loại'), '1')
  await user.type(form.getByLabelText('Số lượng bản sách'), '3')
  await user.type(form.getByLabelText('Mô tả'), 'Truyện thiếu nhi')
  return form
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  URL.createObjectURL = vi.fn(() => 'blob:preview')
  URL.revokeObjectURL = vi.fn()
})

describe('AddBookPage (2.2.2)', () => {
  it('chưa có thể loại → thông báo kèm liên kết tới trang thể loại, không có form', async () => {
    await setup({ categories: [] })
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Chưa có thể loại sách nào')
    expect(within(alert).getByRole('link', { name: 'tạo thể loại' })).toHaveAttribute('href', '/librarian/categories')
    expect(screen.queryByRole('form')).not.toBeInTheDocument()
  })

  it('admin: liên kết tạo thể loại trỏ tới trang admin', async () => {
    await setup({ categories: [], role: 'admin' })
    expect(await screen.findByRole('link', { name: 'tạo thể loại' })).toHaveAttribute('href', '/admin/categories')
  })

  it('happy case: gửi dữ liệu + ảnh bìa, báo "Thêm sách thành công", form được làm trống', async () => {
    createBook.mockResolvedValue({ message: 'Thêm sách thành công', book: { id: 7 } })
    const user = await setup()
    const form = await fillValid(user)
    const file = png()
    await user.upload(form.getByLabelText('Chọn ảnh bìa'), file)
    expect(form.getByAltText('Xem trước ảnh bìa')).toBeInTheDocument()

    await user.click(form.getByRole('button', { name: 'Thêm sách' }))

    expect(createBook).toHaveBeenCalledWith({
      title: 'Dế Mèn', author: 'Tô Hoài', publishYear: '1941', isbn: '978-0-306-40615-7',
      categoryId: '1', description: 'Truyện thiếu nhi', quantity: '3',
    }, file)
    expect(await screen.findByRole('status')).toHaveTextContent('Thêm sách thành công')
    expect(form.getByLabelText('Tên sách')).toHaveValue('')
    expect(form.queryByAltText('Xem trước ảnh bìa')).not.toBeInTheDocument()
  })

  it('edge 5: hiển thị cảnh báo trùng tên + tác giả', async () => {
    createBook.mockResolvedValue({ message: 'Thêm sách thành công', warning: 'Lưu ý: đã có sách cùng tên và tác giả' })
    const user = await setup()
    const form = await fillValid(user)
    await user.click(form.getByRole('button', { name: 'Thêm sách' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Lưu ý: đã có sách cùng tên và tác giả')
  })

  it('validate ở client: báo lỗi theo field, không gọi API', async () => {
    const user = await setup()
    const form = within(await screen.findByRole('form', { name: 'Thêm sách mới' }))
    await user.type(form.getByLabelText('Năm xuất bản'), '1800')
    await user.type(form.getByLabelText('ISBN (không bắt buộc)'), '123')
    await user.type(form.getByLabelText('Số lượng bản sách'), '0')
    await user.click(form.getByRole('button', { name: 'Thêm sách' }))

    expect(await form.findByText('Tên sách không được để trống')).toBeInTheDocument()
    expect(form.getByText('Tác giả không được để trống')).toBeInTheDocument()
    expect(form.getByText('Năm xuất bản phải từ 1900 đến năm hiện tại')).toBeInTheDocument()
    expect(form.getByText('ISBN phải là ISBN-10 hoặc ISBN-13 hợp lệ')).toBeInTheDocument()
    expect(form.getByText('Vui lòng chọn thể loại')).toBeInTheDocument()
    expect(form.getByText('Số lượng phải lớn hơn 0')).toBeInTheDocument()
    expect(form.getByText('Mô tả không được để trống')).toBeInTheDocument()
    expect(createBook).not.toHaveBeenCalled()
  })

  it('edge 8: ảnh sai định dạng báo lỗi tại field ảnh, không xem trước', async () => {
    const user = userEvent.setup({ applyAccept: false })
    await setup()
    const form = within(await screen.findByRole('form', { name: 'Thêm sách mới' }))
    await user.upload(form.getByLabelText('Chọn ảnh bìa'), new File(['x'], 'a.gif', { type: 'image/gif' }))
    expect(form.getByText('Chỉ nhận ảnh JPG, PNG, WebP tối đa 2 MB')).toBeInTheDocument()
    expect(form.queryByAltText('Xem trước ảnh bìa')).not.toBeInTheDocument()
  })

  it('ISBN trùng (409): lỗi tại field ISBN, dữ liệu giữ nguyên', async () => {
    createBook.mockRejectedValue(apiError(409, { message: 'ISBN đã tồn tại', errors: { isbn: 'ISBN đã tồn tại. Nếu là cùng đầu sách, hãy cập nhật số lượng ở sách đã có' } }))
    const user = await setup()
    const form = await fillValid(user)
    await user.click(form.getByRole('button', { name: 'Thêm sách' }))
    expect(await form.findByText(/ISBN đã tồn tại/)).toBeInTheDocument()
    expect(form.getByLabelText('Tên sách')).toHaveValue('Dế Mèn')
  })

  it('edge 7: thể loại đã bị xóa → lỗi tại field thể loại và tải lại danh sách', async () => {
    createBook.mockRejectedValue(apiError(400, { message: 'x', errors: { categoryId: 'Thể loại không tồn tại hoặc đã bị xóa, vui lòng chọn lại' } }))
    const user = await setup()
    const form = await fillValid(user)
    listCategories.mockResolvedValue([CATEGORIES[1]])
    await user.click(form.getByRole('button', { name: 'Thêm sách' }))
    expect(await form.findByText('Thể loại không tồn tại hoặc đã bị xóa, vui lòng chọn lại')).toBeInTheDocument()
    expect(listCategories).toHaveBeenCalledTimes(2)
    expect(await form.findByRole('option', { name: 'Khoa học' })).toBeInTheDocument()
    expect(form.queryByRole('option', { name: 'Văn học' })).not.toBeInTheDocument()
  })

  it('lỗi ảnh từ server hiển thị tại field ảnh', async () => {
    createBook.mockRejectedValue(apiError(413, { message: 'x', errors: { cover: 'Chỉ nhận ảnh JPG, PNG, WebP tối đa 2 MB' } }))
    const user = await setup()
    const form = await fillValid(user)
    await user.upload(form.getByLabelText('Chọn ảnh bìa'), png())
    await user.click(form.getByRole('button', { name: 'Thêm sách' }))
    expect(await form.findByText('Chỉ nhận ảnh JPG, PNG, WebP tối đa 2 MB')).toBeInTheDocument()
    expect(form.getByLabelText('Tác giả')).toHaveValue('Tô Hoài')
  })

  it('edge 6: nút bị khóa khi đang gửi', async () => {
    let resolve
    createBook.mockImplementation(() => new Promise((r) => { resolve = r }))
    const user = await setup()
    const form = await fillValid(user)
    await user.click(form.getByRole('button', { name: 'Thêm sách' }))
    expect(form.getByRole('button', { name: 'Đang lưu...' })).toBeDisabled()
    resolve({ message: 'Thêm sách thành công' })
    expect(await screen.findByRole('status')).toBeInTheDocument()
  })
})
