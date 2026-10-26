import request from 'supertest';
import { createApp } from '../../src/app';
import { createTokenService } from '../../src/lib/tokens';

const tokens = createTokenService({ secret: 'test-secret', expiresIn: '24h' });
const USERS = {
  1: { id: 1, email: 'r@example.com', name: 'R', role: 'reader', status: 'active' },
  2: { id: 2, email: 'l@example.com', name: 'L', role: 'librarian', status: 'active' },
  3: { id: 3, email: 'a@example.com', name: 'A', role: 'admin', status: 'active' },
};
const bearer = (id = 3) => `Bearer ${tokens.sign(USERS[id])}`;
const UPDATED_AT = '2026-10-26T03:00:00.123Z';

function makeApp() {
  const authService = { getSessionUser: vi.fn(async (id) => USERS[id] ?? null) };
  const fineService = {
    listTierOptions: vi.fn(async () => ({ late: [], damaged: [], lost: [] })),
    listTiers: vi.fn(async () => [{ id: 1, name: 'Trả muộn', type: 'late', amount: 10000, ticketCount: 0 }]),
    createTier: vi.fn(async (data) => ({ id: 2, ...data, ticketCount: 0 })),
    updateTier: vi.fn(async (id, { name, amount }) => ({ id, name, amount, type: 'late', ticketCount: 0 })),
    deleteTier: vi.fn(async () => ({ hidden: false, message: 'Đã xóa mức phạt' })),
  };
  return { app: createApp({ authService, fineService, tokens }), fineService };
}

describe('Phân quyền /api/fine-tiers (2.5.1)', () => {
  it.each([
    ['get', '/api/fine-tiers'],
    ['post', '/api/fine-tiers'],
    ['patch', '/api/fine-tiers/1'],
    ['delete', '/api/fine-tiers/1'],
  ])('%s %s không có token → 401', async (method, url) => {
    const { app } = makeApp();
    const res = await request(app)[method](url);
    expect(res.status).toBe(401);
  });

  it.each([
    ['get', '/api/fine-tiers'],
    ['post', '/api/fine-tiers'],
    ['patch', '/api/fine-tiers/1'],
    ['delete', '/api/fine-tiers/1'],
  ])('edge 6: librarian %s %s → 403, reader cũng 403', async (method, url) => {
    const { app, fineService } = makeApp();
    for (const id of [1, 2]) {
      const res = await request(app)[method](url).set('Authorization', bearer(id)).send({});
      expect(res.status).toBe(403);
    }
    expect(fineService.listTiers).not.toHaveBeenCalled();
    expect(fineService.createTier).not.toHaveBeenCalled();
    expect(fineService.updateTier).not.toHaveBeenCalled();
    expect(fineService.deleteTier).not.toHaveBeenCalled();
  });

  it('admin → 200 danh sách', async () => {
    const { app } = makeApp();
    const res = await request(app).get('/api/fine-tiers').set('Authorization', bearer());
    expect(res.status).toBe(200);
    expect(res.body.tiers).toHaveLength(1);
  });

  it('/options (2.4.2) vẫn cho librarian, không cho reader', async () => {
    const { app } = makeApp();
    expect((await request(app).get('/api/fine-tiers/options').set('Authorization', bearer(2))).status).toBe(200);
    expect((await request(app).get('/api/fine-tiers/options').set('Authorization', bearer(1))).status).toBe(403);
  });
});

