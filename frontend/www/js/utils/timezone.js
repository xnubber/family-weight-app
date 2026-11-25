// 全球時區工具：預設自動跟隨裝置 IANA 時區，亦支援使用者於設定頁手動指定並同步送往後端

const TIMEZONE_STORAGE_KEY = 'appTimezone';

export const COMMON_TIMEZONES = [
  { id: 'Asia/Taipei', labelKey: 'tz.asiaTaipei' },
  { id: 'Asia/Tokyo', labelKey: 'tz.asiaTokyo' },
  { id: 'Asia/Hong_Kong', labelKey: 'tz.asiaHongKong' },
  { id: 'Asia/Singapore', labelKey: 'tz.asiaSingapore' },
  { id: 'Australia/Sydney', labelKey: 'tz.australiaSydney' },
  { id: 'Pacific/Auckland', labelKey: 'tz.pacificAuckland' },
  { id: 'Europe/London', labelKey: 'tz.europeLondon' },
  { id: 'Europe/Paris', labelKey: 'tz.europeParis' },
  { id: 'America/New_York', labelKey: 'tz.americaNewYork' },
  { id: 'America/Chicago', labelKey: 'tz.americaChicago' },
  { id: 'America/Denver', labelKey: 'tz.americaDenver' },
  { id: 'America/Los_Angeles', labelKey: 'tz.americaLosAngeles' },
  { id: 'Pacific/Honolulu', labelKey: 'tz.pacificHonolulu' },
  { id: 'UTC', labelKey: 'tz.utc' }
];

export function isValidTimeZone(tz) {
  if (typeof tz !== 'string') return false;
  const trimmed = tz.trim();
  if (!trimmed || trimmed.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: trimmed });
    return true;
  } catch {
    return false;
  }
}

export function getDeviceTimeZone() {
  try {
    const resolved = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (isValidTimeZone(resolved)) return resolved;
  } catch {
    // 忽略極少數環境不支援 resolvedOptions
  }
  return 'UTC';
}

export function getTimezoneSetting() {
  try {
    const stored = (localStorage.getItem(TIMEZONE_STORAGE_KEY) || '').trim();
    if (!stored || stored === 'auto') return 'auto';
    if (isValidTimeZone(stored)) return stored;
  } catch {
    // 忽略儲存空間受限
  }
  return 'auto';
}

export function setTimezoneSetting(value) {
  const next = value === 'auto' || !isValidTimeZone(value) ? 'auto' : value.trim();
  try {
    localStorage.setItem(TIMEZONE_STORAGE_KEY, next);
  } catch {
    // 忽略儲存空間受限
  }
  return next;
}

export function getActiveTimeZone() {
  const setting = getTimezoneSetting();
  return setting === 'auto' ? getDeviceTimeZone() : setting;
}

// 取得指定日期於目標時區的 YYYY-MM-DD（支援全球 IANA 時區與日光節約時間）
export function formatDateInTimeZone(date = new Date(), timeZone = getActiveTimeZone()) {
  const safeTz = isValidTimeZone(timeZone) ? timeZone : 'UTC';
  try {
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
  } catch {
    // 後備：本機日期
  }
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function getTodayInTimeZone(timeZone = getActiveTimeZone(), now = new Date()) {
  return formatDateInTimeZone(now, timeZone);
}

export function getCurrentYearInTimeZone(timeZone = getActiveTimeZone(), now = new Date()) {
  return Number(getTodayInTimeZone(timeZone, now).slice(0, 4));
}

// 將後端回傳的 ISO 時間戳記（如 created_at）轉換為指定時區的 YYYY-MM-DD
export function isoTimestampToYmd(isoStr, timeZone = getActiveTimeZone()) {
  if (typeof isoStr !== 'string' || !isoStr.trim()) return null;
  const trimmed = isoStr.trim();
  // 若本身已是純日曆日期 YYYY-MM-DD，直接沿用避免時區二次偏移
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return trimmed.length >= 10 && /^\d{4}-\d{2}-\d{2}$/.test(trimmed.slice(0, 10))
      ? trimmed.slice(0, 10)
      : null;
  }
  return formatDateInTimeZone(parsed, timeZone);
}

// 以純日曆方式計算 YYYY-MM-DD 的星期幾（0=週日 .. 6=週六），不受裝置本機時區偏移影響
export function getWeekdayFromYmd(ymd) {
  const str = String(ymd || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) return null;
  const [y, m, d] = str.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

// 計算指定時區目前的 UTC 偏移字串（例：UTC+08:00、UTC+09:00、UTC-08:00，含 DST）
export function getTimeZoneOffsetLabel(timeZone = getActiveTimeZone(), now = new Date()) {
  const safeTz = isValidTimeZone(timeZone) ? timeZone : 'UTC';
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: safeTz,
      timeZoneName: 'shortOffset'
    }).formatToParts(now);
    const tzName = parts.find((p) => p.type === 'timeZoneName')?.value || '';
    const match = tzName.match(/^GMT([+-])(\d{1,2})(?::?(\d{2}))?$/i);
    if (match) {
      const sign = match[1];
      const hh = match[2].padStart(2, '0');
      const mm = (match[3] || '00').padStart(2, '0');
      return `UTC${sign}${hh}:${mm}`;
    }
    if (/^(GMT|UTC)$/i.test(tzName)) return 'UTC+00:00';
  } catch {
    // 某些舊環境不支援 shortOffset，改以實際偏移計算
  }
  try {
    const utcDate = new Date(now.toLocaleString('en-US', { timeZone: 'UTC' }));
    const tzDate = new Date(now.toLocaleString('en-US', { timeZone: safeTz }));
    const diffMin = Math.round((tzDate.getTime() - utcDate.getTime()) / 60000);
    const sign = diffMin >= 0 ? '+' : '-';
    const abs = Math.abs(diffMin);
    const hh = String(Math.floor(abs / 60)).padStart(2, '0');
    const mm = String(abs % 60).padStart(2, '0');
    return `UTC${sign}${hh}:${mm}`;
  } catch {
    return 'UTC+00:00';
  }
}
