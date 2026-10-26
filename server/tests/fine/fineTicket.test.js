import request from 'supertest';
import { createApp } from '../../src/app';
import { createTokenService } from '../../src/lib/tokens';
import { HttpError } from '../../src/lib/httpError';
import { PAY_BLOCKED, canPay, evaluatePayment, transferContent } from '../../src/modules/fine/fineTicket.rules';
import { myTicketsQuerySchema } from '../../src/modules/fine/fineTicket.validation';
import {
  createFineTicketService, bankFromEnv, RECEIPT_BUCKET, RECEIPT_URL_TTL, TICKET_NOT_FOUND, NO_RECEIPT, SUBMITTED,
} from '../../src/modules/fine/fineTicket.service';

const NOW = new Date('2026-10-26T03:00:00Z');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

describe('Quy tắc 2.5.2', () => {
  it.each([
    ['unpaid', null],
    // Edge 2: phiếu bị từ chối được gửi lại.
    ['rejected', null],
    // Edge 1: bấm lần hai khi đã chờ xác nhận.
    ['pending', 'already_submitted'],
    ['paid', 'already_paid'],
  ])('%s → %s', (status, reason) => {
    expect(evaluatePayment(status)).toBe(reason);
    expect(canPay(status)).toBe(reason === null);
  });

  it('edge 5: nội dung chuyển khoản chứa mã phiếu', () => {
    expect(transferContent(42)).toBe('THU VIEN PHAT 42');
  });

  it.each([
    [{}, { status: 'due', page: 1 }],
    [{ status: 'paid', page: '3' }, { status: 'paid', page: 3 }],
    [{ status: 'xyz', page: '-1' }, { status: 'due', page: 1 }],
  ])('query %j → %j', (input, expected) => {
    expect(myTicketsQuerySchema.validate(input).value).toEqual(expected);
  });

  it('bank lấy từ env, thiếu số tài khoản → null', () => {
    expect(bankFromEnv({ BANK_NAME: 'VCB', BANK_ACCOUNT_NUMBER: '01', BANK_ACCOUNT_HOLDER: 'TV' }))
      .toEqual({ bankName: 'VCB', accountNumber: '01', accountHolder: 'TV' });
    expect(bankFromEnv({ BANK_NAME: 'VCB' })).toBeNull();
  });
});

const ROW = {
  id: 7, type: 'late', tierName: 'Trả muộn', amount: 10000, note: null, status: 'unpaid',
  issuedAt: NOW, submittedAt: null, rejectReason: null, rejectedAt: null, confirmedAt: null, receiptPath: null,
  borrowOrder: { book: { title: 'Sách A' } },
};

describe('fineTicketService.listMyTickets', () => {
  function makeService(rows = [ROW], total = rows.length) {
    const prisma = {
      fineTicket: {
        count: vi.fn(async ({ where }) => (where.status === 'pending' ? 2 : total)),
        aggregate: vi.fn(async () => ({ _count: { _all: 3 }, _sum: { amount: 60000 } })),
        findMany: vi.fn(async () => rows),
      },
    };
    const bank = { bankName: 'VCB', accountNumber: '01', accountHolder: 'TV' };
    return { service: createFineTicketService({ prisma, storage: {}, bank }), prisma, bank };
  }

  it('mặc định lọc phiếu cần thanh toán của chính độc giả, kèm tổng và thông tin ngân hàng', async () => {
    const { service, prisma, bank } = makeService();
    const result = await service.listMyTickets(5, { status: 'due', page: 1 });
    expect(prisma.fineTicket.count).toHaveBeenCalledWith({ where: { readerId: 5, status: { in: ['unpaid', 'rejected'] } } });
    expect(prisma.fineTicket.findMany.mock.calls[0][0]).toMatchObject({
      where: { readerId: 5, status: { in: ['unpaid', 'rejected'] } },
      orderBy: [{ issuedAt: 'desc' }, { id: 'desc' }],
      skip: 0,
      take: 10,
    });
    expect(result.tickets[0]).toEqual({
      id: 7, type: 'late', tierName: 'Trả muộn', bookTitle: 'Sách A', note: null, amount: 10000, status: 'unpaid',
      issuedAt: NOW, submittedAt: null, rejectReason: null, rejectedAt: null, confirmedAt: null,
      hasReceipt: false, canPay: true, transferContent: 'THU VIEN PHAT 7',
    });
    expect(result.summary).toEqual({ dueCount: 3, dueAmount: 60000, pendingCount: 2 });
    expect(result.bank).toBe(bank);
  });

  it('tab Tất cả không lọc trạng thái; trang quá cuối về trang cuối', async () => {
    const { service, prisma } = makeService([ROW], 12);
    const result = await service.listMyTickets(5, { status: 'all', page: 9 });
    expect(prisma.fineTicket.count).toHaveBeenCalledWith({ where: { readerId: 5 } });
    expect(prisma.fineTicket.findMany.mock.calls[0][0].skip).toBe(10);
    expect(result.pagination).toEqual({ page: 2, pageSize: 10, total: 12, totalPages: 2 });
  });

  it('không có phiếu → danh sách rỗng, không truy vấn findMany', async () => {
    const { service, prisma } = makeService([], 0);
    const result = await service.listMyTickets(5, { status: 'due', page: 1 });
    expect(result.tickets).toEqual([]);
    expect(prisma.fineTicket.findMany).not.toHaveBeenCalled();
  });
});

