import { test, expect } from '@playwright/test'

// 2.1.3 Hồ sơ cá nhân. Cần server chạy (có SUPABASE_SERVICE_ROLE_KEY để upload ảnh) và seed lại
// tài khoản test.profile trước mỗi lần chạy:  cd server && node scripts/seed-test-users.js
const PASSWORD = 'Test@1234'
const NEW_PASSWORD = 'Test@5678'
const PROFILE_EMAIL = 'test.profile@example.com'
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
)

async function login(page, email = PROFILE_EMAIL, password = PASSWORD) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Mật khẩu').fill(password)
  await page.getByRole('button', { name: 'Đăng nhập' }).click()
}

// Đợi đăng nhập xong (token đã lưu) rồi mới mở trang hồ sơ.
async function openProfile(page) {
  await login(page)
  await expect(page).toHaveURL('/reader')
  await page.goto('/reader/profile')
}

const infoForm = (page) => page.getByRole('form', { name: 'Thông tin cá nhân' })
const pwForm = (page) => page.getByRole('form', { name: 'Đổi mật khẩu' })

// Các test dùng chung một tài khoản nên chạy lần lượt.
test.describe.configure({ mode: 'serial' })

test.describe('2.1.3 Hồ sơ cá nhân', () => {
  test('mở hồ sơ từ dashboard: hiện thông tin, thống kê, ảnh mặc định (edge 1)', async ({ page }) => {
    await login(page)
    await page.getByRole('link', { name: 'Hồ sơ' }).click()

    await expect(page).toHaveURL('/reader/profile')
    await expect(page.getByRole('heading', { name: 'Hồ sơ cá nhân' })).toBeVisible()
    await expect(page.getByRole('img', { name: 'Ảnh đại diện mặc định' })).toBeVisible()
    await expect(page.getByText('Số lần mượn')).toBeVisible()
    await expect(page.getByText('Tổng tiền phạt')).toBeVisible()
    await expect(infoForm(page).getByLabel('Email')).toHaveValue(PROFILE_EMAIL)
    await expect(infoForm(page).getByLabel('Email')).toBeDisabled()
    await expect(infoForm(page).getByLabel('Số điện thoại')).toHaveValue('')
    await expect(infoForm(page).getByLabel('Địa chỉ')).toHaveValue('')
  })

  test('cập nhật thông tin: lỗi validate rồi lưu thành công, tải lại vẫn còn', async ({ page }) => {
    await openProfile(page)
    const form = infoForm(page)

    await form.getByLabel('Số điện thoại').fill('12345')
    await form.getByRole('button', { name: 'Lưu thông tin' }).click()
    await expect(form.getByText('Số điện thoại không đúng định dạng')).toBeVisible()
    await expect(form.getByText('Địa chỉ không được để trống')).toBeVisible()

    await form.getByLabel('Tên').fill('Người Dùng E2E')
    await form.getByLabel('Số điện thoại').fill('0912345678')
    await form.getByLabel('Địa chỉ').fill('12 Nguyễn Huệ, Q.1')
    await form.getByRole('button', { name: 'Lưu thông tin' }).click()
    await expect(form.getByRole('status')).toHaveText('Cập nhật thông tin thành công')
    await expect(page.locator('header').getByText('Người Dùng E2E')).toBeVisible()

    await page.reload()
    await expect(infoForm(page).getByLabel('Tên')).toHaveValue('Người Dùng E2E')
    await expect(infoForm(page).getByLabel('Số điện thoại')).toHaveValue('0912345678')
    await expect(infoForm(page).getByLabel('Địa chỉ')).toHaveValue('12 Nguyễn Huệ, Q.1')
  })

  test('ảnh đại diện: chặn file sai, tải ảnh, xóa ảnh có xác nhận', async ({ page }) => {
    await openProfile(page)
    const picker = page.getByLabel('Chọn ảnh đại diện')

    await picker.setInputFiles({ name: 'virus.gif', mimeType: 'image/gif', buffer: Buffer.from('GIF89a') })
    await expect(page.getByRole('alert')).toHaveText('Chỉ nhận ảnh JPG, PNG, WebP tối đa 2 MB')

    await picker.setInputFiles({ name: 'me.png', mimeType: 'image/png', buffer: PNG })
    await expect(page.getByRole('img', { name: 'Xem trước ảnh đại diện' })).toBeVisible()
    await page.getByRole('button', { name: 'Xác nhận' }).click()
    await expect(page.getByText('Cập nhật ảnh đại diện thành công')).toBeVisible()
    const avatar = page.getByRole('img', { name: 'Ảnh đại diện', exact: true })
    await expect(avatar).toHaveAttribute('src', /\/storage\/v1\/object\/public\/avatars\/[0-9a-f-]{36}\.png$/)
    // Ảnh tải được thật từ Storage.
    await expect.poll(() => avatar.evaluate((img) => img.complete && img.naturalWidth)).toBe(1)

    await page.reload()
    await expect(avatar).toBeVisible()

    page.once('dialog', (dialog) => dialog.dismiss())
    await page.getByRole('button', { name: 'Xóa ảnh' }).click()
    await expect(avatar).toBeVisible()

    page.once('dialog', (dialog) => dialog.accept())
    await page.getByRole('button', { name: 'Xóa ảnh' }).click()
    await expect(page.getByRole('img', { name: 'Ảnh đại diện mặc định' })).toBeVisible()
    await expect(page.getByText('Đã xóa ảnh đại diện')).toBeVisible()
  })

  test('đổi mật khẩu: sai mật khẩu hiện tại, trùng mật khẩu cũ, thành công rồi đổi lại', async ({ page }) => {
    await openProfile(page)
    const form = pwForm(page)
    const fill = async (current, next, confirm = next) => {
      await form.getByLabel('Mật khẩu hiện tại').fill(current)
      await form.getByLabel('Mật khẩu mới', { exact: true }).fill(next)
      await form.getByLabel('Xác nhận mật khẩu mới').fill(confirm)
      await form.getByRole('button', { name: 'Đổi mật khẩu' }).click()
    }

    await fill(PASSWORD, NEW_PASSWORD, 'Other@1234')
    await expect(form.getByText('Xác nhận mật khẩu không khớp')).toBeVisible()

    await fill('WrongPass1', NEW_PASSWORD)
    await expect(form.getByText('Mật khẩu hiện tại không đúng')).toBeVisible()

    await fill(PASSWORD, PASSWORD)
    await expect(form.getByText('Mật khẩu mới phải khác mật khẩu cũ')).toBeVisible()

    await fill(PASSWORD, NEW_PASSWORD)
    await expect(form.getByRole('status')).toHaveText('Đổi mật khẩu thành công')
    await expect(form.getByLabel('Mật khẩu hiện tại')).toHaveValue('')

    // Edge 6: phiên hiện tại vẫn còn; đăng nhập lại phải dùng mật khẩu mới.
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Hồ sơ cá nhân' })).toBeVisible()
    await page.getByRole('button', { name: 'Đăng xuất' }).click()
    await login(page, PROFILE_EMAIL, PASSWORD)
    await expect(page.getByRole('alert')).toHaveText('Email hoặc mật khẩu không đúng')
    await login(page, PROFILE_EMAIL, NEW_PASSWORD)
    await expect(page).toHaveURL('/reader')

    await page.goto('/reader/profile')
    await fill(NEW_PASSWORD, PASSWORD)
    await expect(pwForm(page).getByRole('status')).toHaveText('Đổi mật khẩu thành công')
  })

  test('chưa đăng nhập → về /login kèm redirect; nhân viên mở hồ sơ → về dashboard của mình', async ({ page }) => {
    await page.goto('/reader/profile')
    await expect(page).toHaveURL('/login?redirect=%2Freader%2Fprofile')

    await page.getByLabel('Email').fill('test.librarian@example.com')
    await page.getByLabel('Mật khẩu').fill(PASSWORD)
    await page.getByRole('button', { name: 'Đăng nhập' }).click()
    await expect(page).toHaveURL('/librarian')
  })
})
