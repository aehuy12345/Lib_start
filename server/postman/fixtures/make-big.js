// Tạo big.jpg (> 2 MB, header JPEG) cho request "File quá 2 MB → 413". File này không commit.
const fs = require('node:fs');
const path = require('node:path');

const header = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
fs.writeFileSync(path.join(__dirname, 'big.jpg'), Buffer.concat([header, Buffer.alloc(2 * 1024 * 1024)]));
