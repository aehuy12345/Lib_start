import { test, expect } from '@playwright/test'

// 2.4.2 Xác Nhận Trả Sách (nhân viên), gồm từ chối yêu cầu và trả tại quầy. Cần server chạy và seed
// trước mỗi lần chạy (thể loại "Test Xác Nhận Trả": test.handover có XT 01..05 kèm yêu cầu trả chờ,
// XT 02 quá hạn 4 ngày, XT 04 quá hạn 2 ngày, XT 06 đang mượn chưa có yêu cầu):
//   cd server && node scripts/seed-test-users.js
const PASSWORD = 'Test@1234'
const READER = 'Test Handover'
const BOOK = {
  normal: 'Test Sách XT 01 Bình Thường',
  late: 'Test Sách XT 02 Trả Muộn',
  damaged: 'Test Sách XT 03 Hư Hỏng',
  lost: 'Test Sách XT 04 Mất',
  reject: 'Test Sách XT 05 Từ Chối',
  counter: 'Test Sách XT 06 Tại Quầy',
}
const LATE_TIER = 'Test Trả Muộn (10.000 đ)'

async function login(page, email) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Mật khẩu').fill(PASSWORD)
  await page.getByRole('button', { name: 'Đăng nhập' }).click()
  await expect(page).not.toHaveURL(/\/login/)
}

const row = (page, book) => page.getByRole('row', { name: `Yêu cầu trả ${book} của ${READER}` })

async function openConfirm(page, book) {
  await page.getByRole('button', { name: `Xác nhận trả ${book} của ${READER}` }).click()
  return page.getByRole('form', { name: `Xác nhận trả ${book}` })
}

async function stockOf(page, title) {
  await page.goto('/books')
  await page.getByLabel('Tìm theo tên sách hoặc tác giả').fill(title)
  await page.getByRole('button', { name: 'Tìm' }).click()
  await page.getByRole('article', { name: title }).getByRole('link', { name: title }).click()
  return page.locator('dt', { hasText: 'Có sẵn' }).locator('+ dd')
}