describe('fineTicketService.payTicket', () => {
  function makeService({ ticket = { status: 'unpaid', receiptPath: null }, uploadError, updateError } = {}) {
    const calls = [];
    const tx = {
      $queryRaw: vi.fn(async (strings, ...values) => {
        calls.push({ sql: strings.join('?'), values });
        return ticket ? [ticket] : [];
      }),
      fineTicket: {
        update: vi.fn(async ({ data }) => {
          if (updateError) throw updateError;
          return { ...ROW, ...data };
        }),
      },
    };
    const prisma = { $transaction: vi.fn(async (fn) => fn(tx)) };
    const storage = {
      upload: vi.fn(async () => { if (uploadError) throw uploadError; }),
      remove: vi.fn(async () => {}),
    };
    const logger = { error: vi.fn() };
    const service = createFineTicketService({ prisma, storage, bank: null, newId: () => 'uuid', now: () => NOW, logger });
    return { service, tx, calls, storage };
  }

  it('khóa phiếu của chính độc giả rồi chuyển Chờ xác nhận, không ảnh thì receipt_path null', async () => {
    const { service, tx, calls, storage } = makeService();
    const result = await service.payTicket(5, 7, undefined);
    expect(calls[0].sql).toMatch(/FROM fine_tickets WHERE id = \? AND reader_id = \? FOR UPDATE/);
    expect(calls[0].values).toEqual([7, 5]);
    expect(tx.fineTicket.update.mock.calls[0][0]).toMatchObject({
      where: { id: 7 }, data: { status: 'pending', submittedAt: NOW, receiptPath: null },
    });
    expect(storage.upload).not.toHaveBeenCalled();
    expect(result.message).toBe(SUBMITTED);
    expect(result.ticket).toMatchObject({ id: 7, status: 'pending', canPay: false });
  });

  it('có ảnh: upload vào bucket receipts trước, lưu đường dẫn', async () => {
    const { service, tx, storage } = makeService();
    await service.payTicket(5, 7, { buffer: PNG });
    expect(storage.upload).toHaveBeenCalledWith(RECEIPT_BUCKET, 'uuid.png', PNG, 'image/png');
    expect(tx.fineTicket.update.mock.calls[0][0].data.receiptPath).toBe('uuid.png');
    expect(storage.remove).not.toHaveBeenCalled();
  });

  it('edge 2: gửi lại phiếu bị từ chối, ảnh cũ bị xóa sau khi ghi DB', async () => {
    const { service, tx, storage } = makeService({ ticket: { status: 'rejected', receiptPath: 'old.jpg' } });
    await service.payTicket(5, 7, { buffer: PNG });
    expect(tx.fineTicket.update).toHaveBeenCalled();
    expect(storage.remove).toHaveBeenCalledWith(RECEIPT_BUCKET, 'old.jpg');
  });

  it.each([
    ['pending', 'already_submitted'],
    ['paid', 'already_paid'],
  ])('edge 1: phiếu %s → 409 %s, ảnh vừa upload bị xóa', async (status, reason) => {
    const { service, tx, storage } = makeService({ ticket: { status, receiptPath: null } });
    await expect(service.payTicket(5, 7, { buffer: PNG }))
      .rejects.toMatchObject({ status: 409, reason, message: PAY_BLOCKED[reason] });
    expect(tx.fineTicket.update).not.toHaveBeenCalled();
    expect(storage.remove).toHaveBeenCalledWith(RECEIPT_BUCKET, 'uuid.png');
  });

  it('edge 6: phiếu không có hoặc của người khác → 404', async () => {
    const { service, tx } = makeService({ ticket: null });
    await expect(service.payTicket(5, 7)).rejects.toMatchObject({ status: 404, message: TICKET_NOT_FOUND });
    expect(tx.fineTicket.update).not.toHaveBeenCalled();
  });

  it('file không phải ảnh → 400, không upload, không ghi DB', async () => {
    const { service, storage, tx } = makeService();
    await expect(service.payTicket(5, 7, { buffer: Buffer.from('hello') }))
      .rejects.toMatchObject({ status: 400, errors: { receipt: expect.any(String) } });
    expect(storage.upload).not.toHaveBeenCalled();
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });

  it('upload lỗi → 502, không ghi DB', async () => {
    const { service, tx } = makeService({ uploadError: new Error('timeout') });
    await expect(service.payTicket(5, 7, { buffer: PNG })).rejects.toMatchObject({ status: 502 });
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });

  it('ghi DB lỗi → xóa ảnh vừa upload, giữ ảnh cũ', async () => {
    const { service, storage } = makeService({
      ticket: { status: 'rejected', receiptPath: 'old.jpg' }, updateError: new Error('db'),
    });
    await expect(service.payTicket(5, 7, { buffer: PNG })).rejects.toThrow('db');
    expect(storage.remove).toHaveBeenCalledTimes(1);
    expect(storage.remove).toHaveBeenCalledWith(RECEIPT_BUCKET, 'uuid.png');
  });
});

