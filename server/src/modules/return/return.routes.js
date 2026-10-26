const express = require('express');
const { validateBody, validateQuery } = require('../../middlewares/validate');
const { requireRole } = require('../../middlewares/auth');
const { HttpError } = require('../../lib/httpError');
const { parseBookId: parseId } = require('../book/book.validation');
const { rejectBorrowSchema } = require('../borrow/borrow.validation');
const { RETURN_NOT_FOUND } = require('./return.service');
const {
  createReturnSchema, confirmReturnSchema, counterReturnSchema, pendingReturnsQuerySchema, counterOrdersQuerySchema,
} = require('./return.validation');

function returnIdParam(req, res, next) {
  req.returnId = parseId(req.params.id);
  if (!req.returnId) throw new HttpError(404, RETURN_NOT_FOUND);
  next();
}

// 2.4.1: độc giả gửi và hủy yêu cầu trả sách của chính mình.
// 2.4.2: nhân viên (cùng Admin, như duyệt mượn 2.3.2) xác nhận, từ chối, nhận trả tại quầy.
function createReturnRouter(returnService, requireAuth) {
  const router = express.Router();
  const readerOnly = [requireAuth, requireRole('reader')];
  const staffOnly = [requireAuth, requireRole('librarian', 'admin')];

  router.get('/pending', ...staffOnly, validateQuery(pendingReturnsQuerySchema), async (req, res) => {
    res.json(await returnService.listPendingReturns(req.query));
  });

  router.get('/counter-orders', ...staffOnly, validateQuery(counterOrdersQuerySchema), async (req, res) => {
    res.json(await returnService.listCounterOrders(req.query));
  });

  router.post('/counter', ...staffOnly, validateBody(counterReturnSchema), async (req, res) => {
    res.json(await returnService.counterReturn(req.user.id, req.body));
  });

  router.post('/:id/confirm', ...staffOnly, returnIdParam, validateBody(confirmReturnSchema), async (req, res) => {
    res.json(await returnService.confirmReturnRequest(req.user.id, req.returnId, req.body));
  });

  // Lý do từ chối cùng quy tắc với từ chối đơn mượn (2.3.2): bắt buộc, trim, tối đa 500 ký tự.
  router.post('/:id/reject', ...staffOnly, returnIdParam, validateBody(rejectBorrowSchema), async (req, res) => {
    res.json(await returnService.rejectReturnRequest(req.user.id, req.returnId, req.body));
  });

  router.post('/', ...readerOnly, validateBody(createReturnSchema), async (req, res) => {
    res.status(201).json(await returnService.createReturnRequest(req.user.id, req.body));
  });

  router.post('/:id/cancel', ...readerOnly, returnIdParam, async (req, res) => {
    res.json(await returnService.cancelReturnRequest(req.user.id, req.returnId));
  });

  return router;
}

module.exports = { createReturnRouter };
