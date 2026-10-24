// Điều kiện mượn sách của độc giả (2.3.1). 2.2.4 dùng để khóa nút Mượn; khi tạo đơn (2.3.1)
// server kiểm tra lại trong transaction, kết quả ở đây chỉ là gợi ý cho UI (2.2.4 edge 3).
const MAX_ACTIVE_BORROWS = 5;
const ACTIVE_STATUSES = ['pending', 'borrowing'];

const INELIGIBLE = {
  out_of_stock: 'Hết sách',
  limit_reached: `Đã đạt giới hạn mượn tối đa ${MAX_ACTIVE_BORROWS} cuốn`,
  unpaid_fine: 'Cần thanh toán phiếu phạt trước khi mượn',
  overdue: 'Bạn đang có sách quá hạn, cần trả sách trước khi mượn',
  already_requested: 'Bạn đang mượn hoặc đã gửi yêu cầu mượn sách này',
};

// Thứ tự kiểm tra theo flow 2.3.1; chặn khi quá hạn theo README điểm 8.
// activeCount: đơn chờ xác nhận + đang mượn (giả định 2.3.1). unpaidFineCount: phiếu chưa `paid` (2.3.1 edge 4).
function evaluateBorrowEligibility({ availableQuantity, activeCount, unpaidFineCount, overdueCount, hasActiveOrderForBook }) {
  let reason = null;
  if (availableQuantity <= 0) reason = 'out_of_stock';
  else if (activeCount >= MAX_ACTIVE_BORROWS) reason = 'limit_reached';
  else if (unpaidFineCount > 0) reason = 'unpaid_fine';
  else if (overdueCount > 0) reason = 'overdue';
  else if (hasActiveOrderForBook) reason = 'already_requested';
  return reason
    ? { canBorrow: false, reason, message: INELIGIBLE[reason] }
    : { canBorrow: true, reason: null, message: null };
}

module.exports = { MAX_ACTIVE_BORROWS, ACTIVE_STATUSES, INELIGIBLE, evaluateBorrowEligibility };
