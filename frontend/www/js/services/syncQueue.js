import { state } from '../state.js';
import { FamilyAPI } from './api.js';
import { showToast } from '../utils/dom.js';
import { getLocalTodayDate } from '../utils/metrics.js';
import { isTempId } from '../utils/validation.js';

let tempSeq = 0;
const idMap = new Map(); // tempId -> 後端回傳之正式 UUID
const queue = [];
let isProcessing = false;
let flushWaiters = [];
let onRenderCallback = () => {};
let onPendingChangeCallback = () => {};

function createTempId(prefix) {
  tempSeq += 1;
  return `temp-${prefix}-${Date.now().toString(36)}-${tempSeq}`;
}

export function resolveId(id) {
  let current = id;
  while (idMap.has(current)) {
    current = idMap.get(current);
  }
  return current;
}

export function getPendingCount() {
  return queue.length + (isProcessing ? 1 : 0);
}

function notifyPendingChange() {
  onPendingChangeCallback(getPendingCount());
}

function sortRecordsInPlace() {
  state.appData.records.sort((a, b) => {
    const dateCmp = String(a.recorded_at || '').localeCompare(String(b.recorded_at || ''));
    if (dateCmp !== 0) return dateCmp;
    return String(a.created_at || '').localeCompare(String(b.created_at || ''));
  });
}

function normalizeTargetWeight(val) {
  if (val === null || val === undefined) return null;
  const num = Number(val);
  return Number.isFinite(num) ? num : null;
}

export function initSyncQueue({ onRender, onPendingChange }) {
  onRenderCallback = onRender || (() => {});
  onPendingChangeCallback = onPendingChange || (() => {});
}

// 等待所有背景寫入任務完成（供手動按「同步」前呼叫，避免舊 GET 覆蓋尚未送出的本地變更）
export function flushQueue() {
  if (getPendingCount() === 0) return Promise.resolve();
  return new Promise((resolve) => {
    flushWaiters.push(resolve);
  });
}

function resolveFlushWaiters() {
  if (getPendingCount() > 0) return;
  const waiters = flushWaiters;
  flushWaiters = [];
  waiters.forEach((resolve) => resolve());
}

function enqueue(task) {
  queue.push(task);
  notifyPendingChange();
  if (!isProcessing) {
    processQueue();
  }
}

async function processQueue() {
  if (isProcessing) return;
  isProcessing = true;
  notifyPendingChange();

  while (queue.length > 0) {
    const task = queue.shift();
    notifyPendingChange();
    try {
      await task.run();
    } catch (err) {
      task.rollback();
      if (state.familyCode === task.familyCode) {
        onRenderCallback();
      }
      showToast(`${task.errorPrefix}：${err.message}`, true);
    }
  }

  isProcessing = false;
  notifyPendingChange();
  resolveFlushWaiters();
}

function replaceMemberTempId(tempId, realMember) {
  idMap.set(tempId, realMember.id);
  const idx = state.appData.members.findIndex((m) => m.id === tempId);
  if (idx !== -1) {
    // 保留在等待期間使用者可能又做的本地編輯（僅補回正式 id 與伺服器預設欄位）
    state.appData.members[idx] = { ...realMember, ...state.appData.members[idx], id: realMember.id };
  }
  state.appData.records.forEach((r) => {
    if (r.member_id === tempId) r.member_id = realMember.id;
  });
  state.appData.targetHistory.forEach((h) => {
    if (h.member_id === tempId) h.member_id = realMember.id;
  });
  if (state.selectedMemberId === tempId) {
    state.selectedMemberId = realMember.id;
  }
}

