// Tạo/cập nhật tài khoản cố định cho API test (Postman) và E2E (Playwright).
// Chạy: node scripts/seed-test-users.js  (cần DATABASE_URL trong .env)
require('dotenv/config');
const bcrypt = require('bcryptjs');
const { getPrisma } = require('../src/lib/prisma');
const { createSupabaseStorage } = require('../src/lib/storage');
const { COVER_BUCKET } = require('../src/modules/book/book.service');

const PASSWORD = 'Test@1234';
const USERS = [
  { email: 'test.reader@example.com', name: 'Test Reader', role: 'reader', status: 'active' },
  { email: 'test.librarian@example.com', name: 'Test Librarian', role: 'librarian', status: 'active' },
  { email: 'test.admin@example.com', name: 'Test Admin', role: 'admin', status: 'active' },
  { email: 'test.pending@example.com', name: 'Test Pending', role: 'reader', status: 'pending' },
  { email: 'test.disabled@example.com', name: 'Test Disabled', role: 'reader', status: 'disabled' },
  // 2.1.3: API/E2E test đổi hồ sơ và mật khẩu trên tài khoản riêng; mỗi lần seed trả về trạng thái trống.
  {
    email: 'test.profile@example.com', name: 'Test Profile', role: 'reader', status: 'active',
    phone: null, address: null, avatarPath: null,
  },
  // 2.2.4: mỗi tài khoản rơi vào một lý do khóa nút Mượn (xem seedBookDetail).
  { email: 'test.borrower@example.com', name: 'Test Borrower', role: 'reader', status: 'active' },
  { email: 'test.fined@example.com', name: 'Test Fined', role: 'reader', status: 'active' },
  { email: 'test.overdue@example.com', name: 'Test Overdue', role: 'reader', status: 'active' },
  // 2.3.1: độc giả gửi yêu cầu mượn trong API/E2E test (xem seedBorrowRequest).
  { email: 'test.requester@example.com', name: 'Test Requester', role: 'reader', status: 'active' },
  // 2.3.2: đơn chờ duyệt cho Postman (test.approvee) và E2E (test.queue), xem seedBorrowApproval.
  { email: 'test.approvee@example.com', name: 'Test Approvee', role: 'reader', status: 'active' },
  { email: 'test.queue@example.com', name: 'Test Queue', role: 'reader', status: 'active' },
  // 2.3.3: lịch sử mượn và gia hạn cho Postman (test.historian) và E2E (test.history), xem seedBorrowHistory.
  { email: 'test.historian@example.com', name: 'Test Historian', role: 'reader', status: 'active' },
  { email: 'test.history@example.com', name: 'Test History', role: 'reader', status: 'active' },
  // 2.4.1: yêu cầu trả sách cho Postman (test.returner) và E2E (test.returnee), xem seedReturnRequest.
  { email: 'test.returner@example.com', name: 'Test Returner', role: 'reader', status: 'active' },
  { email: 'test.returnee@example.com', name: 'Test Returnee', role: 'reader', status: 'active' },
  // 2.4.2: nhân viên xác nhận trả cho Postman (test.giver) và E2E (test.handover), xem seedReturnConfirm.
  { email: 'test.giver@example.com', name: 'Test Giver', role: 'reader', status: 'active' },
  { email: 'test.handover@example.com', name: 'Test Handover', role: 'reader', status: 'active' },
  // 2.5.1: có phiếu phạt đã thanh toán dùng mức "Test MP Dùng ..." (xem seedFineTiers).
  { email: 'test.tiered@example.com', name: 'Test Tiered', role: 'reader', status: 'active' },
  // 2.5.2: cùng bộ phiếu phạt (xem seedFinePayment); payer cho Postman, payee cho E2E.
  { email: 'test.payer@example.com', name: 'Test Payer', role: 'reader', status: 'active' },
  { email: 'test.payee@example.com', name: 'Test Payee', role: 'reader', status: 'active' },
  // 2.5.3: nhân viên xác nhận/từ chối thanh toán (xem seedFineReview); settler/clearer cho Postman,
  // settlee/cleared cho E2E. clearer/cleared chỉ có một phiếu chờ xác nhận (edge 5).
  { email: 'test.settler@example.com', name: 'Test Settler', role: 'reader', status: 'active' },
  { email: 'test.settlee@example.com', name: 'Test Settlee', role: 'reader', status: 'active' },
  { email: 'test.clearer@example.com', name: 'Test Clearer', role: 'reader', status: 'active' },
  { email: 'test.cleared@example.com', name: 'Test Cleared', role: 'reader', status: 'active' },
  // 2.6.1: Admin kích hoạt / vô hiệu hóa (xem seedUserList); "api" cho Postman, "e2e" cho E2E.
  // Tên có dấu để test tìm không dấu; active đang mượn 1 cuốn (edge 3), pending để kích hoạt (edge 5).
  { email: 'test.um.api.active@example.com', name: 'Test Người Dùng API Hoạt Động', role: 'reader', status: 'active' },
  { email: 'test.um.api.pending@example.com', name: 'Test Người Dùng API Chờ', role: 'reader', status: 'pending' },
  { email: 'test.um.api.disabled@example.com', name: 'Test Người Dùng API Khóa', role: 'librarian', status: 'disabled' },
  { email: 'test.um.api.admin@example.com', name: 'Test Người Dùng API Admin', role: 'admin', status: 'active' },
  { email: 'test.um.e2e.active@example.com', name: 'Test Người Dùng E2E Hoạt Động', role: 'reader', status: 'active' },
  { email: 'test.um.e2e.pending@example.com', name: 'Test Người Dùng E2E Chờ', role: 'reader', status: 'pending' },
  { email: 'test.um.e2e.disabled@example.com', name: 'Test Người Dùng E2E Khóa', role: 'librarian', status: 'disabled' },
  // 2.6.2: Admin đổi vai trò (xem seedRoleChange). reader đang mượn 1 cuốn + 1 đơn chờ duyệt (cảnh báo),
  // disabled để đổi vai trò tài khoản bị khóa (edge 3). Vai trò được upsert lại mỗi lần seed.
  { email: 'test.ur.api.reader@example.com', name: 'Test Vai Trò API Độc Giả', role: 'reader', status: 'active' },
  { email: 'test.ur.api.librarian@example.com', name: 'Test Vai Trò API Nhân Viên', role: 'librarian', status: 'active' },
  { email: 'test.ur.api.disabled@example.com', name: 'Test Vai Trò API Khóa', role: 'reader', status: 'disabled' },
  { email: 'test.ur.e2e.reader@example.com', name: 'Test Vai Trò E2E Độc Giả', role: 'reader', status: 'active' },
  { email: 'test.ur.e2e.librarian@example.com', name: 'Test Vai Trò E2E Nhân Viên', role: 'librarian', status: 'active' },
  { email: 'test.ur.e2e.disabled@example.com', name: 'Test Vai Trò E2E Khóa', role: 'reader', status: 'disabled' },
  // 2.7.1: độc giả quá hạn lâu nhất (xem seedDashboard), đứng đầu danh sách nợ quá hạn.
  { email: 'test.dashboard@example.com', name: 'Test Dashboard Quá Hạn', role: 'reader', status: 'active' },
  // 2.7.2: đơn mượn và phiếu phạt quý 1/2020 cho báo cáo chi tiết (xem seedReport).
  { email: 'test.report@example.com', name: 'Test Báo Cáo Nợ Phạt', role: 'reader', status: 'active' },
];

async function main() {
  const prisma = getPrisma();
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  for (const { email, ...data } of USERS) {
    await prisma.user.upsert({
      where: { email },
      create: { email, passwordHash, ...data },
      update: { passwordHash, ...data },
    });
    console.log(`${data.role.padEnd(9)} ${data.status.padEnd(8)} ${email}`);
  }
  console.log(`Mật khẩu chung: ${PASSWORD}`);

  await cleanTestBorrows(prisma);
  await cleanTestBooks(prisma);
  await seedCategories(prisma);
  await seedBookList(prisma);
  await seedBookDetail(prisma);
  await seedBookEdit(prisma);
  await seedBorrowRequest(prisma);
  await seedBorrowApproval(prisma);
  await seedBorrowHistory(prisma);
  await seedReturnRequest(prisma);
  await seedReturnConfirm(prisma);
  await seedFineTiers(prisma);
  await seedFinePayment(prisma);
  await seedFineReview(prisma);
  await seedUserList(prisma);
  await seedRoleChange(prisma);
  await seedDashboard(prisma);
  await seedReport(prisma);
  await prisma.$disconnect();
}

