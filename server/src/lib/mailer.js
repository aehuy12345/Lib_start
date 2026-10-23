// [Giả định] Chưa chọn dịch vụ gửi email: tạm in nội dung ra console.
// Thay bằng provider thật (SMTP, Resend...) mà không đổi interface sendMail.
function createConsoleMailer(logger = console) {
  return {
    async sendMail({ to, subject, text }) {
      logger.info(`[mail] to=${to} subject="${subject}"\n${text}`);
    },
  };
}

module.exports = { createConsoleMailer };
