const Joi = require('joi');
const { registerSchema } = require('../auth/auth.validation');

// [Giả định] 2.1.3 edge 2: số VN 10 số bắt đầu bằng 0, hoặc +84 và 9 số.
const PHONE_PATTERN = /^(0\d{9}|\+84\d{9})$/;

// Quy tắc theo PRD 2.1.3. Email không có trong schema nên bị bỏ (edge 4).
const updateProfileSchema = Joi.object({
  name: registerSchema.extract('name'),
  // SĐT không bắt buộc; chuỗi rỗng nghĩa là xóa số đã lưu.
  phone: Joi.string().trim().allow('', null).pattern(PHONE_PATTERN)
    .messages({
      'string.pattern.base': 'Số điện thoại không đúng định dạng',
      'string.base': 'Số điện thoại không đúng định dạng',
    }),
  address: Joi.string().trim().max(255).required()
    .messages({
      'any.required': 'Địa chỉ không được để trống',
      'string.empty': 'Địa chỉ không được để trống',
      'string.max': 'Địa chỉ tối đa 255 ký tự',
      'string.base': 'Địa chỉ không hợp lệ',
    }),
});

const changePasswordSchema = Joi.object({
  currentPassword: Joi.string().required()
    .messages({
      'any.required': 'Mật khẩu hiện tại không được để trống',
      'string.empty': 'Mật khẩu hiện tại không được để trống',
      'string.base': 'Mật khẩu hiện tại không hợp lệ',
    }),
  newPassword: registerSchema.extract('password'),
  confirmPassword: Joi.string().empty('').required().valid(Joi.ref('newPassword'))
    .messages({
      'any.required': 'Xác nhận mật khẩu không được để trống',
      'string.empty': 'Xác nhận mật khẩu không được để trống',
      'any.only': 'Xác nhận mật khẩu không khớp',
      'string.base': 'Xác nhận mật khẩu không hợp lệ',
    }),
});

module.exports = { updateProfileSchema, changePasswordSchema, PHONE_PATTERN };
