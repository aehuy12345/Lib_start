const { diffDays } = require('../borrow/borrow.rules');

// 2.4.1: điều kiện độc giả gửi yêu cầu trả sách cho đơn của mình.
const RETURN_BLOCKED = {
  not_borrowing: 'Đơn không thể trả: chỉ gửi yêu cầu trả cho sách đang mượn',
  pending_return: 'Đơn này đã có yêu cầu trả sách đang chờ xác nhận',
};

// Thứ tự theo flow 2.4.1. Quá hạn vẫn là `borrowing` nên vẫn gửi được (edge 2);
// đơn đã trả ở quầy, bị từ chối hoặc đang chờ mượn bị chặn (edge 3, 7).
function evaluateReturnRequest({ status, hasPendingReturn }) {
  if (status !== 'borrowing') return 'not_borrowing';
  if (hasPendingReturn) return 'pending_return';
  return null;
}

// 2.4.2: tình trạng sách khi nhân viên nhận lại.
const CONDITIONS = ['normal', 'damaged', 'lost'];
const NOTE_MAX = 500;

// Tác động kho theo ERD (return_requests): hư hỏng không quay lại kho, mất giảm tổng số bản.
// Luôn giữ total = available + borrowed + damaged (CHECK trên books).
const STOCK_CHANGES = {
  normal: { availableQuantity: 1, borrowedQuantity: -1, damagedQuantity: 0, totalQuantity: 0 },
  damaged: { availableQuantity: 0, borrowedQuantity: -1, damagedQuantity: 1, totalQuantity: 0 },
  lost: { availableQuantity: 0, borrowedQuantity: -1, damagedQuantity: 0, totalQuantity: -1 },
};

// Số ngày muộn tính theo ngày VN lúc xác nhận; hạn trả là ngày cuối được trả nên đúng hạn là 0.
function lateDaysOf(dueDate, today) {
  return Math.max(0, diffDays(today, dueDate));
}

// Phiếu phạt cần lập: trả muộn áp dụng cho mọi tình trạng (README điểm 9), cộng hư hỏng hoặc mất.
// Mỗi loại tối đa một phiếu (UNIQUE return_request_id, type).
function requiredFineTypes(condition, lateDays) {
  const types = [];
  if (lateDays > 0) types.push('late');
  if (condition === 'damaged' || condition === 'lost') types.push(condition);
  return types;
}

const TIER_REQUIRED = 'Vui lòng chọn mức phạt';
const TIER_INVALID = 'Mức phạt không hợp lệ hoặc đã ngừng áp dụng, vui lòng chọn lại';
const lateTierRequired = (lateDays) => `Sách trả muộn ${lateDays} ngày, vui lòng chọn mức phạt Trả muộn`;

// Kiểm tra mức phạt nhân viên chọn: đúng loại và còn áp dụng (PRD 2.4.2 Validation Rules).
// tiers: Map id → { type, isActive }. Trả về lỗi theo field, hoặc null khi hợp lệ.
function checkFineTiers({ condition, lateDays, fineTierId, lateFineTierId }, tiers) {
  const errors = {};
  const check = (field, id, type, requiredMessage) => {
    if (!id) errors[field] = requiredMessage;
    else if (tiers.get(id)?.type !== type || !tiers.get(id).isActive) errors[field] = TIER_INVALID;
  };
  for (const type of requiredFineTypes(condition, lateDays)) {
    if (type === 'late') check('lateFineTierId', lateFineTierId, 'late', lateTierRequired(lateDays));
    else check('fineTierId', fineTierId, type, TIER_REQUIRED);
  }
  return Object.keys(errors).length ? errors : null;
}

module.exports = {
  RETURN_BLOCKED, evaluateReturnRequest,
  CONDITIONS, NOTE_MAX, STOCK_CHANGES, lateDaysOf, requiredFineTypes, checkFineTiers,
  TIER_REQUIRED, TIER_INVALID, lateTierRequired,
};
