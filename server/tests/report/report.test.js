import request from 'supertest';
import { Prisma } from '@prisma/client';
import { createApp } from '../../src/app';
import { createTokenService } from '../../src/lib/tokens';
import { BOM, csvCell, toCsv } from '../../src/lib/csv';
import { createReportService } from '../../src/modules/report/report.service';
import { reportToCsv, periodLabel } from '../../src/modules/report/report.export';
import { reportQuerySchema, resolveRange } from '../../src/modules/report/report.validation';

// 2026-10-25 17:30 UTC = 00:30 ngày 26/10 ở Việt Nam.
const NOW = new Date('2026-10-25T17:30:00Z');

function sqlOf(call) {
  const [strings, ...values] = call;
  return Prisma.sql(strings, ...values);
}

describe('csv', () => {
  it('edge 3: mở đầu bằng BOM UTF-8, dòng cách nhau CRLF', () => {
    expect(toCsv([['Tên', 'Số'], ['Sách', 1]])).toBe(`${BOM}Tên,Số\r\nSách,1\r\n`);
  });

  it('edge 4: chuỗi bắt đầu bằng = + - @ tab được thêm dấu nháy đơn', () => {
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(csvCell('+84')).toBe("'+84");
    expect(csvCell('-1')).toBe("'-1");
    expect(csvCell('@user')).toBe("'@user");
    expect(csvCell('\tx')).toBe("'\tx");
    expect(csvCell('a=b')).toBe('a=b');
    // Số giữ nguyên để Excel tính được.
    expect(csvCell(-5)).toBe('-5');
  });

  it('edge 5: dấu phẩy, nháy kép, xuống dòng → bao nháy kép và nhân đôi nháy', () => {
    expect(csvCell('a, b')).toBe('"a, b"');
    expect(csvCell('Sách "hay"')).toBe('"Sách ""hay"""');
    expect(csvCell('dòng 1\ndòng 2')).toBe('"dòng 1\ndòng 2"');
    expect(csvCell('=x, "y"')).toBe('"\'=x, ""y"""');
  });

  it('null / undefined thành ô trống', () => {
    expect(toCsv([[null, undefined, 0]])).toBe(`${BOM},,0\r\n`);
  });
});

describe('resolveRange', () => {
  const TODAY = '2026-10-26';

  it('thiếu from/to → tháng hiện tại, gom theo ngày', () => {
    expect(resolveRange({ from: '', to: '', groupBy: null }, TODAY))
      .toEqual({ from: '2026-10-01', to: '2026-10-31', days: 31, groupBy: 'day' });
    expect(resolveRange({ from: '', to: '', groupBy: null }, '2024-02-10').to).toBe('2024-02-29');
  });

  it('khoảng > 31 ngày gom theo tháng; groupBy truyền vào được giữ', () => {
    expect(resolveRange({ from: '2026-01-01', to: '2026-03-31', groupBy: null }, TODAY).groupBy).toBe('month');
    expect(resolveRange({ from: '2026-01-01', to: '2026-03-31', groupBy: 'quarter' }, TODAY).groupBy).toBe('quarter');
  });

  it('một ngày (from = to) hợp lệ', () => {
    expect(resolveRange({ from: TODAY, to: TODAY, groupBy: null }, TODAY).days).toBe(1);
  });

  it('edge 1: từ ngày lớn hơn đến ngày → 400', () => {
    expect(() => resolveRange({ from: '2026-10-02', to: '2026-10-01' }, TODAY)).toThrow(expect.objectContaining({
      status: 400, errors: { to: 'Từ ngày phải nhỏ hơn hoặc bằng đến ngày' },
    }));
  });

  it('edge 2: tối đa 366 ngày', () => {
    expect(resolveRange({ from: '2024-01-01', to: '2024-12-31' }, TODAY).days).toBe(366);
    expect(() => resolveRange({ from: '2025-01-01', to: '2026-01-02' }, TODAY)).toThrow(expect.objectContaining({
      status: 400, errors: { to: 'Khoảng thời gian tối đa 366 ngày' },
    }));
  });

  it('ngày sai định dạng hoặc không tồn tại, hoặc chỉ có một đầu → 400', () => {
    expect(() => resolveRange({ from: '2026-02-30', to: '2026-03-01' }, TODAY)).toThrow(expect.objectContaining({
      errors: { from: 'Từ ngày không hợp lệ' },
    }));
    expect(() => resolveRange({ from: '26/10/2026', to: '' }, TODAY)).toThrow(expect.objectContaining({
      errors: { from: 'Từ ngày không hợp lệ', to: 'Vui lòng chọn đến ngày' },
    }));
  });

  it('groupBy và page lạ quay về mặc định', () => {
    const { value } = reportQuerySchema.validate({ groupBy: 'week', page: 'x' });
    expect(value).toEqual({ from: '', to: '', groupBy: null, page: 1 });
  });
});

