import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import BooksPage from './BooksPage'
import { AuthProvider } from '../features/auth/AuthContext'
import { getMe } from '../features/auth/authApi'
import { listBooks } from '../features/book/bookApi'
import { listCategoryOptions } from '../features/category/categoryApi'

vi.mock('../features/auth/authApi', () => ({ login: vi.fn(), getMe: vi.fn() }))
vi.mock('../features/book/bookApi', () => ({ listBooks: vi.fn() }))
vi.mock('../features/category/categoryApi', () => ({ listCategoryOptions: vi.fn() }))

const CATEGORIES = [{ id: 1, name: 'Văn học' }, { id: 2, name: 'Khoa học' }]
const book = (id, extra = {}) => ({
  id, title: `Sách ${id}`, author: 'Tô Hoài', publishYear: 2000 + id, category: { id: 1, name: 'Văn học' },
  coverUrl: null, availableQuantity: 2, borrowedQuantity: 1, ...extra,
})
const page = (books, { page: p = 1, total = books.length, totalPages = 1 } = {}) => ({
  books, pagination: { page: p, pageSize: 10, total, totalPages },
})
const apiError = (status, data) => Object.assign(new Error('api'), { response: { status, data } })

// Hiện query string hiện tại để test đọc URL.
function Spy() {
  return <span data-testid="location">{useLocation().search}</span>
}
const search = () => screen.getByTestId('location').textContent

function setup(url = '/books') {
  const user = userEvent.setup()
  render(
    <MemoryRouter initialEntries={[url]}>
      <AuthProvider>
        <Routes>
          <Route path="/books" element={<><BooksPage /><Spy /></>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  )
  return user
}

const lastParams = () => listBooks.mock.calls.at(-1)[0]

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  listCategoryOptions.mockResolvedValue(CATEGORIES)
  listBooks.mockResolvedValue(page([book(1)]))
})

