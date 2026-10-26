import { test, expect } from '@playwright/test'

// 2.5.3 Xác nhận thanh toán khoản phạt (nhân viên). Cần server chạy và seed trước mỗi lần chạy
// (test.settlee có phiếu XP-A..D, test.cleared có XP-E ở sách "Test Sách XP 01 Xác Nhận Phạt"):
//   cd server && node scripts/seed-test-users.js
const PASSWORD = 'Test@1234'
const SETTLEE = '/librarian/fine-tickets?q=test.settlee%40example.com'

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

// Mỗi phiếu của một độc giả seed dùng một mức phạt riêng nên lọc theo tên mức là đủ.
// Chỉ dòng phiếu, không lấy dòng chi tiết đang mở (cũng chứa tên mức phạt).
const row = (page, text) => page.getByRole('row', { name: /^Phiếu phạt \d+$/ }).filter({ hasText: text })
const ticketIdOf = async (r) => (await r.locator('td').first().textContent()).replace('#', '')

async function openDetail(page, text) {
  const r = row(page, text)
  const id = await ticketIdOf(r)
  await r.getByRole('button', { name: `Xem chi tiết phiếu ${id}` }).click()
  // exact: nút "Đóng chi tiết phiếu ..." cũng chứa nhãn này.
  return { id, detail: page.getByLabel(`Chi tiết phiếu ${id}`, { exact: true }) }
}

// window.confirm mở đồng bộ lúc click nên đăng ký handler trước (common_errors 2.5.1).
async function confirmPaid(page, detail, id) {
  page.once('dialog', (d) => d.accept())
  await detail.getByRole('button', { name: `Đã thanh toán phiếu ${id}` }).click()
}