// 2.2.2: API/E2E test tạo sách có tên bắt đầu bằng "Test Sách "; xóa hẳn cùng ảnh bìa.
// Chạy trước seedCategories để thể loại test của chúng dọn được.
async function cleanTestBooks(prisma) {
  const books = await prisma.book.findMany({
    // Không phân biệt hoa thường: test trùng tên (edge 5) tạo cả "test sách ...".
    where: { title: { startsWith: 'Test Sách ', mode: 'insensitive' }, borrowOrders: { none: {} } },
    select: { id: true, coverPath: true },
  });
  const covers = books.map((b) => b.coverPath).filter(Boolean);
  if (covers.length > 0) {
    const storage = createSupabaseStorage({
      url: process.env.SUPABASE_URL,
      serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    });
    for (const path of covers) {
      await storage.remove(COVER_BUCKET, path).catch((err) => console.error(`Không xóa được ảnh ${path}`, err.message));
    }
  }
  await prisma.book.deleteMany({ where: { id: { in: books.map((b) => b.id) } } });
  console.log(`book      đã dọn ${books.length} sách test (${covers.length} ảnh bìa)`);
}

// 2.2.1: thể loại cố định có 1 sách (test chặn xóa) và dọn các thể loại "Test ..." do API/E2E test tạo ra.
const CATEGORY_WITH_BOOK = 'Test Có Sách';
const CATEGORY_FOR_NEW_BOOKS = 'Test Thêm Sách';
const FIXTURE_BOOK = 'Sách Test Thể Loại';
const FIXTURE_ISBN = '9780306406157';

async function seedCategories(prisma) {
  const removed = await prisma.category.deleteMany({
    where: { name: { startsWith: 'Test ' }, NOT: { name: CATEGORY_WITH_BOOK }, books: { none: {} } },
  });
  let category = await prisma.category.findFirst({ where: { name: CATEGORY_WITH_BOOK, deletedAt: null } });
  if (!category) category = await prisma.category.create({ data: { name: CATEGORY_WITH_BOOK } });
  // 2.2.2: sách này giữ ISBN cố định để test thêm sách trùng ISBN.
  const book = await prisma.book.findFirst({ where: { title: FIXTURE_BOOK, deletedAt: null } });
  if (book) {
    await prisma.book.update({ where: { id: book.id }, data: { categoryId: category.id, isbn: FIXTURE_ISBN } });
  } else {
    await prisma.book.create({
      data: {
        title: FIXTURE_BOOK, author: 'Test', publishYear: 2020, description: 'Dữ liệu test 2.2.1',
        isbn: FIXTURE_ISBN, categoryId: category.id, totalQuantity: 1, availableQuantity: 1,
      },
    });
  }
  console.log(`category  "${CATEGORY_WITH_BOOK}" (id ${category.id}) có sách ISBN ${FIXTURE_ISBN}; đã dọn ${removed.count} thể loại test`);

  // 2.2.2: E2E thêm sách vào thể loại riêng để không đổi số sách của "Test Có Sách" mà E2E 2.2.1 kiểm tra.
  const forBooks = await prisma.category.findFirst({ where: { name: CATEGORY_FOR_NEW_BOOKS, deletedAt: null } })
    ?? await prisma.category.create({ data: { name: CATEGORY_FOR_NEW_BOOKS } });
  console.log(`category  "${CATEGORY_FOR_NEW_BOOKS}" (id ${forBooks.id}) cho E2E 2.2.2`);
}

// 2.2.3: 12 sách (hơn 1 trang) để test phân trang, sắp xếp, tìm không dấu, ký tự đặc biệt và "Hết sách".
// Tên bắt đầu bằng "Test Sách " nên cleanTestBooks dọn ở lần seed sau.
const CATEGORY_LIST = 'Test Danh Sách';

function listFixture(i) {
  const n = String(i).padStart(2, '0');
  const book = {
    title: `Test Sách DS ${n}`, author: 'Tác Giả DS', publishYear: 2000 + i,
    borrowCount: i === 3 ? 50 : i, totalQuantity: 2, availableQuantity: 2, borrowedQuantity: 0,
  };
  if (i === 5) Object.assign(book, { title: `Test Sách DS ${n} Mắt Biếc`, author: 'Nguyễn Nhật Ánh' });
  if (i === 7) Object.assign(book, { availableQuantity: 0, borrowedQuantity: 2 });
  if (i === 9) book.title = `Test Sách DS ${n} 100% Sạch`;
  return book;
}

async function seedBookList(prisma) {
  const category = await prisma.category.findFirst({ where: { name: CATEGORY_LIST, deletedAt: null } })
    ?? await prisma.category.create({ data: { name: CATEGORY_LIST } });
  await prisma.book.createMany({
    data: Array.from({ length: 12 }, (_, k) => ({
      ...listFixture(k + 1), description: 'Dữ liệu test 2.2.3', categoryId: category.id,
    })),
  });
  console.log(`category  "${CATEGORY_LIST}" (id ${category.id}) có 12 sách cho E2E 2.2.3`);
}

// 2.2.4: dọn đơn mượn, yêu cầu trả, phiếu phạt của tài khoản test để sách test xóa được.
// Chạy trước cleanTestBooks. Mức phạt "Test ..." không còn phiếu nào cũng bị xóa.
async function cleanTestBorrows(prisma) {
  const readers = { email: { in: USERS.map((u) => u.email) } };
  // 2.5.2: ảnh biên lai do API/E2E test tải lên (bucket private receipts).
  const receipts = await prisma.fineTicket.findMany({
    where: { reader: readers, receiptPath: { not: null } }, select: { receiptPath: true },
  });
  if (receipts.length > 0) {
    const storage = createSupabaseStorage({
      url: process.env.SUPABASE_URL,
      serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    });
    for (const { receiptPath } of receipts) {
      await storage.remove('receipts', receiptPath).catch((err) => console.error(`Không xóa được biên lai ${receiptPath}`, err.message));
    }
  }
  const fines = await prisma.fineTicket.deleteMany({ where: { reader: readers } });
  await prisma.returnRequest.deleteMany({ where: { borrowOrder: { reader: readers } } });
  const orders = await prisma.borrowOrder.deleteMany({ where: { reader: readers } });
  // Không phân biệt hoa thường: test trùng tên (2.5.1) có thể tạo "test mp ...".
  await prisma.fineTier.deleteMany({
    where: { name: { startsWith: 'Test ', mode: 'insensitive' }, fineTickets: { none: {} } },
  });
  console.log(`borrow    đã dọn ${orders.count} đơn mượn, ${fines.count} phiếu phạt của tài khoản test`);
}

// 2.2.4: thể loại "Test Chi Tiết": sách CT 01 có 12 đơn mượn (2 trang lịch sử, đủ trạng thái),
// CT 02..05 để test.borrower đủ 5 đơn đang hoạt động. Lý do khóa nút Mượn ở CT 01:
//   test.reader   → đã gửi yêu cầu (pending)     test.borrower → đạt giới hạn 5 cuốn
//   test.fined    → có phiếu phạt chưa thanh toán test.overdue  → có sách quá hạn
// Sách hết hàng dùng "Test Sách DS 07"; test.reader mượn được "Test Sách DS 01".
const CATEGORY_DETAIL = 'Test Chi Tiết';
const DETAIL_BOOK = 'Test Sách CT 01 Lịch Sử';
const DAY = 24 * 60 * 60 * 1000;

// Ngày nghiệp vụ (cột date) theo Asia/Ho_Chi_Minh, lệch `days` ngày so với hôm nay.
function businessDate(days) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date());
  return new Date(Date.parse(today) + days * DAY);
}

