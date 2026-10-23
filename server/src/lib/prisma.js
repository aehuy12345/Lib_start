const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');

let client;

// Tạo lazily để test không có DATABASE_URL vẫn import được app.
function getPrisma() {
  if (!client) {
    const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
    client = new PrismaClient({ adapter });
  }
  return client;
}

module.exports = { getPrisma };
