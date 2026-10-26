const { toCsv } = require('../../lib/csv');

const TITLES = { books: 'Sách', borrows: 'Mượn trả', fines: 'Phạt', 'damaged-lost': 'Sách mất hoặc hư' };
const SLUGS = { books: 'sach', borrows: 'muon-tra', fines: 'phat', 'damaged-lost': 'sach-mat-hu' };
const FINE_TYPE_LABELS = { late: 'Trả muộn', damaged: 'Hư hỏng', lost: 'Mất sách' };
const CONDITION_LABELS = { lost: 'Mất', damaged: 'Hư hỏng' };

// 'YYYY-MM-DD' → 'DD/MM/YYYY'.
function formatDate(value) {
  const [year, month, day] = value.split('-');
  return `${day}/${month}/${year}`;
}

// Nhãn của một mốc trong báo cáo Mượn trả; client có bản giống ở features/report/reportRules.js.
function periodLabel(period, groupBy) {
  const [year, month] = period.split('-');
  if (groupBy === 'month') return `${month}/${year}`;
  if (groupBy === 'quarter') return `Quý ${Math.floor((Number(month) - 1) / 3) + 1}/${year}`;
  return formatDate(period);
}

function fileName(report) {
  return `bao-cao-${SLUGS[report.type]}_${report.from}_${report.to}.csv`;
}

// Mỗi file mở đầu bằng loại báo cáo và khoảng thời gian đang lọc (edge 6), rồi một dòng trống.
function header(report) {
  return [
    ['Báo cáo', TITLES[report.type]],
    ['Từ ngày', formatDate(report.from)],
    ['Đến ngày', formatDate(report.to)],
    [],
  ];
}

const SECTIONS = {
  books: (r) => [
    ['Tên sách', 'Tác giả', 'ISBN', 'Thể loại', 'Tổng số bản', 'Có sẵn', 'Đang mượn', 'Hư hỏng (trong kho)',
      'Lượt mượn trong kỳ', 'Mất trong kỳ', 'Hư hỏng trong kỳ'],
    ...r.rows.map((b) => [b.title, b.author, b.isbn, b.category, b.totalQuantity, b.available, b.borrowed, b.damaged,
      b.borrowsInRange, b.lostInRange, b.damagedInRange]),
  ],
  borrows: (r) => [
    ['Thời gian', 'Lượt mượn', 'Lượt trả'],
    ...r.rows.map((row) => [periodLabel(row.period, r.groupBy), row.borrowed, row.returned]),
    ['Tổng', r.summary.borrowed, r.summary.returned],
  ],
  fines: (r) => [
    ['Loại phạt', 'Số phiếu phát sinh', 'Tiền phát sinh', 'Số phiếu đã thu', 'Tiền đã thu', 'Số phiếu chưa thu', 'Tiền chưa thu'],
    ...[...r.byType.map((t) => ({ ...t, label: FINE_TYPE_LABELS[t.type] })), { ...r.summary, label: 'Tổng' }].map((t) => [
      t.label, t.issuedCount, t.issuedAmount, t.collectedCount, t.collectedAmount, t.outstandingCount, t.outstandingAmount,
    ]),
    [],
    [`Độc giả nợ tại ngày ${formatDate(r.date)}`],
    ['Độc giả', 'Email', 'Số phiếu chưa thanh toán', 'Tiền phạt chưa thanh toán', 'Số sách quá hạn', 'Quá hạn lâu nhất (ngày)'],
    ...r.debtors.map((d) => [d.name, d.email, d.unpaidCount, d.unpaidAmount, d.overdueCount, d.maxLateDays]),
  ],
  'damaged-lost': (r) => [
    ['Tên sách', 'Tác giả', 'ISBN', 'Thể loại', 'Loại', 'Số bản', 'Ngày ghi nhận gần nhất'],
    ...r.rows.map((b) => [b.title, b.author, b.isbn, b.category, CONDITION_LABELS[b.condition], b.copies,
      formatDate(b.lastRecordedAt)]),
  ],
};

// report: kết quả reportService.getReport(..., { all: true }).
function reportToCsv(report) {
  return { fileName: fileName(report), content: toCsv([...header(report), ...SECTIONS[report.type](report)]) };
}

module.exports = { reportToCsv, periodLabel, formatDate };
