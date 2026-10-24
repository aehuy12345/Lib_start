const { businessToday } = require('../../lib/businessDate');
const { ACTIVE_STATUSES, evaluateBorrowEligibility } = require('./borrow.rules');

// Dữ liệu cho evaluateBorrowEligibility, dùng chung cho 2.2.4 (gợi ý UI) và 2.3.1 (trong transaction).
// client là prisma hoặc tx; truy vấn tuần tự vì cùng một kết nối khi chạy trong transaction.
async function checkBorrowConditions(client, { readerId, bookId, availableQuantity, now }) {
  const active = { readerId, status: { in: ACTIVE_STATUSES } };
  const activeCount = await client.borrowOrder.count({ where: active });
  const activeOrder = await client.borrowOrder.findFirst({ where: { ...active, bookId }, select: { id: true, status: true } });
  // 2.3.1 edge 4: phiếu `pending`/`rejected` vẫn là chưa thanh toán xong.
  const unpaidFineCount = await client.fineTicket.count({ where: { readerId, status: { not: 'paid' } } });
  // Quá hạn khi ngày VN hiện tại > due_date (ERD).
  const overdueCount = await client.borrowOrder.count({
    where: { readerId, status: 'borrowing', dueDate: { lt: new Date(businessToday(now)) } },
  });
  return {
    ...evaluateBorrowEligibility({
      availableQuantity, activeCount, unpaidFineCount, overdueCount, hasActiveOrderForBook: !!activeOrder,
    }),
    activeOrder,
  };
}

module.exports = { checkBorrowConditions };
