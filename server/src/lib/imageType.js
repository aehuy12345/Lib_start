// Nhận diện ảnh theo magic bytes, không tin đuôi file hay Content-Type client gửi
// (design/flows/README.md mục "Upload file", 2.1.3 edge 8).
const SIGNATURES = [
  { mime: 'image/jpeg', ext: 'jpg', test: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    mime: 'image/png',
    ext: 'png',
    test: (b) => b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  {
    mime: 'image/webp',
    ext: 'webp',
    test: (b) => b.length >= 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP',
  },
];

function detectImageType(buffer) {
  if (!Buffer.isBuffer(buffer)) return null;
  const match = SIGNATURES.find((sig) => sig.test(buffer));
  return match ? { mime: match.mime, ext: match.ext } : null;
}

module.exports = { detectImageType };
