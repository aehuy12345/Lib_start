const jwt = require('jsonwebtoken');

// Ghim HS256 khi verify để token đổi alg (vd "none") bị từ chối.
function createTokenService({ secret, expiresIn = '24h' }) {
  return {
    sign: (user) => jwt.sign({ role: user.role }, secret, {
      algorithm: 'HS256',
      subject: String(user.id),
      expiresIn,
    }),
    verify: (token) => jwt.verify(token, secret, { algorithms: ['HS256'] }),
  };
}

module.exports = { createTokenService };
