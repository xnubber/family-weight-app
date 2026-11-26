// 純單機離線資料儲存庫（IndexedDB 為主、localStorage 自動備援）
// 實作與後端 FamilyAPI 完全一致的資料契約，包含：
// - 成員／體重／身高／目標體重歷史完整 CRUD 與自動級聯刪除
// - Web Crypto PBKDF2-SHA256 隨機鹽值本機 4 位數 PIN 驗證＋錯誤次數冷卻鎖定
// - 完整 JSON 備份匯出／嚴格驗證匯入，以及未來付費升級 Pro 時的「本機匯入雲端」遷移封包

import { getLocalTodayDate } from '../../utils/metrics.js';
import { isValidRecordedDate } from '../../utils/validation.js';
import { isValidPinFormat } from '../../utils/privacy.js';
import { t } from '../../utils/i18n.js';

const IDB_NAME = 'kinpaws_local_v1';
const IDB_VERSION = 1;
const IDB_STORE = 'datasets';
const IDB_KEY = 'primary';
const FALLBACK_STORAGE_KEY = 'kinpawsLocalDataset:v1';

const PBKDF2_ITERATIONS = 100000;
const PIN_MAX_FAILURES = 5;
const PIN_LOCKOUT_MS = 60 * 1000;

const MEMBER_TYPES = new Set(['human', 'cat', 'dog']);
const pinFailTracker = new Map(); // memberId -> { count, lockedUntil }
let dbPromise = null;
let writeChain = Promise.resolve();

function createEmptyDataset() {
  return {
    schemaVersion: 1,
    members: [],
    records: [],
    heightRecords: [],
    targetHistory: [],
    updatedAt: new Date().toISOString()
  };
}

function generateUuid() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (globalThis.crypto && typeof globalThis.crypto.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function bytesToHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex) {
  if (typeof hex !== 'string' || hex.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(hex)) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function constantTimeEqual(a, b) {
  if (!(a instanceof Uint8Array) || !(b instanceof Uint8Array) || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

async function hashLocalPinSecure(pin) {
  const normalized = String(pin).trim();
  const salt = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(salt);
  } else {
    for (let i = 0; i < salt.length; i += 1) salt[i] = Math.floor(Math.random() * 256);
  }

  if (globalThis.crypto?.subtle) {
    const keyMaterial = await globalThis.crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(normalized),
      { name: 'PBKDF2' },
      false,
      ['deriveBits']
    );
    const derivedBits = await globalThis.crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt,
        iterations: PBKDF2_ITERATIONS,
        hash: 'SHA-256'
      },
      keyMaterial,
      256
    );
    return `pbkdf2$${PBKDF2_ITERATIONS}$${bytesToHex(salt)}$${bytesToHex(new Uint8Array(derivedBits))}`;
  }

  // 極少數非安全上下文（如無 HTTPS 的測試環境）簡易加鹽雜湊備援
  const saltHex = bytesToHex(salt);
  const input = `kp-local:${saltHex}:${normalized}`;
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `fnv$${saltHex}$${(h >>> 0).toString(16)}`;
}

async function verifyLocalPinSecure(pin, storedHash) {
  if (!isValidPinFormat(pin) || typeof storedHash !== 'string') return false;
  const normalized = pin.trim();
  const parts = storedHash.split('$');

  if (parts[0] === 'pbkdf2' && parts.length === 4 && globalThis.crypto?.subtle) {
    const iterations = Number(parts[1]);
    const salt = hexToBytes(parts[2]);
    const expected = hexToBytes(parts[3]);
    if (!Number.isInteger(iterations) || iterations < 1000 || !salt || !expected) return false;

    const keyMaterial = await globalThis.crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(normalized),
      { name: 'PBKDF2' },
      false,
      ['deriveBits']
    );
    const derivedBits = await globalThis.crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt,
        iterations,
        hash: 'SHA-256'
      },
      keyMaterial,
      expected.length * 8
    );
    return constantTimeEqual(new Uint8Array(derivedBits), expected);
  }

  if (parts[0] === 'fnv' && parts.length === 3) {
    const input = `kp-local:${parts[1]}:${normalized}`;
    let h = 2166136261;
    for (let i = 0; i < input.length; i += 1) {
      h ^= input.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(16) === parts[2];
  }

  return false;
}