// 1. 樂觀新增成員
export function optimisticAddMember(payload) {
  const targetFamilyCode = state.familyCode;
  const tempId = createTempId('mem');
  const nowIso = new Date().toISOString();
  const effectiveDate = payload.target_effective_date || getLocalTodayDate();

  const optimisticMember = {
    id: tempId,
    family_code: targetFamilyCode,
    name: payload.name,
    type: payload.type,
    height_cm: payload.height_cm ?? null,
    target_weight: payload.target_weight ?? null,
    created_at: nowIso
  };

  let tempHistoryId = null;
  state.appData.members.push(optimisticMember);
  if (!state.selectedMemberId) {
    state.selectedMemberId = tempId;
  }

  if (optimisticMember.target_weight !== null) {
    tempHistoryId = createTempId('th');
    state.appData.targetHistory.push({
      id: tempHistoryId,
      member_id: tempId,
      target_weight: optimisticMember.target_weight,
      effective_date: effectiveDate,
      created_at: nowIso
    });
  }

  onRenderCallback();

  enqueue({
    familyCode: targetFamilyCode,
    errorPrefix: '新增成員同步失敗，已還原',
    run: async () => {
      const created = await FamilyAPI.addMember(targetFamilyCode, payload);
      if (state.familyCode === targetFamilyCode) {
        replaceMemberTempId(tempId, created);
        onRenderCallback();
      } else {
        idMap.set(tempId, created.id);
      }
    },
    rollback: () => {
      if (state.familyCode !== targetFamilyCode) return;
      state.appData.members = state.appData.members.filter((m) => m.id !== tempId);
      state.appData.records = state.appData.records.filter((r) => r.member_id !== tempId);
      state.appData.targetHistory = state.appData.targetHistory.filter(
        (h) => h.member_id !== tempId && h.id !== tempHistoryId
      );
      if (state.selectedMemberId === tempId) {
        state.selectedMemberId = state.appData.members[0]?.id ?? null;
      }
    }
  });
}

// 2. 樂觀更新成員（名稱、身高、目標體重）
export function optimisticUpdateMember(rawMemberId, payload) {
  const targetFamilyCode = state.familyCode;
  const currentId = resolveId(rawMemberId);
  const member = state.appData.members.find((m) => m.id === currentId || m.id === rawMemberId);
  if (!member) return;

  const snapshot = { ...member };
  const prevTarget = normalizeTargetWeight(member.target_weight);
  const nextTarget = payload.target_weight === undefined
    ? prevTarget
    : normalizeTargetWeight(payload.target_weight);

  if (payload.name !== undefined) member.name = payload.name;
  if (payload.height_cm !== undefined) member.height_cm = payload.height_cm;
  if (payload.target_weight !== undefined) member.target_weight = payload.target_weight;

  let tempHistoryId = null;
  if (payload.target_weight !== undefined && prevTarget !== nextTarget) {
    tempHistoryId = createTempId('th');
    state.appData.targetHistory.push({
      id: tempHistoryId,
      member_id: member.id,
      target_weight: nextTarget,
      effective_date: payload.target_effective_date || getLocalTodayDate(),
      created_at: new Date().toISOString()
    });
  }

  onRenderCallback();

  enqueue({
    familyCode: targetFamilyCode,
    errorPrefix: '更新成員資料同步失敗，已還原',
    run: async () => {
      const realId = resolveId(rawMemberId);
      if (isTempId(realId)) {
        throw new Error('原成員尚未建立完成');
      }
      const updated = await FamilyAPI.updateMember(targetFamilyCode, realId, payload);
      if (state.familyCode === targetFamilyCode) {
        const idx = state.appData.members.findIndex((m) => m.id === realId);
        if (idx !== -1) {
          state.appData.members[idx] = { ...state.appData.members[idx], ...updated };
        }
        onRenderCallback();
      }
    },
    rollback: () => {
      if (state.familyCode !== targetFamilyCode) return;
      const realId = resolveId(rawMemberId);
      const idx = state.appData.members.findIndex((m) => m.id === realId || m.id === rawMemberId);
      if (idx !== -1) {
        state.appData.members[idx] = { ...snapshot, id: state.appData.members[idx].id };
      }
      if (tempHistoryId) {
        state.appData.targetHistory = state.appData.targetHistory.filter((h) => h.id !== tempHistoryId);
      }
    }
  });
}

