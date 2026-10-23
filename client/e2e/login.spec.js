import { test, expect } from '@playwright/test'

// 2.1.2 Đăng nhập. Cần server chạy và đã seed tài khoản test:
//   cd server && node scripts/seed-test-users.js
const PASSWORD = 'Test@1234'
const email = (who) => `test.${who}@example.com`

async function login(page, who, password = PASSWORD) {
  await page.getByLabel('Email').fill(email(who))
  await page.getByLabel('Mật khẩu').fill(password)
  await page.getByRole('button', { name: 'Đăng nhập' }).click()
}

test.describe('2.1.2 Đăng nhập', () => {
  for (const [who, path, title] of [
    ['reader', '/reader', 'Dashboard độc giả'],
    ['librarian', '/librarian', 'Dashboard nhân viên thư viện'],
    ['admin', '/admin', 'Dashboard quản lý'],
  ]) {
    test(`${who} đăng nhập → ${path}`, async ({ page }) => {
      await page.goto('/login')
      await login(page, who)

      await expect(page).toHaveURL(path)
      await expect(page.getByRole('heading', { name: title })).toBeVisible()
    })
  }

  test('sai mật khẩu và email không tồn tại cùng một thông báo chung', async ({ page }) => {
    await page.goto('/login')
    await login(page, 'reader', 'WrongPass1')
    await expect(page.getByRole('alert')).toHaveText('Email hoặc mật khẩu không đúng')

    await page.getByLabel('Email').fill(`nobody+${Date.now()}@example.com`)
    await page.getByRole('button', { name: 'Đăng nhập' }).click()
    await expect(page.getByRole('alert')).toHaveText('Email hoặc mật khẩu không đúng')
    await expect(page).toHaveURL(/\/login$/)
  })

  test('tài khoản chờ xác nhận / vô hiệu hóa báo lỗi riêng', async ({ page }) => {
    await page.goto('/login')
    await login(page, 'pending')
    await expect(page.getByRole('alert')).toHaveText('Tài khoản chưa được xác nhận')

    await page.getByLabel('Email').fill(email('disabled'))
    await page.getByRole('button', { name: 'Đăng nhập' }).click()
    await expect(page.getByRole('alert')).toHaveText('Tài khoản đã bị vô hiệu hóa')
  })

  test('validation phía client không gọi API', async ({ page }) => {
    let called = false
    await page.route('**/api/auth/login', (route) => { called = true; route.continue() })

    await page.goto('/login')
    await page.getByLabel('Email').fill('abc')
    await page.getByLabel('Mật khẩu').fill('1234567')
    await page.getByRole('button', { name: 'Đăng nhập' }).click()

    await expect(page.getByText('Email không đúng định dạng')).toBeVisible()
    await expect(page.getByText('Mật khẩu tối thiểu 8 ký tự')).toBeVisible()
    expect(called).toBe(false)
  })

  test('edge 6: đã đăng nhập, vào lại /login → về dashboard; tải lại trang vẫn giữ phiên', async ({ page }) => {
    await page.goto('/login')
    await login(page, 'librarian')
    await expect(page).toHaveURL('/librarian')

    await page.reload()
    await expect(page.getByRole('heading', { name: 'Dashboard nhân viên thư viện' })).toBeVisible()

    await page.goto('/login')
    await expect(page).toHaveURL('/librarian')
  })

  test('chưa đăng nhập vào trang cần quyền → /login, đăng nhập xong quay lại', async ({ page }) => {
    await page.goto('/admin')
    await expect(page).toHaveURL('/login?redirect=%2Fadmin')

    await login(page, 'admin')
    await expect(page).toHaveURL('/admin')
  })

  test('sai vai trò → về dashboard của mình', async ({ page }) => {
    await page.goto('/login')
    await login(page, 'reader')
    await expect(page).toHaveURL('/reader')

    await page.goto('/admin')
    await expect(page).toHaveURL('/reader')
  })

  test('edge 5: phiên hết hạn → về /login, xóa token, đăng nhập lại quay về URL cũ', async ({ page }) => {
    await page.goto('/login')
    await login(page, 'reader')
    await expect(page).toHaveURL('/reader')

    // Giả lập token hết hạn/không còn hợp lệ.
    await page.evaluate(() => localStorage.setItem('token', 'expired.token.value'))
    await page.goto('/reader?tab=history')

    await expect(page).toHaveURL(/\/login\?redirect=%2Freader%3Ftab%3Dhistory/)
    expect(await page.evaluate(() => localStorage.getItem('token'))).toBeNull()

    await login(page, 'reader')
    await expect(page).toHaveURL('/reader?tab=history')
  })

  test('đăng xuất xóa phiên', async ({ page }) => {
    await page.goto('/login')
    await login(page, 'admin')
    await page.getByRole('button', { name: 'Đăng xuất' }).click()

    await expect(page).toHaveURL('/login')
    expect(await page.evaluate(() => localStorage.getItem('token'))).toBeNull()
    await page.goto('/admin')
    await expect(page).toHaveURL(/\/login\?redirect=/)
  })
})
