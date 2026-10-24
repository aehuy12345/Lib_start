import { createBookService } from '../../src/modules/book/book.service';

const INPUT = {
  title: 'Dế Mèn', author: 'Tô Hoài', publishYear: 1941, isbn: '9780306406157',
  categoryId: 1, description: 'Truyện', quantity: 3,
};
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const uniqueError = () => Object.assign(new Error('unique'), { code: 'P2002' });

function makeService({
  category = { id: 1 }, sameIsbn = null, locked = [{ id: 1 }], create, duplicates = 0, upload,
} = {}) {
  const calls = [];
  const tx = {
    $queryRaw: vi.fn(async () => { calls.push('lock'); return locked; }),
    book: {
      create: create ?? vi.fn(async ({ data }) => {
        calls.push('insert');
        return {
          id: 7, ...data, borrowedQuantity: 0, createdAt: new Date('2026-10-24'), category: { id: 1, name: 'Văn học' },
        };
      }),
    },
  };
  const prisma = {
    category: { findFirst: vi.fn(async () => category) },
    book: { findFirst: vi.fn(async () => sameIsbn), count: vi.fn(async () => duplicates) },
    $transaction: vi.fn(async (fn) => fn(tx)),
  };
  const storage = {
    upload: upload ?? vi.fn(async () => { calls.push('upload'); }),
    remove: vi.fn(async () => {}),
    publicUrl: (bucket, path) => (path ? `https://cdn/${bucket}/${path}` : null),
  };
  const logger = { error: vi.fn() };
  const service = createBookService({ prisma, storage, logger, newId: () => 'uuid' });
  return { service, prisma, tx, storage, calls, logger };
}

