const express = require('express');
const cors = require('cors');
const { getPrisma } = require('./lib/prisma');
const { createConsoleMailer } = require('./lib/mailer');
const { createTokenService } = require('./lib/tokens');
const { errorHandler } = require('./middlewares/errorHandler');
const { createRequireAuth } = require('./middlewares/auth');
const { createAuthService } = require('./modules/auth/auth.service');
const { createAuthRouter } = require('./modules/auth/auth.routes');
const { createSupabaseStorage } = require('./lib/storage');
const { createProfileService } = require('./modules/profile/profile.service');
const { createProfileRouter } = require('./modules/profile/profile.routes');
const { createCategoryService } = require('./modules/category/category.service');
const { createCategoryRouter } = require('./modules/category/category.routes');

// deps cho phép test thay prisma/mailer/tokens/storage bằng bản giả.
function createApp(deps = {}) {
  const tokens = deps.tokens ?? createTokenService({
    secret: process.env.JWT_SECRET,
    expiresIn: process.env.JWT_EXPIRES_IN || '24h',
  });
  const prisma = deps.prisma ?? lazyPrisma();
  const storage = deps.storage ?? createSupabaseStorage({
    url: process.env.SUPABASE_URL,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  });
  const services = {
    auth: deps.authService ?? createAuthService({
      prisma,
      mailer: deps.mailer ?? createConsoleMailer(),
      clientUrl: process.env.CLIENT_URL || 'http://localhost:5173',
      tokens,
    }),
    profile: deps.profileService ?? createProfileService({ prisma, storage }),
    category: deps.categoryService ?? createCategoryService({ prisma }),
  };
  const requireAuth = createRequireAuth({ tokens, authService: services.auth });

  const app = express();

  app.use(cors());
  app.use(express.json());

  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  app.use('/api/auth', createAuthRouter(services.auth, requireAuth));
  app.use('/api/profile', createProfileRouter(services.profile, requireAuth));
  app.use('/api/categories', createCategoryRouter(services.category, requireAuth));

  app.use((req, res) => {
    res.status(404).json({ message: 'Không tìm thấy' });
  });
  app.use(errorHandler);

  return app;
}

// Chỉ kết nối DB khi có truy vấn đầu tiên.
function lazyPrisma() {
  return new Proxy({}, { get: (_, prop) => getPrisma()[prop] });
}

module.exports = { createApp };