function openIdb() {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(IDB_NAME, IDB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function normalizeDataset(raw) {
  if (!raw || typeof raw !== 'object') return createEmptyDataset();
  return {
    schemaVersion: 1,
    members: Array.isArray(raw.members) ? raw.members : [],
    records: Array.isArray(raw.records) ? raw.records : [],
    heightRecords: Array.isArray(raw.heightRecords) ? raw.heightRecords : [],
    targetHistory: Array.isArray(raw.targetHistory) ? raw.targetHistory : [],
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date().toISOString()
  };
}

async function readDataset() {
  const db = await openIdb();
  if (db) {
    try {
      const idbVal = await new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, 'readonly');
        const req = tx.objectStore(IDB_STORE).get(IDB_KEY);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      });
      if (idbVal) return normalizeDataset(idbVal);
    } catch {
      // 失敗時自動降級讀取 localStorage
    }
  }

  try {
    const raw = localStorage.getItem(FALLBACK_STORAGE_KEY);
    if (raw) {
      return normalizeDataset(JSON.parse(raw));
    }
  } catch {
    // 忽略解析錯誤
  }
  return createEmptyDataset();
}

async function writeDataset(dataset) {
  const next = {
    ...normalizeDataset(dataset),
    updatedAt: new Date().toISOString()
  };

  let savedToIdb = false;
  const db = await openIdb();
  if (db) {
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).put(next, IDB_KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      savedToIdb = true;
    } catch {
      savedToIdb = false;
    }
  }

  // 同步寫入一份至 localStorage 作為輕量備援（空間不足時僅忽略，不影響 IndexedDB 主庫）
  try {
    localStorage.setItem(FALLBACK_STORAGE_KEY, JSON.stringify(next));
  } catch {
    if (!savedToIdb) {
      throw new Error(t('local.storageQuotaError'));
    }
  }
  return next;
}

function withWriteLock(fn) {
  const run = writeChain.then(fn, fn);
  writeChain = run.catch(() => {});
  return run;
}

function sanitizeMemberOutput(row) {
  const { privacy_pin_hash, ...rest } = row;
  return {
    ...rest,
    hide_weight: Boolean(row.hide_weight),
    track_height: row.type === 'human' && Boolean(row.track_height),
    has_privacy_pin: Boolean(privacy_pin_hash)
  };
}

function sortMembersList(members) {
  return [...members].sort((a, b) => {
    const aOrder = Number.isInteger(a.sort_order) ? a.sort_order : Number.MAX_SAFE_INTEGER;
    const bOrder = Number.isInteger(b.sort_order) ? b.sort_order : Number.MAX_SAFE_INTEGER;
    if (aOrder !== bOrder) return aOrder - bOrder;
    return String(a.created_at || '').localeCompare(String(b.created_at || ''));
  });
}

function sortByDateAsc(list, dateField = 'recorded_at') {
  return [...list].sort((a, b) => {
    const dCmp = String(a[dateField] || '').localeCompare(String(b[dateField] || ''));
    if (dCmp !== 0) return dCmp;
    return String(a.created_at || '').localeCompare(String(b.created_at || ''));
  });
}

function normalizeNullableNumber(val) {
  if (val === null || val === undefined || val === '') return null;
  const num = Number(val);
  return Number.isFinite(num) ? num : null;
}

function syncMemberLatestHeightInDataset(dataset, memberId) {
  const member = dataset.members.find((m) => m.id === memberId);
  if (!member || member.type !== 'human') return;
  const recs = sortByDateAsc(
    dataset.heightRecords.filter((r) => r.member_id === memberId),
    'recorded_at'
  );
  if (recs.length === 0) return;
  const latestVal = Number(recs[recs.length - 1].height_cm);
  if (Number.isFinite(latestVal)) {
    member.height_cm = Number(latestVal.toFixed(1));
  }
}

