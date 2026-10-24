import { normalizeIsbn, isValidIsbn } from '../../src/lib/isbn';

describe('ISBN (2.2.2)', () => {
  it('edge 1: bỏ gạch ngang và khoảng trắng', () => {
    expect(normalizeIsbn('978-1-86197 271-2')).toBe('9781861972712');
    expect(normalizeIsbn(' 0-306-40615-2 ')).toBe('0306406152');
  });

  it.each([
    '0306406152', // ISBN-10
    '080442957X', // edge 2: kết thúc bằng X
    '9780306406157', // ISBN-13
    '9781861972712',
  ])('%s hợp lệ', (isbn) => {
    expect(isValidIsbn(isbn)).toBe(true);
  });

  it.each([
    '0306406153', // sai checksum ISBN-10
    '9780306406158', // sai checksum ISBN-13
    '12345', // sai độ dài
    'X306406152', // X không ở cuối
    '978030640615X', // ISBN-13 không có X
    'abcdefghij',
  ])('%s không hợp lệ', (isbn) => {
    expect(isValidIsbn(isbn)).toBe(false);
  });

  it('chữ x thường được đổi thành X', () => {
    expect(normalizeIsbn('080442957x')).toBe('080442957X');
  });
});
