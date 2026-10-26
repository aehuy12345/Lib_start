import {
  CONDITION_REQUIRED, NOTE_REQUIRED, NOTE_TOO_LONG, TIER_REQUIRED, buildReturnPayload, formatAmount,
  lateTierRequired, requiredFineTypes, validateReturnForm,
} from './returnRules'

const values = (v) => ({ condition: '', fineTierId: '', lateFineTierId: '', note: '', ...v })

describe('returnRules (2.4.2)', () => {
  it.each([
    ['normal', 0, []],
    ['normal', 2, ['late']],
    ['damaged', 0, ['damaged']],
    ['lost', 3, ['late', 'lost']],
  ])('%s, muộn %i ngày → %j', (condition, lateDays, types) => {
    expect(requiredFineTypes(condition, lateDays)).toEqual(types)
  })

  it('bắt buộc chọn tình trạng', () => {
    expect(validateReturnForm(values(), 0)).toEqual({ condition: CONDITION_REQUIRED })
  })

  it('bình thường, đúng hạn → hợp lệ, ghi chú tùy chọn', () => {
    expect(validateReturnForm(values({ condition: 'normal' }), 0)).toEqual({})
  })

  it('edge 2: hư hỏng/mất thiếu mức phạt và ghi chú (chỉ khoảng trắng coi là rỗng)', () => {
    expect(validateReturnForm(values({ condition: 'damaged', note: '   ' }), 0))
      .toEqual({ fineTierId: TIER_REQUIRED, note: NOTE_REQUIRED })
  })

  it('edge 3: ghi chú quá 500 ký tự', () => {
    expect(validateReturnForm(values({ condition: 'lost', fineTierId: '3', note: 'a'.repeat(501) }), 0))
      .toEqual({ note: NOTE_TOO_LONG })
    expect(validateReturnForm(values({ condition: 'lost', fineTierId: '3', note: 'a'.repeat(500) }), 0)).toEqual({})
  })

  it('trả muộn thì bắt buộc mức phạt Trả muộn với mọi tình trạng', () => {
    expect(validateReturnForm(values({ condition: 'normal' }), 4)).toEqual({ lateFineTierId: lateTierRequired(4) })
    expect(validateReturnForm(values({ condition: 'lost', fineTierId: '3', note: 'x' }), 1))
      .toEqual({ lateFineTierId: lateTierRequired(1) })
  })

  it('payload chỉ gửi mức phạt cần dùng, ghi chú đã trim', () => {
    expect(buildReturnPayload(values({ condition: 'normal', fineTierId: '2', note: '  ' }), 0)).toEqual({ condition: 'normal' })
    expect(buildReturnPayload(values({ condition: 'damaged', fineTierId: '2', lateFineTierId: '1', note: ' Rách ' }), 3))
      .toEqual({ condition: 'damaged', fineTierId: 2, lateFineTierId: 1, note: 'Rách' })
  })

  it('định dạng số tiền VND', () => {
    expect(formatAmount(150000)).toMatch(/^150.000 đ$/)
  })
})
