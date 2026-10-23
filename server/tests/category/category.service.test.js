import { createCategoryService } from '../../src/modules/category/category.service';

const ROW = {
  id: 1, name: 'Văn học', createdAt: new Date('2026-10-01'), updatedAt: new Date('2026-10-01'), _count: { books: 2 },
};
const uniqueError = () => Object.assign(new Error('unique'), { code: 'P2002' });

function makeService({ locked = [{ id: 1 }], bookCount = 0, ...opts } = {}) {
  const tx = {
    $queryRaw: vi.fn(async () => locked),
    book: { count: vi.fn(async () => bookCount) },
    category: { update: vi.fn(async () => ({})) },
  };
  const prisma = {
    category: {
      findMany: vi.fn(async () => [ROW]),
      findUnique: vi.fn(async () => ROW),
      create: opts.create ?? vi.fn(async ({ data }) => ({ ...ROW, ...data, _count: { books: 0 } })),
      updateMany: opts.updateMany ?? vi.fn(async () => ({ count: 1 })),
    },
    $transaction: vi.fn(async (fn) => fn(tx)),
  };
  return { service: createCategoryService({ prisma }), prisma, tx };
}

describe('categoryService.listCategories (2.2.1)', () => {
  it('chỉ lấy thể loại chưa xóa, sắp theo tên, đếm sách chưa xóa', async () => {
    const { service, prisma } = makeService();
    const list = await service.listCategories();

    expect(list).toEqual([{
      id: 1, name: 'Văn học', bookCount: 2, createdAt: ROW.createdAt, updatedAt: ROW.updatedAt,
    }]);
    expect(prisma.category.findMany).toHaveBeenCalledWith({
      where: { deletedAt: null },
      orderBy: { name: 'asc' },
      include: { _count: { select: { books: { where: { deletedAt: null } } } } },
    });
  });

  it('edge 5: chưa có thể loại → mảng rỗng', async () => {
    const { service, prisma } = makeService();
    prisma.category.findMany.mockResolvedValue([]);
    expect(await service.listCategories()).toEqual([]);
  });
});

describe('categoryService.createCategory', () => {
  it('tạo mới, bookCount = 0', async () => {
    const { service, prisma } = makeService();
    const created = await service.createCategory({ name: 'Khoa học' });
    expect(created).toMatchObject({ name: 'Khoa học', bookCount: 0 });
    expect(prisma.category.create).toHaveBeenCalledWith(expect.objectContaining({ data: { name: 'Khoa học' } }));
  });

  it('edge 1: trùng tên (UNIQUE lower(name) ở DB) → 409 Thể loại đã tồn tại', async () => {
    const { service } = makeService({ create: vi.fn(async () => { throw uniqueError(); }) });
    await expect(service.createCategory({ name: 'VĂN HỌC' })).rejects.toMatchObject({
      status: 409, message: 'Thể loại đã tồn tại', errors: { name: 'Thể loại đã tồn tại' },
    });
  });

  it('lỗi DB khác được ném tiếp', async () => {
    const { service } = makeService({ create: vi.fn(async () => { throw new Error('boom'); }) });
    await expect(service.createCategory({ name: 'X' })).rejects.toThrow('boom');
  });
});

describe('categoryService.updateCategory', () => {
  it('edge 4: đổi tên chỉ trên thể loại chưa xóa, trả bản mới kèm số sách', async () => {
    const { service, prisma } = makeService();
    const updated = await service.updateCategory(1, { name: 'Văn học' });

    expect(prisma.category.updateMany).toHaveBeenCalledWith({
      where: { id: 1, deletedAt: null }, data: { name: 'Văn học' },
    });
    expect(updated).toMatchObject({ id: 1, bookCount: 2 });
  });

  it('không tồn tại hoặc đã xóa → 404', async () => {
    const { service } = makeService({ updateMany: vi.fn(async () => ({ count: 0 })) });
    await expect(service.updateCategory(9, { name: 'X' })).rejects.toMatchObject({ status: 404 });
  });

  it('trùng tên thể loại khác → 409', async () => {
    const { service } = makeService({ updateMany: vi.fn(async () => { throw uniqueError(); }) });
    await expect(service.updateCategory(1, { name: 'Khoa học' })).rejects.toMatchObject({
      status: 409, errors: { name: 'Thể loại đã tồn tại' },
    });
  });
});

describe('categoryService.deleteCategory', () => {
  it('không có sách → xóa mềm trong transaction sau khi khóa dòng', async () => {
    const { service, tx } = makeService();
    await service.deleteCategory(1);

    expect(tx.$queryRaw.mock.calls[0][0].join('')).toContain('FOR UPDATE');
    expect(tx.book.count).toHaveBeenCalledWith({ where: { categoryId: 1, deletedAt: null } });
    expect(tx.category.update).toHaveBeenCalledWith({ where: { id: 1 }, data: { deletedAt: expect.any(Date) } });
  });

  it('còn sách → 409 kèm số sách, không xóa (edge 3 cũng đi đường này)', async () => {
    const { service, tx } = makeService({ bookCount: 3 });
    await expect(service.deleteCategory(1)).rejects.toMatchObject({
      status: 409, message: 'Không thể xóa: còn 3 sách thuộc thể loại này',
    });
    expect(tx.category.update).not.toHaveBeenCalled();
  });

  it('edge 2: đã bị người khác xóa → 404', async () => {
    const { service, tx } = makeService({ locked: [] });
    await expect(service.deleteCategory(1)).rejects.toMatchObject({ status: 404, message: 'Không tìm thấy thể loại' });
    expect(tx.book.count).not.toHaveBeenCalled();
  });
});
