const Joi = require('joi');

const INT32_MAX = 2147483647;
const DEFAULT_DAYS = 14;
const MAX_DAYS = 30;
const INVALID_DAYS = `Thời hạn phải từ 1 đến ${MAX_DAYS} ngày`;

// PRD 2.3.1. Edge 2: 0, âm, 31+, thập phân, chữ đều bị từ chối; bỏ trống → 14 ngày.
const createBorrowSchema = Joi.object({
  bookId: Joi.number().integer().min(1).max(INT32_MAX).required()
    .messages({ '*': 'Sách không hợp lệ' }),
  requestedDays: Joi.number().integer().min(1).max(MAX_DAYS).default(DEFAULT_DAYS)
    .messages({ '*': INVALID_DAYS }),
});

module.exports = { createBorrowSchema, DEFAULT_DAYS, MAX_DAYS, INVALID_DAYS };
