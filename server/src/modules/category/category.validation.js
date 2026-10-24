const Joi = require('joi');

// PRD 2.2.1: tên thể loại không được để trống, tối đa 50 ký tự. Trim trước khi kiểm tra (edge 1).
const categorySchema = Joi.object({
  name: Joi.string().trim().max(50).required()
    .messages({
      'any.required': 'Tên thể loại không được để trống',
      'string.empty': 'Tên thể loại không được để trống',
      'string.max': 'Tên thể loại tối đa 50 ký tự',
      'string.base': 'Tên thể loại không hợp lệ',
    }),
});

module.exports = { categorySchema };
