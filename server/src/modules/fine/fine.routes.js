const express = require('express');
const { validateBody } = require('../../middlewares/validate');
const { requireRole } = require('../../middlewares/auth');
const { HttpError } = require('../../lib/httpError');
const { createFineTierSchema, updateFineTierSchema } = require('./fine.validation');
const { TIER_NOT_FOUND } = require('./fine.service');

// Id không phải số nguyên dương thì coi như không tồn tại.
function parseId(req) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0 || id > 2147483647) throw new HttpError(404, TIER_NOT_FOUND);
  return id;
}

function createFineTierRouter(fineService, requireAuth) {
  const router = express.Router();

  // 2.4.2: nhân viên (cùng Admin) lấy danh sách mức phạt để chọn khi xác nhận trả sách.
  // Phải đứng trước router.use bên dưới vì các route còn lại chỉ dành cho Admin.
  router.get('/options', requireAuth, requireRole('librarian', 'admin'), async (req, res) => {
    res.json({ tiers: await fineService.listTierOptions() });
  });

  // 2.5.1: chỉ quản lý viên (Admin) quản lý mức phạt; nhân viên thư viện nhận 403 (edge 6).
  router.use(requireAuth, requireRole('admin'));

  router.get('/', async (req, res) => {
    res.json({ tiers: await fineService.listTiers() });
  });

  router.post('/', validateBody(createFineTierSchema), async (req, res) => {
    const tier = await fineService.createTier(req.body);
    res.status(201).json({ message: 'Thêm mức phạt thành công', tier });
  });

  router.patch('/:id', validateBody(updateFineTierSchema), async (req, res) => {
    const tier = await fineService.updateTier(parseId(req), req.body);
    res.json({ message: 'Cập nhật mức phạt thành công', tier });
  });

  router.delete('/:id', async (req, res) => {
    res.json(await fineService.deleteTier(parseId(req)));
  });

  return router;
}

module.exports = { createFineTierRouter };