describe('reportService', () => {
  const RANGE = { from: '2020-01-01', to: '2020-03-31', days: 91, groupBy: 'month' };

  it('lọc thời điểm theo ngày Asia/Ho_Chi_Minh, tính cả ngày cuối', async () => {
    const prisma = { $queryRaw: vi.fn(async () => [{ lost: 0, damaged: 0, total: 0 }]) };
    await createReportService({ prisma, now: () => NOW }).damagedLost(RANGE);
    const query = sqlOf(prisma.$queryRaw.mock.calls[0]);
    expect(query.sql).toContain('rr.processed_at >= (?::date::timestamp AT TIME ZONE ?)');
    expect(query.sql).toContain('rr.processed_at < ((?::date + 1)::timestamp AT TIME ZONE ?)');
    expect(query.values).toEqual(['2020-01-01', 'Asia/Ho_Chi_Minh', '2020-03-31', 'Asia/Ho_Chi_Minh']);
    expect(query.sql).toContain('b.deleted_at IS NULL');
  });

  it('báo cáo Mượn trả: cộng tổng, không có lượt nào → hasData false', async () => {
    const rows = [{ period: '2020-01-01', borrowed: 3, returned: 2 }, { period: '2020-02-01', borrowed: 0, returned: 1 }];
    const prisma = { $queryRaw: vi.fn(async () => rows) };
    const report = await createReportService({ prisma }).borrows(RANGE);
    expect(report).toEqual({ groupBy: 'month', summary: { borrowed: 3, returned: 3 }, rows, hasData: true });
    const query = sqlOf(prisma.$queryRaw.mock.calls[0]);
    expect(query.sql).toContain('generate_series');
    expect(query.values.slice(0, 4)).toEqual(['month', '2020-01-01', '2020-03-31', '1 month']);

    prisma.$queryRaw.mockResolvedValueOnce([{ period: '2020-01-01', borrowed: 0, returned: 0 }]);
    expect((await createReportService({ prisma }).borrows(RANGE)).hasData).toBe(false);
  });

  it('báo cáo Phạt: đủ 3 loại kể cả loại không có phiếu, bigint → Number', async () => {
    const prisma = {
      $queryRaw: vi.fn()
        .mockResolvedValueOnce([{
          type: 'lost', issuedCount: 1, issuedAmount: 90000000n, collectedCount: 0, collectedAmount: 0n,
          outstandingCount: 1, outstandingAmount: 90000000n,
        }])
        .mockResolvedValueOnce([{ total: 1 }])
        .mockResolvedValueOnce([{ id: 7, name: 'A', email: 'a@x', unpaidCount: 1, unpaidAmount: 90000000n, overdueCount: 0, maxLateDays: 0 }]),
    };
    const report = await createReportService({ prisma, now: () => NOW }).fines(RANGE);
    expect(report.date).toBe('2026-10-26');
    expect(report.byType.map((t) => t.type)).toEqual(['late', 'damaged', 'lost']);
    expect(report.byType[0].issuedAmount).toBe(0);
    expect(report.summary).toEqual({
      issuedCount: 1, issuedAmount: 90000000, collectedCount: 0, collectedAmount: 0, outstandingCount: 1, outstandingAmount: 90000000,
    });
    expect(report.debtors[0].unpaidAmount).toBe(90000000);
    expect(report.hasData).toBe(true);
    // Nợ phạt: mọi phiếu chưa thanh toán xong; quá hạn tính tới hôm nay (giờ Việt Nam).
    const debtorQuery = sqlOf(prisma.$queryRaw.mock.calls[2]);
    expect(debtorQuery.sql).toContain("WHERE status <> 'paid'");
    expect(debtorQuery.sql).toContain("status = 'borrowing' AND due_date < ?::date");
    expect(debtorQuery.values).toContain('2026-10-26');
    expect(debtorQuery.sql).toContain('LIMIT ? OFFSET ?');
  });

  it('trang vượt quá trang cuối → trang cuối; xuất CSV (all) không phân trang', async () => {
    const prisma = { $queryRaw: vi.fn(async () => [{ lost: 12, damaged: 3, total: 15 }]) };
    const service = createReportService({ prisma });
    const report = await service.damagedLost(RANGE, { page: 9 });
    expect(report.pagination).toEqual({ page: 2, pageSize: 10, total: 15, totalPages: 2 });
    expect(sqlOf(prisma.$queryRaw.mock.calls[1]).values.slice(-2)).toEqual([10, 10]);

    prisma.$queryRaw.mockClear();
    await service.damagedLost(RANGE, { all: true });
    expect(sqlOf(prisma.$queryRaw.mock.calls[1]).sql).not.toContain('LIMIT');
  });

  it('báo cáo Sách: chỉ sách chưa xóa, sắp theo lượt mượn trong khoảng', async () => {
    const summary = { titleCount: 0 };
    const prisma = { $queryRaw: vi.fn().mockResolvedValueOnce([summary]).mockResolvedValue([]) };
    const report = await createReportService({ prisma }).books(RANGE);
    expect(report.hasData).toBe(false);
    const rowsQuery = sqlOf(prisma.$queryRaw.mock.calls[1]);
    expect(rowsQuery.sql).toContain('WHERE b.deleted_at IS NULL');
    expect(rowsQuery.sql).toContain('ORDER BY "borrowsInRange" DESC, b.title ASC');
  });
});

