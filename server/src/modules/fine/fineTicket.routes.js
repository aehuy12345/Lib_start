const express = require('express');
const { validateBody, validateQuery } = require('../../middlewares/validate');
const { requireRole } = require('../../middlewares/auth');
const { uploadImage } = require('../../middlewares/upload');
const { HttpError } = require('../../lib/httpError');
const { parseBookId: parseId } = require('../book/book.validation');
const { rejectBorrowSchema } = require('../borrow/borrow.validation');
const { myTicketsQuerySchema, staffTicketsQuerySchema } = require('./fineTicket.validation');
const { TICKET_NOT_FOUND } = require('./fineTicket.service');

function ticketIdParam(req, res, next) {
  req.ticketId = parseId(req.params.id);
  if (!req.ticketId) throw new HttpError(404, TICKET_NOT_FOUND);
  next();
}

// 2.5.2: độc giả xem và thanh toán phiếu phạt của chính mình.
// 2.5.3: nhân viên (cùng Admin, như 2.3.2, 2.4.2) xem mọi phiếu, xác nhận hoặc từ chối; độc giả 403 (edge 6).
function createFineTicketRouter(fineTicketService, requireAuth) {
  const router = express.Router();
  const readerOnly = [requireAuth, requireRole('reader')];
  const staffOnly = [requireAuth, requireRole('librarian', 'admin')];

  router.get('/', ...staffOnly, validateQuery(staffTicketsQuerySchema), async (req, res) => {
    res.json(await fineTicketService.listTickets(req.query));
  });

  router.get('/mine', ...readerOnly, validateQuery(myTicketsQuerySchema), async (req, res) => {
    res.json(await fineTicketService.listMyTickets(req.user.id, req.query));
  });

  // Ảnh biên lai tùy chọn: multipart field `receipt`, hoặc body rỗng/JSON khi không đính kèm.
  router.post('/:id/pay', ...readerOnly, ticketIdParam, uploadImage('receipt'), async (req, res) => {
    res.json(await fineTicketService.payTicket(req.user.id, req.ticketId, req.file));
  });

  router.post('/:id/confirm', ...staffOnly, ticketIdParam, async (req, res) => {
    res.json(await fineTicketService.confirmTicket(req.user.id, req.ticketId));
  });

  // Edge 4: lý do cùng quy tắc với từ chối đơn mượn (2.3.2): bắt buộc, trim, tối đa 500 ký tự.
  router.post('/:id/reject', ...staffOnly, ticketIdParam, validateBody(rejectBorrowSchema), async (req, res) => {
    res.json(await fineTicketService.rejectTicket(req.user.id, req.ticketId, req.body));
  });

  // Độc giả chỉ xem biên lai của mình; nhân viên xem mọi phiếu để đối chiếu.
  router.get('/:id/receipt', requireAuth, ticketIdParam, async (req, res) => {
    res.json(req.user.role === 'reader'
      ? await fineTicketService.getMyReceiptUrl(req.user.id, req.ticketId)
      : await fineTicketService.getReceiptUrl(req.ticketId));
  });

  return router;
}

module.exports = { createFineTicketRouter };
