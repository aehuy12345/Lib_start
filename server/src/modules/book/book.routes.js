const express = require('express');
const { validateBody } = require('../../middlewares/validate');
const { requireRole } = require('../../middlewares/auth');
const { uploadImage } = require('../../middlewares/upload');
const { createBookSchema } = require('./book.validation');

// Danh sách/chi tiết sách (2.2.3, 2.2.4) sẽ công khai, nên quyền gắn theo từng route.
// 2.2.2: nhân viên thư viện thêm sách; Admin cùng quyền như 2.2.1.
function createBookRouter(bookService, requireAuth) {
  const router = express.Router();
  const staffOnly = [requireAuth, requireRole('librarian', 'admin')];

  // Multipart: các field văn bản + ảnh bìa tùy chọn ở field `cover`. JSON cũng nhận khi không có ảnh.
  router.post('/', ...staffOnly, uploadImage('cover', { maxFields: 20 }), validateBody(createBookSchema), async (req, res) => {
    const { book, warning } = await bookService.createBook(req.body, req.file);
    res.status(201).json({ message: 'Thêm sách thành công', book, ...(warning && { warning }) });
  });

  return router;
}

module.exports = { createBookRouter };
