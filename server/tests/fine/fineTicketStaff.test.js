import request from 'supertest';
import { createApp } from '../../src/app';
import { createTokenService } from '../../src/lib/tokens';
import { HttpError } from '../../src/lib/httpError';
import { REVIEW_BLOCKED, canReview, evaluateReview } from '../../src/modules/fine/fineTicket.rules';
import { staffTicketsQuerySchema } from '../../src/modules/fine/fineTicket.validation';
import { REASON_REQUIRED, REASON_TOO_LONG } from '../../src/modules/borrow/borrow.validation';
import {
  createFineTicketService, ticketIdFromQuery, RECEIPT_BUCKET, RECEIPT_URL_TTL, TICKET_NOT_FOUND, CONFIRMED, REJECTED,
} from '../../src/modules/fine/fineTicket.service';

const NOW = new Date('2026-10-26T03:00:00Z');

describe('Quy tắc 2.5.3', () => {
  it.each([
    ['pending', null],
    // Edge 2: độc giả chưa bấm gửi thì nhân viên chỉ theo dõi.
    ['unpaid', 'not_submitted'],
    // Edge 1: người khác đã xác nhận hoặc từ chối. Edge 7: Đã thanh toán là trạng thái cuối.
    ['paid', 'already_processed'],
    ['rejected', 'already_processed'],
  ])('%s → %s', (status, reason) => {
    expect(evaluateReview(status)).toBe(reason);
    expect(canReview(status)).toBe(reason === null);
  });

  it.each([
    [{}, { status: 'pending', q: '', page: 1 }],
    [{ status: 'paid', q: '  an  ', page: '2' }, { status: 'paid', q: 'an', page: 2 }],
    [{ status: 'due', q: 'x'.repeat(101), page: '0' }, { status: 'pending', q: '', page: 1 }],
  ])('query %j → %j', (input, expected) => {
    expect(staffTicketsQuerySchema.validate(input).value).toEqual(expected);
  });

  it.each([
    ['12', 12], ['#12', 12], ['thu vien phat 12', 12], ['THU VIEN PHAT  7', 7], ['An 12', null], ['abc', null],
  ])('mã phiếu từ "%s" → %s', (q, id) => {
    expect(ticketIdFromQuery(q)).toBe(id);
  });
});

const ROW = {
  id: 7, type: 'damaged', tierName: 'Hư hỏng', amount: 50000, note: 'Rách bìa', status: 'pending',
  issuedAt: NOW, submittedAt: NOW, rejectReason: null, rejectedAt: null, confirmedAt: null, receiptPath: 'a.png',
  reader: { id: 5, name: 'An', email: 'an@example.com' },
  borrowOrder: { id: 30, book: { id: 9, title: 'Sách A' } },
  confirmedBy: null,
};

