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

  await cleanTestBooks(prisma);
  await seedCategories(prisma);
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

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
