const express = require('express');
const { requireRole } = require('../../middlewares/auth');

// 2.4.2: nhân viên (cùng Admin) lấy danh sách mức phạt để chọn khi xác nhận trả sách.
function createFineTierRouter(fineService, requireAuth) {
  const router = express.Router();

  router.get('/options', requireAuth, requireRole('librarian', 'admin'), async (req, res) => {
    res.json({ tiers: await fineService.listTierOptions() });
  });

  return router;
}

module.exports = { createFineTierRouter };
