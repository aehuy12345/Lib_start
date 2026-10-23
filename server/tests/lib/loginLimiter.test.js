import { createLoginLimiter } from '../../src/lib/loginLimiter';

describe('loginLimiter', () => {
  it('chặn khi đủ số lần sai, mở lại sau khi hết cửa sổ thời gian', () => {
    let t = 0;
    const limiter = createLoginLimiter({ max: 2, windowMs: 1000, now: () => t });
    limiter.recordFailure('k');
    expect(limiter.isBlocked('k')).toBe(false);
    limiter.recordFailure('k');
    expect(limiter.isBlocked('k')).toBe(true);

    t = 999;
    expect(limiter.isBlocked('k')).toBe(true);
    t = 1000;
    expect(limiter.isBlocked('k')).toBe(false);
  });

  it('reset xóa bộ đếm', () => {
    const limiter = createLoginLimiter({ max: 1 });
    limiter.recordFailure('k');
    limiter.reset('k');
    expect(limiter.isBlocked('k')).toBe(false);
  });
});