async function seedBookDetail(prisma) {
  const users = Object.fromEntries((await prisma.user.findMany({
    where: { email: { in: USERS.map((u) => u.email) } },
    select: { id: true, email: true },
  })).map((u) => [u.email.split('@')[0].replace('test.', ''), u.id]));
  const category = await prisma.category.findFirst({ where: { name: CATEGORY_DETAIL, deletedAt: null } })
    ?? await prisma.category.create({ data: { name: CATEGORY_DETAIL } });

  const base = { author: 'Tác Giả CT', publishYear: 2015, description: 'Dữ liệu test 2.2.4', categoryId: category.id };
  // Đang mượn: test.borrower + test.overdue → borrowed 2, available 3.
  const book = await prisma.book.create({
    data: {
      ...base, title: DETAIL_BOOK, isbn: '0306406152', borrowCount: 11,
      totalQuantity: 5, availableQuantity: 3, borrowedQuantity: 2,
    },
  });
  const others = [];
  for (let i = 2; i <= 5; i++) {
    others.push(await prisma.book.create({
      data: { ...base, title: `Test Sách CT 0${i}`, totalQuantity: 1, availableQuantity: 1 },
    }));
  }

  const now = Date.now();
  const at = (daysAgo) => new Date(now - daysAgo * DAY);
  const processed = { processedById: users.librarian };
  const returned = (readerId, daysAgo) => ({
    readerId, status: 'returned', ...processed, processedAt: at(daysAgo), createdAt: at(daysAgo + 1),
    borrowedAt: at(daysAgo), dueDate: businessDate(-daysAgo + 14), returnedAt: at(daysAgo - 5),
  });
  const rejected = (readerId, daysAgo) => ({
    readerId, status: 'rejected', ...processed, processedAt: at(daysAgo), createdAt: at(daysAgo + 1),
    rejectReason: 'Dữ liệu test: từ chối',
  });
  const orders = [
    { readerId: users.reader, status: 'pending', createdAt: at(0) },
    {
      readerId: users.borrower, status: 'borrowing', ...processed, processedAt: at(2), createdAt: at(3),
      borrowedAt: at(2), dueDate: businessDate(12),
    },
    {
      readerId: users.overdue, status: 'borrowing', ...processed, processedAt: at(20), createdAt: at(21),
      borrowedAt: at(20), dueDate: businessDate(-6),
    },
    rejected(users.reader, 25),
    returned(users.fined, 30),
    returned(users.reader, 40),
    rejected(users.borrower, 45),
    returned(users.overdue, 50),
    returned(users.borrower, 60),
    returned(users.reader, 70),
    rejected(users.fined, 80),
    returned(users.fined, 90),
  ];
  const created = [];
  for (const order of orders) created.push(await prisma.borrowOrder.create({ data: { ...order, bookId: book.id } }));
  for (const other of others) {
    await prisma.borrowOrder.create({ data: { readerId: users.borrower, bookId: other.id, status: 'pending' } });
  }

  // Phiếu phạt hư hỏng chưa thanh toán của test.fined, gắn với lần trả 30 ngày trước.
  const finedOrder = created.find((o) => o.readerId === users.fined && o.status === 'returned');
  const returnRequest = await prisma.returnRequest.create({
    data: {
      borrowOrderId: finedOrder.id, status: 'confirmed', requestedById: users.fined, processedById: users.librarian,
      processedAt: finedOrder.returnedAt, condition: 'damaged', conditionNote: 'Dữ liệu test: rách bìa', lateDays: 0,
    },
  });
  const tier = await prisma.fineTier.create({ data: { name: 'Test Hư Hỏng', type: 'damaged', amount: 50000 } });
  await prisma.fineTicket.create({
    data: {
      readerId: users.fined, borrowOrderId: finedOrder.id, returnRequestId: returnRequest.id, fineTierId: tier.id,
      type: 'damaged', tierName: tier.name, amount: tier.amount, note: 'Dữ liệu test', issuedById: users.librarian,
    },
  });
  console.log(`category  "${CATEGORY_DETAIL}" (id ${category.id}): "${DETAIL_BOOK}" id ${book.id} có ${orders.length} đơn mượn cho 2.2.4`);
}

// 2.2.5: thể loại "Test Sửa Xóa".
//   SX 01 Sửa       → tổng 6 = 3 sẵn + 2 đang mượn + 1 hư hỏng (tổng tối thiểu 3)
//   SX 02 Đang Mượn → 1 đơn đang mượn của test.overdue, chặn xóa
//   SX 03 Chờ Duyệt → 1 đơn chờ xác nhận của test.reader, chặn xóa (edge 3)
//   SX 04, SX 05    → chỉ có đơn đã trả (edge 1), xóa được: SX 04 cho API test, SX 05 cho E2E
// Sách bị xóa mềm vẫn bắt đầu bằng "Test Sách " nên cleanTestBooks dọn được.
const CATEGORY_EDIT = 'Test Sửa Xóa';

async function seedBookEdit(prisma) {
  const users = Object.fromEntries((await prisma.user.findMany({
    where: { email: { in: USERS.map((u) => u.email) } },
    select: { id: true, email: true },
  })).map((u) => [u.email.split('@')[0].replace('test.', ''), u.id]));
  const category = await prisma.category.findFirst({ where: { name: CATEGORY_EDIT, deletedAt: null } })
    ?? await prisma.category.create({ data: { name: CATEGORY_EDIT } });
  const base = { author: 'Tác Giả SX', publishYear: 2018, description: 'Dữ liệu test 2.2.5', categoryId: category.id };
  const book = (title, stock, extra = {}) => prisma.book.create({ data: { ...base, title, ...stock, ...extra } });

  const now = Date.now();
  const at = (daysAgo) => new Date(now - daysAgo * DAY);
  const borrowing = (readerId) => ({
    readerId, status: 'borrowing', processedById: users.librarian, processedAt: at(1), createdAt: at(2),
    borrowedAt: at(1), dueDate: businessDate(13),
  });
  const returned = (readerId) => ({
    readerId, status: 'returned', processedById: users.librarian, processedAt: at(30), createdAt: at(31),
    borrowedAt: at(30), dueDate: businessDate(-16), returnedAt: at(20),
  });

  const edit = await book('Test Sách SX 01 Sửa',
    { totalQuantity: 6, availableQuantity: 3, borrowedQuantity: 2, damagedQuantity: 1 }, { isbn: '9780131103627' });
  const borrowed = await book('Test Sách SX 02 Đang Mượn', { totalQuantity: 2, availableQuantity: 1, borrowedQuantity: 1 });
  const pending = await book('Test Sách SX 03 Chờ Duyệt', { totalQuantity: 2, availableQuantity: 2 });
  const deletable = [];
  for (const title of ['Test Sách SX 04 Xóa API', 'Test Sách SX 05 Xóa E2E']) {
    deletable.push(await book(title, { totalQuantity: 1, availableQuantity: 1 }, { borrowCount: 1 }));
  }

  const orders = [
    { ...borrowing(users.borrower), bookId: edit.id },
    { ...borrowing(users.overdue), bookId: edit.id },
    { ...borrowing(users.overdue), bookId: borrowed.id },
    { readerId: users.reader, status: 'pending', bookId: pending.id },
    ...deletable.map((b) => ({ ...returned(users.fined), bookId: b.id })),
  ];
  for (const data of orders) await prisma.borrowOrder.create({ data });
  console.log(`category  "${CATEGORY_EDIT}" (id ${category.id}): SX 01 id ${edit.id}, SX 02..05 cho 2.2.5`);
}

// 2.3.1: thể loại "Test Mượn Sách", test.requester chưa có đơn hoạt động nào.
//   MS 01 API    → Postman gửi yêu cầu, gửi trùng, hủy, mượn lại sau khi hủy
//   MS 02 E2E    → E2E gửi yêu cầu rồi hủy
//   MS 03 Hết    → hết sách (available 0)
//   MS 04 Mượn Lại → test.requester từng có đơn đã trả và bị từ chối, vẫn mượn lại được (edge 5)
// Chặn theo lý do khác dùng test.borrower (5 đơn), test.fined (phiếu phạt), test.overdue (quá hạn).
const CATEGORY_BORROW = 'Test Mượn Sách';

