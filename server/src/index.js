require('dotenv/config');
const { createApp } = require('./app');

if (!process.env.JWT_SECRET) {
  console.error('Thiếu JWT_SECRET trong .env');
  process.exit(1);
}

const PORT = process.env.PORT || 5000;

createApp().listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
