import { t } from './i18n.js';
import {
  displayToKg,
  formatWeight,
  getWeightInputBounds,
  getWeightUnit,
  getWeightUnitLabel
} from './units.js';

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
  const maxTime = Date.now() + 2 * 24 * 60 * 60 * 1000;
  return parsed.getTime() >= minTime && parsed.getTime() <= maxTime;
}

// 清理年／月／日數字輸入（支援全形數字轉半形並移除非數字字元）
export function sanitizeDatePartDigits(raw, maxLen = 2) {
  return String(raw ?? '')
    .replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/\D/g, '')
    .slice(0, maxLen);
}

// 將獨立輸入的年／月／日組合並驗證為標準 YYYY-MM-DD（全空回傳 null，部分漏填回傳錯誤）
export function parseBirthDateParts(yearRaw, monthRaw, dayRaw) {
  const y = sanitizeDatePartDigits(yearRaw, 4);
  const m = sanitizeDatePartDigits(monthRaw, 2);
  const d = sanitizeDatePartDigits(dayRaw, 2);

  if (!y && !m && !d) {
    return { value: null };
  }
  if (!y || !m || !d) {
    return { error: t('val.birthDateIncomplete') };
  }
  if (y.length !== 4) {
    return { error: t('val.birthDateInvalid') };
  }

  const mm = m.padStart(2, '0');
  const dd = d.padStart(2, '0');
  const iso = `${y}-${mm}-${dd}`;
  if (!isValidBirthDate(iso)) {
    return { error: t('val.birthDateInvalid') };
  }
  return { value: iso };
}

// 嚴格解析數字欄位（使用 Number() 避免 parseFloat 接受 "65abc"，且不讓 0 或 NaN 靜默轉為 null）
export function parseStrictNumber(raw, { required = false, min, max, label }) {
  const trimmed = String(raw ?? '').trim();
  if (trimmed === '') {
    if (required) return { error: t('val.required', { label }) };
    return { value: null };
  }
  const num = Number(trimmed);
  if (!Number.isFinite(num)) {
    return { error: t('val.invalidNumber', { label }) };
  }
  if (num < min || num > max) {
    return { error: t('val.range', { label, min, max }) };
  }
  return { value: num };
}

function normalizeDecimalSymbols(raw) {
  return String(raw ?? '')
    .replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/[．。，,、]/g, '.');
}

// 即時清理體重輸入（支援 kg 3位整數 / lb 4位整數、最多小數 2 位、全形數字轉半形）
export function sanitizeWeightInputValue(raw, { unit = getWeightUnit() } = {}) {
  const { maxIntDigits } = getWeightInputBounds(unit);
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

  intPart = intPart.slice(0, maxIntDigits);
  fracPart = fracPart.slice(0, 2);

  if (firstDot !== -1) {
    return `${intPart}.${fracPart}`;
  }
  return intPart;
}

// 體重欄位送出前嚴格防呆驗證（支援 kg / lb，驗證通過後統一換算回 kg 存於 value）
export function parseWeightValue(raw, { required = false, unit = getWeightUnit(), min, max, label } = {}) {
  const bounds = getWeightInputBounds(unit);
  const unitLabel = getWeightUnitLabel(unit);
  const effMin = min ?? bounds.min;
  const effMax = max ?? bounds.max;
  const effLabel = label || t('record.weightLabel', { unit: unitLabel });

  const trimmed = normalizeDecimalSymbols(raw).trim();
  if (trimmed === '') {
    if (required) return { error: t('val.required', { label: effLabel }) };
    return { value: null, displayValue: null };
  }
  const formatRegex = new RegExp(`^\\d{1,${bounds.maxIntDigits}}(\\.\\d{1,2})?$`);
  if (!formatRegex.test(trimmed)) {
    return { error: t('val.weightFormat', { label: effLabel }) };
  }
  const num = Number(trimmed);
  if (!Number.isFinite(num)) {
    return { error: t('val.invalidNumber', { label: effLabel }) };
  }
  if (num < effMin || num > effMax) {
    return { error: t('val.weightRange', { label: effLabel, min: effMin, max: effMax, unit: unitLabel }) };
  }
  const displayValue = Number(num.toFixed(2));
  const kgValue = displayToKg(displayValue, unit);
  if (kgValue < 0.1 || kgValue > 500) {
    return { error: t('val.weightRange', { label: effLabel, min: effMin, max: effMax, unit: unitLabel }) };
  }
  return { value: kgValue, displayValue };
}

