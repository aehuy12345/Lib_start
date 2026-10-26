const express = require('express');
const { requireRole } = require('../../middlewares/auth');

// Mỗi thẻ một endpoint: một truy vấn lỗi chỉ làm hỏng thẻ đó, client Thử lại riêng thẻ ấy.
const SECTIONS = {
  books: 'bookStats',
  readers: 'readerStats',
  'borrows-today': 'borrowsToday',
  'top-books': 'topBooks',
  'overdue-readers': 'overdueReaders',
};

// 2.7.1: Librarian + Admin; Reader nhận 403 (edge 6).
function createDashboardRouter(dashboardService, requireAuth) {
  const router = express.Router();
  router.use(requireAuth, requireRole('librarian', 'admin'));

  for (const [path, method] of Object.entries(SECTIONS)) {
    router.get(`/${path}`, async (req, res) => {
      // Edge 5 [Giả định]: không cache, số liệu luôn lấy mới.
      res.set('Cache-Control', 'no-store');
      res.json(await dashboardService[method]());
    });
  }

  return router;
}

module.exports = { createDashboardRouter, SECTIONS };
