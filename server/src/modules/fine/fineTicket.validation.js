const Joi = require('joi');

const INT32_MAX = 2147483647;

// 2.5.2 [Giả định]: mặc định chỉ hiện phiếu cần thanh toán (Chưa thanh toán + Từ chối) như PRD;
// các tab còn lại để xem phiếu đang chờ và đã thanh toán. Giá trị lạ quay về mặc định như 2.3.3.
const TICKET_FILTERS = ['due', 'pending', 'paid', 'all'];
const myTicketsQuerySchema = Joi.object({
  status: Joi.string().valid(...TICKET_FILTERS).default('due').failover('due'),
  page: Joi.number().integer().min(1).max(INT32_MAX).default(1).failover(1),
});

module.exports = { myTicketsQuerySchema, TICKET_FILTERS };
