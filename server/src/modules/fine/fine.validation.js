const Joi = require('joi');

// Thứ tự cũng là thứ tự khai báo enum `fine_type` ở DB (dùng để sắp bảng).
const FINE_TYPES = ['late', 'damaged', 'lost'];

// PRD 2.5.1: tên không rỗng, tối đa 25 ký tự; số tiền > 0. Edge 1, 2 [Giả định]: số nguyên VND,
// tối đa 9 chữ số (CHECK amount BETWEEN 1 AND 999999999 ở DB), số thập phân bị từ chối.
// Không có "Ngày phạt" (README điểm 5): ngày phạt thuộc phiếu phạt.
const name = Joi.string().trim().max(25).required()
  .messages({
    'any.required': 'Tên mức phạt không được để trống',
    'string.empty': 'Tên mức phạt không được để trống',
    'string.max': 'Tên mức phạt tối đa 25 ký tự',
    'string.base': 'Tên mức phạt không hợp lệ',
  });

const amount = Joi.number().integer().min(1).max(999999999).required()
  .messages({
    'any.required': 'Số tiền không được để trống',
    'number.base': 'Số tiền phải là số',
    'number.infinity': 'Số tiền phải là số',
    'number.unsafe': 'Số tiền tối đa 999.999.999 đ',
    'number.integer': 'Số tiền phải là số nguyên (VND)',
    'number.min': 'Số tiền phải lớn hơn 0',
    'number.max': 'Số tiền tối đa 999.999.999 đ',
  });

const createFineTierSchema = Joi.object({
  name,
  type: Joi.string().valid(...FINE_TYPES).required()
    .messages({
      'any.required': 'Vui lòng chọn loại mức phạt',
      'string.empty': 'Vui lòng chọn loại mức phạt',
      'any.only': 'Loại mức phạt không hợp lệ',
      'string.base': 'Loại mức phạt không hợp lệ',
    }),
  amount,
});

// Sửa trên bảng: chỉ Tên và Số tiền (flow 2.5.1). `updatedAt` lấy từ bảng để khóa lạc quan (edge 7).
const updateFineTierSchema = Joi.object({
  name,
  amount,
  updatedAt: Joi.date().iso().required()
    .messages({
      'any.required': 'Thiếu thời điểm cập nhật, vui lòng tải lại bảng',
      'date.base': 'Thời điểm cập nhật không hợp lệ',
      'date.format': 'Thời điểm cập nhật không hợp lệ',
    }),
});

module.exports = { createFineTierSchema, updateFineTierSchema, FINE_TYPES };