function checkPinLockout(memberId) {
  const entry = pinFailTracker.get(String(memberId));
  if (!entry) return;
  if (entry.lockedUntil && Date.now() < entry.lockedUntil) {
    const remainSec = Math.max(1, Math.ceil((entry.lockedUntil - Date.now()) / 1000));
    throw new Error(t('local.pinLockedWait', { seconds: remainSec }));
  }
  if (entry.lockedUntil && Date.now() >= entry.lockedUntil) {
    pinFailTracker.delete(String(memberId));
  }
}

function recordPinFailure(memberId) {
  const key = String(memberId);
  const prev = pinFailTracker.get(key) || { count: 0, lockedUntil: 0 };
  const nextCount = prev.count + 1;
  if (nextCount >= PIN_MAX_FAILURES) {
    pinFailTracker.set(key, { count: 0, lockedUntil: Date.now() + PIN_LOCKOUT_MS });
  } else {
    pinFailTracker.set(key, { count: nextCount, lockedUntil: 0 });
  }
}

function clearPinFailure(memberId) {
  pinFailTracker.delete(String(memberId));
}

function validateBackupDataset(raw) {
  if (!raw || typeof raw !== 'object') {
    throw new Error(t('backup.invalidFile'));
  }
  if (raw.schema !== 'kinpaws-backup' || !raw.data || typeof raw.data !== 'object') {
    throw new Error(t('backup.invalidFile'));
  }

  const rawMembers = Array.isArray(raw.data.members) ? raw.data.members : null;
  const rawRecords = Array.isArray(raw.data.records) ? raw.data.records : null;
  const rawHeightRecords = Array.isArray(raw.data.heightRecords) ? raw.data.heightRecords : [];
  const rawHistory = Array.isArray(raw.data.targetHistory) ? raw.data.targetHistory : [];

  if (!rawMembers || !rawRecords) {
    throw new Error(t('backup.invalidFile'));
  }

  const nowIso = new Date().toISOString();
  const memberIdSet = new Set();
  const members = [];

  for (let i = 0; i < rawMembers.length; i += 1) {
    const m = rawMembers[i];
    if (!m || typeof m !== 'object') continue;
    const name = String(m.name ?? '').trim().slice(0, 50);
    const type = MEMBER_TYPES.has(m.type) ? m.type : null;
    if (!name || !type) continue;

    const id = typeof m.id === 'string' && m.id.trim() ? m.id.trim() : generateUuid();
    if (memberIdSet.has(id)) continue;
    memberIdSet.add(id);

    const isPet = type === 'cat' || type === 'dog';
    const heightVal = !isPet ? normalizeNullableNumber(m.height_cm) : null;
    const validHeight = heightVal !== null && heightVal >= 20 && heightVal <= 300 ? Number(heightVal.toFixed(1)) : null;
    const targetVal = normalizeNullableNumber(m.target_weight);
    const validTarget = targetVal !== null && targetVal >= 0.1 && targetVal <= 500 ? Number(targetVal.toFixed(2)) : null;
    const bcsVal = isPet ? normalizeNullableNumber(m.bcs_score) : null;
    const validBcs = bcsVal !== null && Number.isInteger(bcsVal) && bcsVal >= 1 && bcsVal <= 9 ? bcsVal : null;
    const actVal = isPet ? normalizeNullableNumber(m.pet_activity_factor) : null;
    const validAct = actVal !== null && actVal >= 0.6 && actVal <= 4 ? Number(actVal.toFixed(2)) : null;
    const birthDate = typeof m.birth_date === 'string' && isValidRecordedDate(m.birth_date) ? m.birth_date : null;
    const pinHash = typeof m.privacy_pin_hash === 'string' && (m.privacy_pin_hash.startsWith('pbkdf2$') || m.privacy_pin_hash.startsWith('fnv$'))
      ? m.privacy_pin_hash
      : null;

    members.push({
      id,
      family_code: 'local',
      name,
      type,
      avatar: typeof m.avatar === 'string' && m.avatar.trim() ? m.avatar.trim().slice(0, 40) : null,
      breed: isPet && typeof m.breed === 'string' && m.breed.trim() ? m.breed.trim().slice(0, 40) : null,
      birth_date: birthDate,
      bcs_score: validBcs,
      pet_activity_factor: validAct,
      hide_weight: Boolean(m.hide_weight),
      privacy_pin_hash: Boolean(m.hide_weight) ? pinHash : null,
      track_height: !isPet && Boolean(m.track_height),
      height_cm: validHeight,
      target_weight: validTarget,
      sort_order: Number.isInteger(m.sort_order) ? m.sort_order : i,
      created_at: typeof m.created_at === 'string' && m.created_at ? m.created_at : nowIso
    });
  }

  const records = [];
  const recIds = new Set();
  for (const r of rawRecords) {
    if (!r || typeof r !== 'object') continue;
    const memberId = String(r.member_id || '').trim();
    if (!memberIdSet.has(memberId)) continue;
    const weight = normalizeNullableNumber(r.weight_kg);
    if (weight === null || weight < 0.1 || weight > 500) continue;
    const recordedAt = typeof r.recorded_at === 'string' && isValidRecordedDate(r.recorded_at) ? r.recorded_at : null;
    if (!recordedAt) continue;
    const id = typeof r.id === 'string' && r.id.trim() && !recIds.has(r.id.trim()) ? r.id.trim() : generateUuid();
    recIds.add(id);
    records.push({
      id,
      family_code: 'local',
      member_id: memberId,
      weight_kg: Number(weight.toFixed(2)),
      recorded_at: recordedAt,
      note: String(r.note ?? '').trim().slice(0, 200),
      created_at: typeof r.created_at === 'string' && r.created_at ? r.created_at : nowIso
    });
  }

  const heightRecords = [];
  const hRecIds = new Set();
  for (const r of rawHeightRecords) {
    if (!r || typeof r !== 'object') continue;
    const memberId = String(r.member_id || '').trim();
    const owner = members.find((m) => m.id === memberId);
    if (!owner || owner.type !== 'human') continue;
    const height = normalizeNullableNumber(r.height_cm);
    if (height === null || height < 20 || height > 300) continue;
    const recordedAt = typeof r.recorded_at === 'string' && isValidRecordedDate(r.recorded_at) ? r.recorded_at : null;
    if (!recordedAt) continue;
    const id = typeof r.id === 'string' && r.id.trim() && !hRecIds.has(r.id.trim()) ? r.id.trim() : generateUuid();
    hRecIds.add(id);
    heightRecords.push({
      id,
      family_code: 'local',
      member_id: memberId,
      height_cm: Number(height.toFixed(1)),
      recorded_at: recordedAt,
      note: String(r.note ?? '').trim().slice(0, 200),
      created_at: typeof r.created_at === 'string' && r.created_at ? r.created_at : nowIso
    });
  }

  const targetHistory = [];
  const thIds = new Set();
  for (const h of rawHistory) {
    if (!h || typeof h !== 'object') continue;
    const memberId = String(h.member_id || '').trim();
    if (!memberIdSet.has(memberId)) continue;
    const effectiveDate = typeof h.effective_date === 'string' && isValidRecordedDate(h.effective_date)
      ? h.effective_date
      : null;
    if (!effectiveDate) continue;
    const target = normalizeNullableNumber(h.target_weight);
    const validTarget = target !== null && target >= 0.1 && target <= 500 ? Number(target.toFixed(2)) : null;
    const id = typeof h.id === 'string' && h.id.trim() && !thIds.has(h.id.trim()) ? h.id.trim() : generateUuid();
    thIds.add(id);
    targetHistory.push({
      id,
      member_id: memberId,
      target_weight: validTarget,
      effective_date: effectiveDate,
      created_at: typeof h.created_at === 'string' && h.created_at ? h.created_at : nowIso
    });
  }

  return {
    schemaVersion: 1,
    members: sortMembersList(members),
    records: sortByDateAsc(records, 'recorded_at'),
    heightRecords: sortByDateAsc(heightRecords, 'recorded_at'),
    targetHistory: sortByDateAsc(targetHistory, 'effective_date'),
    updatedAt: nowIso
  };
}