describe('POST /api/fine-tiers', () => {
  it('hợp lệ → 201, tên được trim, số tiền dạng chuỗi số được nhận, field lạ bị bỏ', async () => {
    const { app, fineService } = makeApp();
    const res = await request(app).post('/api/fine-tiers').set('Authorization', bearer())
      .send({ name: '  Mất sách  ', type: 'lost', amount: '150000', issuedAt: '2026-10-26', isActive: false });
    expect(res.status).toBe(201);
    expect(res.body.message).toBe('Thêm mức phạt thành công');
    expect(fineService.createTier).toHaveBeenCalledWith({ name: 'Mất sách', type: 'lost', amount: 150000 });
  });

  it.each([
    ['tên đúng 25 ký tự', { name: 'a'.repeat(25) }],
    ['số tiền 1', { amount: 1 }],
    ['số tiền 999.999.999', { amount: 999999999 }],
  ])('biên %s → 201', async (_, patch) => {
    const { app } = makeApp();
    const res = await request(app).post('/api/fine-tiers').set('Authorization', bearer())
      .send({ name: 'Hư hỏng', type: 'damaged', amount: 50000, ...patch });
    expect(res.status).toBe(201);
  });

  it.each([
    [{}, 'name', 'Tên mức phạt không được để trống'],
    [{ name: '   ' }, 'name', 'Tên mức phạt không được để trống'],
    [{ name: 'a'.repeat(26) }, 'name', 'Tên mức phạt tối đa 25 ký tự'],
    [{ name: 5 }, 'name', 'Tên mức phạt không hợp lệ'],
    [{}, 'type', 'Vui lòng chọn loại mức phạt'],
    [{ type: 'other' }, 'type', 'Loại mức phạt không hợp lệ'],
    [{}, 'amount', 'Số tiền không được để trống'],
    [{ amount: 0 }, 'amount', 'Số tiền phải lớn hơn 0'],
    [{ amount: -5000 }, 'amount', 'Số tiền phải lớn hơn 0'],
    [{ amount: 'abc' }, 'amount', 'Số tiền phải là số'],
    [{ amount: '' }, 'amount', 'Số tiền phải là số'],
    [{ amount: 1000000000 }, 'amount', 'Số tiền tối đa 999.999.999 đ'],
    [{ amount: 1e20 }, 'amount', 'Số tiền tối đa 999.999.999 đ'],
    [{ amount: 1000.5 }, 'amount', 'Số tiền phải là số nguyên (VND)'],
  ])('edge 1, 2: %j → 400 %s "%s"', async (body, field, msg) => {
    const { app, fineService } = makeApp();
    const res = await request(app).post('/api/fine-tiers').set('Authorization', bearer()).send(body);
    expect(res.status).toBe(400);
    expect(res.body.errors[field]).toBe(msg);
    expect(fineService.createTier).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/fine-tiers/:id', () => {
  it('hợp lệ → 200, chỉ gửi tên, số tiền và updatedAt (loại không sửa được)', async () => {
    const { app, fineService } = makeApp();
    const res = await request(app).patch('/api/fine-tiers/5').set('Authorization', bearer())
      .send({ name: ' Muộn ', amount: 20000, type: 'lost', updatedAt: UPDATED_AT });
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Cập nhật mức phạt thành công');
    expect(fineService.updateTier).toHaveBeenCalledWith(5, { name: 'Muộn', amount: 20000, updatedAt: new Date(UPDATED_AT) });
  });

  it.each([
    [{ name: 'X', amount: 1000 }, 'updatedAt', 'Thiếu thời điểm cập nhật, vui lòng tải lại bảng'],
    [{ name: 'X', amount: 1000, updatedAt: 'hôm qua' }, 'updatedAt', 'Thời điểm cập nhật không hợp lệ'],
    [{ name: '', amount: 1000, updatedAt: UPDATED_AT }, 'name', 'Tên mức phạt không được để trống'],
    [{ name: 'X', amount: 0, updatedAt: UPDATED_AT }, 'amount', 'Số tiền phải lớn hơn 0'],
  ])('%j → 400', async (body, field, msg) => {
    const { app, fineService } = makeApp();
    const res = await request(app).patch('/api/fine-tiers/5').set('Authorization', bearer()).send(body);
    expect(res.status).toBe(400);
    expect(res.body.errors[field]).toBe(msg);
    expect(fineService.updateTier).not.toHaveBeenCalled();
  });

  it.each(['abc', '0', '-1', '1.5', '99999999999'])('id "%s" không hợp lệ → 404', async (id) => {
    const { app, fineService } = makeApp();
    const res = await request(app).patch(`/api/fine-tiers/${id}`).set('Authorization', bearer())
      .send({ name: 'X', amount: 1000, updatedAt: UPDATED_AT });
    expect(res.status).toBe(404);
    expect(fineService.updateTier).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/fine-tiers/:id', () => {
  it('→ 200 kèm hidden và message từ service', async () => {
    const { app, fineService } = makeApp();
    fineService.deleteTier.mockResolvedValueOnce({ hidden: true, message: 'ẩn' });
    const res = await request(app).delete('/api/fine-tiers/3').set('Authorization', bearer());
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ hidden: true, message: 'ẩn' });
    expect(fineService.deleteTier).toHaveBeenCalledWith(3);
  });

  it('id không hợp lệ → 404', async () => {
    const { app } = makeApp();
    const res = await request(app).delete('/api/fine-tiers/x').set('Authorization', bearer());
    expect(res.status).toBe(404);
  });
});