test.describe.serial('2.4.2 Xác Nhận Trả Sách', () => {
  test('độc giả không vào được trang quản lý trả sách', async ({ page }) => {
    await login(page, 'test.handover@example.com')
    await page.goto('/librarian/return-requests')
    await expect(page).toHaveURL(/\/reader$/)
  })

  test('nhân viên mở tab Chờ xác nhận trả từ dashboard, thấy số ngày quá hạn', async ({ page }) => {
    await login(page, 'test.librarian@example.com')
    await page.getByRole('link', { name: 'Quản lý trả sách' }).click()
    await expect(page).toHaveURL(/\/librarian\/return-requests$/)
    await expect(page.getByRole('tab', { name: 'Chờ xác nhận trả' })).toHaveAttribute('aria-selected', 'true')
    await expect(row(page, BOOK.normal)).toContainText('test.handover@example.com')
    await expect(row(page, BOOK.normal)).not.toContainText('Quá hạn')
    await expect(row(page, BOOK.late)).toContainText('Quá hạn 4 ngày')
  })

  test('bình thường, đúng hạn: xác nhận không cần mức phạt, kho tăng 1', async ({ page }) => {
    await login(page, 'test.librarian@example.com')
    await expect(await stockOf(page, BOOK.normal)).toHaveText('1')
    await page.goto('/librarian/return-requests')
    const form = await openConfirm(page, BOOK.normal)
    await form.getByRole('button', { name: 'Xác nhận trả' }).click()
    await expect(form.getByText('Vui lòng chọn tình trạng sách')).toBeVisible()
    await form.getByLabel('Bình thường').check()
    await expect(form.getByLabel(/Mức phạt/)).toHaveCount(0)
    await form.getByRole('button', { name: 'Xác nhận trả' }).click()
    await expect(page.getByRole('status')).toHaveText(`Đã xác nhận trả sách: "${BOOK.normal}" của ${READER}`)
    await expect(row(page, BOOK.normal)).toHaveCount(0)
    await expect(await stockOf(page, BOOK.normal)).toHaveText('2')
  })

  test('trả muộn: bắt buộc mức phạt Trả muộn, lập 1 phiếu', async ({ page }) => {
    await login(page, 'test.librarian@example.com')
    await page.goto('/librarian/return-requests')
    const form = await openConfirm(page, BOOK.late)
    await expect(form).toContainText('Trả muộn 4 ngày: cần lập phiếu phạt Trả muộn.')
    await form.getByLabel('Bình thường').check()
    await form.getByRole('button', { name: 'Xác nhận trả' }).click()
    await expect(form.getByText('Sách trả muộn 4 ngày, vui lòng chọn mức phạt Trả muộn')).toBeVisible()
    await form.getByLabel('Mức phạt Trả muộn (bắt buộc)').selectOption({ label: LATE_TIER })
    await form.getByRole('button', { name: 'Xác nhận trả' }).click()
    await expect(page.getByRole('status')).toHaveText(`Đã xác nhận trả sách, đã lập 1 phiếu phạt: "${BOOK.late}" của ${READER}`)
    await expect(row(page, BOOK.late)).toHaveCount(0)
  })

  test('hư hỏng: thiếu mức phạt và ghi chú bị chặn; đủ thì lập phiếu, sách không về kho', async ({ page }) => {
    await login(page, 'test.librarian@example.com')
    await page.goto('/librarian/return-requests')
    const form = await openConfirm(page, BOOK.damaged)
    await form.getByLabel('Hư hỏng').check()
    await form.getByLabel(/Ghi chú/).fill('   ')
    await form.getByRole('button', { name: 'Xác nhận trả' }).click()
    await expect(form.getByText('Vui lòng chọn mức phạt')).toBeVisible()
    await expect(form.getByText('Ghi chú là bắt buộc khi sách hư hỏng hoặc mất')).toBeVisible()
    // Mức đã ẩn ở 2.5.1 không có trong danh sách chọn.
    await expect(form.getByRole('option', { name: /Test Hư Hỏng Ẩn/ })).toHaveCount(0)
    await form.getByLabel('Mức phạt Hư hỏng (bắt buộc)').selectOption({ label: 'Test Hư Hỏng (50.000 đ)' })
    await form.getByLabel(/Ghi chú/).fill('Rách bìa, ướt trang 10')
    await form.getByRole('button', { name: 'Xác nhận trả' }).click()
    await expect(page.getByRole('status')).toHaveText(`Đã xác nhận trả sách, đã lập 1 phiếu phạt: "${BOOK.damaged}" của ${READER}`)
    await expect(await stockOf(page, BOOK.damaged)).toHaveText('1')
  })

  test('mất + trả muộn: lập 2 phiếu', async ({ page }) => {
    await login(page, 'test.librarian@example.com')
    await page.goto('/librarian/return-requests')
    const form = await openConfirm(page, BOOK.lost)
    await form.getByLabel('Mất').check()
    await form.getByLabel('Mức phạt Mất (bắt buộc)').selectOption({ label: 'Test Mất Sách (150.000 đ)' })
    await form.getByLabel('Mức phạt Trả muộn (bắt buộc)').selectOption({ label: LATE_TIER })
    await form.getByLabel(/Ghi chú/).fill('Độc giả báo mất sách')
    await form.getByRole('button', { name: 'Xác nhận trả' }).click()
    await expect(page.getByRole('status')).toHaveText(`Đã xác nhận trả sách, đã lập 2 phiếu phạt: "${BOOK.lost}" của ${READER}`)
  })

  test('từ chối yêu cầu: lý do bắt buộc, đơn vẫn đang mượn', async ({ page }) => {
    await login(page, 'test.librarian@example.com')
    await page.goto('/librarian/return-requests')
    await page.getByRole('button', { name: `Từ chối yêu cầu trả ${BOOK.reject} của ${READER}` }).click()
    const form = page.getByRole('form', { name: `Từ chối yêu cầu trả ${BOOK.reject}` })
    await form.getByRole('button', { name: 'Xác nhận từ chối' }).click()
    await expect(form.getByText('Lý do từ chối là bắt buộc')).toBeVisible()
    await form.getByLabel('Lý do từ chối (bắt buộc)').fill('Độc giả chưa mang sách đến')
    await form.getByRole('button', { name: 'Xác nhận từ chối' }).click()
    await expect(page.getByRole('status')).toHaveText(`Đã từ chối yêu cầu trả sách: "${BOOK.reject}" của ${READER}`)
    await expect(row(page, BOOK.reject)).toHaveCount(0)
  })

  test('trả tại quầy: tìm đơn đang mượn và nhận trả', async ({ page }) => {
    await login(page, 'test.librarian@example.com')
    await page.goto('/librarian/return-requests')
    await page.getByRole('tab', { name: 'Trả tại quầy' }).click()
    await expect(page).toHaveURL(/tab=counter/)
    await page.getByRole('searchbox', { name: 'Tìm đơn đang mượn' }).fill('test.handover')
    await page.getByRole('button', { name: 'Tìm' }).click()
    const counterRow = page.getByRole('row', { name: `Đơn ${BOOK.counter} của ${READER}` })
    await expect(counterRow).toBeVisible()
    // XT 05 bị từ chối yêu cầu nên cũng nhận trả tại quầy được; đơn đã trả không còn.
    await expect(page.getByRole('row', { name: `Đơn ${BOOK.reject} của ${READER}` })).toBeVisible()
    await expect(page.getByRole('row', { name: `Đơn ${BOOK.normal} của ${READER}` })).toHaveCount(0)
    await page.getByRole('button', { name: `Nhận trả ${BOOK.counter} của ${READER}` }).click()
    const form = page.getByRole('form', { name: `Xác nhận trả ${BOOK.counter}` })
    await form.getByLabel('Bình thường').check()
    await form.getByRole('button', { name: 'Xác nhận trả' }).click()
    await expect(page.getByRole('status')).toHaveText(`Đã xác nhận trả sách: "${BOOK.counter}" của ${READER}`)
    await expect(counterRow).toHaveCount(0)
  })

  test('độc giả thấy các đơn đã trả và XT 05 vẫn đang mượn', async ({ page }) => {
    await login(page, 'test.handover@example.com')
    await page.goto('/reader/borrow-history?status=returned')
    for (const book of [BOOK.normal, BOOK.late, BOOK.damaged, BOOK.lost, BOOK.counter]) {
      await expect(page.getByRole('row', { name: `Đơn ${book}` })).toBeVisible()
    }
    await page.goto('/reader/borrow-history?status=borrowing')
    await expect(page.getByRole('row', { name: `Đơn ${BOOK.reject}` }).getByRole('button', { name: /^Xin trả sách/ })).toBeVisible()
  })
})
