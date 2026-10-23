import { test, expect } from '@playwright/test'

// 2.1.1 Đăng ký. Cần server (npm run dev trong server/) kết nối DB Supabase.
const password = 'secret123'

async function fillForm(page, { email, name = 'Người Dùng E2E', pass = password, confirm = password }) {
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Tên').fill(name)
  await page.getByLabel('Mật khẩu', { exact: true }).fill(pass)
  await page.getByLabel('Xác nhận mật khẩu').fill(confirm)
}

test.describe('2.1.1 Đăng ký', () => {
  test('happy case: đăng ký thành công, tài khoản chờ xác nhận', async ({ page }) => {
    await page.goto('/register')
    await fillForm(page, { email: `e2e+${Date.now()}@example.com` })
    await page.getByRole('button', { name: 'Đăng ký' }).click()

    await expect(page.getByRole('status')).toContainText('chờ xác nhận')
  })

  test('email đã tồn tại (khác hoa thường) báo lỗi tại field email', async ({ page }) => {
    const email = `e2e-dup+${Date.now()}@example.com`
    await page.goto('/register')
    await fillForm(page, { email })
    await page.getByRole('button', { name: 'Đăng ký' }).click()
    await expect(page.getByRole('status')).toBeVisible()

    await page.goto('/register')
    await fillForm(page, { email: email.toUpperCase() })
    await page.getByRole('button', { name: 'Đăng ký' }).click()

    await expect(page.getByText('Email đã được sử dụng')).toBeVisible()
  })

  test('validation phía client không gọi API', async ({ page }) => {
    let called = false
    await page.route('**/api/auth/register', (route) => { called = true; route.continue() })

    await page.goto('/register')
    await fillForm(page, { email: 'abc', name: '   ', pass: '1234567', confirm: '7654321' })
    await page.getByRole('button', { name: 'Đăng ký' }).click()

    await expect(page.getByText('Email không đúng định dạng')).toBeVisible()
    await expect(page.getByText('Tên không được để trống')).toBeVisible()
    await expect(page.getByText('Mật khẩu tối thiểu 8 ký tự')).toBeVisible()
    await expect(page.getByText('Xác nhận mật khẩu không khớp')).toBeVisible()
    expect(called).toBe(false)
  })

  test('link xác thực không hợp lệ báo lỗi', async ({ page }) => {
    await page.goto(`/verify-email?token=${'0'.repeat(64)}`)
    await expect(page.getByRole('alert')).toContainText('không hợp lệ')
  })
})
