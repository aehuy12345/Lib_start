const Joi = require('joi');

const INT32_MAX = 2147483647;

// 2.6.1: lọc theo vai trò; giá trị lạ quay về mặc định như 2.2.3. Từ khóa quá dài thì bỏ lọc như 2.4.2.
const ROLE_FILTERS = ['all', 'reader', 'librarian', 'admin'];
const listUsersQuerySchema = Joi.object({
  role: Joi.string().valid(...ROLE_FILTERS).default('all').failover('all'),
  q: Joi.string().trim().max(100).allow('').default('').failover(''),
  page: Joi.number().integer().min(1).max(INT32_MAX).default(1).failover(1),
});

// 2.6.2 edge 5: vai trò ngoài enum → 400.
const ROLES = ['reader', 'librarian', 'admin'];
const changeRoleSchema = Joi.object({
  role: Joi.string().valid(...ROLES).required().messages({
    'any.required': 'Vui lòng chọn vai trò',
    'any.only': 'Vai trò không hợp lệ',
    'string.base': 'Vai trò không hợp lệ',
  }),
});

// Id không phải số nguyên dương thì coi như không tồn tại.
function parseUserId(raw) {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 && id <= INT32_MAX ? id : null;
}

module.exports = { listUsersQuerySchema, ROLE_FILTERS, ROLES, changeRoleSchema, parseUserId };
