const express = require('express');
const { validateQuery } = require('../../middlewares/validate');
const { requireRole } = require('../../middlewares/auth');
const { HttpError } = require('../../lib/httpError');
const { REPORT_TYPES, reportQuerySchema } = require('./report.validation');
const { reportToCsv } = require('./report.export');

function reportType(req, res, next) {
  if (!REPORT_TYPES.includes(req.params.type)) throw new HttpError(404, 'Không tìm thấy báo cáo');
  next();
}

// 2.7.2: Librarian + Admin (edge 7: Librarian xem cả báo cáo Phạt); Reader nhận 403 (edge 8).
function createReportRouter(reportService, requireAuth) {
  const router = express.Router();
  router.use(requireAuth, requireRole('librarian', 'admin'));

  router.get('/:type', reportType, validateQuery(reportQuerySchema), async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(await reportService.getReport(req.params.type, req.query));
  });

  // Edge 6: CSV truy vấn lại ở server với đúng from/to/groupBy đang xem, lấy mọi dòng thay vì một trang.
  router.get('/:type/csv', reportType, validateQuery(reportQuerySchema), async (req, res) => {
    const report = await reportService.getReport(req.params.type, req.query, { all: true });
    const { fileName, content } = reportToCsv(report);
    res.set('Cache-Control', 'no-store');
    res.attachment(fileName);
    res.type('text/csv; charset=utf-8');
    res.send(content);
  });

  return router;
}

module.exports = { createReportRouter };
