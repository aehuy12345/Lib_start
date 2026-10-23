const Joi = require('joi');

// Quy tắc theo PRD 2.1.1 và design/flows/2.1.1-dang-ky.md.
const registerSchema = Joi.object({
  email: Joi.string().trim().lowercase().email({ tlds: { allow: false } }).max(255).required()
    .messages({
      'any.required': 'Email không được để trống',
      'string.empty': 'Email không được để trống',
      'string.email': 'Email không đúng định dạng',
      'string.max': 'Email tối đa 255 ký tự',
      'string.base': 'Email không đúng định dạng',
    }),
  name: Joi.string().trim().max(50).required()
    .messages({
      'any.required': 'Tên không được để trống',
      'string.empty': 'Tên không được để trống',
      'string.max': 'Tên tối đa 50 ký tự',
      'string.base': 'Tên không hợp lệ',
    }),
  password: Joi.string().min(8).max(16).required()
    .messages({
      'any.required': 'Mật khẩu không được để trống',
      'string.empty': 'Mật khẩu không được để trống',
      'string.min': 'Mật khẩu tối thiểu 8 ký tự',
      'string.max': 'Mật khẩu tối đa 16 ký tự',
      'string.base': 'Mật khẩu không hợp lệ',
    }),
  // empty(''): chuỗi rỗng báo "không được để trống" thay vì "không khớp".
  confirmPassword: Joi.string().empty('').required().valid(Joi.ref('password'))
    .messages({
      'any.required': 'Xác nhận mật khẩu không được để trống',
      'string.empty': 'Xác nhận mật khẩu không được để trống',
      'any.only': 'Xác nhận mật khẩu không khớp',
      'string.base': 'Xác nhận mật khẩu không hợp lệ',
    }),
});

// 2.1.2: cùng quy tắc email/mật khẩu với đăng ký.
const loginSchema = Joi.object({
  email: registerSchema.extract('email'),
  password: registerSchema.extract('password'),
});

const verifyEmailSchema = Joi.object({
  token: Joi.string().trim().hex().length(64).required()
    .messages({
      'any.required': 'Thiếu mã xác thực',
      'string.empty': 'Thiếu mã xác thực',
      'string.hex': 'Mã xác thực không hợp lệ',
      'string.length': 'Mã xác thực không hợp lệ',
      'string.base': 'Mã xác thực không hợp lệ',
    }),
});

module.exports = { registerSchema, loginSchema, verifyEmailSchema };