describe('fineTicketService.listTickets', () => {
  function makeService(rows = [ROW], total = rows.length) {
    const prisma = {
      fineTicket: {
        count: vi.fn(async () => total),
        aggregate: vi.fn(async () => ({ _count: { _all: 4 }, _sum: { amount: 90000 } })),
        findMany: vi.fn(async () => rows),
      },
    };
    return { service: createFineTicketService({ prisma, storage: {}, bank: null }), prisma };
  }

  it('mặc định phiếu Chờ xác nhận, gửi sớm nhất trước, kèm chi tiết để đối chiếu', async () => {
    const { service, prisma } = makeService();
    const result = await service.listTickets({ status: 'pending', q: '', page: 1 });
    expect(prisma.fineTicket.count).toHaveBeenCalledWith({ where: { status: 'pending' } });
    expect(prisma.fineTicket.findMany.mock.calls[0][0]).toMatchObject({
      where: { status: 'pending' }, orderBy: [{ submittedAt: 'asc' }, { id: 'asc' }], skip: 0, take: 10,
    });
    expect(result.tickets[0]).toEqual({
      id: 7, type: 'damaged', tierName: 'Hư hỏng', note: 'Rách bìa', amount: 50000, status: 'pending',
      issuedAt: NOW, submittedAt: NOW, rejectReason: null, rejectedAt: null, confirmedAt: null,
      hasReceipt: true, transferContent: 'THU VIEN PHAT 7',
      reader: ROW.reader, borrowOrderId: 30, book: { id: 9, title: 'Sách A' }, confirmedByName: null, canReview: true,
    });
    expect(result.summary).toEqual({ pendingCount: 4, pendingAmount: 90000 });
  });

  it('tab khác mới nhất trước; Tất cả không lọc trạng thái; trang quá cuối về trang cuối', async () => {
    const { service, prisma } = makeService([ROW], 12);
    const result = await service.listTickets({ status: 'all', q: '', page: 5 });
    expect(prisma.fineTicket.count).toHaveBeenCalledWith({ where: {} });
    expect(prisma.fineTicket.findMany.mock.calls[0][0]).toMatchObject({
      orderBy: [{ issuedAt: 'desc' }, { id: 'desc' }], skip: 10,
    });
    expect(result.pagination).toEqual({ page: 2, pageSize: 10, total: 12, totalPages: 2 });
  });

  it('tìm theo tên/email độc giả, tên sách; số thì tìm cả mã phiếu', async () => {
    const { service, prisma } = makeService();
    await service.listTickets({ status: 'unpaid', q: '#7', page: 1 });
    const contains = { contains: '#7', mode: 'insensitive' };
    expect(prisma.fineTicket.count.mock.calls[0][0].where).toEqual({
      status: 'unpaid',
      OR: [{ reader: { name: contains } }, { reader: { email: contains } }, { borrowOrder: { book: { title: contains } } }, { id: 7 }],
    });
    await service.listTickets({ status: 'unpaid', q: 'An', page: 1 });
    expect(prisma.fineTicket.count.mock.calls[1][0].where.OR).toHaveLength(3);
  });

  it('không có phiếu → rỗng, không gọi findMany', async () => {
    const { service, prisma } = makeService([], 0);
    expect((await service.listTickets({ status: 'pending', q: '', page: 1 })).tickets).toEqual([]);
    expect(prisma.fineTicket.findMany).not.toHaveBeenCalled();
  });
});

