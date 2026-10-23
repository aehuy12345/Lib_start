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
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
