// 2.5.2: vòng đời phiếu phạt unpaid → pending → paid | rejected; phiếu bị từ chối được gửi lại (edge 2).
const PAYABLE_STATUSES = ['unpaid', 'rejected'];

const PAY_BLOCKED = {
  already_submitted: 'Phiếu phạt đã được gửi, đang chờ nhân viên xác nhận',
  already_paid: 'Phiếu phạt đã được thanh toán',
};

function canPay(status) {
  return PAYABLE_STATUSES.includes(status);
}

// Edge 1: lần bấm thứ hai thấy trạng thái đã đổi nên bị chặn.
function evaluatePayment(status) {
  if (canPay(status)) return null;
  return status === 'paid' ? 'already_paid' : 'already_submitted';
}

// 2.5.3: nhân viên chỉ xác nhận hoặc từ chối phiếu độc giả đã gửi (Chờ xác nhận). Edge 2 [Giả định]:
// phiếu Chưa thanh toán chỉ để theo dõi, PRD chỉ nêu chuyển khoản nên không xác nhận hộ tiền mặt.
// Edge 7: Đã thanh toán là trạng thái cuối.
const REVIEW_BLOCKED = {
  not_submitted: 'Độc giả chưa gửi thanh toán cho phiếu phạt này',
  already_processed: 'Phiếu phạt đã được xử lý bởi người khác, danh sách đã được tải lại',
};

function canReview(status) {
  return status === 'pending';
}

// Edge 1: hai nhân viên cùng xử lý, người sau thấy trạng thái đã đổi.
function evaluateReview(status) {
  if (canReview(status)) return null;
  return status === 'unpaid' ? 'not_submitted' : 'already_processed';
}

// Edge 5 [Giả định]: nội dung chuyển khoản chứa mã phiếu để nhân viên đối chiếu sao kê (2.5.3).
// Không dấu, viết hoa vì nhiều ngân hàng bỏ dấu tiếng Việt.
function transferContent(ticketId) {
  return `THU VIEN PHAT ${ticketId}`;
}

module.exports = {
  PAYABLE_STATUSES, PAY_BLOCKED, canPay, evaluatePayment, REVIEW_BLOCKED, canReview, evaluateReview, transferContent,
};
