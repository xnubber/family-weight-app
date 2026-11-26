import { isTempId } from './validation.js';

const CACHE_STORAGE_KEY = 'familyDataCache:v1';

function sanitizeMemberForCache(member) {
  if (!member || typeof member !== 'object') return null;
  const { privacy_pin_hash: _ignored, ...rest } = member;
  return rest;
}

function hasAnyTempRecord(appData) {
  const members = Array.isArray(appData?.members) ? appData.members : [];
  const records = Array.isArray(appData?.records) ? appData.records : [];
  const heightRecords = Array.isArray(appData?.heightRecords) ? appData.heightRecords : [];
  const history = Array.isArray(appData?.targetHistory) ? appData.targetHistory : [];
  return (
    members.some((m) => isTempId(m?.id)) ||
    records.some((r) => isTempId(r?.id) || isTempId(r?.member_id)) ||
    heightRecords.some((r) => isTempId(r?.id) || isTempId(r?.member_id)) ||
    history.some((h) => isTempId(h?.id) || isTempId(h?.member_id))
  );
}

// 讀取指定家庭同步碼的本機快取（Stale-While-Revalidate：開 APP 零延遲顯示，同時背景同步雲端）
export function loadFamilyCache(familyCode) {
  if (!familyCode) return null;
  try {
    const raw = localStorage.getItem(CACHE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.familyCode !== familyCode) return null;
    if (
      !Array.isArray(parsed.members) ||
      !Array.isArray(parsed.records) ||
      !Array.isArray(parsed.targetHistory)
    ) {
      return null;
    }
    return {
      members: parsed.members.map(sanitizeMemberForCache).filter(Boolean),
      records: parsed.records,
      heightRecords: Array.isArray(parsed.heightRecords) ? parsed.heightRecords : [],
      targetHistory: parsed.targetHistory,
      cachedAt: typeof parsed.cachedAt === 'number' ? parsed.cachedAt : null
    };
  } catch {
    return null;
  }
}

// 儲存目前家庭的已同步資料至本機（僅保留單一家庭，切換同步碼自動覆蓋／清除以保護隱私）
export function saveFamilyCache(familyCode, appData) {
  if (!familyCode || !appData) return false;
  if (hasAnyTempRecord(appData)) return false;

  try {
    const payload = {
      familyCode,
      members: (appData.members || []).map(sanitizeMemberForCache).filter(Boolean),
      records: Array.isArray(appData.records) ? appData.records : [],
      heightRecords: Array.isArray(appData.heightRecords) ? appData.heightRecords : [],
      targetHistory: Array.isArray(appData.targetHistory) ? appData.targetHistory : [],
      cachedAt: Date.now()
    };
    localStorage.setItem(CACHE_STORAGE_KEY, JSON.stringify(payload));
    return true;
  } catch {
    // 忽略本機空間不足（QuotaExceededError）等錯誤，不影響正常使用
    return false;
  }
}

export function clearFamilyCache() {
  try {
    localStorage.removeItem(CACHE_STORAGE_KEY);
  } catch {
    // 忽略儲存受限錯誤
  }
}
