import { businessToday, toDateString } from '../../src/lib/businessDate';

describe('businessToday', () => {
  it('tính theo Asia/Ho_Chi_Minh (UTC+7), không theo UTC', () => {
    expect(businessToday(new Date('2026-10-24T16:59:59Z'))).toBe('2026-10-24');
    expect(businessToday(new Date('2026-10-24T17:00:00Z'))).toBe('2026-10-25');
  });
});

describe('toDateString', () => {
  it('lấy phần ngày của cột date; null giữ null', () => {
    expect(toDateString(new Date('2026-11-07T00:00:00Z'))).toBe('2026-11-07');
    expect(toDateString(null)).toBeNull();
  });
});
