import { test, expect } from '@playwright/test'

// 2.3.2 Mượn Sách (Nhân Viên): xác nhận và từ chối. Cần server chạy và seed trước mỗi lần chạy
// (thể loại "Test Duyệt Mượn": test.queue có đơn chờ cho DM 04 / 05 / 06):
//   cd server && node scripts/seed-test-users.js
const PASSWORD = 'Test@1234'
const READER = 'Test Queue'
const CONFIRM_BOOK = 'Test Sách DM 04 E2E Xác Nhận'
const REJECT_BOOK = 'Test Sách DM 05 E2E Từ Chối'
const OUT_BOOK = 'Test Sách DM 06 E2E Hết'

async function login(page, email) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Mật khẩu').fill(PASSWORD)
  await page.getByRole('button', { name: 'Đăng nhập' }).click()
  await expect(page).not.toHaveURL(/\/login/)
}

const row = (page, book) => page.getByRole('row', { name: `Đơn ${book} của ${READER}` })
const confirmButton = (page, book) => page.getByRole('button', { name: `Xác nhận đơn ${book} của ${READER}` })
const rejectButton = (page, book) => page.getByRole('button', { name: `Từ chối đơn ${book} của ${READER}` })

async function availableOf(page, title) {
  await page.goto('/books')
  await page.getByLabel('Tìm theo tên sách hoặc tác giả').fill(title)
  await page.getByRole('button', { name: 'Tìm' }).click()
  await page.getByRole('article', { name: title }).getByRole('link', { name: title }).click()
  return page.locator('dt', { hasText: 'Có sẵn' }).locator('+ dd')
}

