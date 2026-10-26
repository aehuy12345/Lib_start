// CSV mở được bằng Excel (2.7.2): BOM UTF-8 để Excel nhận đúng tiếng Việt (edge 3), xuống dòng CRLF.
const BOM = '﻿';

// Edge 4: chuỗi bắt đầu bằng = + - @ (hoặc tab, CR) bị Excel coi là công thức → thêm ' phía trước.
// Chỉ áp cho chuỗi; số (kể cả số âm) giữ nguyên để Excel còn tính toán được.
const FORMULA_START = /^[=+\-@\t\r]/;

function csvCell(value) {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (typeof value === 'string' && FORMULA_START.test(text)) text = `'${text}`;
  // Edge 5: dấu phẩy, nháy kép, xuống dòng → bao trong nháy kép, nháy kép bên trong nhân đôi.
  if (/[",\r\n]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}

// rows: mảng các dòng, mỗi dòng là mảng giá trị; dòng rỗng [] thành dòng trống.
function toCsv(rows) {
  return BOM + rows.map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

module.exports = { BOM, csvCell, toCsv };
