const express = require('express');
const { validateBody } = require('../../middlewares/validate');
const { requireRole } = require('../../middlewares/auth');
const { HttpError } = require('../../lib/httpError');
// Id đơn cùng quy tắc với id sách: không phải số nguyên dương → 404.
const { parseBookId: parseId } = require('../book/book.validation');
const { ORDER_NOT_FOUND } = require('./borrow.service');
const { createBorrowSchema } = require('./borrow.validation');

// 2.3.1: chỉ độc giả gửi và hủy yêu cầu mượn của chính mình.
function createBorrowRouter(borrowService, requireAuth) {
  const router = express.Router();
  const readerOnly = [requireAuth, requireRole('reader')];

  router.post('/', ...readerOnly, validateBody(createBorrowSchema), async (req, res) => {
    res.status(201).json(await borrowService.createBorrowOrder(req.user.id, req.body));
  });

  router.post('/:id/cancel', ...readerOnly, async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) throw new HttpError(404, ORDER_NOT_FOUND);
    await borrowService.cancelBorrowOrder(req.user.id, id);
    res.json({ message: 'Đã hủy yêu cầu mượn' });
  });

  return router;
}

module.exports = { createBorrowRouter };
