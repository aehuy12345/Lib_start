import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import EditBookPage from './EditBookPage'
import { AuthProvider } from '../features/auth/AuthContext'
import RequireAuth from '../features/auth/RequireAuth'
import { getMe } from '../features/auth/authApi'
import { getBook, updateBook } from '../features/book/bookApi'
import { listCategories } from '../features/category/categoryApi'

vi.mock('../features/auth/authApi', () => ({ login: vi.fn(), getMe: vi.fn() }))
vi.mock('../features/book/bookApi', () => ({ getBook: vi.fn(), updateBook: vi.fn() }))
vi.mock('../features/category/categoryApi', () => ({ listCategories: vi.fn() }))

const CATEGORIES = [{ id: 1, name: 'Văn học', bookCount: 1 }, { id: 2, name: 'Khoa học', bookCount: 0 }]
const BOOK = {
  id: 7, title: 'Dế Mèn', author: 'Tô Hoài', isbn: '9780306406157', publishYear: 1941,
  description: 'Truyện thiếu nhi', category: { id: 1, name: 'Văn học' }, coverUrl: 'https://cdn/old.png',
  totalQuantity: 5, availableQuantity: 3, borrowedQuantity: 2, damagedQuantity: 0, version: 3,
}
const apiError = (status, data) => Object.assign(new Error('api'), { response: { status, data } })
const png = () => new File([new Uint8Array(10)], 'c.png', { type: 'image/png' })

function Spy() {
  const location = useLocation()
  return <span data-testid="location">{location.pathname}|{location.state?.notice?.text}</span>
}

function setup({ role = 'librarian', book = BOOK, bookError } = {}) {
  localStorage.setItem('token', 'saved')
  getMe.mockResolvedValue({ id: 2, email: 'l@example.com', name: 'Thủ thư', role, status: 'active' })
  if (bookError) getBook.mockRejectedValue(bookError)
  else getBook.mockResolvedValue(book)
  listCategories.mockResolvedValue(CATEGORIES)
  const user = userEvent.setup()
  render(
    <MemoryRouter initialEntries={[`/${role}/books/7/edit`]}>
      <AuthProvider>
        <Routes>
          <Route path={`/${role}/books/:id/edit`} element={<RequireAuth roles={[role]}><EditBookPage /></RequireAuth>} />
          <Route path="*" element={<Spy />} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  )
  return user
}

const findForm = async () => within(await screen.findByRole('form', { name: 'Sửa sách' }))

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  URL.createObjectURL = vi.fn(() => 'blob:preview')
  URL.revokeObjectURL = vi.fn()
})

