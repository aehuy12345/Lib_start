import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect } from '@playwright/test'

// 2.2.5 Sửa & Xóa Sách. Cần server chạy và seed trước mỗi lần chạy
// (thể loại "Test Sửa Xóa": SX 01 tổng 6 = 3 sẵn + 2 mượn + 1 hư; SX 02 có đơn đang mượn;
// SX 03 có đơn chờ xác nhận; SX 05 chỉ có đơn đã trả):
//   cd server && node scripts/seed-test-users.js
const PASSWORD = 'Test@1234'
const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../server/postman/fixtures')
const SX01 = 'Test Sách SX 01 Sửa'

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

test.describe.configure({ mode: 'serial' })

test.describe('2.2.5 Sửa & Xóa Sách', () => {
  test('reader: không thấy Sửa/Xóa, vào thẳng trang sửa bị chuyển về dashboard', async ({ page }) => {
    await login(page, 'test.reader@example.com')
    await openBook(page, SX01)
    await expect(page.getByRole('link', { name: 'Sửa' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Xóa' })).toHaveCount(0)
    const id = page.url().match(/\/books\/(\d+)/)[1]
    await page.goto(`/librarian/books/${id}/edit`)
    await expect(page).toHaveURL('/reader')
  })

  test('librarian: sửa thông tin, thay ảnh rồi xóa ảnh; số lượng không nhỏ hơn đang mượn + hư', async ({ page }) => {
    await login(page, 'test.librarian@example.com')
    await openBook(page, SX01)
    await page.getByRole('link', { name: 'Sửa' }).click()
    await expect(page).toHaveURL(/\/librarian\/books\/\d+\/edit$/)

    const form = page.getByRole('form', { name: 'Sửa sách' })
    await expect(form.getByLabel('Tên sách')).toHaveValue(SX01)
    await expect(form.getByLabel('ISBN (không bắt buộc)')).toHaveValue('9780131103627')
    await expect(form.getByLabel('Thể loại')).toHaveValue(/\d+/)
    await expect(form.getByLabel('Số lượng bản sách')).toHaveValue('6')
    await expect(form.getByText('hiện có 3 bản sẵn, 2 bản đang mượn, 1 bản hư hỏng')).toBeVisible()

    await form.getByLabel('Số lượng bản sách').fill('2')
    await form.getByRole('button', { name: 'Lưu thay đổi' }).click()
    await expect(form.getByText('Tổng số lượng không được nhỏ hơn 3 (2 bản đang mượn, 1 bản hư hỏng)')).toBeVisible()

    // Edge 2: bằng đúng đang mượn + hư hỏng → có sẵn 0.
    const newTitle = 'Test Sách SX 01 Đã Sửa E2E'
    await form.getByLabel('Tên sách').fill(newTitle)
    await form.getByLabel('Số lượng bản sách').fill('3')
    await form.getByLabel('Chọn ảnh bìa').setInputFiles(path.join(FIXTURES, 'avatar.png'))
    await expect(form.getByAltText('Xem trước ảnh bìa')).toBeVisible()
    await form.getByRole('button', { name: 'Lưu thay đổi' }).click()

    await expect(page).toHaveURL(/\/books\/\d+$/)
    await expect(page.getByRole('status')).toContainText('Cập nhật sách thành công')
    const article = page.getByRole('article', { name: newTitle })
    await expect(article).toContainText('Có sẵn0')
    await expect(article).toContainText('Hết sách')
    await expect(article.getByRole('img', { name: `Ảnh bìa ${newTitle}` })).toBeVisible()

    // Xóa ảnh bìa: về ảnh mặc định.
    await page.getByRole('link', { name: 'Sửa' }).click()
    await expect(form.getByAltText('Ảnh bìa hiện tại')).toBeVisible()
    await form.getByRole('button', { name: 'Xóa ảnh bìa' }).click()
    await expect(form.getByText('Ảnh bìa sẽ bị xóa khi lưu')).toBeVisible()
    await form.getByLabel('Số lượng bản sách').fill('6')
    await form.getByRole('button', { name: 'Lưu thay đổi' }).click()
    await expect(page.getByRole('status')).toContainText('Cập nhật sách thành công')
    await expect(article.getByRole('img', { name: 'Ảnh bìa mặc định' })).toBeVisible()
    await expect(article).toContainText('Có sẵn3')
  })

  test('edge 5: hai nhân viên sửa cùng lúc → người lưu sau bị báo xung đột và tải lại', async ({ browser }) => {
    const librarian = await (await browser.newContext()).newPage()
    const admin = await (await browser.newContext()).newPage()
    await login(librarian, 'test.librarian@example.com')
    await login(admin, 'test.admin@example.com')

    const title = 'Test Sách SX 01 Đã Sửa E2E'
    await openBook(librarian, title)
    await librarian.getByRole('link', { name: 'Sửa' }).click()
    await openBook(admin, title)
    await admin.getByRole('link', { name: 'Sửa' }).click()
    await expect(admin).toHaveURL(/\/admin\/books\/\d+\/edit$/)

    const adminForm = admin.getByRole('form', { name: 'Sửa sách' })
    await adminForm.getByLabel('Tác giả').fill('Tác Giả Admin Sửa')
    await adminForm.getByRole('button', { name: 'Lưu thay đổi' }).click()
    await expect(admin.getByRole('status')).toContainText('Cập nhật sách thành công')

    const form = librarian.getByRole('form', { name: 'Sửa sách' })
    await form.getByLabel('Tác giả').fill('Tác Giả Librarian Ghi Đè')
    await form.getByRole('button', { name: 'Lưu thay đổi' }).click()
    await expect(librarian.getByRole('alert')).toContainText('Sách đã được người khác cập nhật')
    await expect(form.getByRole('button', { name: 'Lưu thay đổi' })).toBeDisabled()

    await librarian.getByRole('button', { name: 'Tải lại dữ liệu mới' }).click()
    await expect(form.getByLabel('Tác giả')).toHaveValue('Tác Giả Admin Sửa')
    await expect(form.getByRole('button', { name: 'Lưu thay đổi' })).toBeEnabled()
  })

  test('xóa bị chặn khi có đơn đang mượn hoặc chờ xác nhận (edge 3)', async ({ page }) => {
    await login(page, 'test.librarian@example.com')
    let dialogs = 0
    page.on('dialog', (d) => { dialogs++; d.dismiss() })

    await openBook(page, 'Test Sách SX 02 Đang Mượn')
    await page.getByRole('button', { name: 'Xóa' }).click()
    await expect(page.getByRole('alert')).toContainText('Không thể xóa: sách đang có 1 đơn mượn hoạt động')

    await openBook(page, 'Test Sách SX 03 Chờ Duyệt')
    await page.getByRole('button', { name: 'Xóa' }).click()
    await expect(page.getByRole('alert')).toContainText('Không thể xóa: sách đang có 1 đơn mượn hoạt động')
    expect(dialogs).toBe(0)
  })

  test('xóa: hủy thì ở lại, đồng ý thì xóa và về danh sách (edge 1: sách có lịch sử đã trả)', async ({ page }) => {
    const title = 'Test Sách SX 05 Xóa E2E'
    await login(page, 'test.librarian@example.com')
    await openBook(page, title)
    const detailUrl = page.url()

    // Hộp thoại chỉ hiện sau khi delete-check trả về, nên chờ đúng sự kiện trước khi xử lý.
    let dialog = page.waitForEvent('dialog')
    await page.getByRole('button', { name: 'Xóa' }).click()
    const cancel = await dialog
    expect(cancel.message()).toBe(`Xóa sách "${title}"?`)
    await cancel.dismiss()
    await expect(page.getByRole('button', { name: 'Xóa' })).toBeEnabled()
    await expect(page).toHaveURL(detailUrl)
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible()

    dialog = page.waitForEvent('dialog')
    await page.getByRole('button', { name: 'Xóa' }).click()
    await (await dialog).accept()
    await expect(page).toHaveURL(/\/books\?q=/)
    await expect(page.getByRole('status').first()).toContainText(`Đã xóa sách "${title}"`)
    await expect(page.getByRole('article', { name: title })).toHaveCount(0)

    // Sách đã xóa không mở được nữa.
    await page.goto(detailUrl.replace(/^https?:\/\/[^/]+/, ''))
    await expect(page.getByRole('heading', { name: 'Không tìm thấy sách' })).toBeVisible()
  })
})
