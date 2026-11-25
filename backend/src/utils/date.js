// 驗證 IANA 時區名稱是否合法（例如 Asia/Tokyo、America/New_York、Asia/Taipei）
export function resolveValidTimeZone(rawTz) {
  if (typeof rawTz !== 'string') return 'UTC';
  const trimmed = rawTz.trim();
  if (!trimmed || trimmed.length > 64) return 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: trimmed });
    return trimmed;
  } catch {
    return 'UTC';
  }
}

// 取得指定時區的日期字串 (YYYY-MM-DD)，精準支援全球時區與日光節約時間
export function formatDateInTimeZone(date = new Date(), timeZone = 'UTC') {
  const safeTz = resolveValidTimeZone(timeZone);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: safeTz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const y = parts.find((p) => p.type === 'year')?.value;
  const m = parts.find((p) => p.type === 'month')?.value;
  const d = parts.find((p) => p.type === 'day')?.value;
  if (y && m && d) return `${y}-${m}-${d}`;
  return date.toISOString().split('T')[0];
}

// 取得指定時區的今天日期字串 (YYYY-MM-DD)
export function getTodayDate(timeZone = 'UTC') {
  return formatDateInTimeZone(new Date(), timeZone);
}

// 取得指定時區兩年前的日期字串 (YYYY-MM-DD)，多留 1 天緩衝避免跨時區邊界誤刪
export function getTwoYearsAgoDate(timeZone = 'UTC') {
  const todayStr = getTodayDate(timeZone);
  const [y, m, d] = todayStr.split('-').map(Number);
  const cutoff = new Date(Date.UTC(y - 2, m - 1, d - 1));
  const cy = cutoff.getUTCFullYear();
  const cm = String(cutoff.getUTCMonth() + 1).padStart(2, '0');
  const cd = String(cutoff.getUTCDate()).padStart(2, '0');
  return `${cy}-${cm}-${cd}`;
}

// 檢核 YYYY-MM-DD 為真實日曆日期且落在合理範圍（2000-01-01 至今天 +2 天內，完整涵蓋 UTC-12 至 UTC+14）
export function isValidRecordedDate(dateStr) {
  if (typeof dateStr !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const [y, m, d] = dateStr.split('-').map(Number);
  const parsed = new Date(Date.UTC(y, m - 1, d));
  if (
    parsed.getUTCFullYear() !== y ||
    parsed.getUTCMonth() + 1 !== m ||
    parsed.getUTCDate() !== d
  ) {
    return false;
  }
  const minTime = Date.UTC(2000, 0, 1);
  const maxTime = Date.now() + 2 * 24 * 60 * 60 * 1000;
  return parsed.getTime() >= minTime && parsed.getTime() <= maxTime;
}

// 檢核生日 YYYY-MM-DD 為真實日曆日期且落在合理範圍（1900-01-01 至今天 +2 天內，完整涵蓋全球時區）
export function isValidBirthDate(dateStr) {
  if (typeof dateStr !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const [y, m, d] = dateStr.split('-').map(Number);
  const parsed = new Date(Date.UTC(y, m - 1, d));
  if (
    parsed.getUTCFullYear() !== y ||
    parsed.getUTCMonth() + 1 !== m ||
    parsed.getUTCDate() !== d
  ) {
    return false;
  }
  const minTime = Date.UTC(1900, 0, 1);
  const maxTime = Date.now() + 2 * 24 * 60 * 60 * 1000;
  return parsed.getTime() >= minTime && parsed.getTime() <= maxTime;
}
