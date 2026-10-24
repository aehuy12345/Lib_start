const crypto = require('node:crypto');
const { Prisma } = require('@prisma/client');
const { HttpError } = require('../../lib/httpError');
const { detectImageType } = require('../../lib/imageType');
const { MAX_IMAGE_BYTES, INVALID_IMAGE } = require('../../middlewares/upload');
const { businessToday, toDateString } = require('../../lib/businessDate');
const { ACTIVE_STATUSES, evaluateBorrowEligibility } = require('../borrow/borrow.rules');

const COVER_BUCKET = 'book-covers';
const BOOK_NOT_FOUND = 'Không tìm thấy sách';
const ISBN_TAKEN = 'ISBN đã tồn tại. Nếu là cùng đầu sách, hãy cập nhật số lượng ở sách đã có';
const CATEGORY_GONE = 'Thể loại không tồn tại hoặc đã bị xóa, vui lòng chọn lại';
const DUPLICATE_TITLE = 'Lưu ý: đã có sách cùng tên và tác giả';
const VERSION_CONFLICT = 'Sách đã được người khác cập nhật. Vui lòng tải lại trang để xem dữ liệu mới';
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
  now = () => new Date(),
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
      damagedQuantity: row.damagedQuantity,
      version: row.version,
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
  // excludeId: khi sửa (2.2.5), ISBN của chính sách đó không tính là trùng.
  async function precheck({ isbn, categoryId }, excludeId) {
    const [category, sameIsbn] = await Promise.all([
      prisma.category.findFirst({ where: { id: categoryId, deletedAt: null }, select: { id: true } }),
      isbn ? prisma.book.findFirst({
        where: { isbn, deletedAt: null, ...(excludeId && { id: { not: excludeId } }) },
        select: { id: true },
      }) : null,
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

  async function uploadCover(file, coverType) {
    if (!coverType) return null;
    const path = `${newId()}.${coverType.ext}`;
    try {
      await storage.upload(COVER_BUCKET, path, file.buffer, coverType.mime);
    } catch (err) {
      logger.error('Upload ảnh bìa thất bại', err);
      throw new HttpError(502, 'Không tải được ảnh bìa, vui lòng thử lại', { cover: 'Không tải được ảnh bìa' });
    }
    return path;
  }

  // FOR SHARE cùng dòng mà xóa thể loại (2.2.1) khóa FOR UPDATE: thể loại không thể bị xóa
  // giữa lúc kiểm tra và ghi sách, và lệnh xóa đang chờ sẽ đếm được sách này (2.2.2 edge 7, 2.2.5 edge 4).
  async function lockCategory(tx, categoryId) {
    const locked = await tx.$queryRaw`
      SELECT id FROM categories WHERE id = ${categoryId} AND deleted_at IS NULL FOR SHARE`;
    if (locked.length === 0) throw new HttpError(400, CATEGORY_GONE, { categoryId: CATEGORY_GONE });
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

    const coverPath = await uploadCover(file, coverType);

    let row;
    try {
      row = await prisma.$transaction(async (tx) => {
        await lockCategory(tx, data.categoryId);
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

  async function findActiveBook(id, select) {
    const book = await prisma.book.findFirst({ where: { id, deletedAt: null }, ...select });
    // Edge 2: sách đã xóa mềm cũng là 404.
    if (!book) throw new HttpError(404, BOOK_NOT_FOUND);
    return book;
  }

  // 2.2.4, công khai: chỉ thông tin sách, không kèm lịch sử mượn (edge 4).
  async function getBook(id) {
    return toBook(await findActiveBook(id, { include: { category: true } }));
  }

  // 2.2.4, chỉ nhân viên. [Giả định] gồm mọi đơn của sách kèm trạng thái; `overdue` suy ra từ hạn trả.
  async function listBorrowHistory(id, { page = 1 }) {
    await findActiveBook(id, { select: { id: true } });
    const total = await prisma.borrowOrder.count({ where: { bookId: id } });
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const current = Math.min(page, totalPages);
    const rows = total === 0 ? [] : await prisma.borrowOrder.findMany({
      where: { bookId: id },
      include: { reader: { select: { id: true, name: true, email: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (current - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    });

    const today = businessToday(now());
    const toHistoryItem = (row) => {
      const dueDate = toDateString(row.dueDate);
      return {
        id: row.id,
        reader: row.reader,
        status: row.status === 'borrowing' && dueDate < today ? 'overdue' : row.status,
        requestedAt: row.createdAt,
        borrowedAt: row.borrowedAt,
        dueDate,
        returnedAt: row.returnedAt,
      };
    };
    return {
      borrows: rows.map(toHistoryItem),
      pagination: { page: current, pageSize: PAGE_SIZE, total, totalPages },
    };
  }

  // 2.2.4: độc giả có mượn được sách này không (khóa nút Mượn kèm lý do).
  async function getBorrowEligibility(id, readerId) {
    const book = await findActiveBook(id, { select: { availableQuantity: true } });
    const active = { readerId, status: { in: ACTIVE_STATUSES } };
    const [activeCount, sameBookCount, unpaidFineCount, overdueCount] = await Promise.all([
      prisma.borrowOrder.count({ where: active }),
      prisma.borrowOrder.count({ where: { ...active, bookId: id } }),
      prisma.fineTicket.count({ where: { readerId, status: { not: 'paid' } } }),
      prisma.borrowOrder.count({
        where: { readerId, status: 'borrowing', dueDate: { lt: new Date(businessToday(now())) } },
      }),
    ]);
    return evaluateBorrowEligibility({
      availableQuantity: book.availableQuantity,
      activeCount,
      unpaidFineCount,
      overdueCount,
      hasActiveOrderForBook: sameBookCount > 0,
    });
  }

  // Edge 5: version khác lúc mở form → xung đột. Edge 2: tổng mới được bằng đúng số bản không có sẵn.
  // Sách hư không quay lại kho (ERD), nên tổng không được nhỏ hơn số đang mượn + hư hỏng.
  function checkEditable(book, { version, quantity }) {
    if (book.version !== version) throw new HttpError(409, VERSION_CONFLICT, { version: VERSION_CONFLICT });
    const minimum = book.borrowedQuantity + book.damagedQuantity;
    if (quantity < minimum) {
      const message = book.damagedQuantity > 0
        ? `Tổng số lượng không được nhỏ hơn ${minimum} (${book.borrowedQuantity} bản đang mượn, ${book.damagedQuantity} bản hư hỏng)`
        : `Tổng số lượng không được nhỏ hơn số bản đang mượn (${book.borrowedQuantity})`;
      throw new HttpError(400, message, { quantity: message });
    }
  }

  // 2.2.5. Input đã qua Joi (như 2.2.2 + version, removeCover). Thứ tự như 2.2.2:
  // kiểm tra trước → upload ảnh mới → transaction khóa sách và kiểm tra lại → xóa ảnh cũ.
  async function updateBook(id, input, file) {
    const coverType = checkCover(file);
    const data = {
      title: input.title,
      author: input.author,
      publishYear: input.publishYear,
      isbn: input.isbn || null,
      description: input.description,
      categoryId: input.categoryId,
    };
    const current = await findActiveBook(id, {
      select: { version: true, borrowedQuantity: true, damagedQuantity: true },
    });
    checkEditable(current, input);
    await precheck(data, id);

    const newCover = await uploadCover(file, coverType);

    let row;
    let oldCover;
    try {
      row = await prisma.$transaction(async (tx) => {
        // Khóa dòng sách: số đang mượn có thể đổi (2.3.2, 2.4.2) giữa lúc kiểm tra và ghi.
        const [locked] = await tx.$queryRaw`
          SELECT version, borrowed_quantity AS "borrowedQuantity", damaged_quantity AS "damagedQuantity",
                 cover_path AS "coverPath"
          FROM books WHERE id = ${id} AND deleted_at IS NULL FOR UPDATE`;
        if (!locked) throw new HttpError(404, BOOK_NOT_FOUND);
        checkEditable(locked, input);
        await lockCategory(tx, data.categoryId);
        oldCover = locked.coverPath;
        return tx.book.update({
          where: { id },
          data: {
            ...data,
            totalQuantity: input.quantity,
            availableQuantity: input.quantity - locked.borrowedQuantity - locked.damagedQuantity,
            coverPath: newCover ?? (input.removeCover ? null : locked.coverPath),
            version: { increment: 1 },
          },
          include: { category: true },
        });
      });
    } catch (err) {
      // Edge 7: lưu lỗi thì xóa ảnh vừa upload, cover_path cũ giữ nguyên.
      if (newCover) await removeQuietly(newCover);
      if (isUniqueViolation(err)) throw new HttpError(409, ISBN_TAKEN, { isbn: ISBN_TAKEN });
      throw err;
    }

    // Ảnh cũ chỉ xóa sau khi DB đã trỏ sang ảnh mới (hoặc null); lỗi chỉ ghi log.
    if (oldCover && oldCover !== row.coverPath) await removeQuietly(oldCover);

    return { book: toBook(row), warning: await duplicateWarning(row) };
  }

  // Edge 3: đơn chờ xác nhận cũng là đơn hoạt động. Quá hạn là `borrowing` quá hạn trả, và yêu cầu trả
  // chờ xác nhận chỉ có trên đơn `borrowing`, nên ACTIVE_STATUSES đã bao gồm cả hai.
  function countActiveBorrows(client, bookId) {
    return client.borrowOrder.count({ where: { bookId, status: { in: ACTIVE_STATUSES } } });
  }

  // 2.2.5: kiểm tra trước khi hiện hộp thoại xác nhận; khi xóa server kiểm tra lại.
  async function getDeleteCheck(id) {
    await findActiveBook(id, { select: { id: true } });
    const activeBorrowCount = await countActiveBorrows(prisma, id);
    return { canDelete: activeBorrowCount === 0, activeBorrowCount };
  }

  // Edge 1 [Giả định]: soft delete để giữ lịch sử mượn và báo cáo. Edge 8: giữ ảnh bìa trên Storage.
  async function deleteBook(id) {
    await prisma.$transaction(async (tx) => {
      // Khóa dòng sách để đơn mượn mới (2.3.1, khóa cùng dòng) không chen vào giữa lúc đếm và xóa.
      const locked = await tx.$queryRaw`SELECT id FROM books WHERE id = ${id} AND deleted_at IS NULL FOR UPDATE`;
      if (locked.length === 0) throw new HttpError(404, BOOK_NOT_FOUND);
      const active = await countActiveBorrows(tx, id);
      if (active > 0) throw new HttpError(409, activeBorrowsMessage(active));
      await tx.book.update({ where: { id }, data: { deletedAt: now() } });
    });
  }

  return {
    createBook, listBooks, getBook, listBorrowHistory, getBorrowEligibility, updateBook, getDeleteCheck, deleteBook,
  };
}

function activeBorrowsMessage(count) {
  return `Không thể xóa: sách đang có ${count} đơn mượn hoạt động (chờ xác nhận, đang mượn hoặc quá hạn)`;
}

module.exports = {
  createBookService, COVER_BUCKET, ISBN_TAKEN, CATEGORY_GONE, DUPLICATE_TITLE, BOOK_NOT_FOUND, VERSION_CONFLICT,
  PAGE_SIZE, escapeLike, activeBorrowsMessage,
};
