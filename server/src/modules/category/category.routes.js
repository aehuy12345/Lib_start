const express = require('express');
const { validateBody } = require('../../middlewares/validate');
const { requireRole } = require('../../middlewares/auth');
const { HttpError } = require('../../lib/httpError');
const { categorySchema } = require('./category.validation');
const { NOT_FOUND } = require('./category.service');

// Id không phải số nguyên dương thì coi như không tồn tại.
function parseId(req) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0 || id > 2147483647) throw new HttpError(404, NOT_FOUND);
  return id;
}

// 2.2.1: nhân viên thư viện quản lý thể loại; Admin cũng có toàn quyền, Reader nhận 403 (edge 6).
function createCategoryRouter(categoryService, requireAuth) {
  const router = express.Router();

  // 2.2.3 [Giả định]: danh sách id + tên cho bộ lọc thể loại ở trang sách công khai; phải đứng trước
  // router.use bên dưới để không bị yêu cầu đăng nhập. Không trả số sách như trang quản lý.
  router.get('/options', async (req, res) => {
    res.json({ categories: await categoryService.listCategoryOptions() });
  });

  router.use(requireAuth, requireRole('librarian', 'admin'));

  router.get('/', async (req, res) => {
    res.json({ categories: await categoryService.listCategories() });
  });

  router.post('/', validateBody(categorySchema), async (req, res) => {
    const category = await categoryService.createCategory(req.body);
    res.status(201).json({ message: 'Thêm thể loại thành công', category });
  });

  router.patch('/:id', validateBody(categorySchema), async (req, res) => {
    const category = await categoryService.updateCategory(parseId(req), req.body);
    res.json({ message: 'Cập nhật thể loại thành công', category });
  });

  router.delete('/:id', async (req, res) => {
    await categoryService.deleteCategory(parseId(req));
    res.json({ message: 'Đã xóa thể loại' });
  });

  return router;
}

module.exports = { createCategoryRouter };