async function seedBorrowRequest(prisma) {
  const requester = await prisma.user.findUnique({ where: { email: 'test.requester@example.com' }, select: { id: true } });
  const librarian = await prisma.user.findUnique({ where: { email: 'test.librarian@example.com' }, select: { id: true } });
  const category = await prisma.category.findFirst({ where: { name: CATEGORY_BORROW, deletedAt: null } })
    ?? await prisma.category.create({ data: { name: CATEGORY_BORROW } });
  const base = { author: 'Tác Giả MS', publishYear: 2019, description: 'Dữ liệu test 2.3.1', categoryId: category.id };
  const book = (title, stock) => prisma.book.create({ data: { ...base, title, ...stock } });

  const api = await book('Test Sách MS 01 API', { totalQuantity: 3, availableQuantity: 3 });
  const e2e = await book('Test Sách MS 02 E2E', { totalQuantity: 2, availableQuantity: 2 });
  const out = await book('Test Sách MS 03 Hết', { totalQuantity: 1, availableQuantity: 0, damagedQuantity: 1 });
  const again = await book('Test Sách MS 04 Mượn Lại', { totalQuantity: 1, availableQuantity: 1, borrowCount: 1 });

  const at = (daysAgo) => new Date(Date.now() - daysAgo * DAY);
  const processed = { readerId: requester.id, bookId: again.id, processedById: librarian.id };
  await prisma.borrowOrder.create({
    data: {
      ...processed, status: 'returned', processedAt: at(30), createdAt: at(31),
      borrowedAt: at(30), dueDate: businessDate(-16), returnedAt: at(20),
    },
  });
  await prisma.borrowOrder.create({
    data: { ...processed, status: 'rejected', processedAt: at(10), createdAt: at(11), rejectReason: 'Dữ liệu test: từ chối' },
  });
  console.log(`category  "${CATEGORY_BORROW}" (id ${category.id}): MS 01 id ${api.id}, MS 02 id ${e2e.id}, MS 03 id ${out.id}, MS 04 id ${again.id} cho 2.3.1`);
}

// 2.3.2: thể loại "Test Duyệt Mượn", mỗi sách có đúng một đơn Chờ xác nhận.
//   DM 01 API Xác Nhận (test.approvee, có sẵn 2) → Postman xác nhận, rồi xác nhận/từ chối lại → 409
//   DM 02 API Từ Chối  (test.approvee)           → Postman kiểm tra lý do rỗng/quá dài rồi từ chối
//   DM 03 API Hết      (test.approvee, có sẵn 0) → xác nhận → 409 out_of_stock, rồi từ chối "Hết sách"
//   DM 04 E2E Xác Nhận / DM 05 E2E Từ Chối / DM 06 E2E Hết (test.queue) → E2E
//   DM 07 Phạt (test.fined) → unpaid_fine; DM 08 Vô Hiệu (test.disabled) → reader_inactive;
//   DM 09 Quá Hạn (test.overdue) → overdue
// Đơn tạo cách đây 60+ ngày để nằm ở trang 1 (danh sách xếp cũ nhất trước).
const CATEGORY_APPROVAL = 'Test Duyệt Mượn';

async function seedBorrowApproval(prisma) {
  const ids = Object.fromEntries((await prisma.user.findMany({
    where: { email: { in: ['approvee', 'queue', 'fined', 'disabled', 'overdue'].map((n) => `test.${n}@example.com`) } },
    select: { id: true, email: true },
  })).map((u) => [u.email.slice(5, u.email.indexOf('@')), u.id]));
  const category = await prisma.category.findFirst({ where: { name: CATEGORY_APPROVAL, deletedAt: null } })
    ?? await prisma.category.create({ data: { name: CATEGORY_APPROVAL } });
  const base = { author: 'Tác Giả DM', publishYear: 2020, description: 'Dữ liệu test 2.3.2', categoryId: category.id };
  const inStock = (n) => ({ totalQuantity: n, availableQuantity: n });
  const outOfStock = { totalQuantity: 1, availableQuantity: 0, damagedQuantity: 1 };
  const FIXTURES = [
    ['Test Sách DM 01 API Xác Nhận', 'approvee', inStock(2), 14],
    ['Test Sách DM 02 API Từ Chối', 'approvee', inStock(2), 14],
    ['Test Sách DM 03 API Hết', 'approvee', outOfStock, 14],
    ['Test Sách DM 04 E2E Xác Nhận', 'queue', inStock(1), 21],
    ['Test Sách DM 05 E2E Từ Chối', 'queue', inStock(1), 14],
    ['Test Sách DM 06 E2E Hết', 'queue', outOfStock, 14],
    ['Test Sách DM 07 Phạt', 'fined', inStock(1), 14],
    ['Test Sách DM 08 Vô Hiệu', 'disabled', inStock(1), 14],
    ['Test Sách DM 09 Quá Hạn', 'overdue', inStock(1), 14],
  ];
  const lines = [];
  for (const [index, [title, reader, stock, requestedDays]] of FIXTURES.entries()) {
    const book = await prisma.book.create({ data: { ...base, title, ...stock } });
    const order = await prisma.borrowOrder.create({
      data: { readerId: ids[reader], bookId: book.id, requestedDays, createdAt: new Date(Date.now() - (70 - index) * DAY) },
    });
    lines.push(`${title.slice(10, 15)} book ${book.id} order ${order.id}`);
  }
  console.log(`category  "${CATEGORY_APPROVAL}" (id ${category.id}) cho 2.3.2: ${lines.join(', ')}`);
}

// 2.3.3: thể loại "Test Lịch Sử Mượn", test.historian (Postman) và test.history (E2E) có cùng bộ đơn:
//   LS 01 Gia Hạn    đang mượn, còn 5 ngày, chưa gia hạn → gia hạn được (+7), lần hai → already_extended
//   LS 02 Đã Gia Hạn đang mượn, đã gia hạn 1 lần        → already_extended
//   LS 03 Quá Hạn    hạn trả 2 ngày trước                → Quá hạn, gia hạn → overdue
//   LS 04 Hôm Nay    hạn trả hôm nay                     → vẫn gia hạn được
//   LS 05 Chờ Trả    đang mượn, có yêu cầu trả chờ       → pending_return
//   LS 06 Chờ Duyệt  chờ xác nhận                        → not_borrowing, hủy được
//   LS 07 Đã Trả     5 đơn đã trả (tổng 12 đơn hiển thị → 2 trang)
//   LS 08 Từ Chối    bị từ chối, có lý do
//   LS 09 Đã Hủy     đã hủy → không hiện trong lịch sử
// createdAt giảm dần theo thứ tự trên: LS 01 mới nhất, đứng đầu trang 1.
const CATEGORY_HISTORY = 'Test Lịch Sử Mượn';
const HISTORY_REJECT_REASON = 'Dữ liệu test: sách đang được bảo trì';

async function seedBorrowHistory(prisma) {
  const readers = await prisma.user.findMany({
    where: { email: { in: ['test.historian@example.com', 'test.history@example.com'] } }, select: { id: true },
  });
  const librarian = await prisma.user.findUnique({ where: { email: 'test.librarian@example.com' }, select: { id: true } });
  const category = await prisma.category.findFirst({ where: { name: CATEGORY_HISTORY, deletedAt: null } })
    ?? await prisma.category.create({ data: { name: CATEGORY_HISTORY } });
  const base = { author: 'Tác Giả LS', publishYear: 2021, description: 'Dữ liệu test 2.3.3', categoryId: category.id };
  // Sách LS 01..05 đang được cả hai độc giả mượn: kho khớp với số đơn `borrowing`.
  const TITLES = [
    'LS 01 Gia Hạn', 'LS 02 Đã Gia Hạn', 'LS 03 Quá Hạn', 'LS 04 Hôm Nay', 'LS 05 Chờ Trả',
    'LS 06 Chờ Duyệt', 'LS 07 Đã Trả', 'LS 08 Từ Chối', 'LS 09 Đã Hủy',
  ];
  const books = [];
  for (const [index, title] of TITLES.entries()) {
    const borrowed = index < 5 ? readers.length : 0;
    books.push(await prisma.book.create({
      data: { ...base, title: `Test Sách ${title}`, totalQuantity: 3, borrowedQuantity: borrowed, availableQuantity: 3 - borrowed },
    }));
  }
  const at = (daysAgo) => new Date(Date.now() - daysAgo * DAY);
  const processed = (daysAgo) => ({ processedById: librarian.id, processedAt: at(daysAgo) });
  const borrowing = (daysAgo, dueIn) => ({
    status: 'borrowing', ...processed(daysAgo), borrowedAt: at(daysAgo), dueDate: businessDate(dueIn),
  });
  for (const { id: readerId } of readers) {
    let age = 0;
    const order = (book, data) => prisma.borrowOrder.create({
      data: { readerId, bookId: book.id, createdAt: at((age += 1) / 24), ...data },
    });
    await order(books[0], borrowing(9, 5));
    await order(books[1], { ...borrowing(15, 3), extensionCount: 1, extendedAt: at(2) });
    await order(books[2], borrowing(16, -2));
    await order(books[3], borrowing(14, 0));
    const waiting = await order(books[4], borrowing(10, 4));
    await prisma.returnRequest.create({ data: { borrowOrderId: waiting.id, requestedById: readerId } });
    await order(books[5], {});
    for (let i = 0; i < 5; i += 1) {
      await order(books[6], {
        status: 'returned', ...processed(40 + i * 10), borrowedAt: at(40 + i * 10),
        dueDate: businessDate(-26 - i * 10), returnedAt: at(30 + i * 10),
      });
    }
    await order(books[7], { status: 'rejected', ...processed(1), rejectReason: HISTORY_REJECT_REASON });
    await order(books[8], { status: 'cancelled', cancelledAt: at(1) });
  }
  console.log(`category  "${CATEGORY_HISTORY}" (id ${category.id}) cho 2.3.3: ${books.map((b) => `${b.title.slice(10, 15)} ${b.id}`).join(', ')}`);
}

