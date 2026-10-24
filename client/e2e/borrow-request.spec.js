import { test, expect } from '@playwright/test'

// 2.3.1 Mượn Sách (Độc Giả). Cần server chạy và seed trước mỗi lần chạy
// (thể loại "Test Mượn Sách": test.requester chưa có đơn nào với "Test Sách MS 02 E2E"):
//   cd server && node scripts/seed-test-users.js
const PASSWORD = 'Test@1234'
const BOOK = 'Test Sách MS 02 E2E'

async function login(page, email) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Mật khẩu').fill(PASSWORD)
  await page.getByRole('button', { name: 'Đăng nhập' }).click()
  await expect(page).not.toHaveURL(/\/login/)
}

async function openBook(page, title) {
  await page.goto('/books')
  await page.getByLabel('Tìm theo tên sách hoặc tác giả').fill(title)
  await page.getByRole('button', { name: 'Tìm' }).click()
  await page.getByRole('article', { name: title }).getByRole('link', { name: title }).click()
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible()
}

const borrowButton = (page) => page.getByRole('button', { name: 'Mượn sách' })
const cancelButton = (page) => page.getByRole('button', { name: 'Hủy yêu cầu mượn' })
const form = (page) => page.getByRole('form', { name: 'Yêu cầu mượn sách' })

test.describe.serial('2.3.1 Mượn Sách (Độc Giả)', () => {
  test('gửi yêu cầu: chọn thời hạn, kiểm tra 1..30, đơn Chờ xác nhận, kho chưa trừ', async ({ page }) => {
    await login(page, 'test.requester@example.com')
    await openBook(page, BOOK)
    const available = page.locator('dt', { hasText: 'Có sẵn' }).locator('+ dd')
    await expect(available).toHaveText('2')

    await expect(borrowButton(page)).toBeEnabled()
    await borrowButton(page).click()
    const days = form(page).getByLabel(/Thời hạn mượn/)
    await expect(days).toHaveValue('14')

    // Edge 2: ngoài 1..30 bị chặn ngay trên form.
    await days.fill('31')
    await form(page).getByRole('button', { name: 'Gửi yêu cầu' }).click()
    await expect(form(page).getByText('Thời hạn phải từ 1 đến 30 ngày')).toBeVisible()

    await days.fill('21')
    await form(page).getByRole('button', { name: 'Gửi yêu cầu' }).click()
    await expect(page.getByRole('status')).toHaveText('Đã gửi yêu cầu mượn, chờ nhân viên xác nhận')
    await expect(form(page)).toHaveCount(0)
    await expect(borrowButton(page)).toBeDisabled()
    await expect(page.locator('#borrow-blocked')).toHaveText('Bạn đang mượn hoặc đã gửi yêu cầu mượn sách này')
    await expect(cancelButton(page)).toBeVisible()
    // Kho chỉ trừ khi nhân viên xác nhận (2.3.2).
    await expect(available).toHaveText('2')

    // Tải lại trang vẫn thấy đơn đang chờ.
    await page.reload()
    await expect(cancelButton(page)).toBeVisible()
  })

  test('nhân viên thấy đơn mới trong lịch sử mượn của sách', async ({ page }) => {
    await login(page, 'test.librarian@example.com')
    await openBook(page, BOOK)
    const row = page.getByRole('row', { name: /Test Requester/ })
    await expect(row).toContainText('Chờ xác nhận')
  })

  test('hủy yêu cầu đang chờ → mượn lại được', async ({ page }) => {
    await login(page, 'test.requester@example.com')
    await openBook(page, BOOK)
    // Bỏ qua hộp thoại xác nhận trước: không hủy.
    page.once('dialog', (dialog) => dialog.dismiss())
    await cancelButton(page).click()
    await expect(cancelButton(page)).toBeVisible()

    page.once('dialog', (dialog) => {
      expect(dialog.message()).toBe(`Hủy yêu cầu mượn "${BOOK}"?`)
      dialog.accept()
    })
    await cancelButton(page).click()
    await expect(page.getByRole('status')).toHaveText('Đã hủy yêu cầu mượn')
    await expect(cancelButton(page)).toHaveCount(0)
    await expect(borrowButton(page)).toBeEnabled()
  })

  test('độc giả có phiếu phạt: nút Mượn bị khóa, không mở được form', async ({ page }) => {
    await login(page, 'test.fined@example.com')
    await openBook(page, BOOK)
    await expect(borrowButton(page)).toBeDisabled()
    await expect(page.locator('#borrow-blocked')).toHaveText('Cần thanh toán phiếu phạt trước khi mượn')
    await expect(form(page)).toHaveCount(0)
  })
})
