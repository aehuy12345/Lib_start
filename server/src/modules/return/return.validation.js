const Joi = require('joi');

const INT32_MAX = 2147483647;

// PRD 2.4.1: chỉ cần đơn mượn; người gửi lấy từ token.
const createReturnSchema = Joi.object({
  borrowOrderId: Joi.number().integer().min(1).max(INT32_MAX).required()
    .messages({ '*': 'Đơn mượn không hợp lệ' }),
});

module.exports = { createReturnSchema };
