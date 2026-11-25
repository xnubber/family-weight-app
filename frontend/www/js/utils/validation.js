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

function normalizeDecimalSymbols(raw) {
  return String(raw ?? '')
    .replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/[．。，,、]/g, '.');
}

// 即時清理體重輸入（支援 type="password" 與 type="text"）：轉半形、去非數字與多餘小數點、限整數 3 位與小數 2 位
export function sanitizeWeightInputValue(raw) {
  const normalized = normalizeDecimalSymbols(raw).replace(/[^0-9.]/g, '');
  if (normalized === '') return '';

  const firstDot = normalized.indexOf('.');
  let intPart = firstDot === -1 ? normalized : normalized.slice(0, firstDot);
  let fracPart = firstDot === -1 ? '' : normalized.slice(firstDot + 1).replace(/\./g, '');

  if (firstDot === 0) {
    intPart = '0';
  } else if (intPart.length > 1) {
    intPart = intPart.replace(/^0+/, '') || '0';
  }

  intPart = intPart.slice(0, 3);
  fracPart = fracPart.slice(0, 2);

  if (firstDot !== -1) {
    return `${intPart}.${fracPart}`;
  }
  return intPart;
}

// 體重欄位送出前嚴格防呆驗證（最多小數 2 位、禁止結尾孤立小數點、範圍 0.1–500 kg）
export function parseWeightValue(raw, { required = false, min = 0.1, max = 500, label = '體重 (kg)' } = {}) {
  const trimmed = normalizeDecimalSymbols(raw).trim();
  if (trimmed === '') {
    if (required) return { error: `${label}不可為空` };
    return { value: null };
  }
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(trimmed)) {
    return { error: `${label}格式不正確，請輸入正數（最多小數兩位）` };
  }
  const num = Number(trimmed);
  if (!Number.isFinite(num)) {
    return { error: `${label}必須為有效數字` };
  }
  if (num < min || num > max) {
    return { error: `${label}須介於 ${min}–${max} kg` };
  }
  return { value: Number(num.toFixed(2)) };
}

// 異常體重／漏打小數點防呆提醒（隱私模式下絕不於提示框中洩漏實際數值）
export function checkWeightAnomaly({ member, weightKg, latestWeightKg = null, isHidden = false }) {
  const name = member?.name || '成員';
  const type = member?.type || 'human';
  const w = Number(weightKg);
  if (!Number.isFinite(w)) return null;

  const prev = latestWeightKg !== null && latestWeightKg !== undefined ? Number(latestWeightKg) : null;
  if (prev !== null && Number.isFinite(prev) && prev > 0) {
    const diff = Math.abs(w - prev);
    const pct = diff / prev;
    const isHugeJump = type === 'human'
      ? (pct >= 0.25 && diff >= 3)
      : (pct >= 0.35 && diff >= 1);
    if (isHugeJump) {
      if (isHidden) {
        return `「${name}」本次輸入的體重與上次紀錄差異較大（可能漏輸入小數點），確定要儲存嗎？`;
      }
      return `「${name}」本次輸入 ${w} kg，與上次 ${prev} kg 差異較大（可能漏輸入小數點），確定要儲存嗎？`;
    }
  }

  const outOfTypicalRange =
    (type === 'cat' && w > 25) ||
    (type === 'dog' && w > 120) ||
    (type === 'human' && (w < 10 || w > 250));

  if (outOfTypicalRange) {
    if (isHidden) {
      return `「${name}」本次輸入的體重超出常見範圍（可能漏輸入小數點），確定要儲存嗎？`;
    }
    return `「${name}」本次輸入 ${w} kg 超出常見範圍（可能漏輸入小數點），確定要儲存嗎？`;
  }

  return null;
}

// 計算 YYYY-MM-DD 加上指定年數後的日期（閏年 2/29 加 1 年自動收斂至 2/28）
export function addCalendarYears(ymd, years = 1) {
  if (typeof ymd !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return '';
  const [y, m, d] = ymd.split('-').map(Number);
  const targetYear = y + years;
  const maxDayOfMonth = new Date(Date.UTC(targetYear, m, 0)).getUTCDate();
  const clampedDay = Math.min(d, maxDayOfMonth);
  return `${targetYear}-${String(m).padStart(2, '0')}-${String(clampedDay).padStart(2, '0')}`;
}

// 驗證歷史紀錄自訂查詢區間（需為有效日期、起日 <= 迄日、迄日不可晚於今天，且區間最長不可超過一年）
export function validateHistoryDateRange(startDate, endDate, todayStr) {
  const start = String(startDate ?? '').trim();
  const end = String(endDate ?? '').trim();
  if (!start || !end) {
    return { error: '請選擇開始與結束日期' };
  }
  if (!isValidRecordedDate(start) || !isValidRecordedDate(end)) {
    return { error: '日期格式不正確或超出合理範圍' };
  }
  if (start > end) {
    return { error: '開始日期不可晚於結束日期' };
  }
  if (todayStr && end > todayStr) {
    return { error: '結束日期不可晚於今天' };
  }
  const maxEnd = addCalendarYears(start, 1);
  if (maxEnd && end > maxEnd) {
    return { error: '歷史紀錄查詢區間最多不可超過一年' };
  }
  return { startDate: start, endDate: end };
}


