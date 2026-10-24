const express = require('express');
const { validateBody, validateQuery } = require('../../middlewares/validate');
const { requireRole } = require('../../middlewares/auth');
const { HttpError } = require('../../lib/httpError');
// Id đơn cùng quy tắc với id sách: không phải số nguyên dương → 404.
const { parseBookId: parseId } = require('../book/book.validation');
const { ORDER_NOT_FOUND } = require('./borrow.service');
const { createBorrowSchema, rejectBorrowSchema, pendingQuerySchema } = require('./borrow.validation');

function orderIdParam(req, res, next) {
  req.orderId = parseId(req.params.id);
  if (!req.orderId) throw new HttpError(404, ORDER_NOT_FOUND);
  next();
}

// 2.3.1: chỉ độc giả gửi và hủy yêu cầu mượn của chính mình.
// 2.3.2: nhân viên (cùng Admin, như các chức năng quản lý sách) duyệt đơn chờ.
function createBorrowRouter(borrowService, requireAuth) {
  const router = express.Router();
  const readerOnly = [requireAuth, requireRole('reader')];
  const staffOnly = [requireAuth, requireRole('librarian', 'admin')];

  router.get('/pending', ...staffOnly, validateQuery(pendingQuerySchema), async (req, res) => {
    res.json(await borrowService.listPendingOrders(req.query));
  });

  router.post('/:id/confirm', ...staffOnly, orderIdParam, async (req, res) => {
    res.json(await borrowService.confirmBorrowOrder(req.user.id, req.orderId));
  });

  router.post('/:id/reject', ...staffOnly, orderIdParam, validateBody(rejectBorrowSchema), async (req, res) => {
    res.json(await borrowService.rejectBorrowOrder(req.user.id, req.orderId, req.body));
  });

  router.post('/', ...readerOnly, validateBody(createBorrowSchema), async (req, res) => {
    res.status(201).json(await borrowService.createBorrowOrder(req.user.id, req.body));
  });

  router.post('/:id/cancel', ...readerOnly, orderIdParam, async (req, res) => {
    await borrowService.cancelBorrowOrder(req.user.id, req.orderId);
    res.json({ message: 'Đã hủy yêu cầu mượn' });
  });

  return router;
}

module.exports = { createBorrowRouter };
