const { HttpError } = require('../../lib/httpError');

const NAME_TAKEN = 'Thể loại đã tồn tại';
const NOT_FOUND = 'Không tìm thấy thể loại';

function isUniqueViolation(err) {
  return err?.code === 'P2002';
}

function toCategory(row) {
  return {
    id: row.id,
    name: row.name,
    bookCount: row._count?.books ?? 0,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// Chỉ đếm sách chưa xóa mềm (ERD: thể loại xóa được khi không còn sách đang dùng).
const BOOK_COUNT = { _count: { select: { books: { where: { deletedAt: null } } } } };

function createCategoryService({ prisma }) {
  // [Giả định] Bảng sắp theo tên A→Z.
  async function listCategories() {
    const rows = await prisma.category.findMany({
      where: { deletedAt: null },
      orderBy: { name: 'asc' },
      include: BOOK_COUNT,
    });
    return rows.map(toCategory);
  }

  async function listCategoryOptions() {
    return prisma.category.findMany({
      where: { deletedAt: null },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    });
  }

  // Trùng tên (không phân biệt hoa thường, edge 1) do UNIQUE (lower(name)) ở DB chặn,
  // nên hai request đồng thời cũng không tạo được bản trùng.
  async function createCategory({ name }) {
    try {
      const row = await prisma.category.create({ data: { name }, include: BOOK_COUNT });
      return toCategory(row);
    } catch (err) {
      if (isUniqueViolation(err)) throw new HttpError(409, NAME_TAKEN, { name: NAME_TAKEN });
      throw err;
    }
  }

  // Edge 4: đổi tên thể loại đang có sách vẫn được, sách tham chiếu theo id.
  async function updateCategory(id, { name }) {
    let result;
    try {
      result = await prisma.category.updateMany({ where: { id, deletedAt: null }, data: { name } });
    } catch (err) {
      if (isUniqueViolation(err)) throw new HttpError(409, NAME_TAKEN, { name: NAME_TAKEN });
      throw err;
    }
    if (result.count === 0) throw new HttpError(404, NOT_FOUND);
    const row = await prisma.category.findUnique({ where: { id }, include: BOOK_COUNT });
    return toCategory(row);
  }

  // Xóa mềm. Khóa dòng thể loại rồi mới đếm sách: thêm sách (2.2.2) phải khóa FOR SHARE cùng dòng
  // này, nên sách được thêm trong lúc chờ xác nhận xóa vẫn bị đếm (edge 3).
  async function deleteCategory(id) {
    await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw`
        SELECT id FROM categories WHERE id = ${id} AND deleted_at IS NULL FOR UPDATE`;
      // Edge 2: người khác đã xóa trước → 404.
      if (locked.length === 0) throw new HttpError(404, NOT_FOUND);

      const bookCount = await tx.book.count({ where: { categoryId: id, deletedAt: null } });
      if (bookCount > 0) {
        throw new HttpError(409, `Không thể xóa: còn ${bookCount} sách thuộc thể loại này`);
      }
      await tx.category.update({ where: { id }, data: { deletedAt: new Date() } });
    });
  }

  return { listCategories, listCategoryOptions, createCategory, updateCategory, deleteCategory };
}

module.exports = { createCategoryService, NAME_TAKEN, NOT_FOUND };
