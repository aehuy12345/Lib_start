const { businessToday } = require('../../lib/businessDate');
const { ACTIVE_STATUSES, evaluateBorrowEligibility } = require('./borrow.rules');

// Dữ liệu cho evaluateBorrowEligibility, dùng chung cho 2.2.4 (gợi ý UI) và 2.3.1 (trong transaction).
// client là prisma hoặc tx; truy vấn tuần tự vì cùng một kết nối khi chạy trong transaction.
async function checkBorrowConditions(client, { readerId, bookId, availableQuantity, now }) {
  const { activeCount, unpaidFineCount, overdueCount } = await countReaderBorrowState(client, { readerId, now });
  const activeOrder = await client.borrowOrder.findFirst({
    where: { readerId, status: { in: ACTIVE_STATUSES }, bookId }, select: { id: true, status: true },
  });
  return {
    ...evaluateBorrowEligibility({
      availableQuantity, activeCount, unpaidFineCount, overdueCount, hasActiveOrderForBook: !!activeOrder,
    }),
    activeOrder,
  };
}

// Số đơn hoạt động, phiếu phạt chưa xong và sách quá hạn của độc giả; dùng cả khi xác nhận (2.3.2).
async function countReaderBorrowState(client, { readerId, now }) {
  const activeCount = await client.borrowOrder.count({ where: { readerId, status: { in: ACTIVE_STATUSES } } });
  // 2.3.1 edge 4: phiếu `pending`/`rejected` vẫn là chưa thanh toán xong.
  const unpaidFineCount = await client.fineTicket.count({ where: { readerId, status: { not: 'paid' } } });
  // Quá hạn khi ngày VN hiện tại > due_date (ERD).
  const overdueCount = await client.borrowOrder.count({
    where: { readerId, status: 'borrowing', dueDate: { lt: new Date(businessToday(now)) } },
  });
  return { activeCount, unpaidFineCount, overdueCount };
}

module.exports = { checkBorrowConditions, countReaderBorrowState };
