const multer = require('multer');
const { HttpError } = require('../lib/httpError');

const MAX_IMAGE_BYTES = 2 * 1024 * 1024; // PRD: ảnh tối đa 2 MB
const INVALID_IMAGE = 'Chỉ nhận ảnh JPG, PNG, WebP tối đa 2 MB';

// Nhận một file ảnh (multipart) vào bộ nhớ; kiểm tra định dạng thật làm ở service theo magic bytes.
function uploadImage(field) {
  const handler = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_IMAGE_BYTES, files: 1, fields: 0 },
  }).single(field);

  return (req, res, next) => {
    handler(req, res, (err) => {
      if (!err) return next();
      if (err instanceof multer.MulterError) {
        const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
        return next(new HttpError(status, INVALID_IMAGE, { [field]: INVALID_IMAGE }));
      }
      // Body không phải multipart hợp lệ (vd thiếu boundary).
      next(new HttpError(400, INVALID_IMAGE, { [field]: INVALID_IMAGE }));
    });
  };
}

module.exports = { uploadImage, MAX_IMAGE_BYTES, INVALID_IMAGE };
