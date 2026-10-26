const FINE_TYPES = ['late', 'damaged', 'lost'];

function createFineService({ prisma }) {
  // 2.4.2: mức phạt đang dùng để nhân viên chọn khi xác nhận trả, nhóm theo loại (ERD fine_tiers).
  // Mức đã ẩn (`is_active = false`, 2.5.1) không hiện. Quản lý mức phạt thuộc 2.5.1.
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

  return { listTierOptions };
}

module.exports = { createFineService, FINE_TYPES };
