// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  // So theo name thay vì instanceof: module có thể bị nạp nhiều bản (ESM/CJS trong test).
  if (err.name === 'HttpError') {
    const body = { message: err.message };
    if (err.errors) body.errors = err.errors;
    return res.status(err.status).json(body);
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ message: 'Body JSON không hợp lệ' });
  }
  console.error(err);
  res.status(500).json({ message: 'Lỗi hệ thống, vui lòng thử lại sau' });
}

module.exports = { errorHandler };
