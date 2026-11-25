const LOCAL_PRIVACY_STORAGE_KEY = 'memberPrivacy';
const UNLOCK_TTL_MS = 5 * 60 * 1000; // 5 分鐘後自動重新遮蔽

export const MASKED_WEIGHT = '∗∗∗';

const unlockedSessions = new Map(); // memberId -> { expiresAt, verifiedPin, timer }
let onLockChangeCallback = () => {};
let visibilityBound = false;

export function isValidPinFormat(pin) {
  return typeof pin === 'string' && /^\d{4}$/.test(pin.trim());
}

function readLocalPrivacyMap() {
  try {
    const raw = localStorage.getItem(LOCAL_PRIVACY_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeLocalPrivacyMap(map) {
  try {
    localStorage.setItem(LOCAL_PRIVACY_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // 忽略儲存空間受限錯誤
  }
}

async function hashLocalPin(memberId, pin) {
  const input = `fami-pin:${memberId}:${pin}`;
  if (globalThis.crypto?.subtle) {
    const data = new TextEncoder().encode(input);
    const digest = await globalThis.crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  // 非安全上下文（極少數測試環境）簡易雜湊備援
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `fnv-${(h >>> 0).toString(16)}`;
}

export async function saveLocalPrivacy(memberId, { hideWeight, pin, keepExistingPin = false }) {
  if (!memberId) return;
  const map = readLocalPrivacyMap();
  const key = String(memberId);

  if (!hideWeight) {
    delete map[key];
    writeLocalPrivacyMap(map);
    return;
  }

  const prev = map[key] || {};
  let pinHash = null;
  if (pin === null) {
    pinHash = null;
  } else if (isValidPinFormat(pin)) {
    pinHash = await hashLocalPin(memberId, pin.trim());
  } else if (keepExistingPin && prev.pinHash) {
    pinHash = prev.pinHash;
  }

  map[key] = {
    hideWeight: true,
    hasPin: Boolean(pinHash),
    pinHash
  };
  writeLocalPrivacyMap(map);
}

export function migrateLocalPrivacy(oldId, newId, knownPin = null) {
  if (!oldId || !newId || oldId === newId) return;
  const map = readLocalPrivacyMap();
  const prev = map[String(oldId)];
  if (prev) {
    delete map[String(oldId)];
    writeLocalPrivacyMap(map);
    if (prev.hideWeight) {
      saveLocalPrivacy(newId, {
        hideWeight: true,
        pin: isValidPinFormat(knownPin) ? knownPin : null,
        keepExistingPin: false
      });
    }
  }
  const session = unlockedSessions.get(oldId);
  if (session) {
    unlockedSessions.delete(oldId);
    unlockedSessions.set(newId, session);
  }
}

export function removeLocalPrivacy(memberId) {
  if (!memberId) return;
  lockMember(memberId, false);
  const map = readLocalPrivacyMap();
  if (Object.prototype.hasOwnProperty.call(map, String(memberId))) {
    delete map[String(memberId)];
    writeLocalPrivacyMap(map);
  }
}

export async function verifyLocalPin(memberId, pin) {
  if (!memberId || !isValidPinFormat(pin)) return false;
  const map = readLocalPrivacyMap();
  const entry = map[String(memberId)];
  if (!entry || !entry.pinHash) return false;
  const candidate = await hashLocalPin(memberId, pin.trim());
  return candidate === entry.pinHash;
}

export function resolveMemberPrivacy(member) {
  if (!member) return { hideWeight: false, hasPin: false };
  const serverHide = Boolean(member.hide_weight);
  const serverHasPin = Boolean(member.has_privacy_pin);
  if (serverHide || serverHasPin) {
    return { hideWeight: serverHide, hasPin: serverHasPin };
  }
  const local = member.id ? readLocalPrivacyMap()[String(member.id)] : null;
  if (local && local.hideWeight) {
    return { hideWeight: true, hasPin: Boolean(local.hasPin) };
  }
  return { hideWeight: false, hasPin: false };
}

export function isMemberPrivacyEnabled(member) {
  return resolveMemberPrivacy(member).hideWeight;
}

export function memberHasPrivacyPin(member) {
  return resolveMemberPrivacy(member).hasPin;
}

export function isMemberUnlocked(memberId) {
  if (!memberId) return false;
  const session = unlockedSessions.get(memberId);
  if (!session) return false;
  if (Date.now() >= session.expiresAt) {
    lockMember(memberId, false);
    return false;
  }
  return true;
}

export function getUnlockedPin(memberId) {
  if (!isMemberUnlocked(memberId)) return null;
  return unlockedSessions.get(memberId)?.verifiedPin || null;
}

export function isMemberWeightHidden(member) {
  if (!member) return false;
  return isMemberPrivacyEnabled(member) && !isMemberUnlocked(member.id);
}

export function unlockMember(memberId, verifiedPin = null) {
  if (!memberId) return;
  const prev = unlockedSessions.get(memberId);
  if (prev?.timer) clearTimeout(prev.timer);

  const timer = setTimeout(() => {
    unlockedSessions.delete(memberId);
    onLockChangeCallback();
  }, UNLOCK_TTL_MS);

  unlockedSessions.set(memberId, {
    expiresAt: Date.now() + UNLOCK_TTL_MS,
    verifiedPin: isValidPinFormat(verifiedPin) ? verifiedPin.trim() : null,
    timer
  });
  onLockChangeCallback();
}

export function lockMember(memberId, notify = true) {
  if (!memberId) return;
  const prev = unlockedSessions.get(memberId);
  if (!prev) return;
  if (prev.timer) clearTimeout(prev.timer);
  unlockedSessions.delete(memberId);
  if (notify) onLockChangeCallback();
}

export function lockAllMembers(notify = true) {
  if (unlockedSessions.size === 0) return;
  for (const session of unlockedSessions.values()) {
    if (session?.timer) clearTimeout(session.timer);
  }
  unlockedSessions.clear();
  if (notify) onLockChangeCallback();
}

export function initPrivacyLifecycle({ onLockChange } = {}) {
  onLockChangeCallback = onLockChange || (() => {});
  if (!visibilityBound && typeof document !== 'undefined') {
    visibilityBound = true;
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        lockAllMembers(true);
      }
    });
  }
}
