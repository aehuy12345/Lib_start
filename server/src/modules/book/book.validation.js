const Joi = require('joi');
const { normalizeIsbn, isValidIsbn } = require('../../lib/isbn');

const INT32_MAX = 2147483647;
const INVALID_ISBN = 'ISBN phải là ISBN-10 hoặc ISBN-13 hợp lệ';

const requiredText = (label, max) => Joi.string().trim().max(max).required()
  .messages({
    'any.required': `${label} không được để trống`,
    'string.empty': `${label} không được để trống`,
    'string.max': `${label} tối đa ${max} ký tự`,
    'string.base': `${label} không hợp lệ`,
  });

// Edge 1, 2: chuẩn hóa rồi kiểm tra checksum; bỏ trống thì lưu null.
const isbn = Joi.string().allow('', null).custom((value, helpers) => {
  if (value == null) return null;
  const normalized = normalizeIsbn(value);
  if (!normalized) return null;
  return isValidIsbn(normalized) ? normalized : helpers.error('isbn.invalid');
}).messages({ 'isbn.invalid': INVALID_ISBN, 'string.base': INVALID_ISBN });

// Năm hiện tại lấy lúc validate để server chạy qua giao thừa vẫn đúng (edge 4).
const publishYear = Joi.number().integer().min(1900).required()
  .custom((value, helpers) => (value > new Date().getFullYear() ? helpers.error('year.future') : value))
  .messages({
    'any.required': 'Năm xuất bản không được để trống',
    'number.base': 'Năm xuất bản phải là số',
    'number.integer': 'Năm xuất bản không hợp lệ',
    'number.min': 'Năm xuất bản phải từ 1900 đến năm hiện tại',
    'year.future': 'Năm xuất bản phải từ 1900 đến năm hiện tại',
  });

// Edge 3: 0, âm, thập phân, chữ đều bị từ chối. Trần INT32 chỉ để không vượt kiểu cột.
const quantity = Joi.number().integer().min(1).max(INT32_MAX).required()
  .messages({
    'any.required': 'Số lượng không được để trống',
    'number.base': 'Số lượng phải là số',
    'number.integer': 'Số lượng phải là số nguyên',
    'number.min': 'Số lượng phải lớn hơn 0',
    'number.max': 'Số lượng quá lớn',
  });

const categoryId = Joi.number().integer().min(1).max(INT32_MAX).required()
  .messages({
    'any.required': 'Vui lòng chọn thể loại',
    'number.base': 'Vui lòng chọn thể loại',
    'number.integer': 'Thể loại không hợp lệ',
    'number.min': 'Thể loại không hợp lệ',
    'number.max': 'Thể loại không hợp lệ',
  });

// PRD 2.2.2. Body có thể đến từ multipart nên số ở dạng chuỗi; Joi tự chuyển.
const createBookSchema = Joi.object({
  title: requiredText('Tên sách', 100),
  author: requiredText('Tác giả', 100),
  publishYear,
  isbn,
  categoryId,
  description: requiredText('Mô tả', 255),
  quantity,
});

module.exports = { createBookSchema, INVALID_ISBN };
