const { HttpError } = require('../../lib/httpError');
const { FINE_TYPES } = require('./fine.validation');

const NAME_TAKEN = 'Tên mức phạt đã tồn tại';
const TIER_NOT_FOUND = 'Không tìm thấy mức phạt';
const STALE = 'Mức phạt đã được người khác sửa, bảng đã được tải lại';
const DELETED = 'Đã xóa mức phạt';
const HIDDEN = 'Mức phạt đã được dùng trong phiếu phạt nên chỉ được ẩn; phiếu phạt cũ giữ nguyên';

function isUniqueViolation(err) {
  return err?.code === 'P2002';
}

function nameTaken() {
  return new HttpError(409, NAME_TAKEN, { name: NAME_TAKEN });
}

function toTier(row) {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    amount: row.amount,
    ticketCount: row._count?.fineTickets ?? 0,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

const TICKET_COUNT = { _count: { select: { fineTickets: true } } };

function createFineService({ prisma }) {
  // 2.4.2: mức phạt đang dùng để nhân viên chọn khi xác nhận trả, nhóm theo loại (ERD fine_tiers).
  // Mức đã ẩn (`is_active = false`, 2.5.1) không hiện.
  async function listTierOptions() {
    const rows = await prisma.fineTier.findMany({
      where: { isActive: true },
      select: { id: true, name: true, type: true, amount: true },
      orderBy: [{ amount: 'asc' }, { id: 'asc' }],
    });
    const tiers = Object.fromEntries(FINE_TYPES.map((type) => [type, []]));
    for (const { type, ...tier } of rows) tiers[type].push(tier);
    return tiers;
  }

  // 2.5.1 [Giả định]: bảng chỉ gồm mức đang áp dụng, sắp theo loại (Trả muộn, Hư hỏng, Mất) rồi số tiền,
  // kèm số phiếu phạt đã dùng để biết xóa sẽ là xóa hẳn hay ẩn.
  async function listTiers() {
    const rows = await prisma.fineTier.findMany({
      where: { isActive: true },
      orderBy: [{ type: 'asc' }, { amount: 'asc' }, { id: 'asc' }],
      include: TICKET_COUNT,
    });
    return rows.map(toTier);
  }

  // Trùng tên (không phân biệt hoa thường) do UNIQUE (lower(name)) WHERE is_active ở DB chặn.
  async function createTier({ name, type, amount }) {
    try {
      return toTier(await prisma.fineTier.create({ data: { name, type, amount }, include: TICKET_COUNT }));
    } catch (err) {
      if (isUniqueViolation(err)) throw nameTaken();
      throw err;
    }
  }

  // Edge 3: phiếu phạt đã lập giữ bản sao tên và số tiền, nên sửa không ảnh hưởng phiếu cũ.
  // Edge 7: khóa lạc quan theo `updated_at` (trigger set_updated_at); so trong SQL với sai số 1 ms
  // vì Date của JS chỉ giữ tới mili giây còn DB giữ tới micro giây.
  async function updateTier(id, { name, amount, updatedAt }) {
    try {
      return await prisma.$transaction(async (tx) => {
        const locked = await tx.$queryRaw`
          SELECT abs(extract(epoch FROM updated_at - ${updatedAt}::timestamptz)) < 0.001 AS fresh
          FROM fine_tiers WHERE id = ${id} AND is_active FOR UPDATE`;
        if (locked.length === 0) throw new HttpError(404, TIER_NOT_FOUND);
        if (!locked[0].fresh) throw Object.assign(new HttpError(409, STALE), { reason: 'stale' });
        return toTier(await tx.fineTier.update({ where: { id }, data: { name, amount }, include: TICKET_COUNT }));
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw nameTaken();
      throw err;
    }
  }

  // Edge 4: đã có phiếu phạt dùng thì ẩn (`is_active = false`), chưa có thì xóa hẳn. Khóa dòng mức phạt
  // trước khi đếm: 2.4.2 khóa cùng dòng FOR SHARE khi lập phiếu, nên phiếu đang lập dở vẫn được đếm.
  async function deleteTier(id) {
    return prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw`SELECT id FROM fine_tiers WHERE id = ${id} AND is_active FOR UPDATE`;
      if (locked.length === 0) throw new HttpError(404, TIER_NOT_FOUND);
      const ticketCount = await tx.fineTicket.count({ where: { fineTierId: id } });
      if (ticketCount > 0) {
        await tx.fineTier.update({ where: { id }, data: { isActive: false } });
        return { hidden: true, message: HIDDEN };
      }
      await tx.fineTier.delete({ where: { id } });
      return { hidden: false, message: DELETED };
    });
  }

  return { listTierOptions, listTiers, createTier, updateTier, deleteTier };
}

module.exports = { createFineService, FINE_TYPES, NAME_TAKEN, TIER_NOT_FOUND, STALE, DELETED, HIDDEN };
