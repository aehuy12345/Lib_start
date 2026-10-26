import { test, expect } from '@playwright/test'

// 2.4.1 Yêu Cầu Trả Sách. Cần server chạy và seed trước mỗi lần chạy
// (thể loại "Test Trả Sách": test.returnee có đơn TS 01..05):
//   cd server && node scripts/seed-test-users.js
const PASSWORD = 'Test@1234'
const T = (n) => `Test Sách TS ${n}`

async function login(page, email) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Mật khẩu').fill(PASSWORD)
  await page.getByRole('button', { name: 'Đăng nhập' }).click()
  await expect(page).not.toHaveURL(/\/login/)
}

const row = (page, title) => page.getByRole('row', { name: `Đơn ${title}` })

test.describe.serial('2.4.1 Yêu cầu trả sách', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'test.returnee@example.com')
    await page.goto('/reader/borrow-history')
    await expect(row(page, T('01 Đang Mượn'))).toBeVisible()
  })

  test('nút Xin trả sách chỉ có ở đơn đang mượn/quá hạn chưa có yêu cầu chờ', async ({ page }) => {
    await expect(row(page, T('01 Đang Mượn')).getByRole('button', { name: /^Xin trả sách/ })).toBeVisible()
    await expect(row(page, T('02 Quá Hạn')).getByRole('button', { name: /^Xin trả sách/ })).toBeVisible()
    await expect(row(page, T('03 Chờ Trả'))).toContainText('Đang chờ xác nhận trả')
    await expect(row(page, T('03 Chờ Trả')).getByRole('button', { name: /^Xin trả sách/ })).toHaveCount(0)
    await expect(row(page, T('04 Đã Trả')).getByRole('button')).toHaveCount(0)
    await expect(row(page, T('05 Chờ Duyệt')).getByRole('button', { name: /^Xin trả sách/ })).toHaveCount(0)
  })

  test('Hủy trong modal không gửi yêu cầu', async ({ page }) => {
    await page.getByRole('button', { name: `Xin trả sách ${T('01 Đang Mượn')}` }).click()
    const dialog = page.getByRole('dialog', { name: 'Xin trả sách' })
    await expect(dialog).toContainText('mang sách đến thư viện')
    await dialog.getByRole('button', { name: 'Hủy' }).click()
    await expect(dialog).toHaveCount(0)
    await page.reload()
    await expect(row(page, T('01 Đang Mượn')).getByRole('button', { name: /^Xin trả sách/ })).toBeVisible()
  })

  test('gửi yêu cầu cho đơn đang mượn → Chờ xác nhận trả, hết nút Gia hạn, đơn vẫn Đang mượn', async ({ page }) => {
    const target = row(page, T('01 Đang Mượn'))
    await expect(target.getByRole('button', { name: /^Gia hạn/ })).toBeVisible()
    await target.getByRole('button', { name: /^Xin trả sách/ }).click()
    await page.getByRole('dialog', { name: 'Xin trả sách' }).getByRole('button', { name: 'Đồng ý' }).click()
    await expect(page.getByRole('status')).toHaveText('Đã gửi yêu cầu trả sách, vui lòng mang sách đến thư viện để nhân viên xác nhận')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(target).toContainText('Đang chờ xác nhận trả')
    await expect(target).toContainText('Đang mượn')
    await expect(target.getByRole('button', { name: /^Gia hạn/ })).toHaveCount(0)
    await expect(target.getByRole('button', { name: /^Xin trả sách/ })).toHaveCount(0)
  })

  test('edge 2: đơn quá hạn vẫn gửi được', async ({ page }) => {
    const target = row(page, T('02 Quá Hạn'))
    await target.getByRole('button', { name: /^Xin trả sách/ }).click()
    await page.getByRole('button', { name: 'Đồng ý' }).click()
    await expect(page.getByRole('status')).toContainText('Đã gửi yêu cầu trả sách')
    await expect(target).toContainText('Đang chờ xác nhận trả')
    await expect(target).toContainText('Quá hạn')
  })

  test('edge 1: hai tab cùng gửi → tab sau báo đã có yêu cầu chờ', async ({ page, context }) => {
    const other = await context.newPage()
    await other.goto('/reader/borrow-history')
    // TS 03 đang có yêu cầu chờ: hủy ở tab 1 để cả hai tab cùng thấy nút Xin trả sách sau khi tải lại.
    page.once('dialog', (d) => d.accept())
    await row(page, T('03 Chờ Trả')).getByRole('button', { name: /^Hủy yêu cầu trả/ }).click()
    await expect(page.getByRole('status')).toHaveText(`Đã hủy yêu cầu trả "${T('03 Chờ Trả')}"`)
    await other.reload()

    await row(page, T('03 Chờ Trả')).getByRole('button', { name: /^Xin trả sách/ }).click()
    await page.getByRole('button', { name: 'Đồng ý' }).click()
    await expect(page.getByRole('status')).toContainText('Đã gửi yêu cầu trả sách')

    await row(other, T('03 Chờ Trả')).getByRole('button', { name: /^Xin trả sách/ }).click()
    await other.getByRole('button', { name: 'Đồng ý' }).click()
    await expect(other.getByRole('alert')).toHaveText('Đơn này đã có yêu cầu trả sách đang chờ xác nhận')
    await expect(row(other, T('03 Chờ Trả'))).toContainText('Đang chờ xác nhận trả')
  })

  test('edge 5: hủy yêu cầu trả đang chờ → có lại nút Xin trả sách', async ({ page }) => {
    const target = row(page, T('01 Đang Mượn'))
    page.once('dialog', (d) => d.accept())
    await target.getByRole('button', { name: /^Hủy yêu cầu trả/ }).click()
    await expect(page.getByRole('status')).toHaveText(`Đã hủy yêu cầu trả "${T('01 Đang Mượn')}"`)
    await expect(target.getByRole('button', { name: /^Xin trả sách/ })).toBeVisible()
    await expect(target.getByRole('button', { name: /^Gia hạn/ })).toBeVisible()
  })
})
