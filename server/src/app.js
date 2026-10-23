const express = require('express');
const cors = require('cors');
const { getPrisma } = require('./lib/prisma');
const { createConsoleMailer } = require('./lib/mailer');
const { createTokenService } = require('./lib/tokens');
const { errorHandler } = require('./middlewares/errorHandler');
const { createRequireAuth } = require('./middlewares/auth');
const { createAuthService } = require('./modules/auth/auth.service');
const { createAuthRouter } = require('./modules/auth/auth.routes');

// deps cho phép test thay prisma/mailer/tokens bằng bản giả.
function createApp(deps = {}) {
  const tokens = deps.tokens ?? createTokenService({
    secret: process.env.JWT_SECRET,
    expiresIn: process.env.JWT_EXPIRES_IN || '24h',
  });
  const services = {
    auth: deps.authService ?? createAuthService({
      prisma: deps.prisma ?? lazyPrisma(),
      mailer: deps.mailer ?? createConsoleMailer(),
      clientUrl: process.env.CLIENT_URL || 'http://localhost:5173',
      tokens,
    }),
  };
  const requireAuth = createRequireAuth({ tokens, authService: services.auth });

  const app = express();

  app.use(cors());
  app.use(express.json());

  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  app.use('/api/auth', createAuthRouter(services.auth, requireAuth));

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
