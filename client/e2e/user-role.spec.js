import { test, expect } from '@playwright/test'

// 2.6.2 Gán vai trò (Admin). Cần server chạy và seed trước mỗi lần chạy (test.ur.e2e.reader đang mượn
// 1 cuốn + 1 đơn chờ duyệt, test.ur.e2e.librarian, test.ur.e2e.disabled là độc giả bị khóa):
//   cd server && node scripts/seed-test-users.js
const PASSWORD = 'Test@1234'
const READER = 'test.ur.e2e.reader@example.com'
const LIBRARIAN = 'test.ur.e2e.librarian@example.com'
const DISABLED = 'test.ur.e2e.disabled@example.com'

// Đổi tài khoản giữa chừng: đã đăng nhập thì /login không hiện form, nên xóa token trước.
async function login(page, email) {
  await page.goto('/login')
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Mật khẩu').fill(PASSWORD)
  await page.getByRole('button', { name: 'Đăng nhập' }).click()
  await expect(page).not.toHaveURL(/\/login/)
}

const row = (page, email) => page.getByRole('row', { name: `Người dùng ${email}` })
const roleSelect = (page, email) => row(page, email).getByRole('combobox', { name: `Vai trò của ${email}` })

// window.confirm mở ngay trong onChange nên phải đăng ký handler trước khi chọn (common_errors 2.5.1).
async function pickRole(page, email, role, accept) {
  let message = ''
  page.once('dialog', (d) => {
    message = d.message()
    return accept ? d.accept() : d.dismiss()
  })
  await roleSelect(page, email).selectOption(role)
  return message
}

async function openUsers(page) {
  await login(page, 'test.admin@example.com')
  await page.goto('/admin/users?q=test.ur.e2e')
  await expect(page.getByRole('row')).toHaveCount(4) // header + 3 tài khoản test.ur.e2e
}

test.describe.serial('2.6.2 Gán vai trò', () => {
  test('chính mình không có ô đổi vai trò', async ({ page }) => {
    await login(page, 'test.admin@example.com')
    await page.goto('/admin/users?q=test.admin%40example.com')
    const self = row(page, 'test.admin@example.com')
    await expect(self).toContainText('Quản lý viên')
    await expect(self.getByRole('combobox')).toHaveCount(0)
  })

  test('edge 1: độc giả đang mượn được đổi thành nhân viên có cảnh báo; quyền mới có hiệu lực khi tải lại', async ({ page, browser }) => {
    const readerContext = await browser.newContext()
    const reader = await readerContext.newPage()
    await login(reader, READER)
    await reader.goto('/reader/borrow-history')
    await expect(reader.getByText('Test Sách VT 01 Vai Trò')).toBeVisible()

    await openUsers(page)
    await expect(roleSelect(page, READER)).toHaveValue('reader')

    // Hủy: không đổi gì.
    const warning = await pickRole(page, READER, 'librarian', false)
    expect(warning).toContain('từ Độc giả thành Nhân viên thư viện')
    expect(warning).toContain('đang mượn 1 cuốn sách, có 1 yêu cầu mượn chờ duyệt')
    expect(warning).toContain('vẫn giữ nguyên')
    await expect(roleSelect(page, READER)).toHaveValue('reader')

    await pickRole(page, READER, 'librarian', true)
    await expect(page.getByRole('status')).toHaveText(`Đã đổi vai trò: Test Vai Trò E2E Độc Giả (${READER}).`)
    await expect(roleSelect(page, READER)).toHaveValue('librarian')
    await expect(row(page, READER)).toContainText('Đang mượn 1 cuốn') // dữ liệu cũ giữ nguyên

    // Người dùng đang đăng nhập: tải lại thì vào trang theo vai trò mới.
    await reader.reload()
    await expect(reader).toHaveURL('/librarian')
    await readerContext.close()

    // Lọc theo vai trò thấy ngay vai trò mới.
    await page.getByRole('button', { name: 'Nhân viên thư viện' }).click()
    await expect(row(page, READER)).toBeVisible()
    await expect(row(page, DISABLED)).toHaveCount(0)
  })

  test('nâng nhân viên lên Admin: đăng nhập thấy trang Admin; hạ lại thì mất quyền', async ({ page }) => {
    await openUsers(page)
    const message = await pickRole(page, LIBRARIAN, 'admin', true)
    expect(message).toBe(`Đổi vai trò của Test Vai Trò E2E Nhân Viên (${LIBRARIAN}) từ Nhân viên thư viện thành Quản lý viên?`)
    await expect(roleSelect(page, LIBRARIAN)).toHaveValue('admin')

    await login(page, LIBRARIAN)
    await expect(page).toHaveURL('/admin')
    await page.getByRole('link', { name: 'Người dùng' }).click()
    await expect(page).toHaveURL('/admin/users')

    await openUsers(page)
    await pickRole(page, LIBRARIAN, 'librarian', true)
    await expect(roleSelect(page, LIBRARIAN)).toHaveValue('librarian')
    await login(page, LIBRARIAN)
    await expect(page).toHaveURL('/librarian')
    await page.goto('/admin/users')
    await expect(page).toHaveURL('/librarian')
  })

  test('edge 3: đổi vai trò tài khoản bị vô hiệu hóa, vẫn chưa đăng nhập được', async ({ page }) => {
    await openUsers(page)
    const message = await pickRole(page, DISABLED, 'librarian', true)
    expect(message).toContain('chỉ có hiệu lực sau khi kích hoạt')
    await expect(roleSelect(page, DISABLED)).toHaveValue('librarian')
    await expect(row(page, DISABLED)).toContainText('Vô hiệu hóa')

    await page.goto('/login')
    await page.evaluate(() => localStorage.clear())
    await page.reload()
    await page.getByLabel('Email').fill(DISABLED)
    await page.getByLabel('Mật khẩu').fill(PASSWORD)
    await page.getByRole('button', { name: 'Đăng nhập' }).click()
    await expect(page.getByText('Tài khoản đã bị vô hiệu hóa')).toBeVisible()
  })
})