describe('fineTicketService.confirmTicket / rejectTicket', () => {
  function makeService({ ticket = { status: 'pending', readerId: 5 }, outstanding = 0 } = {}) {
    const calls = [];
    const tx = {
      $queryRaw: vi.fn(async (strings, ...values) => {
        calls.push({ sql: strings.join('?'), values });
        return ticket ? [ticket] : [];
      }),
      fineTicket: {
        update: vi.fn(async ({ data }) => ({ ...ROW, ...data, confirmedBy: data.confirmedById ? { name: 'Thủ thư' } : null })),
        count: vi.fn(async () => outstanding),
      },
    };
    const prisma = { $transaction: vi.fn(async (fn) => fn(tx)) };
    return { service: createFineTicketService({ prisma, storage: {}, bank: null, now: () => NOW }), tx, calls };
  }

  it('xác nhận: khóa dòng phiếu FOR UPDATE, lưu người xác nhận và thời điểm, bỏ lý do từ chối cũ', async () => {
    const { service, tx, calls } = makeService();
    const result = await service.confirmTicket(2, 7);
    expect(calls[0].sql).toMatch(/FROM fine_tickets WHERE id = \? FOR UPDATE/);
    expect(calls[0].values).toEqual([7]);
    expect(tx.fineTicket.update.mock.calls[0][0]).toMatchObject({
      where: { id: 7 },
      data: { status: 'paid', confirmedById: 2, confirmedAt: NOW, rejectReason: null, rejectedAt: null },
    });
    expect(result).toMatchObject({
      message: CONFIRMED, readerOutstanding: 0, ticket: { status: 'paid', confirmedByName: 'Thủ thư', canReview: false },
    });
  });

  it('edge 5: đếm phiếu chưa Đã thanh toán của độc giả sau khi xác nhận', async () => {
    const { service, tx } = makeService({ outstanding: 2 });
    expect((await service.confirmTicket(2, 7)).readerOutstanding).toBe(2);
    expect(tx.fineTicket.count).toHaveBeenCalledWith({ where: { readerId: 5, status: { not: 'paid' } } });
  });

  it('từ chối: lưu lý do và thời điểm, không đổi người xác nhận', async () => {
    const { service, tx } = makeService({ outstanding: 1 });
    const result = await service.rejectTicket(2, 7, { reason: 'Chuyển thiếu 10.000 đ' });
    expect(tx.fineTicket.update.mock.calls[0][0].data)
      .toEqual({ status: 'rejected', rejectReason: 'Chuyển thiếu 10.000 đ', rejectedAt: NOW });
    expect(result).toMatchObject({ message: REJECTED, readerOutstanding: 1, ticket: { status: 'rejected' } });
  });

  it.each([
    ['unpaid', 'not_submitted'],
    ['paid', 'already_processed'],
    ['rejected', 'already_processed'],
  ])('phiếu %s → 409 %s, không ghi DB', async (status, reason) => {
    for (const run of [(s) => s.confirmTicket(2, 7), (s) => s.rejectTicket(2, 7, { reason: 'x' })]) {
      const { service, tx } = makeService({ ticket: { status, readerId: 5 } });
      await expect(run(service)).rejects.toMatchObject({ status: 409, reason, message: REVIEW_BLOCKED[reason] });
      expect(tx.fineTicket.update).not.toHaveBeenCalled();
    }
  });

  it('phiếu không tồn tại → 404', async () => {
    const { service } = makeService({ ticket: null });
    await expect(service.confirmTicket(2, 7)).rejects.toMatchObject({ status: 404, message: TICKET_NOT_FOUND });
  });
});

describe('fineTicketService.getReceiptUrl', () => {
  it('nhân viên xem biên lai của mọi phiếu', async () => {
    const prisma = { fineTicket: { findFirst: vi.fn(async () => ({ receiptPath: 'a.png' })) } };
    const storage = { signedUrl: vi.fn(async () => 'https://signed') };
    const service = createFineTicketService({ prisma, storage, bank: null });
    expect(await service.getReceiptUrl(7)).toEqual({ url: 'https://signed' });
    expect(prisma.fineTicket.findFirst.mock.calls[0][0].where).toEqual({ id: 7 });
    expect(storage.signedUrl).toHaveBeenCalledWith(RECEIPT_BUCKET, 'a.png', RECEIPT_URL_TTL);
  });
});

