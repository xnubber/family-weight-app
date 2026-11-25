const STORAGE_PREFIX = 'memberOrder:';

function getStorageKey(familyCode) {
  return `${STORAGE_PREFIX}${String(familyCode || '').trim()}`;
}

export function loadLocalMemberOrder(familyCode) {
  if (!familyCode || typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(getStorageKey(familyCode));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

export function saveLocalMemberOrder(familyCode, orderedIds) {
  if (!familyCode || typeof localStorage === 'undefined' || !Array.isArray(orderedIds)) return;
  try {
    localStorage.setItem(getStorageKey(familyCode), JSON.stringify(orderedIds));
  } catch {
    // 無痕模式或儲存空間不足時靜默略過
  }
}

/**
 * 套用成員顯示順序：
 * - 若雲端資料已具備 sort_order（已執行 006_member_sort_order.sql），優先採用雲端順序並回寫本機
 * - 若雲端尚未有 sort_order，則以本機儲存的拖拉順序排列，確保重開與同步後不跳回舊順序
 */
export function applyMemberOrder(members, familyCode) {
  if (!Array.isArray(members) || members.length <= 1) return members || [];

  const hasCloudSortOrder = members.some((m) => Number.isInteger(m?.sort_order));
  if (hasCloudSortOrder) {
    const sorted = [...members].sort((a, b) => {
      const aOrder = Number.isInteger(a?.sort_order) ? a.sort_order : Number.MAX_SAFE_INTEGER;
      const bOrder = Number.isInteger(b?.sort_order) ? b.sort_order : Number.MAX_SAFE_INTEGER;
      if (aOrder !== bOrder) return aOrder - bOrder;
      return String(a?.created_at || '').localeCompare(String(b?.created_at || ''));
    });
    saveLocalMemberOrder(familyCode, sorted.map((m) => m.id));
    return sorted;
  }

  const localOrder = loadLocalMemberOrder(familyCode);
  if (localOrder.length === 0) return members;

  const rankMap = new Map(localOrder.map((id, idx) => [id, idx]));
  return [...members].sort((a, b) => {
    const ra = rankMap.has(a.id) ? rankMap.get(a.id) : Number.MAX_SAFE_INTEGER;
    const rb = rankMap.has(b.id) ? rankMap.get(b.id) : Number.MAX_SAFE_INTEGER;
    if (ra !== rb) return ra - rb;
    return String(a?.created_at || '').localeCompare(String(b?.created_at || ''));
  });
}