// 2.4.1: thể loại "Test Trả Sách", test.returner (Postman) và test.returnee (E2E) có cùng bộ đơn:
//   TS 01 Đang Mượn  đang mượn, còn 5 ngày        → gửi yêu cầu trả được, lần hai → pending_return
//   TS 02 Quá Hạn    hạn trả 3 ngày trước         → vẫn gửi được (edge 2)
//   TS 03 Chờ Trả    đã có yêu cầu trả chờ        → pending_return; hủy yêu cầu được (edge 5)
//   TS 04 Đã Trả     đã trả                       → not_borrowing (edge 3)
//   TS 05 Chờ Duyệt  chờ xác nhận mượn            → not_borrowing, không có nút (edge 7)
const CATEGORY_RETURN = 'Test Trả Sách';

async function seedReturnRequest(prisma) {
  const readers = await prisma.user.findMany({
    where: { email: { in: ['test.returner@example.com', 'test.returnee@example.com'] } }, select: { id: true },
  });
  const librarian = await prisma.user.findUnique({ where: { email: 'test.librarian@example.com' }, select: { id: true } });
  const category = await prisma.category.findFirst({ where: { name: CATEGORY_RETURN, deletedAt: null } })
    ?? await prisma.category.create({ data: { name: CATEGORY_RETURN } });
  const base = { author: 'Tác Giả TS', publishYear: 2022, description: 'Dữ liệu test 2.4.1', categoryId: category.id };
  const TITLES = ['TS 01 Đang Mượn', 'TS 02 Quá Hạn', 'TS 03 Chờ Trả', 'TS 04 Đã Trả', 'TS 05 Chờ Duyệt'];
  const books = [];
  for (const [index, title] of TITLES.entries()) {
    // TS 01..03 đang được cả hai độc giả mượn.
    const borrowed = index < 3 ? readers.length : 0;
    books.push(await prisma.book.create({
      data: { ...base, title: `Test Sách ${title}`, totalQuantity: 3, borrowedQuantity: borrowed, availableQuantity: 3 - borrowed },
    }));
  }
  const at = (daysAgo) => new Date(Date.now() - daysAgo * DAY);
  const processed = (daysAgo) => ({ processedById: librarian.id, processedAt: at(daysAgo) });
  const borrowing = (daysAgo, dueIn) => ({
    status: 'borrowing', ...processed(daysAgo), borrowedAt: at(daysAgo), dueDate: businessDate(dueIn),
  });
  for (const { id: readerId } of readers) {
    let age = 0;
    const order = (book, data) => prisma.borrowOrder.create({
      data: { readerId, bookId: book.id, createdAt: at((age += 1) / 24), ...data },
    });
    await order(books[0], borrowing(9, 5));
    await order(books[1], borrowing(17, -3));
    const waiting = await order(books[2], borrowing(10, 4));
    await prisma.returnRequest.create({ data: { borrowOrderId: waiting.id, requestedById: readerId } });
    await order(books[3], {
      status: 'returned', ...processed(30), borrowedAt: at(30), dueDate: businessDate(-16), returnedAt: at(20),
    });
    await order(books[4], {});
  }
  console.log(`category  "${CATEGORY_RETURN}" (id ${category.id}) cho 2.4.1: ${books.map((b) => `${b.title.slice(10, 15)} ${b.id}`).join(', ')}`);
}

// 2.4.2: thể loại "Test Xác Nhận Trả", test.giver (Postman) và test.handover (E2E) có cùng bộ đơn.
// XT 01..05 có yêu cầu trả chờ tạo 60+ ngày trước nên nằm đầu trang 1 (cũ nhất trước):
//   XT 01 Bình Thường  hạn còn 5 ngày     → xác nhận Bình thường, không phiếu phạt
//   XT 02 Trả Muộn     quá hạn 4 ngày     → Bình thường, bắt buộc mức Trả muộn
//   XT 03 Hư Hỏng      hạn còn 3 ngày     → Hư hỏng: mức phạt + ghi chú
//   XT 04 Mất          quá hạn 2 ngày     → Mất + Trả muộn (2 phiếu)
//   XT 05 Từ Chối      hạn còn 6 ngày     → từ chối yêu cầu
//   XT 06 Tại Quầy     hạn còn 2 ngày, không có yêu cầu → trả tại quầy
// Mỗi sách: tổng 3 = 1 sẵn + 2 đang mượn. Mức phạt test: Trả muộn, Hư Hỏng (seedBookDetail), Mất, một mức đã ẩn.
const CATEGORY_RETURN_CONFIRM = 'Test Xác Nhận Trả';

async function seedReturnConfirm(prisma) {
  const readers = await prisma.user.findMany({
    where: { email: { in: ['test.giver@example.com', 'test.handover@example.com'] } }, select: { id: true },
  });
  const librarian = await prisma.user.findUnique({ where: { email: 'test.librarian@example.com' }, select: { id: true } });
  const category = await prisma.category.findFirst({ where: { name: CATEGORY_RETURN_CONFIRM, deletedAt: null } })
    ?? await prisma.category.create({ data: { name: CATEGORY_RETURN_CONFIRM } });
  const tiers = [
    { name: 'Test Trả Muộn', type: 'late', amount: 10000 },
    { name: 'Test Mất Sách', type: 'lost', amount: 150000 },
    { name: 'Test Hư Hỏng Ẩn', type: 'damaged', amount: 30000, isActive: false },
  ];
  for (const tier of tiers) {
    if (!await prisma.fineTier.findFirst({ where: { name: tier.name } })) await prisma.fineTier.create({ data: tier });
  }
  const base = { author: 'Tác Giả XT', publishYear: 2023, description: 'Dữ liệu test 2.4.2', categoryId: category.id };
  const FIXTURES = [
    ['XT 01 Bình Thường', 5], ['XT 02 Trả Muộn', -4], ['XT 03 Hư Hỏng', 3],
    ['XT 04 Mất', -2], ['XT 05 Từ Chối', 6], ['XT 06 Tại Quầy', 2],
  ];
  const books = [];
  for (const [title] of FIXTURES) {
    books.push(await prisma.book.create({
      data: { ...base, title: `Test Sách ${title}`, totalQuantity: 3, availableQuantity: 1, borrowedQuantity: 2 },
    }));
  }
  const at = (daysAgo) => new Date(Date.now() - daysAgo * DAY);
  let age = 0;
  for (const { id: readerId } of readers) {
    for (const [index, [, dueIn]] of FIXTURES.entries()) {
      const order = await prisma.borrowOrder.create({
        data: {
          readerId, bookId: books[index].id, status: 'borrowing', processedById: librarian.id,
          processedAt: at(20), createdAt: at(21), borrowedAt: at(20), dueDate: businessDate(dueIn),
        },
      });
      // Phút lệch nhau để thứ tự ổn định: test.giver trước, trong mỗi độc giả XT 01 → 05.
      if (index < 5) {
        await prisma.returnRequest.create({
          data: { borrowOrderId: order.id, requestedById: readerId, createdAt: new Date(at(70).getTime() + (age += 1) * 60000) },
        });
      }
    }
  }
  console.log(`category  "${CATEGORY_RETURN_CONFIRM}" (id ${category.id}) cho 2.4.2: ${books.map((b) => `${b.title.slice(10, 15)} ${b.id}`).join(', ')}`);
}

