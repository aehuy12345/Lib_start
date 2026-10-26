const express = require('express');
const { validateQuery } = require('../../middlewares/validate');
const { requireRole } = require('../../middlewares/auth');
const { uploadImage } = require('../../middlewares/upload');
const { HttpError } = require('../../lib/httpError');
const { parseBookId: parseId } = require('../book/book.validation');
const { myTicketsQuerySchema } = require('./fineTicket.validation');
const { TICKET_NOT_FOUND } = require('./fineTicket.service');

function ticketIdParam(req, res, next) {
  req.ticketId = parseId(req.params.id);
  if (!req.ticketId) throw new HttpError(404, TICKET_NOT_FOUND);
  next();
}

// 2.5.2: độc giả xem và thanh toán phiếu phạt của chính mình.
function createFineTicketRouter(fineTicketService, requireAuth) {
  const router = express.Router();
  const readerOnly = [requireAuth, requireRole('reader')];

  router.get('/mine', ...readerOnly, validateQuery(myTicketsQuerySchema), async (req, res) => {
    res.json(await fineTicketService.listMyTickets(req.user.id, req.query));
  });

  // Ảnh biên lai tùy chọn: multipart field `receipt`, hoặc body rỗng/JSON khi không đính kèm.
  router.post('/:id/pay', ...readerOnly, ticketIdParam, uploadImage('receipt'), async (req, res) => {
    res.json(await fineTicketService.payTicket(req.user.id, req.ticketId, req.file));
  });

  router.get('/:id/receipt', ...readerOnly, ticketIdParam, async (req, res) => {
    res.json(await fineTicketService.getMyReceiptUrl(req.user.id, req.ticketId));
  });

  return router;
}

module.exports = { createFineTicketRouter };
