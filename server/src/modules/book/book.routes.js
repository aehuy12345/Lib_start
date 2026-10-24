const express = require('express');
const { validateBody, validateQuery } = require('../../middlewares/validate');
const { requireRole } = require('../../middlewares/auth');
const { uploadImage } = require('../../middlewares/upload');
const { HttpError } = require('../../lib/httpError');
const { BOOK_NOT_FOUND } = require('./book.service');
const {
  createBookSchema, listBooksQuerySchema, borrowHistoryQuerySchema, parseBookId,
} = require('./book.validation');

// 2.2.4 edge 1: id sai định dạng trả 404 như sách không tồn tại.
function bookIdParam(req, res, next) {
  const id = parseBookId(req.params.id);
  if (!id) return next(new HttpError(404, BOOK_NOT_FOUND));
  req.bookId = id;
  next();
}

// Danh sách/chi tiết sách (2.2.3, 2.2.4) công khai, nên quyền gắn theo từng route.
// 2.2.2: nhân viên thư viện thêm sách; Admin cùng quyền như 2.2.1.
function createBookRouter(bookService, requireAuth) {
  const router = express.Router();
  const staffOnly = [requireAuth, requireRole('librarian', 'admin')];

  // 2.2.3: công khai, không cần đăng nhập.
  router.get('/', validateQuery(listBooksQuerySchema), async (req, res) => {
    res.json(await bookService.listBooks(req.query));
  });

  // Multipart: các field văn bản + ảnh bìa tùy chọn ở field `cover`. JSON cũng nhận khi không có ảnh.
  router.post('/', ...staffOnly, uploadImage('cover', { maxFields: 20 }), validateBody(createBookSchema), async (req, res) => {
    const { book, warning } = await bookService.createBook(req.body, req.file);
    res.status(201).json({ message: 'Thêm sách thành công', book, ...(warning && { warning }) });
  });

  // 2.2.4: công khai. Lịch sử mượn có thông tin cá nhân nên tách route riêng cho nhân viên (edge 4).
  router.get('/:id', bookIdParam, async (req, res) => {
    res.json({ book: await bookService.getBook(req.bookId) });
  });

  router.get('/:id/borrow-history', ...staffOnly, bookIdParam, validateQuery(borrowHistoryQuerySchema), async (req, res) => {
    res.json(await bookService.listBorrowHistory(req.bookId, req.query));
  });

  router.get('/:id/borrow-eligibility', requireAuth, requireRole('reader'), bookIdParam, async (req, res) => {
    res.json(await bookService.getBorrowEligibility(req.bookId, req.user.id));
  });

  return router;
}

module.exports = { createBookRouter };
