const Joi = require('joi');
const { HttpError } = require('../../lib/httpError');

const INT32_MAX = 2147483647;
const DAY_MS = 24 * 3600 * 1000;

const REPORT_TYPES = ['books', 'borrows', 'fines', 'damaged-lost'];
// PRD 2.7.2: báo cáo mượn trả gom theo ngày, tháng hoặc quý.
const GROUP_BY = ['day', 'month', 'quarter'];
// Edge 2 [Giả định]: khoảng tối đa 1 năm (366 ngày) để số dòng và thời gian truy vấn có giới hạn.
const MAX_RANGE_DAYS = 366;

// Ngày, Tuần, Tháng, Quý, Năm được client đổi thành from/to; server chỉ nhận from/to. groupBy và page
// sai thì quay về mặc định như 2.2.3; ngày sai thì báo lỗi (edge 1).
const reportQuerySchema = Joi.object({
  from: Joi.string().trim().allow('').default(''),
  to: Joi.string().trim().allow('').default(''),
  groupBy: Joi.string().valid(...GROUP_BY).allow(null).default(null).failover(null),
  page: Joi.number().integer().min(1).max(INT32_MAX).default(1).failover(1),
});

function isIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

// Tháng chứa `today` ('YYYY-MM-DD'): mặc định khi không truyền from/to.
function monthOf(today) {
  const [year, month] = today.split('-').map(Number);
  const last = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  return { from: `${today.slice(0, 7)}-01`, to: last };
}

// from/to là ngày theo Asia/Ho_Chi_Minh, tính cả hai đầu. Thiếu cả hai → tháng hiện tại.
// groupBy mặc định: theo ngày nếu khoảng ≤ 31 ngày, ngược lại theo tháng.
function resolveRange({ from, to, groupBy }, today) {
  let range = { from, to };
  if (!from && !to) range = monthOf(today);
  const errors = {};
  if (!isIsoDate(range.from)) errors.from = range.from ? 'Từ ngày không hợp lệ' : 'Vui lòng chọn từ ngày';
  if (!isIsoDate(range.to)) errors.to = range.to ? 'Đến ngày không hợp lệ' : 'Vui lòng chọn đến ngày';
  let days = 0;
  if (!errors.from && !errors.to) {
    days = Math.round((Date.parse(range.to) - Date.parse(range.from)) / DAY_MS) + 1;
    if (days < 1) errors.to = 'Từ ngày phải nhỏ hơn hoặc bằng đến ngày';
    else if (days > MAX_RANGE_DAYS) errors.to = `Khoảng thời gian tối đa ${MAX_RANGE_DAYS} ngày`;
  }
  if (Object.keys(errors).length > 0) throw new HttpError(400, 'Khoảng thời gian không hợp lệ', errors);
  return { ...range, days, groupBy: groupBy ?? (days <= 31 ? 'day' : 'month') };
}

module.exports = { REPORT_TYPES, GROUP_BY, MAX_RANGE_DAYS, reportQuerySchema, isIsoDate, resolveRange };
