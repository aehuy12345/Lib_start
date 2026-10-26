import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import ReportsPage from './ReportsPage'
import { AuthProvider } from '../features/auth/AuthContext'
import RequireAuth from '../features/auth/RequireAuth'
import { getMe } from '../features/auth/authApi'
import { downloadReportCsv, getReport } from '../features/report/reportApi'

vi.mock('../features/auth/authApi', () => ({ login: vi.fn(), getMe: vi.fn() }))
vi.mock('../features/report/reportApi', () => ({ getReport: vi.fn(), downloadReportCsv: vi.fn() }))
// Recharts cần ResizeObserver và layout thật; unit test chỉ kiểm tra dữ liệu đưa vào biểu đồ.
vi.mock('../features/report/ReportChart', () => ({
  default: ({ label, data }) => <figure aria-label={label}>{data.length} điểm</figure>,
}))

const RANGE = 'from=2020-01-01&to=2020-03-31'
const BOOKS = {
  type: 'books', from: '2020-01-01', to: '2020-03-31', hasData: true,
  summary: { titleCount: 3, totalQuantity: 10, available: 9, borrowed: 0, damaged: 1, borrowsInRange: 7, lostInRange: 1, damagedInRange: 1 },
  chart: [{ id: 1, title: 'Sách A', borrows: 3 }],
  rows: [{
    id: 1, title: 'Sách A', author: 'Tác Giả', isbn: '9780262033848', category: 'Văn học', totalQuantity: 5,
    available: 5, borrowed: 0, damaged: 0, borrowsInRange: 3, lostInRange: 0, damagedInRange: 0,
  }],
  pagination: { page: 1, pageSize: 10, total: 1, totalPages: 1 },
}
const BORROWS = {
  type: 'borrows', from: '2020-01-01', to: '2020-03-31', groupBy: 'month', hasData: true,
  summary: { borrowed: 7, returned: 7 },
  rows: [{ period: '2020-01-01', borrowed: 3, returned: 2 }, { period: '2020-02-01', borrowed: 4, returned: 5 }],
}

let location
function LocationSpy() {
  location = useLocation()
  return null
}