test.describe.serial('2.5.3 Xác nhận thanh toán phạt (nhân viên)', () => {
  test('edge 6: độc giả mở trang bị chuyển về dashboard của mình', async ({ page }) => {
    await login(page, 'test.settlee@example.com')
    await page.goto('/librarian/fine-tickets')
    await expect(page).toHaveURL('/reader')
  })

  test('dashboard có link Quản lý phạt; mặc định phiếu Chờ xác nhận; tìm theo email; xem chi tiết', async ({ page }) => {
    await login(page, 'test.librarian@example.com')
    await page.getByRole('link', { name: 'Quản lý phạt' }).click()
    await expect(page).toHaveURL('/librarian/fine-tickets')
    await expect(page.getByRole('button', { name: 'Chờ xác nhận', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByLabel('Tổng quan phiếu chờ xác nhận')).toContainText('Chờ xác nhận:')

    await page.getByRole('searchbox', { name: 'Tìm phiếu phạt' }).fill('test.settlee@example.com')
    await page.getByRole('button', { name: 'Tìm' }).click()
    await expect(page).toHaveURL(SETTLEE)
    await expect(page.getByRole('row')).toHaveCount(3) // header + XP-A, XP-B
    await expect(page.getByRole('row').nth(1)).toContainText('Trả muộn: Test XP Trả Muộn') // gửi sớm nhất trước
    await expect(row(page, 'Test XP Hư Hỏng')).toContainText('Test Settlee')
    await expect(row(page, 'Test XP Hư Hỏng')).toContainText('50.000 đ')
    await expect(row(page, 'Test XP Hư Hỏng')).toContainText('Chờ xác nhận')

    const { id, detail } = await openDetail(page, 'Test XP Hư Hỏng')
    for (const text of ['test.settlee@example.com', 'Test Sách XP 01 Xác Nhận Phạt', 'Rách bìa (test 2.5.3)', `THU VIEN PHAT ${id}`, 'Độc giả không đính kèm biên lai.']) {
      await expect(detail).toContainText(text)
    }
    await expect(detail.getByRole('button', { name: `Đã thanh toán phiếu ${id}` })).toBeVisible()
    await page.getByRole('button', { name: `Đóng chi tiết phiếu ${id}` }).click()
    await expect(detail).toHaveCount(0)
  })

  test('edge 2 và 7: Chưa thanh toán chỉ theo dõi; Đã thanh toán không có nút xử lý', async ({ page }) => {
    await login(page, 'test.librarian@example.com')
    await page.goto(SETTLEE)
    await page.getByRole('button', { name: 'Chưa thanh toán', exact: true }).click()
    await expect(page).toHaveURL('/librarian/fine-tickets?status=unpaid&q=test.settlee%40example.com')
    let { detail } = await openDetail(page, 'Test XP Mất')
    await expect(detail).toContainText('Độc giả chưa gửi thanh toán, chỉ theo dõi.')
    await expect(detail.getByRole('button', { name: /^(Đã thanh toán|Từ chối) phiếu/ })).toHaveCount(0)

    await page.getByRole('button', { name: 'Đã thanh toán', exact: true }).click()
    ;({ detail } = await openDetail(page, 'Test XP Hư Hỏng'))
    await expect(detail).toContainText('bởi Test Librarian')
    await expect(detail.getByRole('button', { name: /^(Đã thanh toán|Từ chối) phiếu/ })).toHaveCount(0)
  })

  test('từ chối: lý do bắt buộc; gửi xong phiếu rời hàng đợi, sang tab Từ chối kèm lý do', async ({ page }) => {
    await login(page, 'test.librarian@example.com')
    await page.goto(SETTLEE)
    const { id, detail } = await openDetail(page, 'Test XP Hư Hỏng')
    await detail.getByRole('button', { name: `Từ chối phiếu ${id}` }).click()
    const form = page.getByRole('form', { name: `Từ chối phiếu ${id}` })
    await form.getByLabel('Lý do từ chối (bắt buộc)').fill('   ')
    await form.getByRole('button', { name: 'Xác nhận từ chối' }).click()
    await expect(form).toContainText('Lý do từ chối là bắt buộc')
    await form.getByLabel('Lý do từ chối (bắt buộc)').fill('Chuyển thiếu 10.000 đ')
    await form.getByRole('button', { name: 'Xác nhận từ chối' }).click()
    await expect(page.getByRole('status')).toContainText(`Phiếu #${id} của Test Settlee: Đã từ chối thanh toán. Độc giả còn 3 phiếu phạt`)
    await expect(row(page, 'Test XP Hư Hỏng')).toHaveCount(0)

    await page.getByRole('button', { name: 'Từ chối', exact: true }).click()
    const { detail: rejected } = await openDetail(page, 'Test XP Hư Hỏng')
    await expect(rejected).toContainText('Lý do từ chối')
    await expect(rejected).toContainText('Chuyển thiếu 10.000 đ')
  })

  test('độc giả thấy lý do từ chối và được thanh toán lại', async ({ page }) => {
    await login(page, 'test.settlee@example.com')
    await page.goto('/reader/fines')
    const r = row(page, 'Test XP Hư Hỏng')
    await expect(r).toContainText('Lý do từ chối: Chuyển thiếu 10.000 đ')
    await expect(r.getByRole('button', { name: /^Thanh toán phiếu/ })).toHaveText('Thanh toán lại')
  })

  test('xác nhận Đã thanh toán; edge 1: tab khác xác nhận lại cùng phiếu → báo đã xử lý và tải lại', async ({ page, context }) => {
    await login(page, 'test.librarian@example.com')
    await page.goto(SETTLEE)
    const { id, detail } = await openDetail(page, 'Test XP Trả Muộn')
    // Tab thứ hai mở sẵn chi tiết cùng phiếu.
    const other = await context.newPage()
    await other.goto(SETTLEE)
    const { detail: otherDetail } = await openDetail(other, 'Test XP Trả Muộn')
    await expect(otherDetail).toBeVisible()

    // Hủy hộp thoại thì không gửi.
    page.once('dialog', (d) => d.dismiss())
    await detail.getByRole('button', { name: `Đã thanh toán phiếu ${id}` }).click()
    await expect(row(page, 'Test XP Trả Muộn')).toContainText('Chờ xác nhận')

    await confirmPaid(page, detail, id)
    await expect(page.getByRole('status')).toContainText(`Phiếu #${id} của Test Settlee: Đã xác nhận thanh toán. Độc giả còn 2 phiếu phạt`)
    await expect(page.getByText('Không có phiếu phạt nào phù hợp.')).toBeVisible()

    await confirmPaid(other, otherDetail, id)
    await expect(other.getByRole('alert')).toContainText('Phiếu phạt đã được xử lý bởi người khác')
    await expect(row(other, 'Test XP Trả Muộn')).toHaveCount(0)
    await other.close()

    await page.getByRole('button', { name: 'Đã thanh toán', exact: true }).click()
    await expect(row(page, 'Test XP Trả Muộn')).toContainText('Đã thanh toán')
  })

  test('edge 5: Admin xác nhận phiếu cuối cùng → độc giả mượn được sách', async ({ page }) => {
    await login(page, 'test.cleared@example.com')
    await page.goto('/books?q=XP%2001')
    await page.getByRole('link', { name: 'Test Sách XP 01 Xác Nhận Phạt' }).first().click()
    await expect(page.getByText('Cần thanh toán phiếu phạt trước khi mượn')).toBeVisible()
    const bookUrl = page.url()

    await login(page, 'test.admin@example.com')
    await page.getByRole('link', { name: 'Quản lý phạt' }).click()
    await expect(page).toHaveURL('/admin/fine-tickets')
    await page.goto('/admin/fine-tickets?q=test.cleared%40example.com')
    const { id, detail } = await openDetail(page, 'Test XP Mất')
    await confirmPaid(page, detail, id)
    await expect(page.getByRole('status')).toContainText('Độc giả không còn khoản phạt nào và có thể mượn sách lại.')

    await login(page, 'test.cleared@example.com')
    await page.goto(bookUrl)
    await expect(page.getByRole('button', { name: 'Mượn sách' })).toBeEnabled()
    await expect(page.getByText('Cần thanh toán phiếu phạt trước khi mượn')).toHaveCount(0)
  })
})
