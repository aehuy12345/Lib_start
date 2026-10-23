// [Giả định] 2.1.2 edge 2: tối đa 5 lần sai / 15 phút cho mỗi cặp IP + email.
// Lưu trong bộ nhớ tiến trình: đủ cho một instance; khi chạy nhiều instance cần store chung.
function createLoginLimiter({ max = 5, windowMs = 15 * 60 * 1000, now = () => Date.now() } = {}) {
  const failures = new Map();

  function current(key) {
    const entry = failures.get(key);
    if (entry && entry.resetAt <= now()) {
      failures.delete(key);
      return undefined;
    }
    return entry;
  }

  return {
    isBlocked: (key) => (current(key)?.count ?? 0) >= max,
    recordFailure(key) {
      const entry = current(key);
      if (entry) entry.count += 1;
      else failures.set(key, { count: 1, resetAt: now() + windowMs });
    },
    reset: (key) => failures.delete(key),
  };
}

module.exports = { createLoginLimiter };
