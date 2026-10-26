import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect } from '@playwright/test'

// 2.5.2 Xem & thanh toán khoản phạt (độc giả). Cần server chạy và seed trước mỗi lần chạy
// (test.payee có 5 phiếu phạt TT-A..E ở sách "Test Sách TT 01 Thanh Toán"):
//   cd server && node scripts/seed-test-users.js
const PASSWORD = 'Test@1234'
const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../server/postman/fixtures')

async function login(page, email) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Mật khẩu').fill(PASSWORD)
  await page.getByRole('button', { name: 'Đăng nhập' }).click()
  await expect(page).not.toHaveURL(/\/login/)
}

// Mỗi phiếu seed có tên mức phạt riêng theo loại; TT-A và TT-D cùng "Trả Muộn" nên lọc thêm trạng thái.
const row = (page, text) => page.getByRole('row').filter({ hasText: text })
const payButton = (r) => r.getByRole('button', { name: /^Thanh toán phiếu/ })

test.describe.serial('2.5.2 Thanh toán phạt (độc giả)', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'test.payee@example.com')
  })

  test('dashboard có link Khoản phạt; mặc định hiện phiếu cần thanh toán kèm tổng tiền', async ({ page }) => {
    await page.getByRole('link', { name: 'Khoản phạt' }).click()
    await expect(page).toHaveURL('/reader/fines')
    await expect(page.getByRole('row')).toHaveCount(4) // header + TT-A, TT-B, TT-C
    await expect(page.getByLabel('Tổng quan khoản phạt')).toContainText('180.000 đ')
    await expect(page.getByLabel('Tổng quan khoản phạt')).toContainText('1 phiếu đang chờ nhân viên xác nhận')

    const damaged = row(page, 'Test TT Hư Hỏng')
    await expect(damaged).toContainText('Hư hỏng: Test TT Hư Hỏng')
    await expect(damaged).toContainText('Sách: Test Sách TT 01 Thanh Toán')
    await expect(damaged).toContainText('Ghi chú: Rách bìa (test 2.5.2)')
    await expect(damaged).toContainText('50.000 đ')
    await expect(damaged).toContainText('Chưa thanh toán')

    // Edge 2: phiếu bị từ chối hiện lý do và cho thanh toán lại.
    const rejected = row(page, 'Test TT Mất')
    await expect(rejected).toContainText('Từ chối')
    await expect(rejected).toContainText('Lý do từ chối: Chưa nhận được tiền chuyển khoản')
    await expect(payButton(rejected)).toHaveText('Thanh toán lại')
  })

  test('tab Chờ xác nhận / Đã thanh toán không có nút Thanh toán', async ({ page }) => {
    await page.goto('/reader/fines')
    await page.getByRole('button', { name: 'Chờ xác nhận', exact: true }).click()
    await expect(page).toHaveURL('/reader/fines?status=pending')
    await expect(page.getByRole('row')).toHaveCount(2)
    await expect(row(page, 'Test TT Trả Muộn')).toContainText('Chờ xác nhận')
    await expect(row(page, 'Test TT Trả Muộn').getByRole('button')).toHaveCount(0)

    await page.getByRole('button', { name: 'Đã thanh toán', exact: true }).click()
    await expect(page.getByRole('row')).toHaveCount(2)
    await expect(row(page, 'Test TT Hư Hỏng')).toContainText('Đã thanh toán')
    await expect(row(page, 'Test TT Hư Hỏng').getByRole('button')).toHaveCount(0)
  })

  test('Hủy trong modal không gửi; modal hiện tài khoản, số tiền, nội dung chuyển khoản có mã phiếu', async ({ page }) => {
    await page.goto('/reader/fines')
    const late = row(page, 'Test TT Trả Muộn')
    const ticketId = (await late.locator('td').first().textContent()).replace('#', '')
    await payButton(late).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toContainText(`Thanh toán phiếu phạt #${ticketId}`)
    await expect(dialog).toContainText('Số tài khoản')
    await expect(dialog).toContainText('10.000 đ')
    await expect(dialog).toContainText(`THU VIEN PHAT ${ticketId}`)
    await dialog.getByRole('button', { name: 'Hủy' }).click()
    await expect(dialog).toHaveCount(0)
    await page.reload()
    await expect(payButton(row(page, 'Test TT Trả Muộn'))).toBeVisible()
  })

  test('bấm Đã thanh toán (không ảnh) → Chờ xác nhận; edge 1: tab khác bấm lại phiếu đó → báo lỗi', async ({ page, context }) => {
    await page.goto('/reader/fines')
    await expect(row(page, 'Test TT Trả Muộn')).toBeVisible()
    // Tab cũ mở sẵn modal của cùng phiếu trước khi tab mới gửi.
    const other = await context.newPage()
    await other.goto('/reader/fines')
    await payButton(row(other, 'Test TT Trả Muộn')).click()

    await payButton(row(page, 'Test TT Trả Muộn')).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Đã thanh toán' }).click()
    await expect(page.getByRole('status')).toContainText('Đã gửi, chờ nhân viên thư viện xác nhận')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(row(page, 'Test TT Trả Muộn')).toHaveCount(0)
    await expect(page.getByLabel('Tổng quan khoản phạt')).toContainText('170.000 đ')
    await expect(page.getByLabel('Tổng quan khoản phạt')).toContainText('2 phiếu đang chờ')

    await other.getByRole('dialog').getByRole('button', { name: 'Đã thanh toán' }).click()
    await expect(other.getByRole('alert')).toContainText('Phiếu phạt đã được gửi, đang chờ nhân viên xác nhận')
    await expect(row(other, 'Test TT Trả Muộn')).toHaveCount(0)
    await other.close()
  })

  test('ảnh sai định dạng bị chặn ở client; kèm ảnh PNG → gửi được và xem lại biên lai', async ({ page }) => {
    await page.goto('/reader/fines')
    await payButton(row(page, 'Test TT Hư Hỏng')).click()
    const dialog = page.getByRole('dialog')
    const input = dialog.getByLabel('Ảnh biên lai (tùy chọn)')
    await input.setInputFiles({ name: 'a.gif', mimeType: 'image/gif', buffer: Buffer.from('GIF89a') })
    await expect(dialog).toContainText('Chỉ nhận ảnh JPG, PNG, WebP tối đa 2 MB')
    await input.setInputFiles(path.join(FIXTURES, 'avatar.png'))
    await expect(dialog.getByText('Chỉ nhận ảnh JPG, PNG, WebP tối đa 2 MB')).toHaveCount(0)
    await dialog.getByRole('button', { name: 'Đã thanh toán' }).click()
    await expect(page.getByRole('status')).toContainText('Đã gửi')

    await page.getByRole('button', { name: 'Chờ xác nhận', exact: true }).click()
    const damaged = row(page, 'Test TT Hư Hỏng')
    await expect(damaged).toContainText('Chờ xác nhận')
    const popup = page.waitForEvent('popup')
    await damaged.getByRole('button', { name: /^Xem biên lai/ }).click()
    const receipt = await popup
    await expect(receipt).toHaveURL(/\/storage\/v1\/object\/sign\/receipts\/.+\.png\?token=/)
    await receipt.close()
  })

  test('edge 2: thanh toán lại phiếu bị từ chối → Chờ xác nhận', async ({ page }) => {
    await page.goto('/reader/fines')
    await payButton(row(page, 'Test TT Mất')).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Đã thanh toán' }).click()
    await expect(page.getByRole('status')).toContainText('Đã gửi')
    await expect(page.getByText('Bạn không có khoản phạt nào cần thanh toán.').first()).toBeVisible()
    await page.getByRole('button', { name: 'Chờ xác nhận', exact: true }).click()
    await expect(row(page, 'Test TT Mất')).toContainText('Chờ xác nhận')
  })

  test('tab Tất cả: 5 phiếu, không còn nút Thanh toán', async ({ page }) => {
    await page.goto('/reader/fines?status=all')
    await expect(page.getByRole('row')).toHaveCount(6)
    await expect(page.getByRole('button', { name: /^Thanh toán phiếu/ })).toHaveCount(0)
  })
})
