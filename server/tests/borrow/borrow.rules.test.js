import { evaluateBorrowEligibility, INELIGIBLE, MAX_ACTIVE_BORROWS } from '../../src/modules/borrow/borrow.rules';

const OK = { availableQuantity: 2, activeCount: 0, unpaidFineCount: 0, overdueCount: 0, hasActiveOrderForBook: false };

describe('evaluateBorrowEligibility (2.2.4 / 2.3.1)', () => {
  it('đủ điều kiện → canBorrow', () => {
    expect(evaluateBorrowEligibility(OK)).toEqual({ canBorrow: true, reason: null, message: null });
  });

  it.each([
    ['out_of_stock', { availableQuantity: 0 }, 'Hết sách'],
    ['limit_reached', { activeCount: MAX_ACTIVE_BORROWS }, 'Đã đạt giới hạn mượn tối đa 5 cuốn'],
    ['unpaid_fine', { unpaidFineCount: 1 }, 'Cần thanh toán phiếu phạt trước khi mượn'],
    ['overdue', { overdueCount: 1 }, INELIGIBLE.overdue],
    ['already_requested', { hasActiveOrderForBook: true }, 'Bạn đang mượn hoặc đã gửi yêu cầu mượn sách này'],
  ])('%s', (reason, patch, message) => {
    expect(evaluateBorrowEligibility({ ...OK, ...patch })).toEqual({ canBorrow: false, reason, message });
  });

  it('4 đơn đang hoạt động vẫn mượn được (giới hạn là 5)', () => {
    expect(evaluateBorrowEligibility({ ...OK, activeCount: 4 }).canBorrow).toBe(true);
  });

  it('nhiều lý do cùng lúc: theo thứ tự flow 2.3.1', () => {
    const all = { availableQuantity: 0, activeCount: 5, unpaidFineCount: 1, overdueCount: 1, hasActiveOrderForBook: true };
    expect(evaluateBorrowEligibility(all).reason).toBe('out_of_stock');
    expect(evaluateBorrowEligibility({ ...all, availableQuantity: 1 }).reason).toBe('limit_reached');
    expect(evaluateBorrowEligibility({ ...all, availableQuantity: 1, activeCount: 1 }).reason).toBe('unpaid_fine');
    expect(evaluateBorrowEligibility({ ...all, availableQuantity: 1, activeCount: 1, unpaidFineCount: 0 }).reason).toBe('overdue');
  });
});
