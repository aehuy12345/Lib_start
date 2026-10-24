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

const REASON_MAX = 500;
const REASON_REQUIRED = 'Lý do từ chối là bắt buộc';
const REASON_TOO_LONG = `Lý do từ chối tối đa ${REASON_MAX} ký tự`;

// 2.3.2 edge 3: trim trước, chỉ khoảng trắng coi là rỗng; [Giả định] tối đa 500 ký tự (cột varchar(500)).
const rejectBorrowSchema = Joi.object({
  reason: Joi.string().trim().max(REASON_MAX).required()
    .messages({ 'string.max': REASON_TOO_LONG, '*': REASON_REQUIRED }),
});

const pendingQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).max(INT32_MAX).default(1).failover(1),
});

// 2.3.3: lọc theo trạng thái hiển thị; giá trị lạ hoặc page sai quay về mặc định như danh sách sách (2.2.3).
const HISTORY_FILTERS = ['all', 'pending', 'borrowing', 'overdue', 'returned', 'rejected'];
const historyQuerySchema = Joi.object({
  status: Joi.string().valid(...HISTORY_FILTERS).default('all').failover('all'),
  page: Joi.number().integer().min(1).max(INT32_MAX).default(1).failover(1),
});

module.exports = {
  createBorrowSchema, rejectBorrowSchema, pendingQuerySchema, historyQuerySchema, HISTORY_FILTERS,
  DEFAULT_DAYS, MAX_DAYS, INVALID_DAYS, REASON_MAX, REASON_REQUIRED, REASON_TOO_LONG,
};
