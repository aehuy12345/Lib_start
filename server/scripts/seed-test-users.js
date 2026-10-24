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
  const fines = await prisma.fineTicket.deleteMany({ where: { reader: readers } });
  await prisma.returnRequest.deleteMany({ where: { borrowOrder: { reader: readers } } });
  const orders = await prisma.borrowOrder.deleteMany({ where: { reader: readers } });
  await prisma.fineTier.deleteMany({ where: { name: { startsWith: 'Test ' }, fineTickets: { none: {} } } });
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

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