// 2.5.1: mức phạt "Test MP ..." (tên ≤ 25 ký tự). Mỗi cặp có bản API (Postman) và E2E:
//   Sửa  → chưa dùng, test sửa tên/số tiền và khóa lạc quan (edge 7)
//   Xóa  → chưa dùng, xóa hẳn
//   Dùng → có 1 phiếu phạt đã thanh toán của test.tiered, xóa thì chỉ ẩn (edge 4)
// Phiếu gắn với đơn đã trả (tình trạng Mất) của sách MP 01 trong thể loại "Test Mức Phạt".
const CATEGORY_FINE_TIER = 'Test Mức Phạt';

async function seedFineTiers(prisma) {
  const reader = await prisma.user.findUnique({ where: { email: 'test.tiered@example.com' }, select: { id: true } });
  const librarian = await prisma.user.findUnique({ where: { email: 'test.librarian@example.com' }, select: { id: true } });
  const category = await prisma.category.findFirst({ where: { name: CATEGORY_FINE_TIER, deletedAt: null } })
    ?? await prisma.category.create({ data: { name: CATEGORY_FINE_TIER } });
  const book = await prisma.book.create({
    data: {
      title: 'Test Sách MP 01 Mức Phạt', author: 'Tác Giả MP', publishYear: 2023, description: 'Dữ liệu test 2.5.1',
      categoryId: category.id, totalQuantity: 3, availableQuantity: 3,
    },
  });
  const created = [];
  for (const [name, type, amount] of [
    ['Test MP Sửa API', 'late', 5000], ['Test MP Sửa E2E', 'late', 6000],
    ['Test MP Xóa API', 'damaged', 7000], ['Test MP Xóa E2E', 'damaged', 8000],
    ['Test MP Dùng API', 'lost', 200000], ['Test MP Dùng E2E', 'lost', 210000],
  ]) {
    created.push(await prisma.fineTier.create({ data: { name, type, amount } }));
  }
  const at = (daysAgo) => new Date(Date.now() - daysAgo * DAY);
  for (const tier of created.filter((t) => t.name.startsWith('Test MP Dùng'))) {
    const order = await prisma.borrowOrder.create({
      data: {
        readerId: reader.id, bookId: book.id, status: 'returned', processedById: librarian.id, processedAt: at(40),
        createdAt: at(41), borrowedAt: at(40), dueDate: businessDate(-26), returnedAt: at(30),
      },
    });
    const returnRequest = await prisma.returnRequest.create({
      data: {
        borrowOrderId: order.id, status: 'confirmed', requestedById: reader.id, processedById: librarian.id,
        processedAt: at(30), condition: 'lost', conditionNote: 'Dữ liệu test 2.5.1', lateDays: 0,
      },
    });
    await prisma.fineTicket.create({
      data: {
        readerId: reader.id, borrowOrderId: order.id, returnRequestId: returnRequest.id, fineTierId: tier.id,
        type: 'lost', tierName: tier.name, amount: tier.amount, status: 'paid', issuedById: librarian.id,
        issuedAt: at(30), submittedAt: at(29), confirmedById: librarian.id, confirmedAt: at(28),
      },
    });
  }
  console.log(`fine-tier ${created.map((t) => `"${t.name}" ${t.id}`).join(', ')} cho 2.5.1`);
}

// 2.5.2: test.payer (Postman) và test.payee (E2E) có cùng 5 phiếu phạt, sách TT 01 thể loại
// "Test Thanh Toán Phạt"; mỗi phiếu một đơn đã trả + một yêu cầu trả đã xác nhận riêng.
//   TT-A Trả muộn 10.000 Chưa thanh toán (mới nhất)   TT-B Hư hỏng 50.000 Chưa thanh toán
//   TT-C Mất 120.000 Từ chối (có lý do)               TT-D Trả muộn 10.000 Chờ xác nhận
//   TT-E Hư hỏng 50.000 Đã thanh toán
const CATEGORY_FINE_PAYMENT = 'Test Thanh Toán Phạt';

async function seedFinePayment(prisma) {
  const librarian = await prisma.user.findUnique({ where: { email: 'test.librarian@example.com' }, select: { id: true } });
  const category = await prisma.category.findFirst({ where: { name: CATEGORY_FINE_PAYMENT, deletedAt: null } })
    ?? await prisma.category.create({ data: { name: CATEGORY_FINE_PAYMENT } });
  const book = await prisma.book.create({
    data: {
      title: 'Test Sách TT 01 Thanh Toán', author: 'Tác Giả TT', publishYear: 2023, description: 'Dữ liệu test 2.5.2',
      categoryId: category.id, totalQuantity: 3, availableQuantity: 3,
    },
  });
  const tiers = {};
  for (const [name, type, amount] of [
    ['Test TT Trả Muộn', 'late', 10000], ['Test TT Hư Hỏng', 'damaged', 50000], ['Test TT Mất', 'lost', 120000],
  ]) {
    tiers[type] = await prisma.fineTier.create({ data: { name, type, amount } });
  }
  const at = (daysAgo) => new Date(Date.now() - daysAgo * DAY);
  const tickets = [
    // [type, status, ngày phạt cách đây, thêm]
    ['late', 'unpaid', 1, {}],
    ['damaged', 'unpaid', 2, { note: 'Rách bìa (test 2.5.2)' }],
    ['lost', 'rejected', 3, { submittedAt: at(2), rejectedAt: at(1), rejectReason: 'Chưa nhận được tiền chuyển khoản' }],
    ['late', 'pending', 4, { submittedAt: at(3) }],
    ['damaged', 'paid', 5, { submittedAt: at(4), confirmedAt: at(3) }],
  ];
  for (const email of ['test.payer@example.com', 'test.payee@example.com']) {
    const reader = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    const ids = [];
    for (const [type, status, daysAgo, extra] of tickets) {
      const order = await prisma.borrowOrder.create({
        data: {
          readerId: reader.id, bookId: book.id, status: 'returned', processedById: librarian.id, processedAt: at(daysAgo + 20),
          createdAt: at(daysAgo + 21), borrowedAt: at(daysAgo + 20), dueDate: businessDate(-daysAgo - 6), returnedAt: at(daysAgo),
        },
      });
      const condition = type === 'late' ? 'normal' : type;
      const returnRequest = await prisma.returnRequest.create({
        data: {
          borrowOrderId: order.id, status: 'confirmed', requestedById: reader.id, processedById: librarian.id,
          processedAt: at(daysAgo), condition, conditionNote: condition === 'normal' ? null : 'Dữ liệu test 2.5.2',
          lateDays: type === 'late' ? 6 : 0,
        },
      });
      const tier = tiers[type];
      const ticket = await prisma.fineTicket.create({
        data: {
          readerId: reader.id, borrowOrderId: order.id, returnRequestId: returnRequest.id, fineTierId: tier.id,
          type, tierName: tier.name, amount: tier.amount, status, issuedById: librarian.id, issuedAt: at(daysAgo),
          confirmedById: status === 'paid' ? librarian.id : null, ...extra,
        },
      });
      ids.push(ticket.id);
    }
    console.log(`fine      ${email}: phiếu TT-A..E = ${ids.join(', ')} cho 2.5.2`);
  }
}

// 2.5.3: sách XP 01 thể loại "Test Xác Nhận Phạt", mức "Test XP Trả Muộn" 10.000 / "Test XP Hư Hỏng" 50.000 /
// "Test XP Mất" 120.000. Phiếu chờ xác nhận gửi từ 60+ ngày trước nên đứng đầu hàng đợi (gửi sớm nhất trước).
//   test.settler (Postman) / test.settlee (E2E):
//     XP-A Trả muộn Chờ xác nhận (để xác nhận)   XP-B Hư hỏng Chờ xác nhận, có ghi chú (để từ chối)
//     XP-C Mất Chưa thanh toán (edge 2)          XP-D Hư hỏng Đã thanh toán (edge 7)
//   test.clearer (Postman) / test.cleared (E2E): chỉ XP-E Mất Chờ xác nhận → xác nhận xong hết bị chặn mượn (edge 5).
const CATEGORY_FINE_REVIEW = 'Test Xác Nhận Phạt';

