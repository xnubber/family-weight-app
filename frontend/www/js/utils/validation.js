export const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const TEMP_ID_REGEX = /^temp-(mem|rec|th)-[0-9a-z-]+$/i;
export const FAMILY_CODE_REGEX = /^[A-Za-z0-9_-]{12,64}$/;
export const FORBIDDEN_FAMILY_CODES = new Set(['my-family-2026']);

export function isTempId(id) {
  return typeof id === 'string' && TEMP_ID_REGEX.test(id);
}

export function isValidResourceId(id) {
  return typeof id === 'string' && (UUID_REGEX.test(id) || isTempId(id));
}

export function isValidFamilyCode(code) {
  return (
    typeof code === 'string' &&
    FAMILY_CODE_REGEX.test(code) &&
    !FORBIDDEN_FAMILY_CODES.has(code)
  );
}

export function generateFamilyCode() {
  const bytes = new Uint8Array(16);
  window.crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `fam-${hex}`;
}

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

// 嚴格解析數字欄位（使用 Number() 避免 parseFloat 接受 "65abc"，且不讓 0 或 NaN 靜默轉為 null）
export function parseStrictNumber(raw, { required = false, min, max, label }) {
  const trimmed = String(raw ?? '').trim();
  if (trimmed === '') {
    if (required) return { error: `${label}不可為空` };
    return { value: null };
  }
  const num = Number(trimmed);
  if (!Number.isFinite(num)) {
    return { error: `${label}必須為有效數字` };
  }
  if (num < min || num > max) {
    return { error: `${label}須介於 ${min}–${max}` };
  }
  return { value: num };
}
