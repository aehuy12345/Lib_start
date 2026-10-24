// ISBN-10/ISBN-13 theo checksum chuẩn (flow 2.2.2, edge 1, 2).

// Edge 1: bỏ dấu gạch ngang và khoảng trắng trước khi kiểm tra và lưu.
// [Giả định] Chữ x thường cũng nhận, đổi thành X.
function normalizeIsbn(value) {
  return String(value).replace(/[\s-]/g, '').toUpperCase();
}

function isValidIsbn10(isbn) {
  if (!/^\d{9}[\dX]$/.test(isbn)) return false;
  let sum = 0;
  for (let i = 0; i < 10; i += 1) {
    const digit = isbn[i] === 'X' ? 10 : Number(isbn[i]);
    sum += digit * (10 - i);
  }
  return sum % 11 === 0;
}

function isValidIsbn13(isbn) {
  if (!/^\d{13}$/.test(isbn)) return false;
  let sum = 0;
  for (let i = 0; i < 13; i += 1) sum += Number(isbn[i]) * (i % 2 === 0 ? 1 : 3);
  return sum % 10 === 0;
}

// Nhận chuỗi đã chuẩn hóa.
function isValidIsbn(isbn) {
  return isValidIsbn10(isbn) || isValidIsbn13(isbn);
}

module.exports = { normalizeIsbn, isValidIsbn };
