import { test, expect } from '@playwright/test'

// 2.2.1 Quản lý thể loại sách. Cần server chạy và seed trước mỗi lần chạy (tạo "Test Có Sách" có 1 sách,
// dọn các thể loại "Test ..." cũ):  cd server && node scripts/seed-test-users.js
const PASSWORD = 'Test@1234'
const SUFFIX = Date.now()
const NAME = `Test E2E ${SUFFIX}`
const RENAMED = `Test E2E Sửa ${SUFFIX}`

async function login(page, email) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Mật khẩu').fill(PASSWORD)
  await page.getByRole('button', { name: 'Đăng nhập' }).click()
}

const nameInput = (page, name) => page.getByLabel(`Tên thể loại ${name}`, { exact: true })
const rowOf = (page, name) => page.getByRole('row').filter({ has: nameInput(page, name) })

test.describe.configure({ mode: 'serial' })

test.describe('2.2.1 Quản lý thể loại sách', () => {
  test('nhân viên mở trang từ dashboard, thêm thể loại (lỗi validate, trùng tên, thành công)', async ({ page }) => {
    await login(page, 'test.librarian@example.com')
    await expect(page).toHaveURL('/librarian')
    await page.getByRole('link', { name: 'Thể loại sách' }).click()
    await expect(page).toHaveURL('/librarian/categories')
    await expect(page.getByRole('heading', { name: 'Quản lý thể loại sách' })).toBeVisible()
    await expect(rowOf(page, 'Test Có Sách')).toContainText('1')

    await page.getByRole('button', { name: 'Thêm thể loại sách' }).click()
    const form = page.getByRole('form', { name: 'Thêm thể loại sách' })
    await form.getByRole('button', { name: 'Thêm' }).click()
    await expect(form.getByText('Tên thể loại không được để trống')).toBeVisible()

    await form.getByLabel('Tên thể loại mới').fill('a'.repeat(51))
    await form.getByRole('button', { name: 'Thêm' }).click()
    await expect(form.getByText('Tên thể loại tối đa 50 ký tự')).toBeVisible()

    // Edge 1: trùng tên khác hoa thường, dư khoảng trắng.
    await form.getByLabel('Tên thể loại mới').fill('  test CÓ sách ')
    await form.getByRole('button', { name: 'Thêm' }).click()
    await expect(form.getByText('Thể loại đã tồn tại')).toBeVisible()

    await form.getByLabel('Tên thể loại mới').fill(`  ${NAME}  `)
    await form.getByRole('button', { name: 'Thêm' }).click()
    await expect(page.getByRole('status')).toHaveText(`Đã thêm thể loại "${NAME}"`)
    await expect(nameInput(page, NAME)).toHaveValue(NAME)
    await expect(form).toBeHidden()
  })

  test('sửa trực tiếp trên bảng: trùng tên báo lỗi, Hủy trả tên cũ, lưu thành công và còn sau khi tải lại', async ({ page }) => {
    await login(page, 'test.librarian@example.com')
    await expect(page).toHaveURL('/librarian')
    await page.goto('/librarian/categories')

    const input = nameInput(page, NAME)
    const row = rowOf(page, NAME)
    await input.fill('Test Có Sách')
    await row.getByRole('button', { name: 'Lưu' }).click()
    await expect(row.getByText('Thể loại đã tồn tại')).toBeVisible()
    await expect(input).toHaveValue('Test Có Sách')

    await row.getByRole('button', { name: 'Hủy' }).click()
    await expect(input).toHaveValue(NAME)

    await input.fill(RENAMED)
    await input.press('Enter')
    await expect(page.getByRole('status')).toHaveText('Cập nhật thể loại thành công')

    await page.reload()
    await expect(nameInput(page, RENAMED)).toHaveValue(RENAMED)
  })

  test('xóa: chặn thể loại có sách; Hủy xác nhận giữ lại; đồng ý thì xóa', async ({ page }) => {
    await login(page, 'test.admin@example.com')
    await expect(page).toHaveURL('/admin')
    await page.getByRole('link', { name: 'Thể loại sách' }).click()
    await expect(page).toHaveURL('/admin/categories')

    await page.getByRole('button', { name: 'Xóa Test Có Sách' }).click()
    await expect(page.getByRole('alert')).toHaveText('Không thể xóa: còn 1 sách thuộc thể loại này')

    page.once('dialog', (d) => d.dismiss())
    await page.getByRole('button', { name: `Xóa ${RENAMED}` }).click()
    await expect(nameInput(page, RENAMED)).toBeVisible()

    page.once('dialog', (d) => {
      expect(d.message()).toBe(`Xóa thể loại "${RENAMED}"?`)
      d.accept()
    })
    await page.getByRole('button', { name: `Xóa ${RENAMED}` }).click()
    await expect(page.getByRole('status')).toHaveText(`Đã xóa thể loại "${RENAMED}"`)
    await expect(nameInput(page, RENAMED)).toHaveCount(0)
  })

  test('edge 6: độc giả mở trang thể loại bị chuyển về dashboard của mình', async ({ page }) => {
    await login(page, 'test.reader@example.com')
    await expect(page).toHaveURL('/reader')
    await expect(page.getByRole('link', { name: 'Thể loại sách' })).toHaveCount(0)
    await page.goto('/librarian/categories')
    await expect(page).toHaveURL('/reader')
  })
})
