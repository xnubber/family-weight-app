// 取得今天日期字串 (YYYY-MM-DD)
export function getTodayDate() {
  return new Date().toISOString().split('T')[0];
}

// 取得兩年前的日期字串 (YYYY-MM-DD)
export function getTwoYearsAgoDate() {
  const date = new Date();
  date.setFullYear(date.getFullYear() - 2);
  return date.toISOString().split('T')[0];
}

// 檢核 YYYY-MM-DD 為真實日曆日期且落在合理範圍（2000-01-01 至今天 +2 天內）
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

// 檢核生日 YYYY-MM-DD 為真實日曆日期且落在合理範圍（1900-01-01 至今天 +1 天內）
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
  const maxTime = Date.now() + 24 * 60 * 60 * 1000;
  return parsed.getTime() >= minTime && parsed.getTime() <= maxTime;
}
