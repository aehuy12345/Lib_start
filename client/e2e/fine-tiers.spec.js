import { test, expect } from '@playwright/test'

// 2.5.1 Quản lý mức phạt (Admin). Cần server chạy và seed trước mỗi lần chạy (mức "Test MP Sửa E2E",
// "Test MP Xóa E2E" chưa dùng, "Test MP Dùng E2E" có 1 phiếu phạt):  cd server && node scripts/seed-test-users.js
const PASSWORD = 'Test@1234'
const NEW_TIER = `Test MP E2E ${String(Date.now()).slice(-6)}`
const EDIT = 'Test MP Sửa E2E'
const RENAMED = 'Test MP Sửa E2E Mới'

async function login(page, email) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Mật khẩu').fill(PASSWORD)
  await page.getByRole('button', { name: 'Đăng nhập' }).click()
  await expect(page).not.toHaveURL(/\/login/)
}

const nameInput = (page, name) => page.getByLabel(`Tên mức phạt ${name}`, { exact: true })
const amountInput = (page, name) => page.getByLabel(`Số tiền ${name}`, { exact: true })
const rowOf = (page, name) => page.getByRole('row').filter({ has: nameInput(page, name) })

// window.confirm mở ngay trong lúc click, nên phải đăng ký xử lý trước khi click (click chỉ xong khi hộp thoại đóng).
async function clickDelete(page, name, accept) {
  let message = ''
  page.once('dialog', (d) => {
    message = d.message()
    return accept ? d.accept() : d.dismiss()
  })
  await page.getByRole('button', { name: `Xóa ${name}` }).click()
  return message
}

test.describe.configure({ mode: 'serial' })