describe('bookService.createBook (2.2.2)', () => {
  it('không ảnh: available = số lượng, borrowed mặc định 0, ảnh mặc định (coverUrl null, edge 10)', async () => {
    const { service, tx, storage } = makeService();
    const { book, warning } = await service.createBook(INPUT);

    expect(tx.book.create).toHaveBeenCalledWith({
      data: {
        title: 'Dế Mèn', author: 'Tô Hoài', publishYear: 1941, isbn: '9780306406157', description: 'Truyện',
        categoryId: 1, totalQuantity: 3, availableQuantity: 3, coverPath: null,
      },
      include: { category: true },
    });
    expect(book).toMatchObject({
      id: 7, totalQuantity: 3, availableQuantity: 3, borrowedQuantity: 0, coverUrl: null,
      category: { id: 1, name: 'Văn học' },
    });
    expect(warning).toBeNull();
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it('ISBN rỗng lưu null và không kiểm tra trùng ISBN', async () => {
    const { service, tx, prisma } = makeService();
    await service.createBook({ ...INPUT, isbn: '' });
    expect(tx.book.create.mock.calls[0][0].data.isbn).toBeNull();
    expect(prisma.book.findFirst).not.toHaveBeenCalled();
  });

  it('có ảnh: kiểm tra → upload tên ngẫu nhiên → khóa thể loại → insert kèm cover_path', async () => {
    const { service, calls, storage, tx } = makeService();
    const { book } = await service.createBook(INPUT, { buffer: JPEG });

    expect(calls).toEqual(['upload', 'lock', 'insert']);
    expect(storage.upload).toHaveBeenCalledWith('book-covers', 'uuid.jpg', JPEG, 'image/jpeg');
    expect(tx.book.create.mock.calls[0][0].data.coverPath).toBe('uuid.jpg');
    expect(book.coverUrl).toBe('https://cdn/book-covers/uuid.jpg');
  });

  it('khóa dòng thể loại FOR SHARE trong transaction (đối ứng FOR UPDATE khi xóa thể loại)', async () => {
    const { service, tx } = makeService();
    await service.createBook(INPUT);
    expect(tx.$queryRaw.mock.calls[0][0].join('?')).toMatch(/FROM categories WHERE id = \? AND deleted_at IS NULL FOR SHARE/);
  });

  it.each([
    [{ buffer: Buffer.from('not an image') }, 400],
    [{ buffer: Buffer.alloc(0) }, 400],
    [{ buffer: Buffer.concat([JPEG, Buffer.alloc(2 * 1024 * 1024)]) }, 413],
  ])('edge 8: ảnh sai định dạng/rỗng/quá lớn → %#, không upload, không ghi DB', async (file, status) => {
    const { service, storage, prisma } = makeService();
    await expect(service.createBook(INPUT, file)).rejects.toMatchObject({
      status, errors: { cover: 'Chỉ nhận ảnh JPG, PNG, WebP tối đa 2 MB' },
    });
    expect(storage.upload).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('ISBN đã tồn tại → 409 gợi ý sửa số lượng, không upload ảnh (edge 9)', async () => {
    const { service, storage } = makeService({ sameIsbn: { id: 3 } });
    await expect(service.createBook(INPUT, { buffer: JPEG })).rejects.toMatchObject({
      status: 409, errors: { isbn: expect.stringContaining('ISBN đã tồn tại') },
    });
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it('thể loại không còn → 400 tại field categoryId, không upload ảnh', async () => {
    const { service, storage } = makeService({ category: null });
    await expect(service.createBook(INPUT, { buffer: JPEG })).rejects.toMatchObject({
      status: 400, errors: { categoryId: 'Thể loại không tồn tại hoặc đã bị xóa, vui lòng chọn lại' },
    });
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it('edge 7: thể loại bị xóa sau precheck (khóa không thấy dòng) → 400 và xóa ảnh vừa upload', async () => {
    const { service, storage, tx } = makeService({ locked: [] });
    await expect(service.createBook(INPUT, { buffer: JPEG })).rejects.toMatchObject({
      status: 400, errors: { categoryId: expect.any(String) },
    });
    expect(tx.book.create).not.toHaveBeenCalled();
    expect(storage.remove).toHaveBeenCalledWith('book-covers', 'uuid.jpg');
  });

  it('edge 6, 9: ISBN trùng do race (P2002 khi insert) → 409 và xóa ảnh vừa upload', async () => {
    const { service, storage } = makeService({ create: vi.fn(async () => { throw uniqueError(); }) });
    await expect(service.createBook(INPUT, { buffer: JPEG })).rejects.toMatchObject({ status: 409 });
    expect(storage.remove).toHaveBeenCalledWith('book-covers', 'uuid.jpg');
  });

  it('lỗi DB khác: xóa ảnh rồi ném tiếp; xóa ảnh lỗi chỉ ghi log', async () => {
    const { service, storage, logger } = makeService({ create: vi.fn(async () => { throw new Error('boom'); }) });
    storage.remove.mockRejectedValue(new Error('storage down'));
    await expect(service.createBook(INPUT, { buffer: JPEG })).rejects.toThrow('boom');
    expect(logger.error).toHaveBeenCalled();
  });

  it('upload ảnh lỗi → 502, không ghi DB', async () => {
    const { service, prisma } = makeService({ upload: vi.fn(async () => { throw new Error('down'); }) });
    await expect(service.createBook(INPUT, { buffer: JPEG })).rejects.toMatchObject({
      status: 502, errors: { cover: 'Không tải được ảnh bìa' },
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('edge 5: trùng tên + tác giả (không phân biệt hoa thường) chỉ cảnh báo', async () => {
    const { service, prisma } = makeService({ duplicates: 1 });
    const { book, warning } = await service.createBook({ ...INPUT, isbn: '' });
    expect(book.id).toBe(7);
    expect(warning).toBe('Lưu ý: đã có sách cùng tên và tác giả');
    expect(prisma.book.count).toHaveBeenCalledWith({
      where: {
        id: { not: 7 },
        deletedAt: null,
        title: { equals: 'Dế Mèn', mode: 'insensitive' },
        author: { equals: 'Tô Hoài', mode: 'insensitive' },
      },
    });
  });
});
