const { HttpError } = require('../lib/httpError');

function runSchema(schema, input) {
  const { value, error } = schema.validate(input ?? {}, {
    abortEarly: false,
    stripUnknown: true,
  });
  if (error) {
    const errors = {};
    for (const detail of error.details) {
      const field = detail.path.join('.');
      if (!errors[field]) errors[field] = detail.message;
    }
    throw new HttpError(400, 'Dữ liệu không hợp lệ', errors);
  }
  return value;
}

// Validate req.body bằng Joi; field lạ bị bỏ (vd client gửi `role` khi đăng ký).
function validateBody(schema) {
  return (req, res, next) => {
    try {
      req.body = runSchema(schema, req.body);
      next();
    } catch (err) {
      next(err);
    }
  };
}

// Express 5: req.query là getter chỉ đọc, nên ghi đè bằng defineProperty.
function validateQuery(schema) {
  return (req, res, next) => {
    try {
      Object.defineProperty(req, 'query', { value: runSchema(schema, req.query), writable: true });
      next();
    } catch (err) {
      next(err);
    }
  };
}

module.exports = { validateBody, validateQuery };