describe('Route /api/fine-tickets (2.5.3)', () => {
  const tokens = createTokenService({ secret: 'test-secret', expiresIn: '24h' });
  const USERS = {
    1: { id: 1, email: 'r@example.com', name: 'R', role: 'reader', status: 'active' },
    2: { id: 2, email: 'l@example.com', name: 'L', role: 'librarian', status: 'active' },
    3: { id: 3, email: 'a@example.com', name: 'A', role: 'admin', status: 'active' },
  };
  const bearer = (id) => `Bearer ${tokens.sign(USERS[id])}`;

  function makeApp() {
    const authService = { getSessionUser: vi.fn(async (id) => USERS[id] ?? null) };
    const fineTicketService = {
      listTickets: vi.fn(async () => ({ tickets: [] })),
      confirmTicket: vi.fn(async () => ({ message: CONFIRMED })),
      rejectTicket: vi.fn(async () => ({ message: REJECTED })),
      getReceiptUrl: vi.fn(async () => ({ url: 'staff' })),
      getMyReceiptUrl: vi.fn(async () => ({ url: 'mine' })),
    };
    return { app: createApp({ authService, fineTicketService, tokens }), fineTicketService };
  }

  it.each([
    ['get', '/api/fine-tickets'],
    ['post', '/api/fine-tickets/1/confirm'],
    ['post', '/api/fine-tickets/1/reject'],
  ])('%s %s: không token → 401, độc giả → 403 (edge 6)', async (method, url) => {
    const { app, fineTicketService } = makeApp();
    expect((await request(app)[method](url)).status).toBe(401);
    expect((await request(app)[method](url).set('Authorization', bearer(1))).status).toBe(403);
    expect(fineTicketService.listTickets).not.toHaveBeenCalled();
    expect(fineTicketService.confirmTicket).not.toHaveBeenCalled();
    expect(fineTicketService.rejectTicket).not.toHaveBeenCalled();
  });

  it('GET / cho nhân viên và Admin, query chuẩn hóa', async () => {
    const { app, fineTicketService } = makeApp();
    for (const id of [2, 3]) {
      const res = await request(app).get('/api/fine-tickets?status=xyz&page=abc&q=%20An%20').set('Authorization', bearer(id));
      expect(res.status).toBe(200);
    }
    expect(fineTicketService.listTickets).toHaveBeenLastCalledWith({ status: 'pending', q: 'An', page: 1 });
  });

  it('POST /:id/confirm dùng id nhân viên từ token; id sai → 404; 409 kèm reason', async () => {
    const { app, fineTicketService } = makeApp();
    expect((await request(app).post('/api/fine-tickets/7/confirm').set('Authorization', bearer(2))).status).toBe(200);
    expect(fineTicketService.confirmTicket).toHaveBeenCalledWith(2, 7);
    expect((await request(app).post('/api/fine-tickets/0/confirm').set('Authorization', bearer(2))).status).toBe(404);
    fineTicketService.confirmTicket.mockRejectedValueOnce(
      Object.assign(new HttpError(409, REVIEW_BLOCKED.already_processed), { reason: 'already_processed' }),
    );
    const res = await request(app).post('/api/fine-tickets/7/confirm').set('Authorization', bearer(3));
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ message: REVIEW_BLOCKED.already_processed, reason: 'already_processed' });
  });

  it('POST /:id/reject: lý do trim, rỗng hoặc > 500 ký tự → 400 (edge 4)', async () => {
    const { app, fineTicketService } = makeApp();
    let res = await request(app).post('/api/fine-tickets/7/reject').set('Authorization', bearer(2)).send({ reason: '   ' });
    expect(res.status).toBe(400);
    expect(res.body.errors.reason).toBe(REASON_REQUIRED);
    res = await request(app).post('/api/fine-tickets/7/reject').set('Authorization', bearer(2)).send({ reason: 'a'.repeat(501) });
    expect(res.body.errors.reason).toBe(REASON_TOO_LONG);
    expect(fineTicketService.rejectTicket).not.toHaveBeenCalled();
    res = await request(app).post('/api/fine-tickets/7/reject').set('Authorization', bearer(2)).send({ reason: '  Thiếu tiền ' });
    expect(res.status).toBe(200);
    expect(fineTicketService.rejectTicket).toHaveBeenCalledWith(2, 7, { reason: 'Thiếu tiền' });
  });

  it('GET /:id/receipt: độc giả chỉ phiếu của mình, nhân viên mọi phiếu', async () => {
    const { app, fineTicketService } = makeApp();
    let res = await request(app).get('/api/fine-tickets/7/receipt').set('Authorization', bearer(1));
    expect(res.body.url).toBe('mine');
    expect(fineTicketService.getMyReceiptUrl).toHaveBeenCalledWith(1, 7);
    res = await request(app).get('/api/fine-tickets/7/receipt').set('Authorization', bearer(2));
    expect(res.body.url).toBe('staff');
    expect(fineTicketService.getReceiptUrl).toHaveBeenCalledWith(7);
    expect((await request(app).get('/api/fine-tickets/7/receipt')).status).toBe(401);
  });
});