test.describe('2.5.1 Quản lý mức phạt', () => {
  test('Admin mở trang từ dashboard, thêm mức phạt (lỗi validate, trùng tên, thành công)', async ({ page }) => {
    await login(page, 'test.admin@example.com')
    await page.getByRole('link', { name: 'Mức phạt' }).click()
    await expect(page).toHaveURL('/admin/fine-tiers')
    await expect(page.getByRole('heading', { name: 'Quản lý mức phạt' })).toBeVisible()
    await expect(rowOf(page, 'Test MP Dùng E2E')).toContainText('Mất')
    await expect(rowOf(page, 'Test MP Dùng E2E').getByRole('cell').nth(3)).toHaveText('1')
    await expect(nameInput(page, 'Test Hư Hỏng Ẩn')).toHaveCount(0)

    await page.getByRole('button', { name: 'Thêm mức phạt' }).click()
    const form = page.getByRole('form', { name: 'Thêm mức phạt' })
    await form.getByLabel('Số tiền (VND)').fill('150.000')
    await form.getByRole('button', { name: 'Thêm' }).click()
    await expect(form.getByText('Tên mức phạt không được để trống')).toBeVisible()
    await expect(form.getByText('Vui lòng chọn loại mức phạt')).toBeVisible()
    await expect(form.getByText('Số tiền phải là số nguyên (VND)')).toBeVisible()

    await form.getByLabel('Tên mức phạt').fill('a'.repeat(26))
    await form.getByLabel('Loại').selectOption('damaged')
    await form.getByLabel('Số tiền (VND)').fill('0')
    await form.getByRole('button', { name: 'Thêm' }).click()
    await expect(form.getByText('Tên mức phạt tối đa 25 ký tự')).toBeVisible()
    await expect(form.getByText('Số tiền phải lớn hơn 0')).toBeVisible()

    // Trùng tên khác hoa thường: lỗi từ server.
    await form.getByLabel('Tên mức phạt').fill('  test mp SỬA e2e ')
    await form.getByLabel('Số tiền (VND)').fill('45000')
    await form.getByRole('button', { name: 'Thêm' }).click()
    await expect(form.getByText('Tên mức phạt đã tồn tại')).toBeVisible()

    await form.getByLabel('Tên mức phạt').fill(`  ${NEW_TIER}  `)
    await form.getByRole('button', { name: 'Thêm' }).click()
    await expect(page.getByRole('status')).toHaveText(`Đã thêm mức phạt "${NEW_TIER}"`)
    await expect(form).toBeHidden()
    await expect(rowOf(page, NEW_TIER)).toContainText('Hư hỏng')
    await expect(amountInput(page, NEW_TIER)).toHaveValue('45000')
  })

  test('sửa trực tiếp trên bảng: lỗi tại ô, Hủy, lưu thành công và còn sau khi tải lại', async ({ page }) => {
    await login(page, 'test.admin@example.com')
    await page.goto('/admin/fine-tiers')

    const amount = amountInput(page, EDIT)
    await amount.fill('abc')
    await rowOf(page, EDIT).getByRole('button', { name: 'Lưu' }).click()
    await expect(rowOf(page, EDIT).getByText('Số tiền phải là số')).toBeVisible()
    await rowOf(page, EDIT).getByRole('button', { name: 'Hủy' }).click()
    await expect(amount).toHaveValue('6000')
    await expect(rowOf(page, EDIT).getByRole('button', { name: 'Lưu' })).toHaveCount(0)

    await amount.fill('6500')
    await amount.press('Enter')
    await expect(page.getByRole('status')).toHaveText('Cập nhật mức phạt thành công')
    await expect(rowOf(page, EDIT)).toContainText('6.500 đ')

    await page.reload()
    await expect(amountInput(page, EDIT)).toHaveValue('6500')
  })

  test('edge 7: hai Admin sửa cùng lúc, người lưu sau bị báo và bảng được tải lại', async ({ browser }) => {
    const first = await (await browser.newContext()).newPage()
    const second = await (await browser.newContext()).newPage()
    for (const page of [first, second]) {
      await login(page, 'test.admin@example.com')
      await page.goto('/admin/fine-tiers')
      await expect(nameInput(page, EDIT)).toBeVisible()
    }

    await nameInput(second, EDIT).fill(RENAMED)
    await rowOf(second, EDIT).getByRole('button', { name: 'Lưu' }).click()
    await expect(second.getByRole('status')).toHaveText('Cập nhật mức phạt thành công')

    await amountInput(first, EDIT).fill('7000')
    await rowOf(first, EDIT).getByRole('button', { name: 'Lưu' }).click()
    await expect(first.getByRole('alert')).toHaveText('Mức phạt đã được người khác sửa, bảng đã được tải lại')
    await expect(nameInput(first, RENAMED)).toHaveValue(RENAMED)
    await expect(amountInput(first, RENAMED)).toHaveValue('6500')
  })

  test('xóa: Hủy giữ nguyên, mức chưa dùng bị xóa hẳn, mức đã dùng chỉ bị ẩn (edge 4)', async ({ page }) => {
    await login(page, 'test.admin@example.com')
    await page.goto('/admin/fine-tiers')
    await expect(nameInput(page, 'Test MP Xóa E2E')).toBeVisible()

    expect(await clickDelete(page, 'Test MP Xóa E2E', false)).toBe('Xóa mức phạt "Test MP Xóa E2E"?')
    await expect(nameInput(page, 'Test MP Xóa E2E')).toBeVisible()

    await clickDelete(page, 'Test MP Xóa E2E', true)
    await expect(page.getByRole('status')).toHaveText('Đã xóa mức phạt')
    await expect(nameInput(page, 'Test MP Xóa E2E')).toHaveCount(0)

    expect(await clickDelete(page, 'Test MP Dùng E2E', true)).toContain('đã được dùng trong 1 phiếu phạt nên sẽ được ẩn')
    await expect(page.getByRole('status')).toHaveText('Mức phạt đã được dùng trong phiếu phạt nên chỉ được ẩn; phiếu phạt cũ giữ nguyên')
    await expect(nameInput(page, 'Test MP Dùng E2E')).toHaveCount(0)

    // Dọn mức vừa thêm ở test đầu.
    await clickDelete(page, NEW_TIER, true)
    await expect(nameInput(page, NEW_TIER)).toHaveCount(0)
  })

  test('edge 6: nhân viên thư viện không thấy link và bị chuyển về dashboard', async ({ page }) => {
    await login(page, 'test.librarian@example.com')
    await expect(page).toHaveURL('/librarian')
    await expect(page.getByRole('link', { name: 'Mức phạt' })).toHaveCount(0)
    await page.goto('/admin/fine-tiers')
    await expect(page).toHaveURL('/librarian')
  })
})
