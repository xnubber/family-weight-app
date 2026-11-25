// 體重單位轉換工具：資料庫與 API 一律統一存儲公斤 (kg)，顯示與輸入時依使用者偏好即時換算 kg / lb

const WEIGHT_UNIT_STORAGE_KEY = 'appWeightUnit';
export const KG_TO_LB = 2.20462262185;

export function getWeightUnit() {
  try {
    const stored = (localStorage.getItem(WEIGHT_UNIT_STORAGE_KEY) || '').trim().toLowerCase();
    if (stored === 'lb') return 'lb';
  } catch {
    // 忽略儲存空間受限
  }
  return 'kg';
}

export function setWeightUnit(unit) {
  const next = unit === 'lb' ? 'lb' : 'kg';
  try {
    localStorage.setItem(WEIGHT_UNIT_STORAGE_KEY, next);
  } catch {
    // 忽略儲存空間受限
  }
  return next;
}

export function getWeightUnitLabel(unit = getWeightUnit()) {
  return unit === 'lb' ? 'lb' : 'kg';
}

// 將底層公斤數換算為顯示單位數值
export function kgToDisplay(kg, unit = getWeightUnit(), decimals = 2) {
  const num = Number(kg);
  if (!Number.isFinite(num)) return null;
  const converted = unit === 'lb' ? num * KG_TO_LB : num;
  return Number(converted.toFixed(decimals));
}

// 將使用者於顯示單位輸入的數值換算回公斤 (kg) 存入資料庫
export function displayToKg(displayVal, unit = getWeightUnit()) {
  const num = Number(displayVal);
  if (!Number.isFinite(num)) return null;
  const kg = unit === 'lb' ? num / KG_TO_LB : num;
  return Number(kg.toFixed(2));
}

// 取得不同單位下輸入框防呆範圍（皆對應底層 0.1–500 kg）
export function getWeightInputBounds(unit = getWeightUnit()) {
  if (unit === 'lb') {
    return { min: 0.2, max: 1102, maxIntDigits: 4, unit: 'lb' };
  }
  return { min: 0.1, max: 500, maxIntDigits: 3, unit: 'kg' };
}

// 格式化數值（不含單位）
export function formatWeightNumber(kg, { unit = getWeightUnit(), decimals = 2, trimTrailingZeros = false } = {}) {
  const val = kgToDisplay(kg, unit, decimals);
  if (val === null) return '--';
  if (trimTrailingZeros) {
    return String(Number(val.toFixed(decimals)));
  }
  return val.toFixed(decimals);
}

// 格式化含單位的體重字串（例：65.20 kg / 143.74 lb）
export function formatWeight(kg, { unit = getWeightUnit(), decimals = 2, trimTrailingZeros = false } = {}) {
  const numStr = formatWeightNumber(kg, { unit, decimals, trimTrailingZeros });
  if (numStr === '--') return '--';
  return `${numStr} ${getWeightUnitLabel(unit)}`;
}

// 格式化含正負號的體重差值（例：+0.50 kg / -1.10 lb）
export function formatWeightDelta(deltaKg, { unit = getWeightUnit(), decimals = 2, withUnit = true } = {}) {
  const val = kgToDisplay(deltaKg, unit, decimals);
  if (val === null) return '--';
  const absStr = Math.abs(val).toFixed(decimals);
  const signed = val === 0 ? (0).toFixed(decimals) : `${val > 0 ? '+' : '-'}${absStr}`;
  return withUnit ? `${signed} ${getWeightUnitLabel(unit)}` : signed;
}
