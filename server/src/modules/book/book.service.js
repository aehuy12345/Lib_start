const crypto = require('node:crypto');
const { HttpError } = require('../../lib/httpError');
const { detectImageType } = require('../../lib/imageType');
const { MAX_IMAGE_BYTES, INVALID_IMAGE } = require('../../middlewares/upload');

const COVER_BUCKET = 'book-covers';
const ISBN_TAKEN = 'ISBN đã tồn tại. Nếu là cùng đầu sách, hãy cập nhật số lượng ở sách đã có';
const CATEGORY_GONE = 'Thể loại không tồn tại hoặc đã bị xóa, vui lòng chọn lại';
const DUPLICATE_TITLE = 'Lưu ý: đã có sách cùng tên và tác giả';

function isUniqueViolation(err) {
  return err?.code === 'P2002';
}

function createBookService({
  prisma,
  storage,
  newId = () => crypto.randomUUID(),
  logger = console,
}) {
  function toBook(row) {
    return {
      id: row.id,
      title: row.title,
      author: row.author,
      publishYear: row.publishYear,
      isbn: row.isbn,
      description: row.description,
      category: row.category ? { id: row.category.id, name: row.category.name } : null,
      coverUrl: storage.publicUrl(COVER_BUCKET, row.coverPath),
      totalQuantity: row.totalQuantity,
      availableQuantity: row.availableQuantity,
      borrowedQuantity: row.borrowedQuantity,
      createdAt: row.createdAt,
    };
  }

  function checkCover(file) {
    if (!file) return null;
    if (!file.buffer?.length || file.buffer.length > MAX_IMAGE_BYTES) {
      throw new HttpError(file.buffer?.length ? 413 : 400, INVALID_IMAGE, { cover: INVALID_IMAGE });
    }
    const type = detectImageType(file.buffer);
    if (!type) throw new HttpError(400, INVALID_IMAGE, { cover: INVALID_IMAGE });
    return type;
  }

  async function removeQuietly(path) {
    try {
      await storage.remove(COVER_BUCKET, path);
    } catch (err) {
      logger.error(`Không xóa được file ${COVER_BUCKET}/${path}`, err);
    }
  }

  // Edge 9: kiểm tra trước những gì kiểm được để không upload ảnh rồi mới báo lỗi.
  // Hai kiểm tra này không thay cho ràng buộc DB: race vẫn được chặn khi insert.
  async function precheck({ isbn, categoryId }) {
    const [category, sameIsbn] = await Promise.all([
      prisma.category.findFirst({ where: { id: categoryId, deletedAt: null }, select: { id: true } }),
      isbn ? prisma.book.findFirst({ where: { isbn, deletedAt: null }, select: { id: true } }) : null,
    ]);
    if (sameIsbn) throw new HttpError(409, ISBN_TAKEN, { isbn: ISBN_TAKEN });
    if (!category) throw new HttpError(400, CATEGORY_GONE, { categoryId: CATEGORY_GONE });
  }

  // Edge 5 [Giả định]: trùng tên + tác giả chỉ cảnh báo, không chặn.
  async function duplicateWarning({ id, title, author }) {
    const count = await prisma.book.count({
      where: {
        id: { not: id },
        deletedAt: null,
        title: { equals: title, mode: 'insensitive' },
        author: { equals: author, mode: 'insensitive' },
      },
    });
    return count > 0 ? DUPLICATE_TITLE : null;
  }

  // Input đã qua Joi. Sách mới "Có sẵn": available = số lượng, borrowed = 0.
  async function createBook(input, file) {
    const coverType = checkCover(file);
    const data = {
      title: input.title,
      author: input.author,
      publishYear: input.publishYear,
      isbn: input.isbn || null,
      description: input.description,
      categoryId: input.categoryId,
      totalQuantity: input.quantity,
      availableQuantity: input.quantity,
    };
    await precheck(data);

    let coverPath = null;
    if (coverType) {
      coverPath = `${newId()}.${coverType.ext}`;
      try {
        await storage.upload(COVER_BUCKET, coverPath, file.buffer, coverType.mime);
      } catch (err) {
        logger.error('Upload ảnh bìa thất bại', err);
        throw new HttpError(502, 'Không tải được ảnh bìa, vui lòng thử lại', { cover: 'Không tải được ảnh bìa' });
      }
    }

    let row;
    try {
      row = await prisma.$transaction(async (tx) => {
        // FOR SHARE cùng dòng mà xóa thể loại (2.2.1) khóa FOR UPDATE: thể loại không thể bị xóa
        // giữa lúc kiểm tra và insert, và lệnh xóa đang chờ sẽ đếm được sách này (edge 7).
        const locked = await tx.$queryRaw`
          SELECT id FROM categories WHERE id = ${data.categoryId} AND deleted_at IS NULL FOR SHARE`;
        if (locked.length === 0) throw new HttpError(400, CATEGORY_GONE, { categoryId: CATEGORY_GONE });
        return tx.book.create({ data: { ...data, coverPath }, include: { category: true } });
      });
    } catch (err) {
      // Edge 9: lưu sách lỗi thì xóa ảnh vừa upload.
      if (coverPath) await removeQuietly(coverPath);
      if (isUniqueViolation(err)) throw new HttpError(409, ISBN_TAKEN, { isbn: ISBN_TAKEN });
      throw err;
    }

    return { book: toBook(row), warning: await duplicateWarning(row) };
  }

  return { createBook };
}

module.exports = {
  createBookService, COVER_BUCKET, ISBN_TAKEN, CATEGORY_GONE, DUPLICATE_TITLE,
};
