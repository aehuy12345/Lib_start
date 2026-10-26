import {
  csvFileName, nextReportParams, periodLabel, periodRange, rangeError, readReportParams, reportQuery,
} from './reportRules'

describe('periodRange', () => {
  it('Ngày, Tháng, Quý, Năm chứa mốc', () => {
    expect(periodRange('day', '2026-10-26')).toEqual({ from: '2026-10-26', to: '2026-10-26' })
    expect(periodRange('month', '2024-02-10')).toEqual({ from: '2024-02-01', to: '2024-02-29' })
    expect(periodRange('quarter', '2026-11-15')).toEqual({ from: '2026-10-01', to: '2026-12-31' })
    expect(periodRange('quarter', '2026-01-01')).toEqual({ from: '2026-01-01', to: '2026-03-31' })
    expect(periodRange('year', '2026-10-26')).toEqual({ from: '2026-01-01', to: '2026-12-31' })
  })

  it('edge 9: tuần bắt đầu thứ Hai (kể cả khi mốc là Chủ nhật)', () => {
    // 26/10/2026 là thứ Hai, 01/11/2026 là Chủ nhật.
    expect(periodRange('week', '2026-10-26')).toEqual({ from: '2026-10-26', to: '2026-11-01' })
    expect(periodRange('week', '2026-11-01')).toEqual({ from: '2026-10-26', to: '2026-11-01' })
    expect(periodRange('week', '2026-10-29')).toEqual({ from: '2026-10-26', to: '2026-11-01' })
  })
})

describe('rangeError', () => {
  it('edge 1: từ ngày lớn hơn đến ngày', () => {
    expect(rangeError('2026-10-02', '2026-10-01')).toMatch(/từ ngày phải nhỏ hơn hoặc bằng đến ngày/)
    expect(rangeError('2026-10-01', '2026-10-01')).toBe('')
  })

  it('edge 2: tối đa 366 ngày; thiếu ngày', () => {
    expect(rangeError('2024-01-01', '2024-12-31')).toBe('')
    expect(rangeError('2025-01-01', '2026-01-02')).toBe('Khoảng thời gian tối đa 366 ngày')
    expect(rangeError('', '2026-01-02')).toBe('Vui lòng chọn đủ từ ngày và đến ngày')
  })
})

describe('readReportParams / nextReportParams', () => {
  const read = (qs) => readReportParams(new URLSearchParams(qs), '2026-10-26')

  it('mặc định: báo cáo Sách, tháng hiện tại', () => {
    expect(read('')).toEqual({ type: 'books', period: 'month', from: '2026-10-01', to: '2026-10-31', groupBy: '', page: 1 })
    expect(read('type=x&period=y&groupBy=week&page=-1').type).toBe('books')
  })

  it('kỳ có sẵn: tính lại khoảng từ mốc from', () => {
    expect(read('type=fines&period=quarter&from=2020-02-15&to=2099-01-01'))
      .toMatchObject({ type: 'fines', period: 'quarter', from: '2020-01-01', to: '2020-03-31' })
  })

  it('tùy chọn: giữ nguyên from/to, kể cả khi sai (để báo lỗi)', () => {
    expect(read('period=custom&from=2020-03-01&to=2020-01-01')).toMatchObject({ from: '2020-03-01', to: '2020-01-01' })
  })

  it('groupBy chỉ cho báo cáo Mượn trả; trang 1 không ghi lên URL', () => {
    const params = { type: 'books', period: 'month', from: '2026-10-01', to: '2026-10-31', groupBy: 'month', page: 1 }
    expect(nextReportParams(params)).toEqual({ type: 'books', period: 'month', from: '2026-10-01', to: '2026-10-31' })
    expect(nextReportParams({ ...params, type: 'borrows', page: 3 })).toMatchObject({ groupBy: 'month', page: '3' })
    expect(reportQuery({ ...params, type: 'borrows' })).toEqual({ from: '2026-10-01', to: '2026-10-31', groupBy: 'month' })
    expect(reportQuery({ ...params, page: 2 })).toEqual({ from: '2026-10-01', to: '2026-10-31', page: 2 })
  })
})

it('tên file CSV và nhãn mốc thời gian', () => {
  expect(csvFileName('damaged-lost', '2020-01-01', '2020-03-31')).toBe('bao-cao-sach-mat-hu_2020-01-01_2020-03-31.csv')
  expect(periodLabel('2020-01-05', 'day')).toBe('05/01/2020')
  expect(periodLabel('2020-04-01', 'month')).toBe('04/2020')
  expect(periodLabel('2020-07-01', 'quarter')).toBe('Quý 3/2020')
})
