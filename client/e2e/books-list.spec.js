import { test, expect } from '@playwright/test'

// 2.2.3 Xem Danh Sách Sách. Cần server chạy và seed trước mỗi lần chạy
// (thể loại "Test Danh Sách" có 12 sách "Test Sách DS 01..12"):
//   cd server && node scripts/seed-test-users.js
const CATEGORY = 'Test Danh Sách'

const cards = (page) => page.getByRole('list', { name: 'Kết quả sách' }).getByRole('article')
const titles = (page) => cards(page).getByRole('heading').allTextContents()

async function openCategory(page) {
  await page.goto('/books')
  await page.getByLabel('Thể loại').selectOption({ label: CATEGORY })
  await expect(page.getByText('Tìm thấy 12 sách')).toBeVisible()
}

test.describe('2.2.3 Xem Danh Sách Sách', () => {
  test('khách không đăng nhập: trang chủ là danh sách sách, đủ thông tin, có nhãn Hết sách', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveURL('/books')
    await expect(page.getByRole('heading', { name: 'Danh sách sách' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Đăng nhập' })).toBeVisible()

    await openCategory(page)
    await expect(page).toHaveURL(/categoryId=\d+/)
    await expect(cards(page)).toHaveCount(10)

    const first = page.getByRole('article', { name: 'Test Sách DS 01' })
    await expect(first).toContainText('Tác giả: Tác Giả DS')
    await expect(first).toContainText('Năm XB: 2001')
    await expect(first).toContainText(`Thể loại: ${CATEGORY}`)
    await expect(first).toContainText('Có sẵn: 2')
    await expect(first).toContainText('Đang mượn: 0')
    await expect(first.getByRole('img', { name: 'Ảnh bìa mặc định' })).toBeVisible()

    const soldOut = page.getByRole('article', { name: 'Test Sách DS 07' })
    await expect(soldOut.getByText('Hết sách')).toBeVisible()
    await expect(soldOut).toContainText('Có sẵn: 0')
    await expect(page.getByRole('article', { name: 'Test Sách DS 01' }).getByText('Hết sách')).toHaveCount(0)
  })

  test('phân trang, sắp xếp, nút Back và trang vượt quá', async ({ page }) => {
    await openCategory(page)
    const nav = page.getByRole('navigation', { name: 'Phân trang' })
    await expect(nav.getByText('Trang 1 / 2')).toBeVisible()
    await expect(nav.getByRole('button', { name: 'Trang trước' })).toBeDisabled()

    await nav.getByRole('button', { name: 'Trang sau' }).click()
    await expect(page).toHaveURL(/page=2/)
    await expect(cards(page)).toHaveCount(2)
    expect(await titles(page)).toEqual(['Test Sách DS 11', 'Test Sách DS 12'])

    // Back quay lại trang 1 (trạng thái nằm trên URL).
    await page.goBack()
    await expect(nav.getByText('Trang 1 / 2')).toBeVisible()
    await expect(page.getByRole('article', { name: 'Test Sách DS 01' })).toBeVisible()

    // Đổi sắp xếp ở trang 2 → về trang 1.
    await nav.getByRole('button', { name: 'Trang sau' }).click()
    await expect(page).toHaveURL(/page=2/)
    await page.getByLabel('Sắp xếp').selectOption({ label: 'Năm xuất bản (mới nhất)' })
    await expect(page).not.toHaveURL(/page=/)
    await expect(cards(page).first()).toHaveAccessibleName('Test Sách DS 12')

    await page.getByLabel('Sắp xếp').selectOption({ label: 'Lượt mượn (phổ biến nhất)' })
    await expect(cards(page).first()).toHaveAccessibleName('Test Sách DS 03')
    expect((await titles(page)).slice(0, 3)).toEqual(['Test Sách DS 03', 'Test Sách DS 12', 'Test Sách DS 11'])

    // Link chia sẻ với trang quá lớn → chuyển về trang cuối.
    const url = new URL(page.url())
    url.searchParams.delete('sort')
    url.searchParams.set('page', '99')
    await page.goto(url.toString())
    await expect(page).toHaveURL(/page=2/)
    await expect(nav.getByText('Trang 2 / 2')).toBeVisible()
  })

  test('tìm kiếm không dấu, ký tự đặc biệt, không có kết quả và xóa bộ lọc', async ({ page }) => {
    await page.goto('/books')
    const search = page.getByRole('searchbox')

    await search.fill('mat biec')
    await search.press('Enter')
    await expect(page.getByText('Tìm thấy 1 sách')).toBeVisible()
    await expect(page.getByRole('article', { name: 'Test Sách DS 05 Mắt Biếc' })).toContainText('Nguyễn Nhật Ánh')

    await search.fill('NGUYEN NHAT ANH')
    await page.getByRole('button', { name: 'Tìm' }).click()
    await expect(page.getByRole('article', { name: 'Test Sách DS 05 Mắt Biếc' })).toBeVisible()

    await page.getByLabel('Thể loại').selectOption({ label: CATEGORY })
    await search.fill('%')
    await search.press('Enter')
    await expect(page.getByText('Tìm thấy 1 sách')).toBeVisible()
    await expect(page.getByRole('article', { name: 'Test Sách DS 09 100% Sạch' })).toBeVisible()

    await search.fill('khongtontaizzz')
    await search.press('Enter')
    const empty = page.getByRole('status')
    await expect(empty).toContainText('Không tìm thấy sách phù hợp')
    await empty.getByRole('button', { name: 'Xóa bộ lọc' }).click()
    await expect(page).toHaveURL('/books')
    await expect(search).toHaveValue('')
    await expect(page.getByLabel('Thể loại')).toHaveValue('')
    await expect(cards(page).first()).toBeVisible()
  })

  test('thể loại không tồn tại trên URL → báo lỗi, xóa bộ lọc để xem lại', async ({ page }) => {
    await page.goto('/books?categoryId=999999')
    const alert = page.getByRole('alert')
    await expect(alert).toContainText('Thể loại không tồn tại')
    await alert.getByRole('button', { name: 'Xóa bộ lọc' }).click()
    await expect(page).toHaveURL('/books')
    await expect(cards(page).first()).toBeVisible()
  })

  test('độc giả đã đăng nhập vào từ dashboard và quay lại được', async ({ page }) => {
    await page.goto('/login')
    await page.getByLabel('Email').fill('test.reader@example.com')
    await page.getByLabel('Mật khẩu').fill('Test@1234')
    await page.getByRole('button', { name: 'Đăng nhập' }).click()
    await expect(page).toHaveURL('/reader')
    await page.getByRole('link', { name: 'Danh sách sách' }).click()
    await expect(page).toHaveURL('/books')
    await expect(cards(page).first()).toBeVisible()
    await page.getByRole('link', { name: 'Về dashboard' }).click()
    await expect(page).toHaveURL('/reader')
  })
})
