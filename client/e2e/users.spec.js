import { test, expect } from '@playwright/test'

// 2.6.1 Danh sách người dùng (Admin). Cần server chạy và seed trước mỗi lần chạy
// (test.um.e2e.active đang mượn 1 cuốn, test.um.e2e.pending, test.um.e2e.disabled là librarian):
//   cd server && node scripts/seed-test-users.js
const PASSWORD = 'Test@1234'
const ACTIVE = 'test.um.e2e.active@example.com'
const PENDING = 'test.um.e2e.pending@example.com'
const DISABLED = 'test.um.e2e.disabled@example.com'

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

async function search(page, q) {
  await page.getByRole('searchbox', { name: 'Tìm người dùng' }).fill(q)
  await page.getByRole('button', { name: 'Tìm' }).click()
}

test.describe.serial('2.6.1 Danh sách người dùng', () => {
  test('edge 8: nhân viên thư viện mở trang bị chuyển về dashboard của mình', async ({ page }) => {
    await login(page, 'test.librarian@example.com')
    await expect(page.getByRole('link', { name: 'Người dùng' })).toHaveCount(0)
    await page.goto('/admin/users')
    await expect(page).toHaveURL('/librarian')
  })

  test('dashboard có link Người dùng; bảng đủ cột; tìm không dấu; lọc vai trò', async ({ page }) => {
    await login(page, 'test.admin@example.com')
    await page.getByRole('link', { name: 'Người dùng' }).click()
    await expect(page).toHaveURL('/admin/users')
    for (const col of ['Email', 'Tên', 'Vai trò', 'Ngày tham gia', 'Trạng thái']) {
      await expect(page.getByRole('columnheader', { name: col, exact: true })).toBeVisible()
    }

    await search(page, 'test nguoi dung e2e')
    await expect(page).toHaveURL('/admin/users?q=test+nguoi+dung+e2e')
    await expect(page.getByRole('row')).toHaveCount(4) // header + 3 tài khoản e2e
    await expect(row(page, ACTIVE)).toContainText('Test Người Dùng E2E Hoạt Động')
    await expect(row(page, ACTIVE)).toContainText('Độc giả')
    await expect(row(page, ACTIVE)).toContainText('Kích hoạt')
    await expect(row(page, ACTIVE)).toContainText('Đang mượn 1 cuốn')
    await expect(row(page, PENDING)).toContainText('Chờ xác nhận')
    await expect(row(page, DISABLED)).toContainText('Nhân viên thư viện')
    await expect(row(page, DISABLED)).toContainText('Vô hiệu hóa')

    await page.getByRole('button', { name: 'Nhân viên thư viện' }).click()
    await expect(page).toHaveURL('/admin/users?role=librarian&q=test+nguoi+dung+e2e')
    await expect(page.getByRole('row')).toHaveCount(2)
    await expect(row(page, DISABLED)).toBeVisible()

    await search(page, 'zzz_khong_ton_tai')
    await expect(page.getByText('Không tìm thấy người dùng.')).toBeVisible()
  })

  test('edge 1: tài khoản của chính mình không có nút Vô hiệu hóa', async ({ page }) => {
    await login(page, 'test.admin@example.com')
    await page.goto('/admin/users?q=test.admin%40example.com')
    const self = row(page, 'test.admin@example.com')
    await expect(self).toContainText('Test Admin (bạn)')
    await expect(self).toContainText('Tài khoản của bạn')
    await expect(self.getByRole('button')).toHaveCount(0)
  })

  test('edge 3, 4: vô hiệu hóa người đang mượn có cảnh báo; người đó bị đăng xuất ở request kế tiếp', async ({ page, browser }) => {
    // Người dùng đang đăng nhập ở trình duyệt khác.
    const readerContext = await browser.newContext()
    const reader = await readerContext.newPage()
    await login(reader, ACTIVE)
    await expect(reader).toHaveURL('/reader')

    await login(page, 'test.admin@example.com')
    await page.goto('/admin/users?q=test.um.e2e')
    const target = row(page, ACTIVE)

    // Hủy: không đổi gì.
    let message = ''
    page.once('dialog', (d) => { message = d.message(); d.dismiss() })
    await target.getByRole('button', { name: `Vô hiệu hóa ${ACTIVE}` }).click()
    expect(message).toContain('đang mượn 1 cuốn sách')
    await expect(target).toContainText('Kích hoạt')

    page.once('dialog', (d) => d.accept())
    await target.getByRole('button', { name: `Vô hiệu hóa ${ACTIVE}` }).click()
    await expect(page.getByRole('status')).toHaveText(`Đã vô hiệu hóa tài khoản: Test Người Dùng E2E Hoạt Động (${ACTIVE}).`)
    await expect(target).toContainText('Vô hiệu hóa')
    await expect(target).toContainText('Đang mượn 1 cuốn') // edge 3: đơn mượn giữ nguyên
    await expect(target.getByRole('button', { name: `Kích hoạt ${ACTIVE}` })).toBeVisible()

    await reader.goto('/reader/borrow-history')
    await expect(reader).toHaveURL(/\/login/)
    await reader.getByLabel('Email').fill(ACTIVE)
    await reader.getByLabel('Mật khẩu').fill(PASSWORD)
    await reader.getByRole('button', { name: 'Đăng nhập' }).click()
    await expect(reader.getByText('Tài khoản đã bị vô hiệu hóa')).toBeVisible()
    await readerContext.close()

    // Kích hoạt lại thì đăng nhập được.
    await target.getByRole('button', { name: `Kích hoạt ${ACTIVE}` }).click()
    await expect(page.getByRole('status')).toContainText('Đã kích hoạt tài khoản')
    await expect(target.getByRole('button', { name: `Vô hiệu hóa ${ACTIVE}` })).toBeVisible()
    await login(page, ACTIVE)
    await expect(page).toHaveURL('/reader')
  })

  test('edge 5: kích hoạt tài khoản Chờ xác nhận và nhân viên bị vô hiệu hóa', async ({ page }) => {
    await login(page, 'test.admin@example.com')
    await page.goto('/admin/users?q=test.um.e2e')
    await row(page, PENDING).getByRole('button', { name: `Kích hoạt ${PENDING}` }).click()
    await expect(page.getByRole('status')).toContainText(`Đã kích hoạt tài khoản: Test Người Dùng E2E Chờ (${PENDING}).`)
    await expect(row(page, PENDING)).toContainText('Kích hoạt')
    await expect(row(page, PENDING).getByRole('button', { name: `Vô hiệu hóa ${PENDING}` })).toBeVisible()

    await row(page, DISABLED).getByRole('button', { name: `Kích hoạt ${DISABLED}` }).click()
    await expect(row(page, DISABLED).getByRole('button', { name: `Vô hiệu hóa ${DISABLED}` })).toBeVisible()
    await expect(row(page, DISABLED)).toContainText('Nhân viên thư viện')

    await login(page, PENDING)
    await expect(page).toHaveURL('/reader')
    await login(page, DISABLED)
    await expect(page).toHaveURL('/librarian')
  })
})
