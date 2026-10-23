const { HttpError } = require('../lib/httpError');

// Validate req.body bằng Joi; field lạ bị bỏ (vd client gửi `role` khi đăng ký).
function validateBody(schema) {
  return (req, res, next) => {
    const { value, error } = schema.validate(req.body ?? {}, {
      abortEarly: false,
      stripUnknown: true,
    });
    if (error) {
      const errors = {};
      for (const detail of error.details) {
        const field = detail.path.join('.');
        if (!errors[field]) errors[field] = detail.message;
      }
      return next(new HttpError(400, 'Dữ liệu không hợp lệ', errors));
    }
    req.body = value;
    next();
  };
}

module.exports = { validateBody };