describe('BooksPage (2.2.3)', () => {
  it('khách vào không cần đăng nhập: mặc định trang 1, Tên A-Z; hiển thị đủ thông tin PRD', async () => {
    setup()
    const card = await screen.findByRole('article', { name: 'Sách 1' })
    expect(listBooks).toHaveBeenCalledWith({})
    expect(card).toHaveTextContent('Tác giả: Tô Hoài')
    expect(card).toHaveTextContent('Năm XB: 2001')
    expect(card).toHaveTextContent('Thể loại: Văn học')
    expect(card).toHaveTextContent('Có sẵn: 2')
    expect(card).toHaveTextContent('Đang mượn: 1')
    expect(screen.getByRole('link', { name: 'Đăng nhập' })).toHaveAttribute('href', '/login')
    expect(screen.getByLabelText('Sắp xếp')).toHaveValue('name')
  })

  it('người đã đăng nhập thấy liên kết về dashboard', async () => {
    localStorage.setItem('token', 'saved')
    getMe.mockResolvedValue({ id: 1, name: 'Độc giả', role: 'reader', status: 'active' })
    setup()
    expect(await screen.findByRole('link', { name: 'Về dashboard' })).toHaveAttribute('href', '/reader')
  })

  it('đọc bộ lọc từ URL (chia sẻ link)', async () => {
    setup('/books?q=d%E1%BA%BF&categoryId=2&sort=popular&page=3')
    await screen.findByRole('article', { name: 'Sách 1' })
    expect(listBooks).toHaveBeenCalledWith({ q: 'dế', categoryId: '2', sort: 'popular', page: '3' })
    expect(screen.getByRole('searchbox')).toHaveValue('dế')
    await waitFor(() => expect(screen.getByLabelText('Thể loại')).toHaveValue('2'))
  })

  it('tìm kiếm, lọc thể loại, sắp xếp đều về trang 1 và ghi lên URL', async () => {
    listBooks.mockResolvedValueOnce(page([book(1)], { page: 2, total: 12, totalPages: 2 }))
    const user = setup('/books?page=2')
    await screen.findByRole('article', { name: 'Sách 1' })

    await user.type(screen.getByRole('searchbox'), 'mắt biếc{Enter}')
    await waitFor(() => expect(lastParams()).toEqual({ q: 'mắt biếc' }))
    expect(search()).toBe(`?q=${encodeURIComponent('mắt biếc').replace(/%20/g, '+')}`)

    await user.selectOptions(await screen.findByLabelText('Thể loại'), '1')
    await waitFor(() => expect(lastParams()).toEqual({ q: 'mắt biếc', categoryId: '1' }))

    await user.selectOptions(screen.getByLabelText('Sắp xếp'), 'newest')
    await waitFor(() => expect(lastParams()).toEqual({ q: 'mắt biếc', categoryId: '1', sort: 'newest' }))
  })

  it('edge 4: từ khóa chỉ gồm khoảng trắng coi như không có', async () => {
    const user = setup('/books?q=abc')
    await screen.findByRole('article', { name: 'Sách 1' })
    await user.clear(screen.getByRole('searchbox'))
    await user.type(screen.getByRole('searchbox'), '   {Enter}')
    await waitFor(() => expect(lastParams()).toEqual({}))
  })

  it('phân trang: 10 sách/trang, nút trước/sau, ẩn khi chỉ 1 trang', async () => {
    listBooks.mockResolvedValue(page(Array.from({ length: 10 }, (_, i) => book(i + 1)), { total: 12, totalPages: 2 }))
    const user = setup()
    const nav = await screen.findByRole('navigation', { name: 'Phân trang' })
    expect(within(nav).getByText('Trang 1 / 2')).toBeInTheDocument()
    expect(within(nav).getByRole('button', { name: 'Trang trước' })).toBeDisabled()
    expect(screen.getAllByRole('article')).toHaveLength(10)

    listBooks.mockResolvedValue(page([book(11), book(12)], { page: 2, total: 12, totalPages: 2 }))
    await user.click(within(nav).getByRole('button', { name: 'Trang sau' }))
    await screen.findByRole('article', { name: 'Sách 12' })
    expect(lastParams()).toEqual({ page: '2' })
    expect(screen.getByRole('button', { name: 'Trang sau' })).toBeDisabled()
  })

  it('không hiện phân trang khi chỉ có 1 trang', async () => {
    setup()
    await screen.findByRole('article', { name: 'Sách 1' })
    expect(screen.queryByRole('navigation', { name: 'Phân trang' })).not.toBeInTheDocument()
  })

  it('trang vượt tổng số trang → server trả trang cuối, URL được sửa theo', async () => {
    listBooks.mockResolvedValue(page([book(11)], { page: 2, total: 11, totalPages: 2 }))
    setup('/books?page=9')
    await screen.findByRole('article', { name: 'Sách 11' })
    await waitFor(() => expect(search()).toBe('?page=2'))
  })

  it('edge 1: thư viện chưa có sách', async () => {
    listBooks.mockResolvedValue(page([]))
    setup()
    expect(await screen.findByRole('status')).toHaveTextContent('Chưa có sách nào')
  })

  it('không có kết quả khi đang lọc → thông báo + nút xóa bộ lọc (giữ sắp xếp)', async () => {
    listBooks.mockResolvedValue(page([]))
    const user = setup('/books?q=zzz&categoryId=1&sort=newest')
    const empty = await screen.findByRole('status')
    expect(empty).toHaveTextContent('Không tìm thấy sách phù hợp')
    await user.click(within(empty).getByRole('button', { name: 'Xóa bộ lọc' }))
    await waitFor(() => expect(search()).toBe('?sort=newest'))
  })

  it('edge 5: sách hết vẫn hiển thị, có nhãn "Hết sách"', async () => {
    listBooks.mockResolvedValue(page([book(1, { availableQuantity: 0, borrowedQuantity: 3 }), book(2)]))
    setup()
    expect(within(await screen.findByRole('article', { name: 'Sách 1' })).getByText('Hết sách')).toBeInTheDocument()
    expect(within(screen.getByRole('article', { name: 'Sách 2' })).queryByText('Hết sách')).not.toBeInTheDocument()
  })

  it('edge 7, 8: ảnh bìa lazy; chưa có ảnh hoặc ảnh lỗi → ảnh mặc định', async () => {
    listBooks.mockResolvedValue(page([book(1, { coverUrl: 'https://cdn/a.jpg' }), book(2)]))
    setup()
    const card = await screen.findByRole('article', { name: 'Sách 1' })
    const img = within(card).getByRole('img', { name: 'Ảnh bìa Sách 1' })
    expect(img).toHaveAttribute('loading', 'lazy')
    expect(within(screen.getByRole('article', { name: 'Sách 2' })).getByRole('img', { name: 'Ảnh bìa mặc định' })).toBeInTheDocument()

    fireEvent.error(img)
    expect(within(card).getByRole('img', { name: 'Ảnh bìa mặc định' })).toBeInTheDocument()
  })

  it('thể loại trên URL không tồn tại → 400, báo lỗi kèm nút xóa bộ lọc', async () => {
    listBooks.mockRejectedValueOnce(apiError(400, {
      message: 'Thể loại không tồn tại hoặc đã bị xóa, vui lòng chọn lại',
      errors: { categoryId: 'Thể loại không tồn tại hoặc đã bị xóa, vui lòng chọn lại' },
    }))
    const user = setup('/books?categoryId=999')
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Thể loại không tồn tại')
    await user.click(within(alert).getByRole('button', { name: 'Xóa bộ lọc' }))
    await screen.findByRole('article', { name: 'Sách 1' })
    expect(lastParams()).toEqual({})
  })

  it('mất kết nối → báo lỗi, nút Thử lại gọi lại API', async () => {
    listBooks.mockRejectedValueOnce(new Error('network'))
    const user = setup()
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Không kết nối được máy chủ')
    await user.click(within(alert).getByRole('button', { name: 'Thử lại' }))
    await screen.findByRole('article', { name: 'Sách 1' })
    expect(listBooks).toHaveBeenCalledTimes(2)
  })

  it('không tải được thể loại thì danh sách sách vẫn hiển thị', async () => {
    listCategoryOptions.mockRejectedValue(new Error('x'))
    setup()
    await screen.findByRole('article', { name: 'Sách 1' })
    expect(within(screen.getByLabelText('Thể loại')).getAllByRole('option')).toHaveLength(1)
  })
})
