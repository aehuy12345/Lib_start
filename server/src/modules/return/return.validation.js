const Joi = require('joi');
const { CONDITIONS, NOTE_MAX, TIER_REQUIRED } = require('./return.rules');

const INT32_MAX = 2147483647;

// PRD 2.4.1: chỉ cần đơn mượn; người gửi lấy từ token.
const borrowOrderId = Joi.number().integer().min(1).max(INT32_MAX).required()
  .messages({ '*': 'Đơn mượn không hợp lệ' });
const createReturnSchema = Joi.object({ borrowOrderId });

const CONDITION_REQUIRED = 'Vui lòng chọn tình trạng sách';
const NOTE_REQUIRED = 'Ghi chú là bắt buộc khi sách hư hỏng hoặc mất';
const NOTE_TOO_LONG = `Ghi chú tối đa ${NOTE_MAX} ký tự`;

const tierId = Joi.number().integer().min(1).max(INT32_MAX)
  .messages({ 'any.required': TIER_REQUIRED, '*': 'Mức phạt không hợp lệ' });
// required(): điều kiện của Joi.when mặc định khớp cả khi thiếu condition.
const lossOrDamage = Joi.valid('damaged', 'lost').required();
const note = Joi.string().trim().max(NOTE_MAX);

// PRD 2.4.2 Validation Rules. Mức phạt và ghi chú bắt buộc khi Hư hỏng/Mất (edge 2, 3); trả đúng hạn,
// bình thường thì bỏ mức phạt, ghi chú tùy chọn. Mức phạt Trả muộn bắt buộc hay không phụ thuộc
// số ngày muộn tính ở server lúc xác nhận, nên kiểm tra trong service (checkFineTiers).
const confirmReturnSchema = Joi.object({
  condition: Joi.string().valid(...CONDITIONS).required().messages({ '*': CONDITION_REQUIRED }),
  fineTierId: Joi.when('condition', { is: lossOrDamage, then: tierId.required(), otherwise: Joi.any().strip() }),
  note: Joi.when('condition', {
    is: lossOrDamage,
    then: note.required().messages({ 'string.max': NOTE_TOO_LONG, '*': NOTE_REQUIRED }),
    otherwise: note.allow('', null).messages({ 'string.max': NOTE_TOO_LONG, '*': 'Ghi chú không hợp lệ' }),
  }),
  lateFineTierId: tierId.allow(null),
});

// Trả tại quầy (README điểm 10): như xác nhận, kèm đơn mượn.
const counterReturnSchema = confirmReturnSchema.keys({ borrowOrderId });

const pageQuery = Joi.number().integer().min(1).max(INT32_MAX).default(1).failover(1);
const pendingReturnsQuerySchema = Joi.object({ page: pageQuery });
// Tìm đơn đang mượn để trả tại quầy theo tên/email độc giả hoặc tên sách; quá dài thì bỏ lọc.
const counterOrdersQuerySchema = Joi.object({
  q: Joi.string().trim().max(100).allow('').default('').failover(''),
  page: pageQuery,
});

module.exports = {
  createReturnSchema, confirmReturnSchema, counterReturnSchema,
  pendingReturnsQuerySchema, counterOrdersQuerySchema,
  CONDITION_REQUIRED, NOTE_REQUIRED, NOTE_TOO_LONG,
};
