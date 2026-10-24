import { test, expect } from '@playwright/test'

// 2.2.4 Xem Chi Tiết Sách. Cần server chạy và seed trước mỗi lần chạy
// (thể loại "Test Chi Tiết": "Test Sách CT 01 Lịch Sử" có 12 đơn mượn; test.reader đã gửi yêu cầu,
// test.borrower đủ 5 đơn, test.fined có phiếu phạt, test.overdue có sách quá hạn; "Test Sách DS 07" hết sách):
//   cd server && node scripts/seed-test-users.js
const PASSWORD = 'Test@1234'
const BOOK = 'Test Sách CT 01 Lịch Sử'

async function login(page, email) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Mật khẩu').fill(PASSWORD)
  await page.getByRole('button', { name: 'Đăng nhập' }).click()
  await expect(page).not.toHaveURL(/\/login/)
}

// Mở chi tiết sách từ trang danh sách (tìm theo tên rồi bấm vào tên sách).
async function openBook(page, title) {
  await page.goto('/books')
  await page.getByLabel('Tìm theo tên sách hoặc tác giả').fill(title)
  await page.getByRole('button', { name: 'Tìm' }).click()
  await page.getByRole('article', { name: title }).getByRole('link', { name: title }).click()
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible()
}

const borrowButton = (page) => page.getByRole('button', { name: 'Mượn sách' })

test.describe('2.2.4 Xem Chi Tiết Sách', () => {
  test('khách: xem đủ thông tin, không thấy lịch sử; Mượn sách → đăng nhập rồi quay lại', async ({ page }) => {
    await openBook(page, BOOK)
    await expect(page).toHaveURL(/\/books\/\d+$/)
    const article = page.getByRole('article', { name: BOOK })
    await expect(article).toContainText('Tác giảTác Giả CT')
    await expect(article).toContainText('ISBN0306406152')
    await expect(article).toContainText('Năm xuất bản2015')
    await expect(article).toContainText('Thể loạiTest Chi Tiết')
    await expect(article).toContainText('Có sẵn3')
    await expect(article).toContainText('Đang mượn2')
    await expect(article).toContainText('Dữ liệu test 2.2.4')
    await expect(article.getByRole('img', { name: 'Ảnh bìa mặc định' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Lịch sử mượn' })).toHaveCount(0)
    await expect(page.getByText('test.reader@example.com')).toHaveCount(0)

    // Quay lại danh sách giữ nguyên từ khóa.
    await page.getByRole('link', { name: '← Danh sách sách' }).click()
    await expect(page).toHaveURL(/\/books\?q=/)
    await expect(page.getByLabel('Tìm theo tên sách hoặc tác giả')).toHaveValue(BOOK)
    await page.goBack()

    const detailUrl = page.url()
    await borrowButton(page).click()
    await expect(page).toHaveURL(/\/login\?redirect=%2Fbooks%2F\d+/)
    await page.getByLabel('Email').fill('test.reader@example.com')
    await page.getByLabel('Mật khẩu').fill(PASSWORD)
    await page.getByRole('button', { name: 'Đăng nhập' }).click()
    await expect(page).toHaveURL(detailUrl)
    // Edge 7: test.reader đã có đơn chờ xác nhận cho sách này.
    await expect(borrowButton(page)).toBeDisabled()
    await expect(page.getByText('Bạn đang mượn hoặc đã gửi yêu cầu mượn sách này')).toBeVisible()
  })

  test('độc giả: mượn được sách còn hàng, bị khóa khi hết sách', async ({ page }) => {
    await login(page, 'test.reader@example.com')
    await openBook(page, 'Test Sách DS 01')
    await expect(borrowButton(page)).toBeEnabled()
    await expect(page.getByRole('heading', { name: 'Lịch sử mượn' })).toHaveCount(0)

    await openBook(page, 'Test Sách DS 07')
    await expect(borrowButton(page)).toBeDisabled()
    await expect(page.locator('#borrow-blocked')).toHaveText('Hết sách')
  })

  for (const [email, message] of [
    ['test.borrower@example.com', 'Đã đạt giới hạn mượn tối đa 5 cuốn'],
    ['test.fined@example.com', 'Cần thanh toán phiếu phạt trước khi mượn'],
    ['test.overdue@example.com', 'Bạn đang có sách quá hạn, cần trả sách trước khi mượn'],
  ]) {
    test(`độc giả ${email}: nút Mượn bị khóa "${message}"`, async ({ page }) => {
      await login(page, email)
      await openBook(page, BOOK)
      await expect(borrowButton(page)).toBeDisabled()
      await expect(page.locator('#borrow-blocked')).toHaveText(message)
    })
  }

  test('nhân viên: bảng lịch sử mượn có phân trang, không có nút Mượn', async ({ page }) => {
    await login(page, 'test.librarian@example.com')
    await openBook(page, BOOK)
    await expect(borrowButton(page)).toHaveCount(0)

    const history = page.getByRole('region', { name: 'Lịch sử mượn' })
    const rows = history.getByRole('row')
    await expect(rows).toHaveCount(11) // tiêu đề + 10 dòng
    await expect(rows.nth(0)).toContainText('Độc giảNgày yêu cầuNgày mượnNgày hết hạnTrạng thái')
    await expect(rows.nth(1)).toContainText('test.reader@example.com')
    await expect(rows.nth(1)).toContainText('Chờ xác nhận')
    await expect(history.getByRole('row').filter({ hasText: 'test.overdue@example.com' }).first()).toContainText('Quá hạn')
    await expect(history.getByText('Đang mượn', { exact: true })).toBeVisible()
    await expect(history.getByText('Đã trả', { exact: true }).first()).toBeVisible()
    await expect(history.getByText('Bị từ chối', { exact: true }).first()).toBeVisible()

    const nav = page.getByRole('navigation', { name: 'Phân trang lịch sử mượn' })
    await expect(nav).toContainText('Trang 1 / 2')
    await nav.getByRole('button', { name: 'Trang sau' }).click()
    await expect(nav).toContainText('Trang 2 / 2')
    await expect(rows).toHaveCount(3)
  })

  test('admin cũng thấy lịch sử; sách chưa từng được mượn → lịch sử trống', async ({ page }) => {
    await login(page, 'test.admin@example.com')
    await openBook(page, 'Test Sách DS 01')
    await expect(page.getByText('Sách chưa từng được mượn')).toBeVisible()
  })

  test('edge 1: id không hợp lệ hoặc không tồn tại → trang 404', async ({ page }) => {
    for (const id of ['abc', '-1', '2147483647']) {
      await page.goto(`/books/${id}`)
      await expect(page.getByRole('heading', { name: 'Không tìm thấy sách' })).toBeVisible()
    }
    await page.getByRole('link', { name: 'Về danh sách sách' }).click()
    await expect(page).toHaveURL('/books')
  })
})
