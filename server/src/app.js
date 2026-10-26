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
const { createBookService } = require('./modules/book/book.service');
const { createBookRouter } = require('./modules/book/book.routes');
const { createBorrowService } = require('./modules/borrow/borrow.service');
const { createBorrowRouter } = require('./modules/borrow/borrow.routes');
const { createReturnService } = require('./modules/return/return.service');
const { createReturnRouter } = require('./modules/return/return.routes');
const { createFineService } = require('./modules/fine/fine.service');
const { createFineTierRouter } = require('./modules/fine/fine.routes');
const { createFineTicketService } = require('./modules/fine/fineTicket.service');
const { createFineTicketRouter } = require('./modules/fine/fineTicket.routes');
const { createUserService } = require('./modules/user/user.service');
const { createUserRouter } = require('./modules/user/user.routes');
const { createDashboardService } = require('./modules/dashboard/dashboard.service');
const { createDashboardRouter } = require('./modules/dashboard/dashboard.routes');
const { createReportService } = require('./modules/report/report.service');
const { createReportRouter } = require('./modules/report/report.routes');

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
    book: deps.bookService ?? createBookService({ prisma, storage }),
    borrow: deps.borrowService ?? createBorrowService({ prisma }),
    return: deps.returnService ?? createReturnService({ prisma }),
    fine: deps.fineService ?? createFineService({ prisma }),
    fineTicket: deps.fineTicketService ?? createFineTicketService({ prisma, storage }),
    user: deps.userService ?? createUserService({ prisma }),
    dashboard: deps.dashboardService ?? createDashboardService({ prisma }),
    report: deps.reportService ?? createReportService({ prisma }),
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
  app.use('/api/books', createBookRouter(services.book, requireAuth));
  app.use('/api/borrow-orders', createBorrowRouter(services.borrow, requireAuth));
  app.use('/api/return-requests', createReturnRouter(services.return, requireAuth));
  app.use('/api/fine-tiers', createFineTierRouter(services.fine, requireAuth));
  app.use('/api/fine-tickets', createFineTicketRouter(services.fineTicket, requireAuth));
  app.use('/api/users', createUserRouter(services.user, requireAuth));
  app.use('/api/dashboard', createDashboardRouter(services.dashboard, requireAuth));
  app.use('/api/reports', createReportRouter(services.report, requireAuth));

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
