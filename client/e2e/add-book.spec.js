import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect } from '@playwright/test'

// 2.2.2 Thêm Sách Mới. Cần server chạy (có SUPABASE_SERVICE_ROLE_KEY) và seed trước mỗi lần chạy
// (sách seed ISBN 9780306406157, thể loại "Test Thêm Sách"; dọn sách "Test Sách ..." cũ kèm ảnh bìa):
//   cd server && node scripts/seed-test-users.js
const PASSWORD = 'Test@1234'
const SUFFIX = Date.now()
const TITLE = `Test Sách E2E ${SUFFIX}`
const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../server/postman/fixtures')

async function login(page, email) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Mật khẩu').fill(PASSWORD)
  await page.getByRole('button', { name: 'Đăng nhập' }).click()
}

async function fillBook(form, { title = TITLE, isbn = '' } = {}) {
  await form.getByLabel('Tên sách').fill(title)
  await form.getByLabel('Tác giả').fill('Tô Hoài')
  await form.getByLabel('Năm xuất bản').fill('1941')
  await form.getByLabel('ISBN (không bắt buộc)').fill(isbn)
  await form.getByLabel('Thể loại').selectOption({ label: 'Test Thêm Sách' })
  await form.getByLabel('Số lượng bản sách').fill('4')
  await form.getByLabel('Mô tả').fill('Truyện thiếu nhi, tạo bởi E2E')
}

test.describe.configure({ mode: 'serial' })

test.describe('2.2.2 Thêm Sách Mới', () => {
  test('nhân viên: lỗi validate, ISBN trùng, ảnh sai định dạng, rồi thêm thành công kèm ảnh bìa', async ({ page }) => {
    await login(page, 'test.librarian@example.com')
    await expect(page).toHaveURL('/librarian')
    await page.getByRole('link', { name: 'Thêm Sách Mới' }).click()
    await expect(page).toHaveURL('/librarian/books/new')

    const form = page.getByRole('form', { name: 'Thêm sách mới' })
    await form.getByRole('button', { name: 'Thêm sách' }).click()
    await expect(form.getByText('Tên sách không được để trống')).toBeVisible()
    await expect(form.getByText('Vui lòng chọn thể loại')).toBeVisible()
    await expect(form.getByText('Số lượng không được để trống')).toBeVisible()

    // ISBN đã có ở sách seed (dạng có gạch ngang, edge 1): lỗi tại field, dữ liệu giữ nguyên.
    await fillBook(form, { isbn: '978-0-306-40615-7' })
    await form.getByRole('button', { name: 'Thêm sách' }).click()
    await expect(form.getByText(/ISBN đã tồn tại/)).toBeVisible()
    await expect(form.getByLabel('Tên sách')).toHaveValue(TITLE)

    // Edge 8: file không phải ảnh bị chặn ở client, không có xem trước.
    await form.getByLabel('Chọn ảnh bìa').setInputFiles({ name: 'a.gif', mimeType: 'image/gif', buffer: Buffer.from('GIF89a') })
    await expect(form.getByText('Chỉ nhận ảnh JPG, PNG, WebP tối đa 2 MB')).toBeVisible()
    await expect(form.getByAltText('Xem trước ảnh bìa')).toHaveCount(0)

    // Edge 2: ISBN-10 kết thúc bằng x thường.
    await form.getByLabel('ISBN (không bắt buộc)').fill('0-8044-2957-x')
    await form.getByLabel('Chọn ảnh bìa').setInputFiles(path.join(FIXTURES, 'avatar.png'))
    await expect(form.getByAltText('Xem trước ảnh bìa')).toBeVisible()
    await form.getByRole('button', { name: 'Thêm sách' }).click()

    await expect(form.getByRole('status')).toHaveText('Thêm sách thành công')
    await expect(form.getByLabel('Tên sách')).toHaveValue('')
    await expect(form.getByAltText('Xem trước ảnh bìa')).toHaveCount(0)
  })

  test('edge 5: admin thêm sách trùng tên + tác giả → thành công kèm cảnh báo', async ({ page }) => {
    await login(page, 'test.admin@example.com')
    await expect(page).toHaveURL('/admin')
    await page.getByRole('link', { name: 'Thêm Sách Mới' }).click()
    await expect(page).toHaveURL('/admin/books/new')

    const form = page.getByRole('form', { name: 'Thêm sách mới' })
    await fillBook(form, { title: TITLE.toLowerCase() })
    await form.getByRole('button', { name: 'Thêm sách' }).click()
    await expect(form.getByRole('status')).toContainText('Thêm sách thành công')
    await expect(form.getByRole('status')).toContainText('Lưu ý: đã có sách cùng tên và tác giả')
  })

  test('độc giả không vào được trang thêm sách', async ({ page }) => {
    await login(page, 'test.reader@example.com')
    await expect(page).toHaveURL('/reader')
    await expect(page.getByRole('link', { name: 'Thêm Sách Mới' })).toHaveCount(0)
    await page.goto('/librarian/books/new')
    await expect(page).toHaveURL('/reader')
  })
})