// 3. 樂觀刪除成員
export function optimisticDeleteMember(rawMemberId) {
  const targetFamilyCode = state.familyCode;
  const currentId = resolveId(rawMemberId);
  const member = state.appData.members.find((m) => m.id === currentId || m.id === rawMemberId);
  if (!member) return;

  const removedMember = { ...member };
  const removedRecords = state.appData.records.filter(
    (r) => r.member_id === member.id || r.member_id === rawMemberId
  );
  const removedHistory = state.appData.targetHistory.filter(
    (h) => h.member_id === member.id || h.member_id === rawMemberId
  );
  const prevSelectedId = state.selectedMemberId;

  state.appData.members = state.appData.members.filter((m) => m.id !== member.id && m.id !== rawMemberId);
  state.appData.records = state.appData.records.filter((r) => r.member_id !== member.id && r.member_id !== rawMemberId);
  state.appData.targetHistory = state.appData.targetHistory.filter(
    (h) => h.member_id !== member.id && h.member_id !== rawMemberId
  );
  if (state.selectedMemberId === member.id || state.selectedMemberId === rawMemberId) {
    state.selectedMemberId = state.appData.members[0]?.id ?? null;
  }

  onRenderCallback();

  enqueue({
    familyCode: targetFamilyCode,
    errorPrefix: '刪除成員同步失敗，已還原',
    run: async () => {
      const realId = resolveId(rawMemberId);
      // 若為尚未建立成功的暫時成員，直接結束無需呼叫後端
      if (isTempId(realId)) return;
      await FamilyAPI.deleteMember(targetFamilyCode, realId);
    },
    rollback: () => {
      if (state.familyCode !== targetFamilyCode) return;
      const restoredId = resolveId(rawMemberId);
      state.appData.members.push({ ...removedMember, id: restoredId });
      state.appData.records.push(...removedRecords.map((r) => ({ ...r, member_id: restoredId })));
      state.appData.targetHistory.push(...removedHistory.map((h) => ({ ...h, member_id: restoredId })));
      sortRecordsInPlace();
      state.selectedMemberId = prevSelectedId === rawMemberId ? restoredId : prevSelectedId;
    }
  });
}

// 4. 樂觀新增體重紀錄
export function optimisticAddRecord(payload) {
  const targetFamilyCode = state.familyCode;
  const tempId = createTempId('rec');
  const resolvedMemberId = resolveId(payload.member_id);

  const optimisticRecord = {
    id: tempId,
    family_code: targetFamilyCode,
    member_id: resolvedMemberId,
    weight_kg: payload.weight_kg,
    recorded_at: payload.recorded_at,
    note: payload.note ?? '',
    created_at: new Date().toISOString()
  };

  state.appData.records.push(optimisticRecord);
  sortRecordsInPlace();
  onRenderCallback();

  enqueue({
    familyCode: targetFamilyCode,
    errorPrefix: '體重紀錄同步失敗，已還原',
    run: async () => {
      const realMemberId = resolveId(payload.member_id);
      if (isTempId(realMemberId)) {
        throw new Error('所屬成員尚未建立完成');
      }
      const created = await FamilyAPI.addRecord(targetFamilyCode, {
        ...payload,
        member_id: realMemberId
      });
      idMap.set(tempId, created.id);
      if (state.familyCode === targetFamilyCode) {
        const idx = state.appData.records.findIndex((r) => r.id === tempId);
        if (idx !== -1) {
          state.appData.records[idx] = created;
          sortRecordsInPlace();
          onRenderCallback();
        }
      }
    },
    rollback: () => {
      if (state.familyCode !== targetFamilyCode) return;
      state.appData.records = state.appData.records.filter((r) => r.id !== tempId);
    }
  });
}

// 5. 樂觀刪除單筆體重紀錄
export function optimisticDeleteRecord(rawRecordId) {
  const targetFamilyCode = state.familyCode;
  const currentId = resolveId(rawRecordId);
  const record = state.appData.records.find((r) => r.id === currentId || r.id === rawRecordId);
  if (!record) return;

  const removedRecord = { ...record };
  state.appData.records = state.appData.records.filter((r) => r.id !== record.id && r.id !== rawRecordId);
  onRenderCallback();

  enqueue({
    familyCode: targetFamilyCode,
    errorPrefix: '刪除紀錄同步失敗，已還原',
    run: async () => {
      const realId = resolveId(rawRecordId);
      if (isTempId(realId)) return;
      await FamilyAPI.deleteRecord(targetFamilyCode, realId);
    },
    rollback: () => {
      if (state.familyCode !== targetFamilyCode) return;
      const restoredId = resolveId(rawRecordId);
      state.appData.records.push({ ...removedRecord, id: restoredId });
      sortRecordsInPlace();
    }
  });
}
