const express = require('express');
const { validateBody } = require('../../middlewares/validate');
const { registerSchema, verifyEmailSchema } = require('./auth.validation');

function createAuthRouter(authService) {
  const router = express.Router();

  router.post('/register', validateBody(registerSchema), async (req, res) => {
    const user = await authService.register(req.body);
    res.status(201).json({
      message: 'Đăng ký thành công. Tài khoản đang chờ xác nhận, vui lòng kiểm tra email.',
      user,
    });
  });

  router.post('/verify-email', validateBody(verifyEmailSchema), async (req, res) => {
    const user = await authService.verifyEmail(req.body);
    res.json({ message: 'Xác nhận email thành công', user });
  });

  return router;
}

module.exports = { createAuthRouter };