describe('reportToCsv', () => {
  it('ghi loại báo cáo, khoảng lọc rồi tới bảng; tên file theo khoảng', () => {
    const { fileName, content } = reportToCsv({
      type: 'borrows', from: '2020-01-01', to: '2020-03-31', groupBy: 'month',
      summary: { borrowed: 5, returned: 4 },
      rows: [{ period: '2020-01-01', borrowed: 3, returned: 2 }, { period: '2020-02-01', borrowed: 2, returned: 2 }],
    });
    expect(fileName).toBe('bao-cao-muon-tra_2020-01-01_2020-03-31.csv');
    expect(content.split('\r\n')).toEqual([
      `${BOM}Báo cáo,Mượn trả`, 'Từ ngày,01/01/2020', 'Đến ngày,31/03/2020', '',
      'Thời gian,Lượt mượn,Lượt trả', '01/2020,3,2', '02/2020,2,2', 'Tổng,5,4', '',
    ]);
  });

  it('báo cáo Sách mất / hư: tên, tác giả có ký tự đặc biệt được escape', () => {
    const { content } = reportToCsv({
      type: 'damaged-lost', from: '2020-01-01', to: '2020-01-31',
      rows: [{ title: 'Sách "A", B', author: '=1+1', isbn: null, category: 'C', condition: 'lost', copies: 1, lastRecordedAt: '2020-01-05' }],
    });
    expect(content).toContain('"Sách ""A"", B",\'=1+1,,C,Mất,1,05/01/2020');
  });

  it('nhãn mốc thời gian', () => {
    expect(periodLabel('2020-01-05', 'day')).toBe('05/01/2020');
    expect(periodLabel('2020-04-01', 'month')).toBe('04/2020');
    expect(periodLabel('2020-10-01', 'quarter')).toBe('Quý 4/2020');
  });
});