describe('fineTicketService.getMyReceiptUrl', () => {
  function makeService(ticket) {
    const prisma = { fineTicket: { findFirst: vi.fn(async () => ticket) } };
    const storage = { signedUrl: vi.fn(async () => 'https://signed') };
    return { service: createFineTicketService({ prisma, storage, bank: null }), prisma, storage };
  }

  it('trả signed URL ngắn hạn cho phiếu của chính độc giả', async () => {
    const { service, prisma, storage } = makeService({ receiptPath: 'a.png' });
    expect(await service.getMyReceiptUrl(5, 7)).toEqual({ url: 'https://signed' });
    expect(prisma.fineTicket.findFirst.mock.calls[0][0].where).toEqual({ id: 7, readerId: 5 });
    expect(storage.signedUrl).toHaveBeenCalledWith(RECEIPT_BUCKET, 'a.png', RECEIPT_URL_TTL);
  });

  it('phiếu của người khác → 404; không có ảnh → 404', async () => {
    await expect(makeService(null).service.getMyReceiptUrl(5, 7)).rejects.toMatchObject({ status: 404, message: TICKET_NOT_FOUND });
    await expect(makeService({ receiptPath: null }).service.getMyReceiptUrl(5, 7))
      .rejects.toMatchObject({ status: 404, message: NO_RECEIPT });
  });
});

describe('Route /api/fine-tickets (2.5.2)', () => {
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
      listMyTickets: vi.fn(async () => ({ tickets: [] })),
      payTicket: vi.fn(async () => ({ message: SUBMITTED })),
      getMyReceiptUrl: vi.fn(async () => ({ url: 'u' })),
    };
    return { app: createApp({ authService, fineTicketService, tokens }), fineTicketService };
  }

  it.each([
    ['get', '/api/fine-tickets/mine'],
    ['post', '/api/fine-tickets/1/pay'],
    ['get', '/api/fine-tickets/1/receipt'],
  ])('%s %s: không token → 401, nhân viên/Admin → 403', async (method, url) => {
    const { app, fineTicketService } = makeApp();
    expect((await request(app)[method](url)).status).toBe(401);
    for (const id of [2, 3]) {
      expect((await request(app)[method](url).set('Authorization', bearer(id))).status).toBe(403);
    }
    expect(fineTicketService.listMyTickets).not.toHaveBeenCalled();
    expect(fineTicketService.payTicket).not.toHaveBeenCalled();
  });

  it('GET /mine chuẩn hóa query và dùng id từ token', async () => {
    const { app, fineTicketService } = makeApp();
    const res = await request(app).get('/api/fine-tickets/mine?status=lung-tung&page=abc').set('Authorization', bearer(1));
    expect(res.status).toBe(200);
    expect(fineTicketService.listMyTickets).toHaveBeenCalledWith(1, { status: 'due', page: 1 });
  });

  it('POST /:id/pay không file và có file', async () => {
    const { app, fineTicketService } = makeApp();
    let res = await request(app).post('/api/fine-tickets/7/pay').set('Authorization', bearer(1));
    expect(res.status).toBe(200);
    expect(fineTicketService.payTicket).toHaveBeenLastCalledWith(1, 7, undefined);
    res = await request(app).post('/api/fine-tickets/7/pay').set('Authorization', bearer(1))
      .attach('receipt', PNG, 'a.png');
    expect(res.status).toBe(200);
    expect(fineTicketService.payTicket.mock.lastCall[2].buffer.equals(PNG)).toBe(true);
  });

  it('POST /:id/pay ảnh > 2 MB → 413', async () => {
    const { app, fineTicketService } = makeApp();
    const res = await request(app).post('/api/fine-tickets/7/pay').set('Authorization', bearer(1))
      .attach('receipt', Buffer.alloc(2 * 1024 * 1024 + 1), 'big.png');
    expect(res.status).toBe(413);
    expect(fineTicketService.payTicket).not.toHaveBeenCalled();
  });

  it('id không hợp lệ → 404; 409 trả kèm reason', async () => {
    const { app, fineTicketService } = makeApp();
    expect((await request(app).post('/api/fine-tickets/abc/pay').set('Authorization', bearer(1))).status).toBe(404);
    fineTicketService.payTicket.mockRejectedValueOnce(
      Object.assign(new HttpError(409, PAY_BLOCKED.already_submitted), { reason: 'already_submitted' }),
    );
    const res = await request(app).post('/api/fine-tickets/7/pay').set('Authorization', bearer(1));
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ message: PAY_BLOCKED.already_submitted, reason: 'already_submitted' });
  });
});