export const LocalRepository = {
  async getAllData() {
    const dataset = await readDataset();
    return {
      members: sortMembersList(dataset.members).map(sanitizeMemberOutput),
      records: sortByDateAsc(dataset.records, 'recorded_at'),
      heightRecords: sortByDateAsc(dataset.heightRecords, 'recorded_at'),
      targetHistory: sortByDateAsc(dataset.targetHistory, 'effective_date')
    };
  },

  async addMember(_familyCode, payload) {
    return withWriteLock(async () => {
      const dataset = await readDataset();
      const nowIso = new Date().toISOString();
      const id = generateUuid();
      const isPet = payload.type === 'cat' || payload.type === 'dog';
      const hideWeight = Boolean(payload.hide_weight);
      const pinHash = hideWeight && isValidPinFormat(payload.privacy_pin)
        ? await hashLocalPinSecure(payload.privacy_pin)
        : null;

      const member = {
        id,
        family_code: 'local',
        name: String(payload.name ?? '').trim(),
        type: payload.type,
        avatar: payload.avatar ?? null,
        breed: isPet ? (payload.breed ?? null) : null,
        birth_date: payload.birth_date ?? null,
        bcs_score: isPet ? (payload.bcs_score ?? null) : null,
        pet_activity_factor: isPet ? (payload.pet_activity_factor ?? null) : null,
        hide_weight: hideWeight,
        privacy_pin_hash: pinHash,
        track_height: !isPet && Boolean(payload.track_height),
        height_cm: isPet ? null : (payload.height_cm ?? null),
        target_weight: payload.target_weight ?? null,
        sort_order: dataset.members.length,
        created_at: nowIso
      };

      dataset.members.push(member);

      if (member.target_weight !== null && member.target_weight !== undefined) {
        dataset.targetHistory.push({
          id: generateUuid(),
          member_id: id,
          target_weight: normalizeNullableNumber(member.target_weight),
          effective_date: payload.target_effective_date || getLocalTodayDate(),
          created_at: nowIso
        });
      }

      await writeDataset(dataset);
      return sanitizeMemberOutput(member);
    });
  },

  async updateMember(_familyCode, id, payload) {
    return withWriteLock(async () => {
      const dataset = await readDataset();
      const idx = dataset.members.findIndex((m) => m.id === id);
      if (idx === -1) {
        throw new Error(t('api.notFound'));
      }

      const existing = dataset.members[idx];

      // 比照後端安全規則：修改受 PIN 保護的隱私／密碼／目標體重前驗證原 PIN
      if (existing.privacy_pin_hash) {
        const wantsDisableHide = payload.hide_weight === false && Boolean(existing.hide_weight);
        const wantsChangePin = payload.privacy_pin !== undefined;
        const prevTarget = normalizeNullableNumber(existing.target_weight);
        const nextTarget = payload.target_weight === undefined
          ? prevTarget
          : normalizeNullableNumber(payload.target_weight);
        const wantsChangeTarget = payload.target_weight !== undefined && prevTarget !== nextTarget;

        if (wantsDisableHide || wantsChangePin || wantsChangeTarget) {
          checkPinLockout(id);
          const pinOk = await verifyLocalPinSecure(payload.current_pin, existing.privacy_pin_hash);
          if (!pinOk) {
            recordPinFailure(id);
            throw new Error(t('pinModal.errIncorrect'));
          }
          clearPinFailure(id);
        }
      }

      const isPet = existing.type === 'cat' || existing.type === 'dog';
      const prevTarget = normalizeNullableNumber(existing.target_weight);
      const updated = { ...existing };

      if (payload.name !== undefined) updated.name = String(payload.name).trim();
      if (payload.avatar !== undefined) updated.avatar = payload.avatar;
      if (payload.birth_date !== undefined) updated.birth_date = payload.birth_date;
      if (isPet) {
        if (payload.breed !== undefined) updated.breed = payload.breed;
        if (payload.bcs_score !== undefined) updated.bcs_score = payload.bcs_score;
        if (payload.pet_activity_factor !== undefined) updated.pet_activity_factor = payload.pet_activity_factor;
      } else {
        if (payload.height_cm !== undefined) updated.height_cm = payload.height_cm;
        if (payload.track_height !== undefined) updated.track_height = Boolean(payload.track_height);
      }
      if (payload.target_weight !== undefined) updated.target_weight = payload.target_weight;

      if (payload.hide_weight !== undefined) {
        updated.hide_weight = Boolean(payload.hide_weight);
        if (!updated.hide_weight && payload.privacy_pin === undefined) {
          updated.privacy_pin_hash = null;
        }
      }
      if (payload.privacy_pin !== undefined) {
        const effectiveHide = payload.hide_weight !== undefined
          ? Boolean(payload.hide_weight)
          : Boolean(existing.hide_weight);
        updated.privacy_pin_hash = effectiveHide && isValidPinFormat(payload.privacy_pin)
          ? await hashLocalPinSecure(payload.privacy_pin)
          : null;
      }

      dataset.members[idx] = updated;

      if (payload.target_weight !== undefined) {
        const nextTarget = normalizeNullableNumber(updated.target_weight);
        if (prevTarget !== nextTarget) {
          dataset.targetHistory.push({
            id: generateUuid(),
            member_id: id,
            target_weight: nextTarget,
            effective_date: payload.target_effective_date || getLocalTodayDate(),
            created_at: new Date().toISOString()
          });
        }
      }

      await writeDataset(dataset);
      return sanitizeMemberOutput(updated);
    });
  },

  async deleteMember(_familyCode, id) {
    return withWriteLock(async () => {
      const dataset = await readDataset();
      const before = dataset.members.length;
      dataset.members = dataset.members.filter((m) => m.id !== id);
      if (dataset.members.length === before) {
        throw new Error(t('api.notFound'));
      }
      dataset.records = dataset.records.filter((r) => r.member_id !== id);
      dataset.heightRecords = dataset.heightRecords.filter((r) => r.member_id !== id);
      dataset.targetHistory = dataset.targetHistory.filter((h) => h.member_id !== id);
      clearPinFailure(id);
      await writeDataset(dataset);
      return null;
    });
  },

  async reorderMembers(_familyCode, memberIds) {
    return withWriteLock(async () => {
      const dataset = await readDataset();
      const rank = new Map((memberIds || []).map((id, idx) => [id, idx]));
      dataset.members = dataset.members.map((m) => ({
        ...m,
        sort_order: rank.has(m.id) ? rank.get(m.id) : m.sort_order
      }));
      await writeDataset(dataset);
      return { synced: true, count: (memberIds || []).length };
    });
  },

  async verifyMemberPin(_familyCode, id, pin) {
    checkPinLockout(id);
    const dataset = await readDataset();
    const member = dataset.members.find((m) => m.id === id);
    if (!member) {
      throw new Error(t('api.notFound'));
    }
    if (!member.privacy_pin_hash) {
      return { verified: true, has_privacy_pin: false };
    }
    const ok = await verifyLocalPinSecure(pin, member.privacy_pin_hash);
    if (!ok) {
      recordPinFailure(id);
      return { verified: false, has_privacy_pin: true };
    }
    clearPinFailure(id);
    return { verified: true, has_privacy_pin: true };
  },

  async addRecord(_familyCode, payload) {
    return withWriteLock(async () => {
      const dataset = await readDataset();
      const owner = dataset.members.find((m) => m.id === payload.member_id);
      if (!owner) {
        throw new Error(t('api.forbidden'));
      }
      const record = {
        id: generateUuid(),
        family_code: 'local',
        member_id: payload.member_id,
        weight_kg: Number(Number(payload.weight_kg).toFixed(2)),
        recorded_at: payload.recorded_at || getLocalTodayDate(),
        note: String(payload.note ?? '').trim().slice(0, 200),
        created_at: new Date().toISOString()
      };
      dataset.records.push(record);
      dataset.records = sortByDateAsc(dataset.records, 'recorded_at');
      await writeDataset(dataset);
      return record;
    });
  },

  async deleteRecord(_familyCode, id) {
    return withWriteLock(async () => {
      const dataset = await readDataset();
      const before = dataset.records.length;
      dataset.records = dataset.records.filter((r) => r.id !== id);
      if (dataset.records.length === before) {
        throw new Error(t('api.notFound'));
      }
      await writeDataset(dataset);
      return null;
    });
  },

  async addHeightRecord(_familyCode, payload) {
    return withWriteLock(async () => {
      const dataset = await readDataset();
      const owner = dataset.members.find((m) => m.id === payload.member_id);
      if (!owner) {
        throw new Error(t('api.forbidden'));
      }
      if (owner.type !== 'human') {
        throw new Error(t('api.badRequest'));
      }
      const record = {
        id: generateUuid(),
        family_code: 'local',
        member_id: payload.member_id,
        height_cm: Number(Number(payload.height_cm).toFixed(1)),
        recorded_at: payload.recorded_at || getLocalTodayDate(),
        note: String(payload.note ?? '').trim().slice(0, 200),
        created_at: new Date().toISOString()
      };
      dataset.heightRecords.push(record);
      dataset.heightRecords = sortByDateAsc(dataset.heightRecords, 'recorded_at');
      syncMemberLatestHeightInDataset(dataset, payload.member_id);
      await writeDataset(dataset);
      return record;
    });
  },

  async deleteHeightRecord(_familyCode, id) {
    return withWriteLock(async () => {
      const dataset = await readDataset();
      const target = dataset.heightRecords.find((r) => r.id === id);
      if (!target) {
        throw new Error(t('api.notFound'));
      }
      dataset.heightRecords = dataset.heightRecords.filter((r) => r.id !== id);
      syncMemberLatestHeightInDataset(dataset, target.member_id);
      await writeDataset(dataset);
      return null;
    });
  },

  // 匯出本機完整 JSON 備份檔（保留 PBKDF2 雜湊密碼，絕不含明碼）
  async exportBackupSnapshot({ appVersion = '2.16.0', edition = 'store' } = {}) {
    const dataset = await readDataset();
    return {
      schema: 'kinpaws-backup',
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      appVersion,
      sourceEdition: edition,
      data: {
        members: sortMembersList(dataset.members),
        records: sortByDateAsc(dataset.records, 'recorded_at'),
        heightRecords: sortByDateAsc(dataset.heightRecords, 'recorded_at'),
        targetHistory: sortByDateAsc(dataset.targetHistory, 'effective_date')
      }
    };
  },

  // 嚴格驗證並還原 JSON 備份檔至本機資料庫
  async importBackupSnapshot(rawObject) {
    return withWriteLock(async () => {
      const normalized = validateBackupDataset(rawObject);
      await writeDataset(normalized);
      pinFailTracker.clear();
      return {
        summary: {
          members: normalized.members.length,
          records: normalized.records.length,
          heightRecords: normalized.heightRecords.length,
          targetHistory: normalized.targetHistory.length
        },
        data: {
          members: normalized.members.map(sanitizeMemberOutput),
          records: normalized.records,
          heightRecords: normalized.heightRecords,
          targetHistory: normalized.targetHistory
        }
      };
    });
  },

  // 清除全部本機資料
  async clearAllLocalData() {
    return withWriteLock(async () => {
      const empty = createEmptyDataset();
      await writeDataset(empty);
      pinFailTracker.clear();
      return empty;
    });
  },

  // 預留未來付費升級 Pro 雲端同步時，將本機資料轉換為標準上雲遷移封包（不含本機雜湊）
  async buildCloudMigrationBundle() {
    const data = await LocalRepository.getAllData();
    return {
      schema: 'kinpaws-cloud-migration',
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      ...data
    };
  }
};
