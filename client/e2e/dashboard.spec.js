import { test, expect } from '@playwright/test'

// 2.7.1 Báo cáo tổng quan (Librarian + Admin). Cần server chạy và seed trước (Test Sách DB 01 đứng đầu Top 5,
// DB 02 đã xóa đứng thứ 2, test.dashboard quá hạn 45 và 40 ngày đứng đầu danh sách nợ quá hạn):
//   cd server && node scripts/seed-test-users.js
// Số liệu là tổng toàn hệ thống nên chỉ kiểm tra các dòng seed chắc chắn đứng đầu.
const PASSWORD = 'Test@1234'

async function login(page, email) {
  await page.goto('/login')
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Mật khẩu').fill(PASSWORD)
  await page.getByRole('button', { name: 'Đăng nhập' }).click()
  await expect(page).not.toHaveURL(/\/login/)
}

const card = (page, name) => page.getByRole('region', { name })

test('nhân viên thư viện xem dashboard tổng quan', async ({ page }) => {
  await login(page, 'test.librarian@example.com')
  await expect(page).toHaveURL('/librarian')

  const books = card(page, 'Tổng số sách')
  await expect(books.getByText(/\d+ đầu sách · [\d.]+ cuốn/)).toBeVisible()
  for (const label of ['Có sẵn', 'Đang mượn', 'Bị mất', 'Hư hỏng']) await expect(books.getByText(label)).toBeVisible()

  const readers = card(page, 'Tổng số độc giả')
  await expect(readers.getByText('Hoạt động')).toBeVisible()
  await expect(readers.getByText('Vô hiệu hóa')).toBeVisible()

  // Edge 4: ngày theo giờ Việt Nam; seed có đơn chờ DB 04 tạo hôm nay.
  const vnToday = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10).split('-').reverse().join('/')
  const today = card(page, 'Đơn mượn hôm nay')
  await expect(today.getByText(`Ngày ${vnToday}`)).toBeVisible()
  await expect(today.getByText(/\d+ chờ xác nhận/)).toBeVisible()

  const top = card(page, 'Top 5 sách phổ biến')
  const items = top.getByRole('listitem')
  await expect(items.first()).toContainText('Test Sách DB 01 Phổ Biến')
  await expect(items.first()).toContainText('9.999 lượt')
  // Edge 7: sách đã xóa vẫn có trong thống kê nhưng không có liên kết.
  await expect(items.nth(1)).toContainText('Test Sách DB 02 Đã Xóa (đã xóa)')
  await expect(items.nth(1).getByRole('link')).toHaveCount(0)

  await top.getByRole('link', { name: 'Test Sách DB 01 Phổ Biến' }).click()
  await expect(page).toHaveURL(/\/books\/\d+$/)
  await expect(page.getByRole('heading', { name: 'Test Sách DB 01 Phổ Biến' })).toBeVisible()
})

test('admin thấy độc giả nợ quá hạn, tối đa 10 dòng', async ({ page }) => {
  await login(page, 'test.admin@example.com')
  await expect(page).toHaveURL('/admin')

  const overdue = card(page, 'Độc giả nợ quá hạn')
  const rows = overdue.getByRole('row', { name: /^Độc giả quá hạn / })
  await expect(rows.first()).toHaveAccessibleName('Độc giả quá hạn test.dashboard@example.com')
  await expect(rows.first()).toContainText('Test Dashboard Quá Hạn')
  await expect(rows.first()).toContainText(/Test Sách DB 01 Phổ Biến \(hạn \d{2}\/\d{2}\/\d{4}, muộn 45 ngày\)/)
  await expect(rows.first()).toContainText('muộn 40 ngày')
  // Edge 3.
  expect(await rows.count()).toBeLessThanOrEqual(10)
})

test('edge 6: độc giả không thấy dashboard báo cáo', async ({ page }) => {
  await login(page, 'test.reader@example.com')
  await expect(page).toHaveURL('/reader')
  await expect(page.getByText(/^Xin chào, /)).toBeVisible()
  await expect(card(page, 'Tổng số sách')).toHaveCount(0)
})

test('một thẻ lỗi hiển thị Thử lại, các thẻ khác vẫn hiển thị', async ({ page }) => {
  let fail = true
  await page.route('**/api/dashboard/top-books', (route) => (fail
    ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'Lỗi máy chủ' }) })
    : route.continue()))
  await login(page, 'test.librarian@example.com')

  const top = card(page, 'Top 5 sách phổ biến')
  await expect(top.getByRole('alert')).toContainText('Lỗi máy chủ')
  await expect(card(page, 'Tổng số sách').getByText('Có sẵn')).toBeVisible()

  fail = false
  await top.getByRole('button', { name: 'Thử lại' }).click()
  await expect(top.getByRole('listitem').first()).toContainText('Test Sách DB 01 Phổ Biến')
})