describe('EditBookPage (2.2.5)', () => {
  it('form điền sẵn dữ liệu hiện tại kèm ảnh bìa hiện tại', async () => {
    setup()
    const form = await findForm()
    expect(form.getByLabelText('Tên sách')).toHaveValue('Dế Mèn')
    expect(form.getByLabelText('Tác giả')).toHaveValue('Tô Hoài')
    expect(form.getByLabelText('Năm xuất bản')).toHaveValue('1941')
    expect(form.getByLabelText('ISBN (không bắt buộc)')).toHaveValue('9780306406157')
    expect(form.getByLabelText('Thể loại')).toHaveValue('1')
    expect(form.getByLabelText('Số lượng bản sách')).toHaveValue('5')
    expect(form.getByLabelText('Mô tả')).toHaveValue('Truyện thiếu nhi')
    expect(form.getByAltText('Ảnh bìa hiện tại')).toHaveAttribute('src', 'https://cdn/old.png')
    expect(form.getByText(/2 bản đang mượn/)).toBeInTheDocument()
  })

  it('lưu: gửi kèm version, về trang chi tiết với thông báo thành công', async () => {
    updateBook.mockResolvedValue({ message: 'Cập nhật sách thành công', book: BOOK })
    const user = setup()
    const form = await findForm()
    await user.clear(form.getByLabelText('Tên sách'))
    await user.type(form.getByLabelText('Tên sách'), 'Dế Mèn mới')
    await user.click(form.getByRole('button', { name: 'Lưu thay đổi' }))

    expect(updateBook).toHaveBeenCalledWith('7', expect.objectContaining({ title: 'Dế Mèn mới', quantity: '5' }), {
      version: 3, cover: null, removeCover: false,
    })
    expect(await screen.findByTestId('location')).toHaveTextContent('/books/7|Cập nhật sách thành công')
  })

  it('thay ảnh bìa: xem trước ảnh mới, gửi file', async () => {
    updateBook.mockResolvedValue({ message: 'Cập nhật sách thành công' })
    const user = setup()
    const form = await findForm()
    const file = png()
    await user.upload(form.getByLabelText('Chọn ảnh bìa'), file)
    expect(form.getByAltText('Xem trước ảnh bìa')).toBeInTheDocument()
    await user.click(form.getByRole('button', { name: 'Lưu thay đổi' }))
    expect(updateBook.mock.calls[0][2]).toEqual({ version: 3, cover: file, removeCover: false })
  })

  it('xóa ảnh bìa: hiện placeholder, có thể giữ lại; lưu gửi removeCover', async () => {
    updateBook.mockResolvedValue({ message: 'Cập nhật sách thành công' })
    const user = setup()
    const form = await findForm()
    await user.click(form.getByRole('button', { name: 'Xóa ảnh bìa' }))
    expect(form.queryByAltText('Ảnh bìa hiện tại')).not.toBeInTheDocument()
    expect(form.getByText('Ảnh bìa sẽ bị xóa khi lưu')).toBeInTheDocument()
    await user.click(form.getByRole('button', { name: 'Giữ ảnh cũ' }))
    expect(form.getByAltText('Ảnh bìa hiện tại')).toBeInTheDocument()
    await user.click(form.getByRole('button', { name: 'Xóa ảnh bìa' }))
    await user.click(form.getByRole('button', { name: 'Lưu thay đổi' }))
    expect(updateBook.mock.calls[0][2]).toMatchObject({ removeCover: true, cover: null })
  })

  it('sách chưa có ảnh: không có nút Xóa ảnh bìa', async () => {
    setup({ book: { ...BOOK, coverUrl: null } })
    const form = await findForm()
    expect(form.getByText('Chưa có ảnh')).toBeInTheDocument()
    expect(form.queryByRole('button', { name: 'Xóa ảnh bìa' })).not.toBeInTheDocument()
  })

  it('tổng mới nhỏ hơn số đang mượn → lỗi ở client, không gọi API; bằng đúng thì được (edge 2)', async () => {
    updateBook.mockResolvedValue({ message: 'Cập nhật sách thành công' })
    const user = setup()
    const form = await findForm()
    const qty = form.getByLabelText('Số lượng bản sách')
    await user.clear(qty)
    await user.type(qty, '1')
    await user.click(form.getByRole('button', { name: 'Lưu thay đổi' }))
    expect(await form.findByText('Tổng số lượng không được nhỏ hơn số bản đang mượn (2)')).toBeInTheDocument()
    expect(updateBook).not.toHaveBeenCalled()

    await user.clear(qty)
    await user.type(qty, '2')
    await user.click(form.getByRole('button', { name: 'Lưu thay đổi' }))
    expect(updateBook).toHaveBeenCalled()
  })

  it('validate như 2.2.2', async () => {
    const user = setup()
    const form = await findForm()
    await user.clear(form.getByLabelText('Tên sách'))
    await user.clear(form.getByLabelText('ISBN (không bắt buộc)'))
    await user.type(form.getByLabelText('ISBN (không bắt buộc)'), '123')
    await user.click(form.getByRole('button', { name: 'Lưu thay đổi' }))
    expect(await form.findByText('Tên sách không được để trống')).toBeInTheDocument()
    expect(form.getByText('ISBN phải là ISBN-10 hoặc ISBN-13 hợp lệ')).toBeInTheDocument()
    expect(updateBook).not.toHaveBeenCalled()
  })

  it('ISBN trùng sách khác (409) → lỗi tại field ISBN', async () => {
    updateBook.mockRejectedValue(apiError(409, { message: 'ISBN đã tồn tại', errors: { isbn: 'ISBN đã tồn tại' } }))
    const user = setup()
    const form = await findForm()
    await user.click(form.getByRole('button', { name: 'Lưu thay đổi' }))
    expect(await form.findByText('ISBN đã tồn tại')).toBeInTheDocument()
  })

  it('server báo số lượng nhỏ hơn số đang mượn (vừa có người mượn) → lỗi tại field số lượng', async () => {
    const msg = 'Tổng số lượng không được nhỏ hơn số bản đang mượn (5)'
    updateBook.mockRejectedValue(apiError(400, { message: msg, errors: { quantity: msg } }))
    const user = setup()
    const form = await findForm()
    await user.click(form.getByRole('button', { name: 'Lưu thay đổi' }))
    expect(await form.findByText(msg)).toBeInTheDocument()
  })

  it('edge 5: xung đột phiên bản → khóa form, tải lại lấy dữ liệu mới', async () => {
    const msg = 'Sách đã được người khác cập nhật. Vui lòng tải lại trang để xem dữ liệu mới'
    updateBook.mockRejectedValue(apiError(409, { message: msg, errors: { version: msg } }))
    const user = setup()
    const form = await findForm()
    await user.click(form.getByRole('button', { name: 'Lưu thay đổi' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(msg)
    expect(form.getByRole('button', { name: 'Lưu thay đổi' })).toBeDisabled()

    getBook.mockResolvedValue({ ...BOOK, title: 'Tên mới của người khác', version: 4 })
    await user.click(screen.getByRole('button', { name: 'Tải lại dữ liệu mới' }))
    const fresh = await findForm()
    expect(await fresh.findByDisplayValue('Tên mới của người khác')).toBeInTheDocument()
    expect(fresh.getByRole('button', { name: 'Lưu thay đổi' })).toBeEnabled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('sách bị xóa trong lúc sửa (404 khi lưu) → báo sách không còn tồn tại', async () => {
    updateBook.mockRejectedValue(apiError(404, { message: 'Không tìm thấy sách' }))
    const user = setup()
    const form = await findForm()
    await user.click(form.getByRole('button', { name: 'Lưu thay đổi' }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Sách không còn tồn tại')
    expect(within(alert).getByRole('link', { name: 'Về danh sách sách' })).toHaveAttribute('href', '/books')
  })

  it('edge 4: thể loại vừa bị xóa → lỗi tại field thể loại và tải lại danh sách', async () => {
    const msg = 'Thể loại không tồn tại hoặc đã bị xóa, vui lòng chọn lại'
    updateBook.mockRejectedValue(apiError(400, { message: msg, errors: { categoryId: msg } }))
    const user = setup()
    const form = await findForm()
    await user.selectOptions(form.getByLabelText('Thể loại'), '2')
    await user.click(form.getByRole('button', { name: 'Lưu thay đổi' }))
    expect(await form.findByText(msg)).toBeInTheDocument()
    expect(listCategories).toHaveBeenCalledTimes(2)
  })

  it('mở sách không tồn tại → thông báo không tìm thấy, không có form', async () => {
    setup({ bookError: apiError(404, { message: 'Không tìm thấy sách' }) })
    expect(await screen.findByRole('alert')).toHaveTextContent('Không tìm thấy sách')
    expect(screen.queryByRole('form', { name: 'Sửa sách' })).not.toBeInTheDocument()
  })
})