describe('/api/reports', () => {
  const tokens = createTokenService({ secret: 'test-secret', expiresIn: '24h' });
  const USERS = {
    1: { id: 1, email: 'r@example.com', name: 'R', role: 'reader', status: 'active' },
    2: { id: 2, email: 'l@example.com', name: 'L', role: 'librarian', status: 'active' },
    3: { id: 3, email: 'a@example.com', name: 'A', role: 'admin', status: 'active' },
  };
  const bearer = (id) => `Bearer ${tokens.sign(USERS[id])}`;
  const REPORT = {
    type: 'borrows', from: '2020-01-01', to: '2020-01-31', groupBy: 'day',
    summary: { borrowed: 1, returned: 0 }, rows: [{ period: '2020-01-01', borrowed: 1, returned: 0 }], hasData: true,
  };

  function makeApp(reportService = { getReport: vi.fn(async () => REPORT) }) {
    const authService = { getSessionUser: vi.fn(async (id) => USERS[id] ?? null) };
    return { app: createApp({ authService, reportService, tokens }), reportService };
  }

  it('không có token → 401; edge 8: reader → 403', async () => {
    const { app, reportService } = makeApp();
    expect((await request(app).get('/api/reports/books')).status).toBe(401);
    expect((await request(app).get('/api/reports/fines').set('Authorization', bearer(1))).status).toBe(403);
    expect((await request(app).get('/api/reports/fines/csv').set('Authorization', bearer(1))).status).toBe(403);
    expect(reportService.getReport).not.toHaveBeenCalled();
  });

  it('edge 7: librarian và admin xem được mọi báo cáo, kể cả Phạt; không cache', async () => {
    const { app, reportService } = makeApp();
    for (const id of [2, 3]) {
      for (const type of ['books', 'borrows', 'fines', 'damaged-lost']) {
        const res = await request(app).get(`/api/reports/${type}?from=2020-01-01&to=2020-01-31&page=2`).set('Authorization', bearer(id));
        expect(res.status).toBe(200);
        expect(res.headers['cache-control']).toBe('no-store');
      }
    }
    expect(reportService.getReport).toHaveBeenCalledWith('fines', { from: '2020-01-01', to: '2020-01-31', groupBy: null, page: 2 });
  });

  it('loại báo cáo không tồn tại → 404', async () => {
    const res = await request(makeApp().app).get('/api/reports/users').set('Authorization', bearer(3));
    expect(res.status).toBe(404);
  });

  it('edge 1: từ ngày lớn hơn đến ngày → 400, không truy vấn DB', async () => {
    const prisma = { $queryRaw: vi.fn() };
    const { app } = makeApp(createReportService({ prisma }));
    const res = await request(app).get('/api/reports/books?from=2020-02-01&to=2020-01-01').set('Authorization', bearer(2));
    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual({ to: 'Từ ngày phải nhỏ hơn hoặc bằng đến ngày' });
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('edge 6: CSV truy vấn lại với đúng bộ lọc, lấy mọi dòng, tải về dạng file', async () => {
    const { app, reportService } = makeApp();
    const res = await request(app).get('/api/reports/borrows/csv?from=2020-01-01&to=2020-01-31&groupBy=day')
      .set('Authorization', bearer(2));
    expect(res.status).toBe(200);
    expect(reportService.getReport).toHaveBeenCalledWith('borrows', { from: '2020-01-01', to: '2020-01-31', groupBy: 'day', page: 1 }, { all: true });
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(res.headers['content-disposition']).toBe('attachment; filename=bao-cao-muon-tra_2020-01-01_2020-01-31.csv');
    expect(res.text.startsWith(BOM)).toBe(true);
    expect(res.text).toContain('01/01/2020,1,0');
  });
});
