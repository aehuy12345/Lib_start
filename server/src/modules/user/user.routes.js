const express = require('express');
const { validateBody, validateQuery } = require('../../middlewares/validate');
const { requireRole } = require('../../middlewares/auth');
const { HttpError } = require('../../lib/httpError');
const { listUsersQuerySchema, changeRoleSchema, parseUserId } = require('./user.validation');
const { USER_NOT_FOUND } = require('./user.service');

function userIdParam(req, res, next) {
  req.userId = parseUserId(req.params.id);
  if (!req.userId) throw new HttpError(404, USER_NOT_FOUND);
  next();
}

// 2.6.1, 2.6.2: chỉ quản lý viên (Admin); nhân viên thư viện và độc giả nhận 403 (2.6.1 edge 8, 2.6.2 edge 6).
function createUserRouter(userService, requireAuth) {
  const router = express.Router();
  router.use(requireAuth, requireRole('admin'));

  router.get('/', validateQuery(listUsersQuerySchema), async (req, res) => {
    res.json(await userService.listUsers(req.user.id, req.query));
  });

  router.post('/:id/disable', userIdParam, async (req, res) => {
    res.json(await userService.disableUser(req.user.id, req.userId));
  });

  router.post('/:id/activate', userIdParam, async (req, res) => {
    res.json(await userService.activateUser(req.user.id, req.userId));
  });

  // 2.6.2: gán vai trò.
  router.post('/:id/role', userIdParam, validateBody(changeRoleSchema), async (req, res) => {
    res.json(await userService.changeRole(req.user.id, req.userId, req.body.role));
  });

  return router;
}

module.exports = { createUserRouter };