async function seedFineReview(prisma) {
  const librarian = await prisma.user.findUnique({ where: { email: 'test.librarian@example.com' }, select: { id: true } });
  const category = await prisma.category.findFirst({ where: { name: CATEGORY_FINE_REVIEW, deletedAt: null } })
    ?? await prisma.category.create({ data: { name: CATEGORY_FINE_REVIEW } });
  const book = await prisma.book.create({
    data: {
      title: 'Test Sách XP 01 Xác Nhận Phạt', author: 'Tác Giả XP', publishYear: 2023, description: 'Dữ liệu test 2.5.3',
      categoryId: category.id, totalQuantity: 3, availableQuantity: 3,
    },
  });
  const tiers = {};
  for (const [name, type, amount] of [
    ['Test XP Trả Muộn', 'late', 10000], ['Test XP Hư Hỏng', 'damaged', 50000], ['Test XP Mất', 'lost', 120000],
  ]) {
    tiers[type] = await prisma.fineTier.create({ data: { name, type, amount } });
  }
  const at = (daysAgo) => new Date(Date.now() - daysAgo * DAY);
  // [type, status, ngày phạt cách đây, thêm]
  const sets = {
    full: [
      ['late', 'pending', 70, { submittedAt: at(69) }],
      ['damaged', 'pending', 70, { submittedAt: at(68), note: 'Rách bìa (test 2.5.3)' }],
      ['lost', 'unpaid', 2, {}],
      ['damaged', 'paid', 5, { submittedAt: at(4), confirmedAt: at(3), confirmedById: librarian.id }],
    ],
    single: [['lost', 'pending', 70, { submittedAt: at(67) }]],
  };
  // Postman trước E2E: offset làm phiếu của Postman gửi sớm hơn, thứ tự trong hàng đợi cố định.
  for (const [email, set, offset] of [
    ['test.settler@example.com', 'full', 20], ['test.clearer@example.com', 'single', 20],
    ['test.settlee@example.com', 'full', 0], ['test.cleared@example.com', 'single', 0],
  ]) {
    const reader = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    const ids = [];
    for (const [type, status, daysAgo, extra] of sets[set]) {
      const shift = (date) => new Date(date.getTime() - offset * DAY);
      const order = await prisma.borrowOrder.create({
        data: {
          readerId: reader.id, bookId: book.id, status: 'returned', processedById: librarian.id,
          processedAt: shift(at(daysAgo + 20)), createdAt: shift(at(daysAgo + 21)), borrowedAt: shift(at(daysAgo + 20)),
          dueDate: businessDate(-daysAgo - offset - 6), returnedAt: shift(at(daysAgo)),
        },
      });
      const condition = type === 'late' ? 'normal' : type;
      const returnRequest = await prisma.returnRequest.create({
        data: {
          borrowOrderId: order.id, status: 'confirmed', requestedById: reader.id, processedById: librarian.id,
          processedAt: shift(at(daysAgo)), condition, conditionNote: condition === 'normal' ? null : 'Dữ liệu test 2.5.3',
          lateDays: type === 'late' ? 6 : 0,
        },
      });
      const tier = tiers[type];
      const ticket = await prisma.fineTicket.create({
        data: {
          readerId: reader.id, borrowOrderId: order.id, returnRequestId: returnRequest.id, fineTierId: tier.id,
          type, tierName: tier.name, amount: tier.amount, status, issuedById: librarian.id, issuedAt: shift(at(daysAgo)),
          ...extra,
          ...(extra.submittedAt && { submittedAt: shift(extra.submittedAt) }),
          ...(extra.confirmedAt && { confirmedAt: shift(extra.confirmedAt) }),
        },
      });
      ids.push(ticket.id);
    }
    console.log(`fine      ${email}: phiếu ${set === 'full' ? 'XP-A..D' : 'XP-E'} = ${ids.join(', ')} cho 2.5.3`);
  }
}

// 2.6.1: mỗi tài khoản test.um.*.active đang mượn 1 cuốn "Test Sách ND 01" (cảnh báo edge 3). Trạng thái
// tài khoản được upsert lại ở main; audit log kích hoạt / vô hiệu hóa của tài khoản test được dọn.
const CATEGORY_USER_LIST = 'Test Người Dùng';

async function seedUserList(prisma) {
  const testUsers = await prisma.user.findMany({
    where: { email: { in: USERS.map((u) => u.email) } }, select: { id: true },
  });
  const logs = await prisma.auditLog.deleteMany({
    where: { entityType: 'user', entityId: { in: testUsers.map((u) => u.id) } },
  });
  const librarian = await prisma.user.findUnique({ where: { email: 'test.librarian@example.com' }, select: { id: true } });
  const category = await prisma.category.findFirst({ where: { name: CATEGORY_USER_LIST, deletedAt: null } })
    ?? await prisma.category.create({ data: { name: CATEGORY_USER_LIST } });
  const book = await prisma.book.create({
    data: {
      title: 'Test Sách ND 01 Người Dùng', author: 'Tác Giả ND', publishYear: 2023, description: 'Dữ liệu test 2.6.1',
      categoryId: category.id, totalQuantity: 3, availableQuantity: 1, borrowedQuantity: 2,
    },
  });
  const at = (daysAgo) => new Date(Date.now() - daysAgo * DAY);
  for (const email of ['test.um.api.active@example.com', 'test.um.e2e.active@example.com']) {
    const reader = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    await prisma.borrowOrder.create({
      data: {
        readerId: reader.id, bookId: book.id, status: 'borrowing', processedById: librarian.id,
        processedAt: at(3), createdAt: at(4), borrowedAt: at(3), dueDate: businessDate(11),
      },
    });
  }
  console.log(`user      7 tài khoản test.um.* cho 2.6.1; đã dọn ${logs.count} audit log`);
}

// 2.6.2: mỗi test.ur.*.reader đang mượn 1 cuốn và có 1 đơn chờ duyệt "Test Sách VT 01" để client cảnh báo
// khi đổi vai trò. Audit log đổi vai trò đã được seedUserList dọn.
const CATEGORY_ROLE_CHANGE = 'Test Vai Trò';

async function seedRoleChange(prisma) {
  const librarian = await prisma.user.findUnique({ where: { email: 'test.librarian@example.com' }, select: { id: true } });
  const category = await prisma.category.findFirst({ where: { name: CATEGORY_ROLE_CHANGE, deletedAt: null } })
    ?? await prisma.category.create({ data: { name: CATEGORY_ROLE_CHANGE } });
  const book = await prisma.book.create({
    data: {
      title: 'Test Sách VT 01 Vai Trò', author: 'Tác Giả VT', publishYear: 2023, description: 'Dữ liệu test 2.6.2',
      categoryId: category.id, totalQuantity: 4, availableQuantity: 2, borrowedQuantity: 2,
    },
  });
  // Mỗi độc giả chỉ có một đơn đang hoạt động cho một cuốn (borrow_orders_active_reader_book_key).
  const pendingBook = await prisma.book.create({
    data: {
      title: 'Test Sách VT 02 Chờ Duyệt', author: 'Tác Giả VT', publishYear: 2023, description: 'Dữ liệu test 2.6.2',
      categoryId: category.id, totalQuantity: 2, availableQuantity: 2,
    },
  });
  const at = (daysAgo) => new Date(Date.now() - daysAgo * DAY);
  for (const email of ['test.ur.api.reader@example.com', 'test.ur.e2e.reader@example.com']) {
    const reader = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    await prisma.borrowOrder.create({
      data: {
        readerId: reader.id, bookId: book.id, status: 'borrowing', processedById: librarian.id,
        processedAt: at(3), createdAt: at(4), borrowedAt: at(3), dueDate: businessDate(11),
      },
    });
    await prisma.borrowOrder.create({ data: { readerId: reader.id, bookId: pendingBook.id, status: 'pending', createdAt: at(1) } });
  }
  console.log('user      6 tài khoản test.ur.* cho 2.6.2');
}

