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

// 2.3.2: lý do không xác nhận được; mọi trường hợp vẫn cho từ chối.
const CONFIRM_BLOCKED = {
  out_of_stock: 'Sách đã hết, chỉ có thể từ chối đơn này (gợi ý lý do: Hết sách)',
  reader_inactive: 'Tài khoản độc giả không còn hoạt động, chỉ có thể từ chối đơn này',
  limit_reached: `Độc giả đã vượt giới hạn mượn tối đa ${MAX_ACTIVE_BORROWS} cuốn, chỉ có thể từ chối đơn này`,
  unpaid_fine: 'Độc giả còn phiếu phạt chưa thanh toán, chỉ có thể từ chối đơn này',
  overdue: 'Độc giả đang có sách quá hạn, chỉ có thể từ chối đơn này',
};

// Thứ tự theo flow 2.3.2: kho (edge 2) → độc giả còn đủ điều kiện (edge 6, giới hạn, phạt).
// Quá hạn chặn như khi gửi đơn (README điểm 8). activeCount đã gồm chính đơn đang duyệt nên chỉ chặn khi > 5.
function evaluateConfirmEligibility({ availableQuantity, readerStatus, activeCount, unpaidFineCount, overdueCount }) {
  if (availableQuantity <= 0) return 'out_of_stock';
  if (readerStatus !== 'active') return 'reader_inactive';
  if (activeCount > MAX_ACTIVE_BORROWS) return 'limit_reached';
  if (unpaidFineCount > 0) return 'unpaid_fine';
  if (overdueCount > 0) return 'overdue';
  return null;
}

// 'YYYY-MM-DD' + n ngày (lịch, không phụ thuộc múi giờ).
function addDays(dateString, days) {
  const date = new Date(`${dateString}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

// Số ngày từ `from` tới `to` (cùng dạng 'YYYY-MM-DD'); âm khi `to` đã qua.
function diffDays(to, from) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
}

// 2.3.3: trạng thái hiển thị; `Quá hạn` suy ra khi đang mượn và ngày VN hiện tại > hạn trả.
// dueDate/today dạng 'YYYY-MM-DD'.
function displayStatus({ status, dueDate }, today) {
  if (status === 'borrowing' && dueDate && today > dueDate) return 'overdue';
  return status;
}

const EXTENSION_DAYS = 7;
const MAX_EXTENSIONS = 1;

const EXTEND_BLOCKED = {
  not_borrowing: 'Chỉ gia hạn được đơn đang mượn',
  overdue: 'Đơn đã quá hạn, không thể gia hạn',
  already_extended: `Mỗi đơn chỉ được gia hạn ${MAX_EXTENSIONS} lần`,
  pending_return: 'Đang có yêu cầu trả sách, không thể gia hạn',
};

// Thứ tự theo flow gia hạn 2.3.3. Hạn trả là ngày cuối được trả nên đúng ngày hạn vẫn gia hạn được.
// Phiếu phạt chưa thanh toán không chặn gia hạn (edge 5).
function evaluateExtension({ status, dueDate, extensionCount, hasPendingReturn }, today) {
  if (status !== 'borrowing') return 'not_borrowing';
  if (today > dueDate) return 'overdue';
  if (extensionCount >= MAX_EXTENSIONS) return 'already_extended';
  if (hasPendingReturn) return 'pending_return';
  return null;
}

module.exports = {
  MAX_ACTIVE_BORROWS, ACTIVE_STATUSES, INELIGIBLE, evaluateBorrowEligibility,
  CONFIRM_BLOCKED, evaluateConfirmEligibility, addDays, diffDays, displayStatus,
  EXTENSION_DAYS, MAX_EXTENSIONS, EXTEND_BLOCKED, evaluateExtension,
};
