import { daysLeftLabel, groupOrders, nextHistoryParams, readHistoryParams } from './borrowHistory'

describe('borrowHistory (2.3.3)', () => {
  it('readHistoryParams: giá trị lạ → mặc định', () => {
    expect(readHistoryParams(new URLSearchParams(''))).toEqual({ status: 'all', page: 1 })
    expect(readHistoryParams(new URLSearchParams('status=overdue&page=3'))).toEqual({ status: 'overdue', page: 3 })
    expect(readHistoryParams(new URLSearchParams('status=cancelled&page=-2'))).toEqual({ status: 'all', page: 1 })
  })

  it('nextHistoryParams: bỏ giá trị mặc định khỏi URL', () => {
    expect(nextHistoryParams({ status: 'all', page: 1 })).toEqual({})
    expect(nextHistoryParams({ status: 'returned', page: 2 })).toEqual({ status: 'returned', page: '2' })
  })

  it.each([
    [5, '5 ngày'],
    [0, 'Hết hạn hôm nay'],
    [-3, 'Quá 3 ngày'],
    [null, '—'],
  ])('daysLeftLabel(%j) = %s', (days, label) => {
    expect(daysLeftLabel(days)).toBe(label)
  })

  it('groupOrders: Quá hạn chung nhóm Đang mượn, bỏ nhóm rỗng, giữ thứ tự', () => {
    const orders = [
      { id: 1, status: 'returned' },
      { id: 2, status: 'overdue' },
      { id: 3, status: 'borrowing' },
      { id: 4, status: 'pending' },
    ]
    expect(groupOrders(orders).map((g) => [g.key, g.orders.map((o) => o.id)])).toEqual([
      ['pending', [4]],
      ['borrowing', [2, 3]],
      ['returned', [1]],
    ])
  })
})