test.describe.serial('2.3.2 Mượn Sách (Nhân Viên)', () => {
  test('độc giả không vào được trang duyệt đơn', async ({ page }) => {
    await login(page, 'test.queue@example.com')
    await page.goto('/librarian/borrow-orders')
    await expect(page).toHaveURL(/\/reader$/)
  })

  test('nhân viên mở danh sách từ dashboard, thấy đơn chờ kèm thông tin', async ({ page }) => {
    await login(page, 'test.librarian@example.com')
    await page.getByRole('link', { name: 'Đơn mượn chờ xác nhận' }).click()
    await expect(page).toHaveURL(/\/librarian\/borrow-orders$/)
    await expect(page.getByRole('heading', { name: 'Đơn mượn chờ xác nhận' })).toBeVisible()
    const confirmRow = row(page, CONFIRM_BOOK)
    await expect(confirmRow).toContainText('test.queue@example.com')
    await expect(confirmRow).toContainText('21 ngày')
    await expect(row(page, OUT_BOOK)).toContainText('Hết sách')
  })

  test('xác nhận: đơn biến khỏi danh sách, kho giảm 1', async ({ page }) => {
    await login(page, 'test.librarian@example.com')
    await expect(await availableOf(page, CONFIRM_BOOK)).toHaveText('1')

    await page.goto('/librarian/borrow-orders')
    await confirmButton(page, CONFIRM_BOOK).click()
    await expect(page.getByRole('status')).toContainText(`Đã xác nhận đơn mượn "${CONFIRM_BOOK}" của ${READER}, hạn trả`)
    await expect(row(page, CONFIRM_BOOK)).toHaveCount(0)

    // Hết sách thì trang chi tiết hiện kèm nhãn "Hết sách" (2.2.4).
    await expect(await availableOf(page, CONFIRM_BOOK)).toHaveText(/^0\s*Hết sách$/)
    // Lịch sử mượn trên trang chi tiết (nhân viên) hiện đơn Đang mượn.
    await expect(page.getByRole('cell', { name: READER })).toBeVisible()
  })

  test('edge 2: sách đã hết → báo lỗi, gợi ý từ chối "Hết sách", từ chối thành công', async ({ page }) => {
    await login(page, 'test.librarian@example.com')
    await page.goto('/librarian/borrow-orders')
    await confirmButton(page, OUT_BOOK).click()
    await expect(page.getByRole('alert')).toContainText('Sách đã hết, chỉ có thể từ chối đơn này')
    const form = page.getByRole('form', { name: `Từ chối đơn ${OUT_BOOK}` })
    await expect(form.getByLabel('Lý do từ chối (bắt buộc)')).toHaveValue('Hết sách')
    await form.getByRole('button', { name: 'Xác nhận từ chối' }).click()
    await expect(page.getByRole('status')).toHaveText(`Đã từ chối đơn mượn "${OUT_BOOK}" của ${READER}`)
    await expect(row(page, OUT_BOOK)).toHaveCount(0)
  })

  test('từ chối: lý do bắt buộc (edge 3), lưu lý do, kho không đổi', async ({ page }) => {
    await login(page, 'test.librarian@example.com')
    await page.goto('/librarian/borrow-orders')
    await rejectButton(page, REJECT_BOOK).click()
    const form = page.getByRole('form', { name: `Từ chối đơn ${REJECT_BOOK}` })
    const reason = form.getByLabel('Lý do từ chối (bắt buộc)')
    await expect(reason).toHaveValue('')
    await reason.fill('    ')
    await form.getByRole('button', { name: 'Xác nhận từ chối' }).click()
    await expect(form.getByText('Lý do từ chối là bắt buộc')).toBeVisible()

    // Hủy đóng form, đơn vẫn còn.
    await form.getByRole('button', { name: 'Hủy' }).click()
    await expect(form).toHaveCount(0)
    await expect(row(page, REJECT_BOOK)).toBeVisible()

    await rejectButton(page, REJECT_BOOK).click()
    await page.getByLabel('Lý do từ chối (bắt buộc)').fill('Sách đang được bảo trì')
    await page.getByRole('button', { name: 'Xác nhận từ chối' }).click()
    await expect(page.getByRole('status')).toHaveText(`Đã từ chối đơn mượn "${REJECT_BOOK}" của ${READER}`)
    await expect(row(page, REJECT_BOOK)).toHaveCount(0)

    await expect(await availableOf(page, REJECT_BOOK)).toHaveText('1')
  })

  test('edge 1: hai nhân viên cùng xử lý một đơn → bên sau được báo và danh sách tải lại', async ({ browser }) => {
    // Đơn của test.fined (DM 07): dùng nút Từ chối nên không phụ thuộc điều kiện phạt.
    const book = 'Test Sách DM 07 Phạt'
    const reader = 'Test Fined'
    const [librarian, admin] = await Promise.all([browser.newPage(), browser.newPage()])
    await login(librarian, 'test.librarian@example.com')
    await login(admin, 'test.admin@example.com')
    await librarian.goto('/librarian/borrow-orders')
    await admin.goto('/admin/borrow-orders')
    const rejectFrom = (page) => page.getByRole('button', { name: `Từ chối đơn ${book} của ${reader}` })
    await expect(rejectFrom(admin)).toBeVisible()

    await rejectFrom(librarian).click()
    await librarian.getByLabel('Lý do từ chối (bắt buộc)').fill('Còn phiếu phạt chưa thanh toán')
    await librarian.getByRole('button', { name: 'Xác nhận từ chối' }).click()
    await expect(librarian.getByRole('status')).toContainText('Đã từ chối đơn mượn')

    // Admin vẫn thấy đơn cũ trên màn hình, bấm Xác nhận.
    await admin.getByRole('button', { name: `Xác nhận đơn ${book} của ${reader}` }).click()
    await expect(admin.getByRole('alert')).toHaveText('Đơn đã được xử lý hoặc đã bị hủy, vui lòng tải lại danh sách')
    await expect(admin.getByRole('row', { name: `Đơn ${book} của ${reader}` })).toHaveCount(0)
  })
})