function setup(query = `period=custom&${RANGE}`, role = 'librarian') {
  localStorage.setItem('token', 'saved')
  getMe.mockResolvedValue({ id: 2, email: 'l@example.com', name: 'Thủ Thư', role, status: 'active' })
  render(
    <MemoryRouter initialEntries={[`/${role}/reports?${query}`]}>
      <AuthProvider>
        <Routes>
          <Route path="/:role/reports" element={<RequireAuth roles={[role]}><ReportsPage /><LocationSpy /></RequireAuth>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  )
  return userEvent.setup()
}

afterEach(() => {
  localStorage.clear()
  vi.resetAllMocks()
})

describe('ReportsPage (2.7.2)', () => {
  it('báo cáo Sách: số liệu, biểu đồ, bảng; Xuất CSV dùng đúng bộ lọc đang xem (edge 6)', async () => {
    getReport.mockResolvedValue(BOOKS)
    const user = setup()
    const table = await screen.findByRole('table', { name: 'Báo cáo sách' })
    expect(getReport).toHaveBeenCalledWith('books', { from: '2020-01-01', to: '2020-03-31' })
    expect(screen.getByText('Lượt mượn trong kỳ', { selector: 'dt' }).nextSibling).toHaveTextContent('7')
    expect(screen.getByRole('figure', { name: 'Sách được mượn nhiều nhất trong kỳ' })).toHaveTextContent('1 điểm')
    expect(within(table).getByRole('link', { name: 'Sách A' })).toHaveAttribute('href', '/books/1')
    expect(screen.getByText('Từ 01/01/2020 đến 31/03/2020')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Xuất CSV' }))
    expect(downloadReportCsv).toHaveBeenCalledWith(
      'books', { from: '2020-01-01', to: '2020-03-31' }, 'bao-cao-sach_2020-01-01_2020-03-31.csv',
    )
  })

  it('không có dữ liệu → thông báo và vô hiệu hóa Xuất CSV', async () => {
    getReport.mockResolvedValue({
      type: 'damaged-lost', from: '2020-01-01', to: '2020-03-31', hasData: false,
      summary: { lost: 0, damaged: 0, copies: 0 }, rows: [], pagination: { page: 1, pageSize: 10, total: 0, totalPages: 1 },
    })
    setup(`type=damaged-lost&period=custom&${RANGE}`)
    expect(await screen.findByText('Không có dữ liệu trong khoảng này.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Xuất CSV' })).toBeDisabled()
  })

  it('edge 1: từ ngày lớn hơn đến ngày → báo lỗi, không gửi request', async () => {
    getReport.mockResolvedValue(BOOKS)
    const user = setup()
    await screen.findByRole('table', { name: 'Báo cáo sách' })
    await user.clear(screen.getByLabelText('Từ ngày'))
    await user.type(screen.getByLabelText('Từ ngày'), '2020-05-01')
    await user.click(screen.getByRole('button', { name: 'Áp dụng' }))
    expect(screen.getByRole('alert')).toHaveTextContent('từ ngày phải nhỏ hơn hoặc bằng đến ngày')
    expect(getReport).toHaveBeenCalledTimes(1)
    expect(location.search).toContain('from=2020-01-01')
  })

  it('URL có khoảng sai → báo lỗi, không tải và không xuất được', async () => {
    setup('period=custom&from=2020-03-01&to=2020-01-01')
    expect(await screen.findByRole('alert')).toHaveTextContent('từ ngày phải nhỏ hơn hoặc bằng đến ngày')
    expect(getReport).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Xuất CSV' })).toBeDisabled()
  })

  it('chọn kỳ Quý tính lại khoảng từ mốc hiện tại', async () => {
    getReport.mockResolvedValue(BOOKS)
    const user = setup('period=custom&from=2020-02-15&to=2020-02-20')
    await screen.findByRole('table', { name: 'Báo cáo sách' })
    await user.selectOptions(screen.getByLabelText('Khoảng thời gian'), 'quarter')
    expect(location.search).toBe('?type=books&period=quarter&from=2020-01-01&to=2020-03-31')
    expect(getReport).toHaveBeenLastCalledWith('books', { from: '2020-01-01', to: '2020-03-31' })
  })

  it('báo cáo Mượn trả: đổi loại báo cáo, gom theo quý', async () => {
    getReport.mockResolvedValueOnce(BOOKS).mockResolvedValue(BORROWS)
    const user = setup()
    await screen.findByRole('table', { name: 'Báo cáo sách' })
    await user.click(screen.getByRole('button', { name: 'Mượn trả' }))
    const table = await screen.findByRole('table', { name: 'Báo cáo mượn trả' })
    expect(within(table).getByText('01/2020')).toBeInTheDocument()
    expect(within(table).getByText('02/2020').parentElement).toHaveTextContent('02/202045')
    expect(screen.getByLabelText('Gom nhóm')).toHaveValue('month')

    await user.selectOptions(screen.getByLabelText('Gom nhóm'), 'quarter')
    expect(getReport).toHaveBeenLastCalledWith('borrows', { from: '2020-01-01', to: '2020-03-31', groupBy: 'quarter' })
  })

  it('báo cáo Phạt: doanh thu, độc giả nợ', async () => {
    getReport.mockResolvedValue({
      type: 'fines', from: '2020-01-01', to: '2020-03-31', date: '2026-10-26', hasData: true,
      summary: { issuedCount: 3, issuedAmount: 90060000, collectedCount: 2, collectedAmount: 60000, outstandingCount: 1, outstandingAmount: 90000000 },
      byType: [
        { type: 'late', collectedAmount: 10000, outstandingAmount: 0 },
        { type: 'damaged', collectedAmount: 50000, outstandingAmount: 0 },
        { type: 'lost', collectedAmount: 0, outstandingAmount: 90000000 },
      ],
      debtors: [{ id: 7, name: 'An', email: 'an@example.com', unpaidCount: 1, unpaidAmount: 90000000, overdueCount: 2, maxLateDays: 45 }],
      pagination: { page: 1, pageSize: 10, total: 1, totalPages: 1 },
    })
    setup(`type=fines&period=custom&${RANGE}`, 'admin')
    const row = await screen.findByRole('row', { name: 'Độc giả nợ an@example.com' })
    expect(row).toHaveTextContent('90.000.000 đ')
    expect(row).toHaveTextContent('45 ngày')
    expect(screen.getByText('Doanh thu phạt đã thu (2 phiếu)').nextSibling).toHaveTextContent('60.000 đ')
    expect(screen.getByText(/Độc giả nợ tại ngày 26\/10\/2026/)).toBeInTheDocument()
  })

  it('lỗi validate từ server hiển thị đúng lỗi của trường', async () => {
    getReport.mockRejectedValueOnce({ response: { status: 400, data: { message: 'Khoảng thời gian không hợp lệ', errors: { to: 'Khoảng thời gian tối đa 366 ngày' } } } })
    setup()
    expect(await screen.findByRole('alert')).toHaveTextContent('Khoảng thời gian tối đa 366 ngày')
  })
})
