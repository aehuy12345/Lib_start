const express = require('express');
const { validateBody } = require('../../middlewares/validate');
const { requireRole } = require('../../middlewares/auth');
const { uploadImage } = require('../../middlewares/upload');
const { updateProfileSchema, changePasswordSchema } = require('./profile.validation');

// 2.1.3: PRD chỉ mô tả hồ sơ cho Độc giả (edge 7 còn cần làm rõ cho nhân viên/admin).
function createProfileRouter(profileService, requireAuth) {
  const router = express.Router();
  router.use(requireAuth, requireRole('reader'));

  router.get('/', async (req, res) => {
    res.json({ profile: await profileService.getProfile(req.user.id) });
  });

  router.patch('/', validateBody(updateProfileSchema), async (req, res) => {
    const profile = await profileService.updateProfile(req.user.id, req.body);
    res.json({ message: 'Cập nhật thông tin thành công', profile });
  });

  router.put('/password', validateBody(changePasswordSchema), async (req, res) => {
    await profileService.changePassword(req.user.id, req.body);
    res.json({ message: 'Đổi mật khẩu thành công' });
  });

  router.put('/avatar', uploadImage('avatar'), async (req, res) => {
    const result = await profileService.uploadAvatar(req.user.id, req.file);
    res.json({ message: 'Cập nhật ảnh đại diện thành công', ...result });
  });

  router.delete('/avatar', async (req, res) => {
    const result = await profileService.deleteAvatar(req.user.id);
    res.json({ message: 'Đã xóa ảnh đại diện', ...result });
  });

  return router;
}

module.exports = { createProfileRouter };
