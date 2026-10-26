import { createFineService, NAME_TAKEN, TIER_NOT_FOUND, STALE, DELETED, HIDDEN } from '../../src/modules/fine/fine.service';

const ROW = {
  id: 1, name: 'Trả muộn', type: 'late', amount: 10000, isActive: true,
  createdAt: new Date('2026-10-01'), updatedAt: new Date('2026-10-02'), _count: { fineTickets: 3 },
};
const UPDATED_AT = new Date('2026-10-02T00:00:00.000Z');
const uniqueError = () => Object.assign(new Error('unique'), { code: 'P2002' });

function makeService({ locked = [{ id: 1, fresh: true }], ticketCount = 0, updateError, createError } = {}) {
  const calls = [];
  const tx = {
    $queryRaw: vi.fn(async (strings, ...values) => {
      calls.push({ sql: strings.join('?').replace(/\s+/g, ' ').trim(), values });
      return locked;
    }),
    fineTicket: { count: vi.fn(async () => ticketCount) },
    fineTier: {
      update: vi.fn(async ({ data }) => {
        if (updateError) throw updateError;
        return { ...ROW, ...data };
      }),
      delete: vi.fn(async () => ROW),
    },
  };
  const prisma = {
    fineTier: {
      findMany: vi.fn(async () => [ROW]),
      create: vi.fn(async ({ data }) => {
        if (createError) throw createError;
        return { ...ROW, id: 2, ...data, _count: { fineTickets: 0 } };
      }),
    },
    $transaction: vi.fn(async (fn) => fn(tx)),
  };
  return { service: createFineService({ prisma }), prisma, tx, calls };
}

describe('fineService.listTiers (2.5.1)', () => {
  it('chỉ lấy mức đang áp dụng, sắp theo loại rồi số tiền, kèm số phiếu đã dùng', async () => {
    const { service, prisma } = makeService();
    const list = await service.listTiers();
    expect(list).toEqual([{
      id: 1, name: 'Trả muộn', type: 'late', amount: 10000, ticketCount: 3, createdAt: ROW.createdAt, updatedAt: ROW.updatedAt,
    }]);
    expect(prisma.fineTier.findMany).toHaveBeenCalledWith({
      where: { isActive: true },
      orderBy: [{ type: 'asc' }, { amount: 'asc' }, { id: 'asc' }],
      include: { _count: { select: { fineTickets: true } } },
    });
  });
});

describe('fineService.createTier', () => {
  it('tạo mới, ticketCount = 0', async () => {
    const { service, prisma } = makeService();
    const tier = await service.createTier({ name: 'Mất', type: 'lost', amount: 150000 });
    expect(prisma.fineTier.create.mock.calls[0][0].data).toEqual({ name: 'Mất', type: 'lost', amount: 150000 });
    expect(tier).toMatchObject({ id: 2, name: 'Mất', type: 'lost', amount: 150000, ticketCount: 0 });
  });

  it('trùng tên (P2002) → 409 lỗi trên field name', async () => {
    const { service } = makeService({ createError: uniqueError() });
    await expect(service.createTier({ name: 'trả MUỘN', type: 'late', amount: 1 }))
      .rejects.toMatchObject({ status: 409, message: NAME_TAKEN, errors: { name: NAME_TAKEN } });
  });

  it('lỗi khác ném nguyên', async () => {
    const { service } = makeService({ createError: new Error('db down') });
    await expect(service.createTier({ name: 'X', type: 'late', amount: 1 })).rejects.toThrow('db down');
  });
});

describe('fineService.updateTier', () => {
  it('khóa dòng đang áp dụng FOR UPDATE, so updated_at trong SQL, rồi cập nhật tên + số tiền', async () => {
    const { service, tx, calls } = makeService();
    const tier = await service.updateTier(1, { name: 'Muộn', amount: 20000, updatedAt: UPDATED_AT });
    expect(calls).toHaveLength(1);
    expect(calls[0].sql).toMatch(/updated_at - \?::timestamptz.*FROM fine_tiers WHERE id = \? AND is_active FOR UPDATE$/);
    expect(calls[0].values).toEqual([UPDATED_AT, 1]);
    expect(tx.fineTier.update).toHaveBeenCalledWith({
      where: { id: 1 }, data: { name: 'Muộn', amount: 20000 }, include: { _count: { select: { fineTickets: true } } },
    });
    expect(tier).toMatchObject({ id: 1, name: 'Muộn', amount: 20000, ticketCount: 3 });
  });

  it('không có hoặc đã ẩn → 404', async () => {
    const { service, tx } = makeService({ locked: [] });
    await expect(service.updateTier(1, { name: 'X', amount: 1, updatedAt: UPDATED_AT }))
      .rejects.toMatchObject({ status: 404, message: TIER_NOT_FOUND });
    expect(tx.fineTier.update).not.toHaveBeenCalled();
  });

  it('edge 7: Admin khác đã sửa (updated_at khác) → 409 reason stale, không ghi đè', async () => {
    const { service, tx } = makeService({ locked: [{ fresh: false }] });
    await expect(service.updateTier(1, { name: 'X', amount: 1, updatedAt: UPDATED_AT }))
      .rejects.toMatchObject({ status: 409, message: STALE, reason: 'stale' });
    expect(tx.fineTier.update).not.toHaveBeenCalled();
  });

  it('trùng tên mức đang áp dụng khác → 409 name', async () => {
    const { service } = makeService({ updateError: uniqueError() });
    await expect(service.updateTier(1, { name: 'Mất', amount: 1, updatedAt: UPDATED_AT }))
      .rejects.toMatchObject({ status: 409, errors: { name: NAME_TAKEN } });
  });
});

describe('fineService.deleteTier', () => {
  it('chưa phiếu nào dùng → xóa hẳn', async () => {
    const { service, tx, calls } = makeService();
    const res = await service.deleteTier(1);
    expect(calls[0].sql).toBe('SELECT id FROM fine_tiers WHERE id = ? AND is_active FOR UPDATE');
    expect(tx.fineTicket.count).toHaveBeenCalledWith({ where: { fineTierId: 1 } });
    expect(tx.fineTier.delete).toHaveBeenCalledWith({ where: { id: 1 } });
    expect(tx.fineTier.update).not.toHaveBeenCalled();
    expect(res).toEqual({ hidden: false, message: DELETED });
  });

  it('edge 4: đã có phiếu (kể cả đã thanh toán) → ẩn is_active = false, không xóa', async () => {
    const { service, tx } = makeService({ ticketCount: 2 });
    const res = await service.deleteTier(1);
    expect(tx.fineTier.update).toHaveBeenCalledWith({ where: { id: 1 }, data: { isActive: false } });
    expect(tx.fineTier.delete).not.toHaveBeenCalled();
    expect(res).toEqual({ hidden: true, message: HIDDEN });
  });

  it('đã xóa/ẩn ở nơi khác → 404', async () => {
    const { service, tx } = makeService({ locked: [] });
    await expect(service.deleteTier(1)).rejects.toMatchObject({ status: 404 });
    expect(tx.fineTicket.count).not.toHaveBeenCalled();
  });
});