// 2.7.1: số liệu dashboard là tổng toàn hệ thống nên test chỉ kiểm tra được những dòng chắc chắn đứng đầu.
// DB 01 (borrow_count 9999) đứng đầu Top 5, DB 02 (9998) đã xóa vẫn đứng thứ 2 (edge 7); test.dashboard
// quá hạn 45 và 40 ngày nên đứng đầu danh sách nợ quá hạn, và có 1 đơn chờ duyệt tạo hôm nay (DB 04).
const CATEGORY_DASHBOARD = 'Test Dashboard';

async function seedDashboard(prisma) {
  const librarian = await prisma.user.findUnique({ where: { email: 'test.librarian@example.com' }, select: { id: true } });
  const reader = await prisma.user.findUnique({ where: { email: 'test.dashboard@example.com' }, select: { id: true } });
  const category = await prisma.category.findFirst({ where: { name: CATEGORY_DASHBOARD, deletedAt: null } })
    ?? await prisma.category.create({ data: { name: CATEGORY_DASHBOARD } });
  const book = (title, data) => prisma.book.create({
    data: {
      title, author: 'Tác Giả DB', publishYear: 2023, description: 'Dữ liệu test 2.7.1', categoryId: category.id,
      totalQuantity: 2, availableQuantity: 2, ...data,
    },
  });
  const popular = await book('Test Sách DB 01 Phổ Biến', { availableQuantity: 1, borrowedQuantity: 1, borrowCount: 9999 });
  await book('Test Sách DB 02 Đã Xóa', { borrowCount: 9998, deletedAt: new Date() });
  const overdue = await book('Test Sách DB 03 Quá Hạn', { availableQuantity: 1, borrowedQuantity: 1, borrowCount: 1 });
  const today = await book('Test Sách DB 04 Hôm Nay', {});
  const at = (daysAgo) => new Date(Date.now() - daysAgo * DAY);
  for (const [bookId, lateDays] of [[popular.id, 45], [overdue.id, 40]]) {
    await prisma.borrowOrder.create({
      data: {
        readerId: reader.id, bookId, status: 'borrowing', processedById: librarian.id, processedAt: at(lateDays + 14),
        createdAt: at(lateDays + 15), borrowedAt: at(lateDays + 14), dueDate: businessDate(-lateDays),
      },
    });
  }
  await prisma.borrowOrder.create({ data: { readerId: reader.id, bookId: today.id, status: 'pending' } });
  console.log('book      4 sách Test Sách DB 0x cho 2.7.1');
}

// 2.7.2: dữ liệu nằm trong quý 1/2020, trước mọi dữ liệu khác của hệ thống, nên báo cáo lọc 01/01/2020 –
// 31/03/2020 cho số liệu chính xác. Theo tháng: mượn 3/2/2, trả 2/2/3 (tổng 7/7). Đơn mượn lúc 00:30 ngày
// 01/01/2020 giờ Việt Nam được tính, đơn trả lúc 23:30 ngày 31/12/2019 thì không (ranh giới múi giờ).
// Phạt: phát sinh 3 phiếu 90.060.000 đ, đã thu 60.000 đ, chưa thu 90.000.000 đ (phiếu Mất của test.report,
// nên test.report đứng đầu danh sách nợ). Sách mất/hư: BC 02 mất 1 bản (01/03), hư 1 bản (01/02).
// Sách BC 03 có tên chứa nháy kép + dấu phẩy và tác giả bắt đầu bằng "=" (CSV edge 4, 5).
const CATEGORY_REPORT = 'Test Báo Cáo';

async function seedReport(prisma) {
  const librarian = await prisma.user.findUnique({ where: { email: 'test.librarian@example.com' }, select: { id: true } });
  const reader = await prisma.user.findUnique({ where: { email: 'test.report@example.com' }, select: { id: true } });
  const category = await prisma.category.findFirst({ where: { name: CATEGORY_REPORT, deletedAt: null } })
    ?? await prisma.category.create({ data: { name: CATEGORY_REPORT } });
  const book = (title, data) => prisma.book.create({
    data: {
      title, author: 'Tác Giả BC', publishYear: 2019, description: 'Dữ liệu test 2.7.2', categoryId: category.id, ...data,
    },
  });
  const many = await book('Test Sách BC 01 Mượn Nhiều', { totalQuantity: 5, availableQuantity: 5, borrowCount: 3 });
  // Ban đầu 4 bản: 1 bản mất (tổng −1), 1 bản hư (vào damaged, không về kho).
  const broken = await book('Test Sách BC 02 Mất Hư', {
    isbn: '9780262033848', totalQuantity: 3, availableQuantity: 2, damagedQuantity: 1, borrowCount: 2,
  });
  const quoted = await book('Test Sách BC 03 "Nháy", Phẩy', {
    author: '=1+1 Tác Giả BC', totalQuantity: 2, availableQuantity: 2, borrowCount: 3,
  });
  const tiers = {};
  for (const [name, type, amount] of [
    ['Test BC Trả Muộn', 'late', 10000], ['Test BC Hư Hỏng', 'damaged', 50000], ['Test BC Mất', 'lost', 90000000],
  ]) {
    tiers[type] = await prisma.fineTier.create({ data: { name, type, amount } });
  }
  // Giờ UTC; 05:00Z là 12:00 ở Việt Nam.
  const noon = (date) => new Date(`${date}T05:00:00Z`);
  const HOUR = 3600 * 1000;
  // [sách, mượn lúc, trả lúc, tình trạng, số ngày được mượn, phiếu phạt]
  const ORDERS = [
    [many, noon('2020-01-10'), noon('2020-01-17'), 'normal', 14],
    [many, noon('2020-02-05'), noon('2020-02-12'), 'normal', 14],
    [many, noon('2020-03-15'), noon('2020-03-22'), 'normal', 4, { type: 'late', status: 'paid', submittedAt: noon('2020-03-24'), confirmedAt: noon('2020-03-25') }],
    [broken, noon('2020-01-20'), noon('2020-02-01'), 'damaged', 14, { type: 'damaged', status: 'paid', submittedAt: noon('2020-02-02'), confirmedAt: noon('2020-02-03') }],
    [broken, noon('2020-02-20'), noon('2020-03-01'), 'lost', 14, { type: 'lost', status: 'unpaid' }],
    [quoted, noon('2019-12-20'), new Date('2019-12-31T16:30:00Z'), 'normal', 14],
    [quoted, new Date('2019-12-31T17:30:00Z'), noon('2020-01-05'), 'normal', 14],
    [quoted, noon('2020-03-05'), noon('2020-03-10'), 'normal', 14],
  ];
  for (const [target, borrowedAt, returnedAt, condition, days, fine] of ORDERS) {
    const dueDate = new Date(Date.parse(borrowedAt.toISOString().slice(0, 10)) + days * DAY);
    const lateDays = Math.max(0, Math.round((Date.parse(returnedAt.toISOString().slice(0, 10)) - dueDate.getTime()) / DAY));
    const order = await prisma.borrowOrder.create({
      data: {
        readerId: reader.id, bookId: target.id, status: 'returned', requestedDays: days, processedById: librarian.id,
        createdAt: new Date(borrowedAt.getTime() - HOUR), processedAt: borrowedAt, borrowedAt, dueDate, returnedAt,
      },
    });
    const returnRequest = await prisma.returnRequest.create({
      data: {
        borrowOrderId: order.id, status: 'confirmed', requestedById: reader.id, processedById: librarian.id,
        processedAt: returnedAt, createdAt: new Date(returnedAt.getTime() - HOUR), condition, lateDays,
        conditionNote: condition === 'normal' ? null : 'Dữ liệu test 2.7.2',
      },
    });
    if (!fine) continue;
    const { type, ...status } = fine;
    const tier = tiers[type];
    await prisma.fineTicket.create({
      data: {
        readerId: reader.id, borrowOrderId: order.id, returnRequestId: returnRequest.id, fineTierId: tier.id, type,
        tierName: tier.name, amount: tier.amount, issuedById: librarian.id, issuedAt: returnedAt,
        ...status, ...(status.confirmedAt && { confirmedById: librarian.id }),
      },
    });
  }
  console.log(`book      3 sách Test Sách BC 0x (id ${many.id}, ${broken.id}, ${quoted.id}) cho 2.7.2`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
