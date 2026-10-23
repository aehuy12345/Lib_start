import { detectImageType } from '../../src/lib/imageType';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x24, 0, 0, 0]), Buffer.from('WEBPVP8 ')]);

describe('detectImageType', () => {
  it.each([
    [JPEG, 'image/jpeg', 'jpg'],
    [PNG, 'image/png', 'png'],
    [WEBP, 'image/webp', 'webp'],
  ])('nhận diện %#', (buffer, mime, ext) => {
    expect(detectImageType(buffer)).toEqual({ mime, ext });
  });

  it.each([
    ['exe đổi đuôi', Buffer.from('MZ\x90\x00\x03\x00\x00\x00', 'latin1')],
    ['GIF', Buffer.from('GIF89a\x01\x00', 'latin1')],
    ['RIFF không phải WEBP (WAV)', Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVE')])],
    ['quá ngắn', Buffer.from([0xff, 0xd8])],
    ['rỗng', Buffer.alloc(0)],
    ['không phải Buffer', 'not-a-buffer'],
  ])('từ chối: %s', (_, input) => {
    expect(detectImageType(input)).toBeNull();
  });
});
