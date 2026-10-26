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

module.exports = { RETURN_BLOCKED, evaluateReturnRequest };
