// Ngày nghiệp vụ (hạn trả, quá hạn) tính theo Asia/Ho_Chi_Minh; thời điểm vẫn lưu UTC (ERD).
const BUSINESS_TZ = 'Asia/Ho_Chi_Minh';
const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: BUSINESS_TZ });

// 'YYYY-MM-DD' của ngày hiện tại theo múi giờ nghiệp vụ.
function businessToday(now = new Date()) {
  return formatter.format(now);
}

// Cột @db.Date về JS Date lúc 00:00 UTC; chỉ lấy phần ngày.
function toDateString(date) {
  return date ? date.toISOString().slice(0, 10) : null;
}

module.exports = { BUSINESS_TZ, businessToday, toDateString };
