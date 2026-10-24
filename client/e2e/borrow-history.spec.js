import { test, expect } from '@playwright/test'

// 2.3.3 Xem Lịch Sử Mượn Sách và gia hạn. Cần server chạy và seed trước mỗi lần chạy
// (thể loại "Test Lịch Sử Mượn": test.history có đơn LS 01..09):
//   cd server && node scripts/seed-test-users.js
const PASSWORD = 'Test@1234'
const T = (n) => `Test Sách LS ${n}`

// Ngày nghiệp vụ theo giờ Việt Nam, dạng DD/MM/YYYY như trên UI.
function vnDate(days = 0) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date())
  const date = new Date(`${today}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  const [y, m, d] = date.toISOString().slice(0, 10).split('-')
  return `${d}/${m}/${y}`
}

async function login(page, email) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Mật khẩu').fill(PASSWORD)
  await page.getByRole('button', { name: 'Đăng nhập' }).click()
  await expect(page).not.toHaveURL(/\/login/)
}

const row = (page, title) => page.getByRole('row', { name: `Đơn ${title}` })
const filter = (page, label) => page.getByRole('navigation', { name: 'Lọc theo trạng thái' }).getByRole('button', { name: label })

test.describe.serial('2.3.3 Lịch sử mượn sách', () => {
  test('nhân viên không vào được trang lịch sử của độc giả', async ({ page }) => {
    await login(page, 'test.librarian@example.com')
    await page.goto('/reader/borrow-history')
    await expect(page).toHaveURL(/\/librarian$/)
  })

  test('độc giả mở từ dashboard, đơn hiển thị theo nhóm với cột theo PRD', async ({ page }) => {
    await login(page, 'test.history@example.com')
    await page.getByRole('link', { name: 'Lịch sử mượn sách' }).click()
    await expect(page).toHaveURL(/\/reader\/borrow-history$/)
    await expect(page.getByText('Tổng: 12 đơn')).toBeVisible()

    const borrowing = page.getByRole('region', { name: 'Đang mượn' })
    await expect(borrowing.getByRole('columnheader')).toHaveText(['Sách', 'Ngày mượn', 'Hạn trả', 'Số ngày còn lại', 'Trạng thái', 'Thao tác'])
    await expect(row(page, T('01 Gia Hạn'))).toContainText('Tác Giả LS')
    await expect(row(page, T('01 Gia Hạn'))).toContainText(vnDate(5))
    await expect(row(page, T('01 Gia Hạn'))).toContainText('5 ngày')
    await expect(row(page, T('03 Quá Hạn'))).toContainText('Quá 2 ngày')
    await expect(row(page, T('03 Quá Hạn'))).toContainText('Quá hạn')
    await expect(row(page, T('04 Hôm Nay'))).toContainText('Hết hạn hôm nay')
    await expect(row(page, T('05 Chờ Trả'))).toContainText('Đang chờ xác nhận trả')
    await expect(row(page, T('02 Đã Gia Hạn'))).toContainText('Đã gia hạn')
    // Chỉ LS 01 và LS 04 còn nút Gia hạn.
    await expect(borrowing.getByRole('button', { name: /^Gia hạn/ })).toHaveCount(2)

    await expect(page.getByRole('region', { name: 'Chờ xác nhận' })).toContainText(T('06 Chờ Duyệt'))
    await expect(page.getByRole('region', { name: 'Đã trả' }).getByRole('row', { name: `Đơn ${T('07 Đã Trả')}` })).toHaveCount(4)
  })

  test('phân trang: trang 2 có đơn bị từ chối kèm lý do, không có đơn đã hủy', async ({ page }) => {
    await login(page, 'test.history@example.com')
    await page.goto('/reader/borrow-history')
    await page.getByRole('button', { name: 'Trang sau' }).click()
    await expect(page).toHaveURL(/page=2/)
    await expect(page.getByText('Trang 2 / 2')).toBeVisible()
    await expect(row(page, T('08 Từ Chối'))).toContainText('Dữ liệu test: sách đang được bảo trì')
    await expect(page.getByText(T('09 Đã Hủy'))).toHaveCount(0)
  })

  test('lọc theo trạng thái', async ({ page }) => {
    await login(page, 'test.history@example.com')
    await page.goto('/reader/borrow-history')
    await filter(page, 'Quá hạn').click()
    await expect(page).toHaveURL(/status=overdue/)
    await expect(page.getByText('Tổng: 1 đơn')).toBeVisible()
    await expect(row(page, T('03 Quá Hạn'))).toBeVisible()

    await filter(page, 'Bị từ chối').click()
    await expect(row(page, T('08 Từ Chối'))).toContainText('Dữ liệu test: sách đang được bảo trì')

    await filter(page, 'Đã trả').click()
    await expect(page.getByText('Tổng: 5 đơn')).toBeVisible()

    await filter(page, 'Đang mượn').click()
    await expect(page.getByText('Tổng: 4 đơn')).toBeVisible()
    await expect(row(page, T('03 Quá Hạn'))).toHaveCount(0)
  })

  test('gia hạn: hạn trả +7 ngày, nút biến mất', async ({ page }) => {
    await login(page, 'test.history@example.com')
    await page.goto('/reader/borrow-history?status=borrowing')
    await page.getByRole('button', { name: `Gia hạn ${T('01 Gia Hạn')}` }).click()
    await expect(page.getByRole('status')).toHaveText(`Đã gia hạn "${T('01 Gia Hạn')}", hạn trả mới ${vnDate(12)}`)
    const ls01 = row(page, T('01 Gia Hạn'))
    await expect(ls01).toContainText(vnDate(12))
    await expect(ls01).toContainText('12 ngày')
    await expect(ls01).toContainText('Đã gia hạn')
    await expect(page.getByRole('button', { name: `Gia hạn ${T('01 Gia Hạn')}` })).toHaveCount(0)

    // Đúng ngày hạn vẫn gia hạn được.
    await page.getByRole('button', { name: `Gia hạn ${T('04 Hôm Nay')}` }).click()
    await expect(page.getByRole('status')).toContainText(`hạn trả mới ${vnDate(7)}`)
    await expect(row(page, T('04 Hôm Nay'))).toContainText('7 ngày')
  })

  test('hủy yêu cầu đang chờ xác nhận', async ({ page }) => {
    await login(page, 'test.history@example.com')
    await page.goto('/reader/borrow-history?status=pending')
    page.once('dialog', (dialog) => dialog.accept())
    await page.getByRole('button', { name: `Hủy yêu cầu mượn ${T('06 Chờ Duyệt')}` }).click()
    await expect(page.getByRole('status')).toHaveText(`Đã hủy yêu cầu mượn "${T('06 Chờ Duyệt')}"`)
    await expect(page.getByText('Không có đơn nào ở trạng thái này.')).toBeVisible()
  })

  test('độc giả chưa có đơn → trạng thái trống kèm liên kết tới danh sách sách', async ({ page }) => {
    await login(page, 'test.requester@example.com')
    await page.goto('/reader/borrow-history?status=borrowing')
    await expect(page.getByText('Không có đơn nào ở trạng thái này.')).toBeVisible()
    await page.getByRole('link', { name: 'Xem danh sách sách' }).click()
    await expect(page).toHaveURL(/\/books$/)
  })
})
