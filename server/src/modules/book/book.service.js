const crypto = require('node:crypto');
const { Prisma } = require('@prisma/client');
const { HttpError } = require('../../lib/httpError');
const { detectImageType } = require('../../lib/imageType');
const { MAX_IMAGE_BYTES, INVALID_IMAGE } = require('../../middlewares/upload');

const COVER_BUCKET = 'book-covers';
const ISBN_TAKEN = 'ISBN đã tồn tại. Nếu là cùng đầu sách, hãy cập nhật số lượng ở sách đã có';
const CATEGORY_GONE = 'Thể loại không tồn tại hoặc đã bị xóa, vui lòng chọn lại';
const DUPLICATE_TITLE = 'Lưu ý: đã có sách cùng tên và tác giả';
const PAGE_SIZE = 10;

// Edge 6: luôn có id làm tiêu chí phụ để hai sách bằng nhau không đổi chỗ giữa các trang.
const ORDER_BY = {
  name: Prisma.sql`b.title ASC, b.id ASC`,
  newest: Prisma.sql`b.publish_year DESC, b.id DESC`,
  popular: Prisma.sql`b.borrow_count DESC, b.id ASC`,
};

// Edge 2: từ khóa đi qua tham số; chỉ cần escape ký tự wildcard của LIKE (escape mặc định là \).
function escapeLike(text) {
  return text.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

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

  function toListItem(row) {
    return {
      id: row.id,
      title: row.title,
      author: row.author,
      publishYear: row.publishYear,
      category: { id: row.categoryId, name: row.categoryName },
      coverUrl: storage.publicUrl(COVER_BUCKET, row.coverPath),
      availableQuantity: row.availableQuantity,
      borrowedQuantity: row.borrowedQuantity,
    };
  }

  // 2.2.3, công khai. Query đã qua Joi: { q?, categoryId?, sort, page }.
  async function listBooks({ q, categoryId, sort = 'name', page = 1 }) {
    if (categoryId) {
      const category = await prisma.category.findFirst({ where: { id: categoryId, deletedAt: null }, select: { id: true } });
      if (!category) throw new HttpError(400, CATEGORY_GONE, { categoryId: CATEGORY_GONE });
    }

    const conditions = [Prisma.sql`b.deleted_at IS NULL`];
    if (categoryId) conditions.push(Prisma.sql`b.category_id = ${categoryId}`);
    if (q) {
      // Edge 3 [Giả định]: không phân biệt hoa thường và dấu tiếng Việt (migration unaccent).
      const pattern = `%${escapeLike(q)}%`;
      conditions.push(Prisma.sql`(public.immutable_unaccent(b.title) ILIKE public.immutable_unaccent(${pattern})
        OR public.immutable_unaccent(b.author) ILIKE public.immutable_unaccent(${pattern}))`);
    }
    const where = Prisma.join(conditions, ' AND ');

    const [{ count }] = await prisma.$queryRaw`SELECT count(*)::int AS count FROM books b WHERE ${where}`;
    const totalPages = Math.max(1, Math.ceil(count / PAGE_SIZE));
    // Trang vượt tổng số trang → trả trang cuối (flow, nhánh K).
    const current = Math.min(page, totalPages);

    const rows = count === 0 ? [] : await prisma.$queryRaw`
      SELECT b.id, b.title, b.author, b.publish_year AS "publishYear", b.cover_path AS "coverPath",
             b.available_quantity AS "availableQuantity", b.borrowed_quantity AS "borrowedQuantity",
             c.id AS "categoryId", c.name AS "categoryName"
      FROM books b JOIN categories c ON c.id = b.category_id
      WHERE ${where}
      ORDER BY ${ORDER_BY[sort] ?? ORDER_BY.name}
      LIMIT ${PAGE_SIZE} OFFSET ${(current - 1) * PAGE_SIZE}`;

    return {
      books: rows.map(toListItem),
      pagination: { page: current, pageSize: PAGE_SIZE, total: count, totalPages },
    };
  }

  return { createBook, listBooks };
}

module.exports = {
  createBookService, COVER_BUCKET, ISBN_TAKEN, CATEGORY_GONE, DUPLICATE_TITLE, PAGE_SIZE, escapeLike,
};