// 抱毛孩相減計算：輸入「抱著毛孩總重」與「主人單獨體重」，自動防浮點誤差相減並驗證範圍（依目前顯示單位 kg / lb）
export function computePetHoldWeight(withPetRaw, ownerRaw, { unit = getWeightUnit() } = {}) {
  const withTrimmed = normalizeDecimalSymbols(withPetRaw).trim();
  const ownerTrimmed = normalizeDecimalSymbols(ownerRaw).trim();
  if (withTrimmed === '' || ownerTrimmed === '') {
    return { status: 'incomplete' };
  }

  const bounds = getWeightInputBounds(unit);
  const unitLabel = getWeightUnitLabel(unit);
  const formatRegex = new RegExp(`^\\d{1,${bounds.maxIntDigits}}(\\.\\d{1,2})?$`);
  if (!formatRegex.test(withTrimmed) || !formatRegex.test(ownerTrimmed)) {
    return { status: 'error', error: t('record.petCalcErrInvalid') };
  }

  const withNum = Number(withTrimmed);
  const ownerNum = Number(ownerTrimmed);
  if (!Number.isFinite(withNum) || !Number.isFinite(ownerNum) || withNum <= 0 || ownerNum <= 0) {
    return { status: 'error', error: t('record.petCalcErrInvalid') };
  }
  if (withNum > bounds.max || ownerNum > bounds.max) {
    return {
      status: 'error',
      error: t('record.petCalcErrRange', { min: bounds.min, max: bounds.max, unit: unitLabel })
    };
  }
  if (withNum <= ownerNum) {
    return { status: 'error', error: t('record.petCalcErrOrder') };
  }

  // 以整數分位（×100）運算避免 72.85 - 68.5 = 4.349999999999994 浮點誤差
  const diffDisplay = Math.round((withNum - ownerNum) * 100) / 100;
  const diffKg = displayToKg(diffDisplay, unit);
  if (diffDisplay < bounds.min || diffDisplay > bounds.max || diffKg < 0.1 || diffKg > 500) {
    return {
      status: 'error',
      error: t('record.petCalcErrRange', { min: bounds.min, max: bounds.max, unit: unitLabel })
    };
  }

  const cleanInputStr = diffDisplay.toFixed(2).replace(/\.?0+$/, '');
  return {
    status: 'ok',
    withPet: withNum,
    owner: ownerNum,
    displayValue: diffDisplay,
    inputValue: cleanInputStr,
    kgValue: diffKg,
    unitLabel
  };
}

// 異常體重／漏打小數點防呆提醒（以底層 kg 判定，提示文字自動換算為目前顯示單位；隱私模式絕不洩漏數值）
export function checkWeightAnomaly({ member, weightKg, latestWeightKg = null, isHidden = false, unit = getWeightUnit() }) {
  const name = member?.name || t('memberType.human');
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
        return t('val.anomalyJumpHidden', { name });
      }
      return t('val.anomalyJump', {
        name,
        weight: formatWeight(w, { unit, trimTrailingZeros: true }),
        prev: formatWeight(prev, { unit, trimTrailingZeros: true })
      });
    }
  }

  const outOfTypicalRange =
    (type === 'cat' && w > 25) ||
    (type === 'dog' && w > 120) ||
    (type === 'human' && (w < 10 || w > 250));

  if (outOfTypicalRange) {
    if (isHidden) {
      return t('val.anomalyRangeHidden', { name });
    }
    return t('val.anomalyRange', {
      name,
      weight: formatWeight(w, { unit, trimTrailingZeros: true })
    });
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
    return { error: t('val.rangeMissing') };
  }
  if (!isValidRecordedDate(start) || !isValidRecordedDate(end)) {
    return { error: t('val.rangeInvalidDate') };
  }
  if (start > end) {
    return { error: t('val.rangeOrder') };
  }
  if (todayStr && end > todayStr) {
    return { error: t('val.rangeFuture') };
  }
  const maxEnd = addCalendarYears(start, 1);
  if (maxEnd && end > maxEnd) {
    return { error: t('val.rangeMaxYear') };
  }
  return { startDate: start, endDate: end };
}
