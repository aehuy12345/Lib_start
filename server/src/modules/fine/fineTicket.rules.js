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

// Edge 5 [Giả định]: nội dung chuyển khoản chứa mã phiếu để nhân viên đối chiếu sao kê (2.5.3).
// Không dấu, viết hoa vì nhiều ngân hàng bỏ dấu tiếng Việt.
function transferContent(ticketId) {
  return `THU VIEN PHAT ${ticketId}`;
}

module.exports = { PAYABLE_STATUSES, PAY_BLOCKED, canPay, evaluatePayment, transferContent };
