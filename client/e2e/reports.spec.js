import { readFile } from 'node:fs/promises'
import { test, expect } from '@playwright/test'

// 2.7.2 Báo cáo chi tiết (Librarian + Admin). Cần server chạy và seed trước:
//   cd server && node scripts/seed-test-users.js
// Dữ liệu của test.report nằm trong quý 1/2020, trước mọi dữ liệu khác, nên lọc 01/01/2020 – 31/03/2020
// cho số liệu chính xác (mượn 3/2/2, trả 2/2/3; phạt chưa thu 90.000.000 đ; BC 02 mất 1, hư 1).
const PASSWORD = 'Test@1234'

async function login(page, email) {
  await page.goto('/login')
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Mật khẩu').fill(PASSWORD)
  await page.getByRole('button', { name: 'Đăng nhập' }).click()
  await expect(page).not.toHaveURL(/\/login/)
}

async function customRange(page, from, to) {
  await page.getByLabel('Khoảng thời gian').selectOption('custom')
  await page.getByLabel('Từ ngày').fill(from)
  await page.getByLabel('Đến ngày').fill(to)
  await page.getByRole('button', { name: 'Áp dụng' }).click()
}

async function downloadCsv(page) {
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Xuất CSV' }).click()
  const file = await download
  return { name: file.suggestedFilename(), text: await readFile(await file.path(), 'utf8') }
}

test('nhân viên thư viện xem báo cáo Sách, Mượn trả và xuất CSV', async ({ page }) => {
  await login(page, 'test.librarian@example.com')
  await page.getByRole('link', { name: 'Báo cáo' }).click()
  await expect(page).toHaveURL(/\/librarian\/reports/)
  await expect(page.getByRole('heading', { name: 'Báo cáo chi tiết' })).toBeVisible()

  await customRange(page, '2020-01-01', '2020-03-31')
  await expect(page.getByText('Từ 01/01/2020 đến 31/03/2020')).toBeVisible()
  const rows = page.getByRole('table', { name: 'Báo cáo sách' }).getByRole('row')
  await expect(rows.nth(1)).toContainText('Test Sách BC 01 Mượn Nhiều')
  await expect(rows.nth(1).getByRole('cell').nth(6)).toHaveText('3')
  await expect(rows.nth(2)).toContainText('Test Sách BC 02 Mất Hư')
  await expect(page.getByRole('figure', { name: 'Sách được mượn nhiều nhất trong kỳ' }).locator('svg').first()).toBeVisible()

  // Edge 3–6: file CSV có BOM, đúng bộ lọc, escape dấu nháy/phẩy và chặn công thức.
  const books = await downloadCsv(page)
  expect(books.name).toBe('bao-cao-sach_2020-01-01_2020-03-31.csv')
  expect(books.text.charCodeAt(0)).toBe(0xfeff)
  expect(books.text).toContain('Từ ngày,01/01/2020\r\nĐến ngày,31/03/2020')
  expect(books.text).toContain('"Test Sách BC 03 ""Nháy"", Phẩy",\'=1+1 Tác Giả BC,')

  await page.getByRole('button', { name: 'Mượn trả' }).click()
  const borrows = page.getByRole('table', { name: 'Báo cáo mượn trả' })
  await expect(borrows.getByRole('row', { name: '01/2020 3 2' })).toBeVisible()
  await expect(borrows.getByRole('row', { name: '03/2020 2 3' })).toBeVisible()
  await expect(page.getByLabel('Gom nhóm')).toHaveValue('month')

  await page.getByLabel('Gom nhóm').selectOption('quarter')
  await expect(borrows.getByRole('row', { name: 'Quý 1/2020 7 7' })).toBeVisible()
  const quarter = await downloadCsv(page)
  expect(quarter.name).toBe('bao-cao-muon-tra_2020-01-01_2020-03-31.csv')
  expect(quarter.text).toContain('Quý 1/2020,7,7\r\nTổng,7,7')
})

test('edge 1: từ ngày lớn hơn đến ngày bị chặn; khoảng không có dữ liệu thì không xuất được', async ({ page }) => {
  await login(page, 'test.librarian@example.com')
  await page.goto('/librarian/reports?type=damaged-lost')

  await customRange(page, '2020-05-01', '2020-01-01')
  await expect(page.getByRole('alert')).toContainText('từ ngày phải nhỏ hơn hoặc bằng đến ngày')

  await customRange(page, '2019-01-01', '2019-01-31')
  await expect(page.getByText('Không có dữ liệu trong khoảng này.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Xuất CSV' })).toBeDisabled()

  await customRange(page, '2020-01-01', '2020-03-31')
  const table = page.getByRole('table', { name: 'Sách cần thay thế' })
  await expect(table.getByRole('row').nth(1)).toContainText('Test Sách BC 02 Mất Hư')
  await expect(table.getByRole('row').nth(1)).toContainText('Mất')
  await expect(table.getByRole('row').nth(2)).toContainText('Hư hỏng')
})

test('kỳ Quý tính lại khoảng; admin xem báo cáo Phạt và xuất CSV', async ({ page }) => {
  await login(page, 'test.admin@example.com')
  await page.goto('/admin/reports?type=fines&period=custom&from=2020-02-15&to=2020-02-20')
  await page.getByLabel('Khoảng thời gian').selectOption('quarter')
  await expect(page.getByText('Từ 01/01/2020 đến 31/03/2020')).toBeVisible()

  await expect(page.getByText('Doanh thu phạt đã thu (2 phiếu)')).toBeVisible()
  await expect(page.getByText('60.000 đ', { exact: true })).toBeVisible()
  const debtor = page.getByRole('row', { name: 'Độc giả nợ test.report@example.com' })
  await expect(debtor).toContainText('90.000.000 đ')

  const fines = await downloadCsv(page)
  expect(fines.name).toBe('bao-cao-phat_2020-01-01_2020-03-31.csv')
  expect(fines.text).toContain('Tổng,3,90060000,2,60000,1,90000000')
  expect(fines.text).toContain('Test Báo Cáo Nợ Phạt,test.report@example.com,1,90000000,0,0')
})

test('edge 8: độc giả không vào được trang báo cáo', async ({ page }) => {
  await login(page, 'test.reader@example.com')
  await page.goto('/librarian/reports')
  await expect(page).toHaveURL('/reader')
  await expect(page.getByRole('link', { name: 'Báo cáo' })).toHaveCount(0)
})
