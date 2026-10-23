// Tạo/cập nhật tài khoản cố định cho API test (Postman) và E2E (Playwright).
// Chạy: node scripts/seed-test-users.js  (cần DATABASE_URL trong .env)
require('dotenv/config');
const bcrypt = require('bcryptjs');
const { getPrisma } = require('../src/lib/prisma');

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

  await seedCategories(prisma);
  await prisma.$disconnect();
}

// 2.2.1: thể loại cố định có 1 sách (test chặn xóa) và dọn các thể loại "Test ..." do API/E2E test tạo ra.
const CATEGORY_WITH_BOOK = 'Test Có Sách';

async function seedCategories(prisma) {
  const removed = await prisma.category.deleteMany({
    where: { name: { startsWith: 'Test ' }, NOT: { name: CATEGORY_WITH_BOOK }, books: { none: {} } },
  });
  let category = await prisma.category.findFirst({ where: { name: CATEGORY_WITH_BOOK, deletedAt: null } });
  if (!category) category = await prisma.category.create({ data: { name: CATEGORY_WITH_BOOK } });
  const book = await prisma.book.findFirst({ where: { categoryId: category.id, deletedAt: null } });
  if (!book) {
    await prisma.book.create({
      data: {
        title: 'Sách Test Thể Loại', author: 'Test', publishYear: 2020, description: 'Dữ liệu test 2.2.1',
        categoryId: category.id, totalQuantity: 1, availableQuantity: 1,
      },
    });
  }
  console.log(`category  "${CATEGORY_WITH_BOOK}" (id ${category.id}) có sách; đã dọn ${removed.count} thể loại test`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
