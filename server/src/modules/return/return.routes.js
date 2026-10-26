const express = require('express');
const { validateBody } = require('../../middlewares/validate');
const { requireRole } = require('../../middlewares/auth');
const { HttpError } = require('../../lib/httpError');
const { parseBookId: parseId } = require('../book/book.validation');
const { RETURN_NOT_FOUND } = require('./return.service');
const { createReturnSchema } = require('./return.validation');

// 2.4.1: độc giả gửi và hủy yêu cầu trả sách của chính mình.
function createReturnRouter(returnService, requireAuth) {
  const router = express.Router();
  const readerOnly = [requireAuth, requireRole('reader')];

  router.post('/', ...readerOnly, validateBody(createReturnSchema), async (req, res) => {
    res.status(201).json(await returnService.createReturnRequest(req.user.id, req.body));
  });

  router.post('/:id/cancel', ...readerOnly, async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) throw new HttpError(404, RETURN_NOT_FOUND);
    res.json(await returnService.cancelReturnRequest(req.user.id, id));
  });

  return router;
}

module.exports = { createReturnRouter };
