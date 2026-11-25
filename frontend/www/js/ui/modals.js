import { state } from '../state.js';
import { FamilyAPI } from '../services/api.js';
import {
  optimisticAddMember,
  optimisticUpdateMember,
  optimisticAddRecord
} from '../services/syncQueue.js';
import { createEl, openModal, closeModal, isModalOpen, playSoftFade, showToast } from '../utils/dom.js';
import { createIcon } from '../utils/icons.js';
import {
  createAvatarNode,
  getDefaultAvatarForType,
  isValidAvatarId,
  renderAvatarPicker,
  resolveMemberAvatar
} from '../utils/avatars.js';
import {
  MASKED_WEIGHT,
  getUnlockedPin,
  isMemberPrivacyEnabled,
  isMemberUnlocked,
  isMemberWeightHidden,
  isValidPinFormat,
  lockMember,
  memberHasPrivacyPin,
  unlockMember,
  verifyLocalPin
} from '../utils/privacy.js';
import {
  calculateAgeInfo,
  calculateBmi,
  calculateGoalProgress,
  calculateHealthyWeightRange,
  calculatePetCalories,
  calculateWeeklyWeightChangePct,
  getBcsMeta,
  getLocalTodayDate
} from '../utils/metrics.js';
import {
  isTempId,
  isValidBirthDate,
  isValidRecordedDate,
  isValidResourceId,
  parseStrictNumber
} from '../utils/validation.js';

const CAT_FACTORS = [
  { value: '1.2', label: '已結紮成貓 (1.2x)' },
  { value: '1.4', label: '未結紮成貓 (1.4x)' },
  { value: '0.8', label: '減重中貓咪 (0.8x)' },
  { value: '2.5', label: '幼貓成長期 (2.5x)' }
];

const DOG_FACTORS = [
  { value: '1.6', label: '已結紮成犬 (1.6x)' },
  { value: '1.8', label: '未結紮成犬 (1.8x)' },
  { value: '1.0', label: '減重中狗狗 (1.0x)' },
  { value: '2.0', label: '活潑／高活動量成犬 (2.0x)' },
  { value: '3.0', label: '幼犬成長期 (3.0x)' }
];

const VALID_MEMBER_TYPES = new Set(['human', 'cat', 'dog']);

const BCS_OPTIONS = [
  { value: '', label: '未評分（總覽顯示一週體重變化）' },
  { value: '1', label: '1 分 · 極瘦（肋骨腰椎極明顯）' },
  { value: '2', label: '2 分 · 過瘦（幾乎無脂肪覆蓋）' },
  { value: '3', label: '3 分 · 偏瘦（肋骨易見、腰身明顯凹陷）' },
  { value: '4', label: '4 分 · 適中偏瘦（輕摸可感肋骨）' },
  { value: '5', label: '5 分 · 理想體態（肋骨好摸、腰身自然）' },
  { value: '6', label: '6 分 · 略重（肋骨需稍用力才摸到）' },
  { value: '7', label: '7 分 · 過重（肋骨難摸、腰身不明顯）' },
  { value: '8', label: '8 分 · 肥胖（摸不到肋骨、腹部下垂）' },
  { value: '9', label: '9 分 · 重度肥胖（明顯脂肪堆積）' }
];

let recordModalMode = 'batch'; // 'batch' | 'single'
let hasProfileHealthCard = false;
let memberAvatarManuallyPicked = false;
let activePinRequest = null; // { member, onUnlocked }
let activeProfileContext = null; // { memberId, onNavigateToChart }
let activeProfileInlineField = null; // 'name' | 'breed' | 'birth_date' | 'height_cm' | 'bcs_score' | 'target_weight' | null
let isInlineAvatarDrawerOpen = false;

function getMemberTypeLabel(type) {
  if (type === 'cat') return '貓咪';
  if (type === 'dog') return '狗狗';
  return '家人';
}

function isPetType(type) {
  return type === 'cat' || type === 'dog';
}

function getPetFactors(type) {
  return type === 'dog' ? DOG_FACTORS : CAT_FACTORS;
}

function getDefaultPetFactorNumber(type) {
  return type === 'dog' ? 1.6 : 1.2;
}

function getSavedPetFactor(member, type) {
  const factors = getPetFactors(type);
  const defaultFactor = String(getDefaultPetFactorNumber(type).toFixed(1));
  if (member?.pet_activity_factor !== null && member?.pet_activity_factor !== undefined) {
    const cloudVal = Number(member.pet_activity_factor).toFixed(1);
    if (factors.some((f) => f.value === cloudVal)) return cloudVal;
  }
  const memberId = member?.id;
  const saved = memberId
    ? (localStorage.getItem(`petFactor:${memberId}`) ||
      (type === 'cat' ? localStorage.getItem(`catFactor:${memberId}`) : null))
    : null;
  return factors.some((f) => f.value === saved) ? saved : defaultFactor;
}

function parseOptionalBcsInput(rawValue) {
  const trimmed = String(rawValue ?? '').trim();
  if (trimmed === '') return { value: null };
  const num = Number(trimmed);
  if (!Number.isInteger(num) || num < 1 || num > 9) {
    return { error: '體態評分 BCS 須為 1–9 的整數' };
  }
  return { value: num };
}

function parseOptionalBirthDateInput(rawValue) {
  const trimmed = String(rawValue ?? '').trim();
  if (trimmed === '') return { value: null };
  if (!isValidBirthDate(trimmed)) {
    return { error: '生日格式不正確或超出合理範圍' };
  }
  return { value: trimmed };
}

// 請求解鎖受隱私保護的成員（無 PIN 直接暫時顯示；有 PIN 則彈出 4 位數驗證視窗）
export function requestMemberUnlock(member, onUnlocked = null) {
  if (!member) return;
  if (!isMemberPrivacyEnabled(member) || isMemberUnlocked(member.id)) {
    if (onUnlocked) onUnlocked();
    return;
  }

  if (!memberHasPrivacyPin(member)) {
    unlockMember(member.id, null);
    showToast('已暫時顯示真實體重');
    if (onUnlocked) onUnlocked();
    return;
  }

  activePinRequest = { member, onUnlocked };
  const titleEl = document.getElementById('pin-modal-title');
  const descEl = document.getElementById('pin-modal-desc');
  const inputEl = document.getElementById('input-pin-verify');
  const errEl = document.getElementById('pin-modal-error');
  const submitBtn = document.getElementById('btn-pin-submit');

  titleEl.textContent = `解鎖 ${member.name || '成員'} 的體重`;
  descEl.textContent = '請輸入 4 位數個人密碼，驗證後將暫時顯示 5 分鐘（離開畫面即自動隱藏）。';
  inputEl.value = '';
  errEl.textContent = '';
  errEl.classList.add('hidden');
  submitBtn.disabled = false;
  submitBtn.textContent = '解鎖檢視';

  openModal('modal-pin');
  inputEl.focus();
}

// 若個人資訊彈窗開啟期間發生自動重新上鎖，立即重繪以確保不殘留體重數字
export function refreshOpenProfileModalIfAny() {
  if (!isModalOpen('modal-profile') || !activeProfileContext) return;
  const stillExists = state.appData.members.some((m) => m.id === activeProfileContext.memberId);
  if (!stillExists) {
    closeModal('modal-profile');
    activeProfileContext = null;
    return;
  }
  openProfileModal(activeProfileContext.memberId, {
    onNavigateToChart: activeProfileContext.onNavigateToChart
  });
}

function updateSingleWeightInputMask() {
  const select = document.getElementById('rec-member');
  const weightInput = document.getElementById('rec-weight');
  if (!select || !weightInput) return;
  const member = state.appData.members.find((m) => m.id === select.value);
  const masked = isMemberWeightHidden(member);
  if (masked) {
    weightInput.type = 'password';
    weightInput.inputMode = 'decimal';
    weightInput.autocomplete = 'off';
    weightInput.placeholder = '輸入體重 (kg)（隱私遮蔽輸入）';
  } else {
    weightInput.type = 'number';
    weightInput.inputMode = 'decimal';
    weightInput.placeholder = '體重 (kg)，例：62.5 或 4.35';
  }
}

function setRecordModalMode(mode, animate = false) {
  recordModalMode = mode === 'single' ? 'single' : 'batch';
  const isBatch = recordModalMode === 'batch';

  const batchFields = document.getElementById('rec-batch-fields');
  const singleFields = document.getElementById('rec-single-fields');
  batchFields.classList.toggle('hidden', !isBatch);
  singleFields.classList.toggle('hidden', isBatch);
  if (animate) {
    playSoftFade(isBatch ? batchFields : singleFields);
  }

  const batchBtn = document.getElementById('btn-rec-mode-batch');
  const singleBtn = document.getElementById('btn-rec-mode-single');
  batchBtn.className = isBatch
    ? 'inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-linen text-sage-700 shadow-sm'
    : 'inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-ink-500';
  singleBtn.className = !isBatch
    ? 'inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-linen text-sage-700 shadow-sm'
    : 'inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-ink-500';

  document.getElementById('btn-rec-submit').textContent = isBatch ? '一次儲存' : '儲存';
  if (!isBatch) {
    updateSingleWeightInputMask();
  }
}

function renderBatchMemberRows() {
  const container = document.getElementById('batch-member-rows');
  const rows = state.appData.members.map((m) => {
    const recs = state.appData.records.filter((r) => r.member_id === m.id);
    const latest = recs[recs.length - 1];
    const isHidden = isMemberWeightHidden(m);

    const row = createEl('div', 'py-2.5 flex items-center justify-between gap-2.5');
    const leftGroup = createEl('div', 'flex items-center gap-2.5 min-w-0 flex-1');
    const labelWrap = createEl('div', 'min-w-0 flex-1');
    const subtitleText = isHidden
      ? (latest ? '已隱藏上次體重' : '隱私模式')
      : (latest ? `上次 ${latest.weight_kg} kg` : '尚未有紀錄');

    labelWrap.append(
      createEl('div', 'font-medium text-sm text-ink leading-snug break-words', String(m.name ?? '')),
      createEl('div', 'text-fluid-label text-ink-400 tabular-nums mt-0.5', subtitleText)
    );
    leftGroup.append(createAvatarNode(resolveMemberAvatar(m), 'w-8 h-8'), labelWrap);

    const inputWrap = createEl('div', 'flex items-center gap-1.5 shrink-0');
    const input = document.createElement('input');
    if (isHidden) {
      input.type = 'password';
      input.inputMode = 'decimal';
      input.autocomplete = 'off';
      input.placeholder = '隱私輸入';
    } else {
      input.type = 'number';
      input.min = '0.1';
      input.max = '500';
      input.step = '0.01';
      input.placeholder = latest ? String(latest.weight_kg) : '體重';
    }
    input.dataset.memberId = String(m.id);
    input.dataset.memberName = String(m.name ?? '');
    input.className = 'batch-weight-input w-24 border rounded-xl px-2.5 py-1.5 text-sm text-right tabular-nums';

    inputWrap.append(input, createEl('span', 'text-xs text-ink-400', 'kg'));
    row.append(leftGroup, inputWrap);
    return row;
  });

  container.replaceChildren(...rows);
}

// 開啟新增體重彈窗（預設批量模式；從個人資訊面板點入則預設單筆模式並預選該成員）
export function openRecordModal(preselectedMemberId = null, mode = 'batch') {
  if (state.appData.members.length === 0) return showToast('請先到設定頁新增成員', true);
  const today = getLocalTodayDate();

  // 準備單筆模式欄位
  const select = document.getElementById('rec-member');
  const options = state.appData.members.map((m) => {
    const opt = document.createElement('option');
    opt.value = String(m.id);
    opt.textContent = `${m.name ?? ''}（${getMemberTypeLabel(m.type)}）`;
    return opt;
  });
  select.replaceChildren(...options);

  if (preselectedMemberId && state.appData.members.some((m) => m.id === preselectedMemberId)) {
    select.value = String(preselectedMemberId);
  }

  document.getElementById('rec-weight').value = '';
  document.getElementById('rec-note').value = '';
  document.getElementById('rec-date').value = today;

  // 準備批量模式欄位
  document.getElementById('batch-date').value = today;
  renderBatchMemberRows();

  setRecordModalMode(mode);
  if (document.activeElement && typeof document.activeElement.blur === 'function') {
    document.activeElement.blur();
  }
  openModal('modal-record');
}

function setMemberModalAvatar(avatarId) {
  const input = document.getElementById('mem-avatar');
  const picker = document.getElementById('mem-avatar-picker');
  const validId = isValidAvatarId(avatarId) ? avatarId : 'human-short';
  input.value = validId;
  renderAvatarPicker(picker, validId, (picked) => {
    memberAvatarManuallyPicked = true;
    input.value = picked;
  });
}

function syncPrivacyFormUI(prefix, member) {
  const isLockedWithPin = Boolean(member && memberHasPrivacyPin(member) && !isMemberUnlocked(member.id));
  const hideEnabled = member ? isMemberPrivacyEnabled(member) : false;
  const hasPin = member ? memberHasPrivacyPin(member) : false;

  const targetWrap = document.getElementById(`${prefix}-target-wrap`);
  const lockedBox = document.getElementById(`${prefix}-privacy-locked-box`);
  const controls = document.getElementById(`${prefix}-privacy-controls`);
  const hideCheckbox = document.getElementById(`${prefix}-hide-weight`);
  const pinWrap = document.getElementById(`${prefix}-pin-wrap`);
  const pinLabel = document.getElementById(`${prefix}-pin-label`);
  const pinInput = document.getElementById(`${prefix}-pin`);
  const clearWrap = document.getElementById(`${prefix}-clear-pin-wrap`);
  const clearCheckbox = document.getElementById(`${prefix}-clear-pin`);

  if (targetWrap) targetWrap.classList.toggle('hidden', isLockedWithPin);
  lockedBox.classList.toggle('hidden', !isLockedWithPin);
  controls.classList.toggle('hidden', isLockedWithPin);

  hideCheckbox.checked = hideEnabled;
  pinInput.value = '';
  clearCheckbox.checked = false;
  pinInput.disabled = false;

  pinLabel.textContent = hasPin
    ? '變更 4 位數個人密碼（留空表示維持現有密碼）'
    : '個人 4 位數密碼（選填，建議共用同步碼時設定）';
  pinInput.placeholder = hasPin ? '輸入新 4 位數字，或留空維持不變' : '留空表示不設密碼，或輸入 4 位數字';

  pinWrap.classList.toggle('hidden', !hideEnabled);
  clearWrap.classList.toggle('hidden', !hideEnabled || !hasPin);
}

// 開啟新增／編輯成員彈窗（傳入 member 物件則進入編輯模式，支援修改名稱、頭像、品種、生日、BCS、隱私設定、身高與目標體重）
export function openMemberModal(member = null) {
  const form = document.getElementById('form-member');
  const titleEl = document.getElementById('mem-modal-title');
  const submitBtn = document.getElementById('btn-mem-submit');
  const idInput = document.getElementById('mem-id');
  const nameInput = document.getElementById('mem-name');
  const typeSelect = document.getElementById('mem-type');
  const breedWrap = document.getElementById('mem-breed-wrap');
  const breedInput = document.getElementById('mem-breed');
  const birthDateInput = document.getElementById('mem-birth-date');
  const heightWrap = document.getElementById('mem-height-wrap');
  const heightInput = document.getElementById('mem-height');
  const bcsWrap = document.getElementById('mem-bcs-wrap');
  const bcsSelect = document.getElementById('mem-bcs');
  const targetInput = document.getElementById('mem-target');

  form.reset();
  birthDateInput.max = getLocalTodayDate();

  if (member) {
    const isPet = isPetType(member.type);
    const isLockedWithPin = memberHasPrivacyPin(member) && !isMemberUnlocked(member.id);
    memberAvatarManuallyPicked = true;
    titleEl.textContent = '編輯成員';
    submitBtn.textContent = '儲存修改';
    idInput.value = member.id;
    nameInput.value = member.name || '';
    typeSelect.value = VALID_MEMBER_TYPES.has(member.type) ? member.type : 'human';
    typeSelect.disabled = true;
    breedWrap.classList.toggle('hidden', !isPet);
    breedInput.value = isPet ? (member.breed || '') : '';
    birthDateInput.value = member.birth_date ? String(member.birth_date).slice(0, 10) : '';
    heightWrap.classList.toggle('hidden', isPet);
    heightInput.value = isPet ? '' : (member.height_cm ?? '');
    bcsWrap.classList.toggle('hidden', !isPet);
    bcsSelect.value = isPet && member.bcs_score ? String(member.bcs_score) : '';
    targetInput.value = isLockedWithPin ? '' : (member.target_weight ?? '');
    setMemberModalAvatar(resolveMemberAvatar(member));
    syncPrivacyFormUI('mem', member);

    document.getElementById('btn-mem-unlock').onclick = () => {
      requestMemberUnlock(member, () => {
        targetInput.value = member.target_weight ?? '';
        syncPrivacyFormUI('mem', member);
      });
    };
  } else {
    memberAvatarManuallyPicked = false;
    titleEl.textContent = '新增成員';
    submitBtn.textContent = '新增';
    idInput.value = '';
    typeSelect.value = 'human';
    typeSelect.disabled = false;
    breedWrap.classList.add('hidden');
    breedInput.value = '';
    birthDateInput.value = '';
    heightWrap.classList.remove('hidden');
    bcsWrap.classList.add('hidden');
    bcsSelect.value = '';
    setMemberModalAvatar(getDefaultAvatarForType('human'));
    syncPrivacyFormUI('mem', null);
  }

  if (document.activeElement && typeof document.activeElement.blur === 'function') {
    document.activeElement.blur();
  }
  openModal('modal-member');
}

// 繪製個人資訊面板中的「自動健康指標卡」（家人 BMI / 區間、貓咪與狗狗 RER / DER 與 BCS 指南，隱私模式防反推）
function renderProfileHealthCard(member, latest) {
  const card = document.getElementById('prof-health-card');
  const isHuman = member.type === 'human';
  const isHidden = isMemberWeightHidden(member);

  if (isHuman) {
    const bmiRes = latest && member.height_cm ? calculateBmi(latest.weight_kg, member.height_cm) : null;
    const range = member.height_cm ? calculateHealthyWeightRange(member.height_cm) : null;

    if (!bmiRes && !range) {
      hasProfileHealthCard = false;
      card.classList.add('hidden');
      card.replaceChildren();
      return;
    }

    hasProfileHealthCard = true;
    card.className = 'rounded-2xl p-3.5 text-sm space-y-2 border bg-sage-50/75 border-sage-200';

    const header = createEl('div', 'flex flex-wrap justify-between items-center gap-1.5');
    const titleWrap = createEl('span', 'font-medium text-sage-700 text-xs inline-flex items-center gap-1.5');
    titleWrap.append(
      createIcon('leaf', 'w-3.5 h-3.5 shrink-0'),
      createEl('span', '', '衛福部成人健康指標')
    );
    header.appendChild(titleWrap);

    if (bmiRes) {
      const badgeClass = bmiRes.status === '正常範圍'
        ? 'bg-sage-100 text-sage-700 border border-sage-200'
        : bmiRes.status === '過輕'
          ? 'bg-oat-100 text-ink-700 border border-oat-200'
          : 'bg-ochre-100 text-ochre-700 border border-ochre-200';
      // 隱私模式下僅呈現衛福部狀態（如「正常範圍」），遮蔽精確 BMI 數值防止反推體重
      const badgeText = isHidden
        ? bmiRes.status
        : `BMI ${bmiRes.bmi.toFixed(1)} · ${bmiRes.status}`;
      header.appendChild(
        createEl('span', `text-xs font-medium px-2 py-0.5 rounded-full tabular-nums whitespace-nowrap ${badgeClass}`, badgeText)
      );
    }

    const children = [header];
    if (range) {
      const row = createEl('div', 'flex flex-wrap justify-between items-baseline gap-x-2 gap-y-0.5 text-xs text-ink-500');
      row.append(
        createEl('span', '', '建議健康區間（BMI 18.5–24）'),
        createEl('strong', 'text-ink font-semibold tabular-nums whitespace-nowrap', `${range.minKg}–${range.maxKg} kg`)
      );
      children.push(row);
    }

    card.replaceChildren(...children);
    return;
  }

  // 貓咪／狗狗自動每日熱量建議（RER / DER，活動係數雲端同步）＋ WSAVA BCS 體態參考
  const bcsMeta = getBcsMeta(member.bcs_score);
  if (!latest && !bcsMeta) {
    hasProfileHealthCard = false;
    card.classList.add('hidden');
    card.replaceChildren();
    return;
  }

  const isDog = member.type === 'dog';
  hasProfileHealthCard = true;
  card.className = isDog
    ? 'rounded-2xl p-3.5 text-sm space-y-2.5 border bg-ochre-50/80 border-ochre-200'
    : 'rounded-2xl p-3.5 text-sm space-y-2.5 border bg-clay-50/80 border-clay-200';

  const children = [];

  if (latest) {
    const header = createEl('div', 'flex flex-wrap justify-between items-center gap-2');
    const titleWrap = createEl(
      'span',
      `font-medium text-xs shrink-0 inline-flex items-center gap-1.5 ${isDog ? 'text-ochre-700' : 'text-clay-700'}`
    );
    titleWrap.append(
      createIcon('paw', 'w-3.5 h-3.5 shrink-0'),
      createEl('span', '', isDog ? '狗狗每日熱量建議' : '貓咪每日熱量建議')
    );
    header.appendChild(titleWrap);

    if (isHidden) {
      children.push(
        header,
        createEl('p', 'text-xs text-ink-500 leading-relaxed', '已開啟體重隱私保護，解鎖後可檢視每日熱量建議（RER / DER）。')
      );
    } else {
      const factors = getPetFactors(member.type);
      const factorSelect = document.createElement('select');
      factorSelect.className = `max-w-full border rounded-lg px-2 py-1 text-xs bg-linen text-ink-700 ${isDog ? 'border-ochre-200' : 'border-clay-200'}`;
      factors.forEach((optCfg) => {
        const opt = document.createElement('option');
        opt.value = optCfg.value;
        opt.textContent = optCfg.label;
        factorSelect.appendChild(opt);
      });
      factorSelect.value = getSavedPetFactor(member, member.type);

      const resultGrid = createEl('div', 'grid grid-cols-2 gap-2 bg-linen/90 border border-oat-200/70 rounded-xl p-2.5 text-center');
      const renderPetResult = () => {
        const res = calculatePetCalories(latest.weight_kg, factorSelect.value);
        if (!res) return;
        const colRer = createEl('div', 'min-w-0');
        colRer.append(
          createEl('div', 'text-fluid-label text-ink-400', '基礎代謝 RER'),
          createEl('div', 'text-fluid-metric font-semibold text-ink tabular-nums whitespace-nowrap mt-0.5', `${res.rer} kcal`)
        );
        const colDer = createEl('div', 'min-w-0');
        colDer.append(
          createEl('div', 'text-fluid-label text-ink-400', '每日建議 DER'),
          createEl('div', `text-fluid-metric font-semibold tabular-nums whitespace-nowrap mt-0.5 ${isDog ? 'text-ochre-700' : 'text-clay-700'}`, `${res.der} kcal`)
        );
        resultGrid.replaceChildren(colRer, colDer);
      };

      factorSelect.onchange = () => {
        const nextFactor = Number(factorSelect.value);
        localStorage.setItem(`petFactor:${member.id}`, factorSelect.value);
        renderPetResult();
        if (Number.isFinite(nextFactor)) {
          optimisticUpdateMember(member.id, { pet_activity_factor: nextFactor });
        }
      };

      header.appendChild(factorSelect);
      renderPetResult();
      children.push(header, resultGrid);
    }
  }

  if (bcsMeta) {
    const bcsBox = createEl(
      'div',
      latest ? 'pt-2 border-t border-oat-200/80 space-y-1' : 'space-y-1'
    );
    const bcsHead = createEl('div', 'flex flex-wrap items-center justify-between gap-1.5');
    bcsHead.append(
      createEl('span', `text-xs font-medium ${isDog ? 'text-ochre-700' : 'text-clay-700'}`, 'WSAVA 體態評分'),
      createEl('span', `text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${bcsMeta.badgeClass}`, bcsMeta.compact)
    );
    bcsBox.append(
      bcsHead,
      createEl('p', 'text-fluid-label text-ink-500 leading-relaxed', bcsMeta.guide)
    );
    children.push(bcsBox);
  }

  card.replaceChildren(...children);
}

function setInlineAvatarDrawer(isOpen) {
  isInlineAvatarDrawerOpen = Boolean(isOpen);
  const drawer = document.getElementById('prof-inline-avatar-drawer');
  if (!drawer) return;
  drawer.classList.toggle('hidden', !isInlineAvatarDrawerOpen);
  if (isInlineAvatarDrawerOpen) {
    playSoftFade(drawer);
  }
}

function setProfileEditMode(isEditing, animate = false) {
  const viewFields = document.getElementById('prof-view-fields');
  const editFields = document.getElementById('prof-edit-fields');
  if (isEditing) {
    activeProfileInlineField = null;
    setInlineAvatarDrawer(false);
  }
  viewFields.classList.toggle('hidden', isEditing);
  document.getElementById('prof-view-actions').classList.toggle('hidden', isEditing);
  document.getElementById('btn-prof-add-record').classList.toggle('hidden', isEditing);
  document.getElementById('prof-health-card').classList.toggle('hidden', isEditing || !hasProfileHealthCard);
  editFields.classList.toggle('hidden', !isEditing);
  document.getElementById('prof-edit-actions').classList.toggle('hidden', !isEditing);

  if (animate) {
    playSoftFade(isEditing ? editFields : viewFields);
  }

  if (document.activeElement && typeof document.activeElement.blur === 'function') {
    document.activeElement.blur();
  }
}

export function openProfileModal(memberId, { onNavigateToChart, initialInlineField = null } = {}) {
  const m = state.appData.members.find((x) => x.id === memberId);
  if (!m) return;
  activeProfileContext = { memberId, onNavigateToChart };
  activeProfileInlineField = initialInlineField || null;
  setInlineAvatarDrawer(false);

  const recs = state.appData.records.filter((r) => r.member_id === m.id);
  const latest = recs[recs.length - 1];
  const isPet = isPetType(m.type);
  const initialAvatar = resolveMemberAvatar(m);
  const isPrivacyOn = isMemberPrivacyEnabled(m);
  const isHidden = isMemberWeightHidden(m);
  const hasPin = memberHasPrivacyPin(m);
  const isLockedWithPin = hasPin && !isMemberUnlocked(m.id);
  const ageInfo = calculateAgeInfo(m.birth_date, m.type);
  const bcsMeta = isPet ? getBcsMeta(m.bcs_score) : null;
  const weeklyPct = isPet ? calculateWeeklyWeightChangePct(recs) : null;

  const renderProfileAvatarPreview = (avatarId) => {
    const slot = document.getElementById('prof-avatar-slot');
    if (slot) {
      const editDot = createEl(
        'span',
        'absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-linen border border-oat-200 text-ink-500 flex items-center justify-center shadow-sm'
      );
      editDot.appendChild(createIcon('edit', 'w-2.5 h-2.5'));
      slot.replaceChildren(createAvatarNode(avatarId, 'w-11 h-11'), editDot);
    }
  };

  const renderInlineAvatarPicker = () => {
    const picker = document.getElementById('prof-inline-avatar-picker');
    if (!picker) return;
    renderAvatarPicker(picker, resolveMemberAvatar(m), (picked) => {
      if (picked === resolveMemberAvatar(m)) {
        setInlineAvatarDrawer(false);
        return;
      }
      optimisticUpdateMember(m.id, { avatar: picked });
      showToast('頭像已更新');
      openProfileModal(m.id, { onNavigateToChart });
    });
  };

  const avatarSlotBtn = document.getElementById('prof-avatar-slot');
  if (avatarSlotBtn) {
    avatarSlotBtn.onclick = () => {
      // 完整編輯模式已有內嵌頭像選擇器，檢視模式才切換快捷頭像抽屜
      if (!document.getElementById('prof-edit-fields').classList.contains('hidden')) return;
      if (!isInlineAvatarDrawerOpen) {
        activeProfileInlineField = null;
        renderProfileViewFields();
        renderInlineAvatarPicker();
      }
      setInlineAvatarDrawer(!isInlineAvatarDrawerOpen);
    };
  }
  const closeAvatarDrawerBtn = document.getElementById('btn-prof-close-avatar-drawer');
  if (closeAvatarDrawerBtn) {
    closeAvatarDrawerBtn.onclick = () => setInlineAvatarDrawer(false);
  }

  const fillEditInputs = () => {
    document.getElementById('prof-name').value = m.name || '';
    document.getElementById('prof-breed').value = isPet ? (m.breed || '') : '';
    const profBirthEl = document.getElementById('prof-birth-date');
    profBirthEl.max = getLocalTodayDate();
    profBirthEl.value = m.birth_date ? String(m.birth_date).slice(0, 10) : '';
    document.getElementById('prof-height').value = isPet ? '' : (m.height_cm ?? '');
    document.getElementById('prof-bcs').value = isPet && m.bcs_score ? String(m.bcs_score) : '';
    document.getElementById('prof-target').value = isLockedWithPin ? '' : (m.target_weight ?? '');
    document.getElementById('prof-avatar').value = initialAvatar;
    renderProfileAvatarPreview(initialAvatar);
    renderAvatarPicker(document.getElementById('prof-avatar-picker'), initialAvatar, (picked) => {
      document.getElementById('prof-avatar').value = picked;
      renderProfileAvatarPreview(picked);
    });
    syncPrivacyFormUI('prof', m);
  };

  // 原地單欄快速編輯：渲染檢視列表與展開中的單一輸入列
  function renderProfileViewFields() {
    const container = document.getElementById('prof-view-fields');
    if (!container) return;

    const fieldDefs = [
      {
        key: 'name',
        label: '成員名稱',
        value: m.name || '--',
        editable: true,
        valueClass: 'font-medium text-ink text-right break-words min-w-0'
      },
      {
        key: 'type',
        label: '成員類型',
        value: getMemberTypeLabel(m.type),
        editable: false,
        valueClass: 'font-medium text-ink-500 text-right break-words min-w-0'
      }
    ];

    if (isPet) {
      fieldDefs.push({
        key: 'breed',
        label: '品種',
        value: m.breed ? String(m.breed).trim() : '未設定',
        isEmpty: !m.breed,
        editable: true,
        valueClass: 'font-medium text-right break-words min-w-0'
      });
    }

    fieldDefs.push({
      key: 'birth_date',
      label: '生日與年齡',
      value: ageInfo ? ageInfo.displayText : '未設定',
      isEmpty: !ageInfo,
      editable: true,
      valueClass: 'font-medium text-right break-words min-w-0'
    });

    if (!isPet) {
      fieldDefs.push({
        key: 'height_cm',
        label: '身高',
        value: m.height_cm ? `${m.height_cm} cm` : '未設定',
        isEmpty: !m.height_cm,
        editable: true,
        valueClass: 'font-medium text-right tabular-nums whitespace-nowrap'
      });
    }

    if (isPet) {
      fieldDefs.push({
        key: 'bcs_score',
        label: '體態評分 BCS',
        value: bcsMeta ? bcsMeta.compact : '未評分',
        isEmpty: !bcsMeta,
        editable: true,
        valueClass: `font-medium text-right whitespace-nowrap ${bcsMeta ? bcsMeta.colorClass : ''}`
      });
    }

    fieldDefs.push(
      {
        key: 'target_weight',
        label: '目標體重',
        value: isHidden
          ? (m.target_weight ? '已隱藏' : '未設定')
          : (m.target_weight ? `${m.target_weight} kg` : '未設定'),
        isEmpty: !m.target_weight,
        editable: true,
        valueClass: 'font-medium text-right tabular-nums whitespace-nowrap'
      },
      {
        key: 'privacy',
        label: '體重隱私',
        value: !isPrivacyOn
          ? '公開顯示'
          : (hasPin ? '已隱藏（密碼保護）' : '已隱藏（點擊可檢視）'),
        editable: true,
        valueClass: 'font-medium text-ink text-right break-words min-w-0'
      }
    );

    const startInlineEdit = (fieldKey) => {
      setInlineAvatarDrawer(false);
      if (fieldKey === 'privacy') {
        setProfileEditMode(true, true);
        const privTarget = document.getElementById(
          isLockedWithPin ? 'prof-privacy-locked-box' : 'prof-privacy-controls'
        );
        privTarget?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
        return;
      }
      if (fieldKey === 'target_weight' && isHidden) {
        requestMemberUnlock(m, () =>
          openProfileModal(m.id, { onNavigateToChart, initialInlineField: 'target_weight' })
        );
        return;
      }
      activeProfileInlineField = fieldKey;
      renderProfileViewFields();
    };

    const commitInlineField = (fieldKey, rawVal) => {
      let payload = null;
      let toastMsg = '資料已更新';

      if (fieldKey === 'name') {
        const nextName = String(rawVal ?? '').trim();
        if (!nextName || nextName.length > 50) {
          showToast('名稱須為 1–50 字元', true);
          return false;
        }
        payload = { name: nextName };
        toastMsg = '成員名稱已更新';
      } else if (fieldKey === 'breed') {
        const nextBreed = String(rawVal ?? '').trim();
        if (nextBreed.length > 40) {
          showToast('品種不可超過 40 字元', true);
          return false;
        }
        payload = { breed: nextBreed || null };
        toastMsg = '品種已更新';
      } else if (fieldKey === 'birth_date') {
        const parsed = parseOptionalBirthDateInput(rawVal);
        if (parsed.error) {
          showToast(parsed.error, true);
          return false;
        }
        payload = { birth_date: parsed.value };
        toastMsg = parsed.value ? '生日已更新' : '已清除生日';
      } else if (fieldKey === 'height_cm') {
        const parsed = parseStrictNumber(rawVal, {
          required: false,
          min: 20,
          max: 300,
          label: '身高 (cm)'
        });
        if (parsed.error) {
          showToast(parsed.error, true);
          return false;
        }
        payload = { height_cm: parsed.value };
        toastMsg = '身高已更新';
      } else if (fieldKey === 'bcs_score') {
        const parsed = parseOptionalBcsInput(rawVal);
        if (parsed.error) {
          showToast(parsed.error, true);
          return false;
        }
        payload = { bcs_score: parsed.value };
        toastMsg = parsed.value ? '體態評分已更新' : '已清除體態評分';
      } else if (fieldKey === 'target_weight') {
        const parsed = parseStrictNumber(rawVal, {
          required: false,
          min: 0.1,
          max: 500,
          label: '目標體重 (kg)'
        });
        if (parsed.error) {
          showToast(parsed.error, true);
          return false;
        }
        payload = {
          target_weight: parsed.value,
          target_effective_date: getLocalTodayDate()
        };
        if (hasPin) {
          const currentPin = getUnlockedPin(m.id);
          if (currentPin) payload.current_pin = currentPin;
        }
        toastMsg = parsed.value !== null ? '目標體重已更新' : '已清除目標體重';
      }

      if (!payload) return false;
      activeProfileInlineField = null;
      optimisticUpdateMember(m.id, payload);
      showToast(toastMsg);
      openProfileModal(m.id, { onNavigateToChart });
      return true;
    };

    const nodes = fieldDefs.map((field) => {
      // 展開中的原地編輯列
      if (field.editable && activeProfileInlineField === field.key) {
        const editRow = createEl('div', 'px-2 py-3 space-y-2');
        const labelRow = createEl('div', 'flex items-center justify-between gap-2');
        labelRow.appendChild(createEl('span', 'text-xs font-medium text-sage-700', field.label));

        let controlEl;
        if (field.key === 'bcs_score') {
          controlEl = document.createElement('select');
          controlEl.className = 'w-full border border-sage-500/50 rounded-xl px-2.5 py-2 text-sm bg-linen text-ink';
          BCS_OPTIONS.forEach((optCfg) => {
            const opt = document.createElement('option');
            opt.value = optCfg.value;
            opt.textContent = optCfg.label;
            controlEl.appendChild(opt);
          });
          controlEl.value = m.bcs_score ? String(m.bcs_score) : '';
        } else {
          controlEl = document.createElement('input');
          controlEl.className = 'w-full border border-sage-500/50 rounded-xl px-2.5 py-2 text-sm bg-linen text-ink';
          if (field.key === 'name') {
            controlEl.type = 'text';
            controlEl.maxLength = 50;
            controlEl.placeholder = '輸入成員名稱';
            controlEl.value = m.name || '';
          } else if (field.key === 'breed') {
            controlEl.type = 'text';
            controlEl.maxLength = 40;
            controlEl.placeholder = '例：橘貓、米克斯、柴犬、貴賓';
            controlEl.value = m.breed || '';
          } else if (field.key === 'birth_date') {
            controlEl.type = 'date';
            controlEl.min = '1900-01-01';
            controlEl.max = getLocalTodayDate();
            controlEl.value = m.birth_date ? String(m.birth_date).slice(0, 10) : '';
          } else if (field.key === 'height_cm') {
            controlEl.type = 'number';
            controlEl.min = '20';
            controlEl.max = '300';
            controlEl.step = '0.1';
            controlEl.placeholder = '例：172.5（留空可清除）';
            controlEl.value = m.height_cm ?? '';
          } else if (field.key === 'target_weight') {
            controlEl.type = 'number';
            controlEl.min = '0.1';
            controlEl.max = '500';
            controlEl.step = '0.01';
            controlEl.placeholder = '例：65.0（留空可清除）';
            controlEl.value = m.target_weight ?? '';
          }
        }

        controlEl.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            commitInlineField(field.key, controlEl.value);
          } else if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            activeProfileInlineField = null;
            renderProfileViewFields();
          }
        });

        const btnRow = createEl('div', 'flex items-center justify-end gap-1.5');
        if (field.key === 'birth_date' && m.birth_date) {
          const clearBtn = createEl(
            'button',
            'mr-auto text-xs text-rosewood-600 hover:bg-rosewood-50 px-2.5 py-1.5 rounded-xl font-medium',
            '清除'
          );
          clearBtn.type = 'button';
          clearBtn.onclick = () => commitInlineField('birth_date', '');
          btnRow.appendChild(clearBtn);
        }

        const cancelBtn = createEl(
          'button',
          'text-xs bg-oat-100 text-ink-700 px-3 py-1.5 rounded-xl font-medium',
          '取消'
        );
        cancelBtn.type = 'button';
        cancelBtn.onclick = () => {
          activeProfileInlineField = null;
          renderProfileViewFields();
        };

        const saveBtn = createEl(
          'button',
          'text-xs bg-sage-600 text-linen px-3.5 py-1.5 rounded-xl font-medium',
          '儲存'
        );
        saveBtn.type = 'button';
        saveBtn.onclick = () => commitInlineField(field.key, controlEl.value);

        btnRow.append(cancelBtn, saveBtn);
        editRow.append(labelRow, controlEl, btnRow);

        // 使用者主動點擊欄位後才聚焦輸入框（日期與下拉選單則由使用者點選展開）
        if (field.key !== 'birth_date' && field.key !== 'bcs_score') {
          queueMicrotask(() => {
            if (typeof controlEl.focus === 'function') {
              controlEl.focus();
            }
          });
        }
        return editRow;
      }

      // 唯讀列（例如成員類型）
      if (!field.editable) {
        const staticRow = createEl('div', 'px-2 py-2.5 flex justify-between items-baseline gap-3');
        staticRow.append(
          createEl('span', 'text-ink-500 shrink-0 whitespace-nowrap', field.label),
          createEl('span', field.valueClass, field.value)
        );
        return staticRow;
      }

      // 可直接點擊編輯的檢視列
      const rowBtn = createEl(
        'button',
        'w-full text-left px-2 py-2.5 flex justify-between items-center gap-3 cursor-pointer hover:bg-oat-100/70 active:bg-oat-100 rounded-xl transition-colors'
      );
      rowBtn.type = 'button';
      rowBtn.dataset.inlineField = field.key;
      rowBtn.setAttribute('aria-label', `編輯${field.label}`);

      const rightWrap = createEl('span', 'flex items-center justify-end gap-1.5 min-w-0');
      const valColor = field.isEmpty
        ? 'text-ink-400'
        : field.valueClass.includes('text-')
          ? ''
          : 'text-ink';
      rightWrap.append(
        createEl('span', `${field.valueClass} ${valColor}`.trim(), field.value),
        createIcon('chevronRight', 'w-3.5 h-3.5 shrink-0 text-ink-400/70')
      );

      rowBtn.append(
        createEl('span', 'text-ink-500 shrink-0 whitespace-nowrap', field.label),
        rightWrap
      );
      rowBtn.onclick = () => startInlineEdit(field.key);
      return rowBtn;
    });

    container.replaceChildren(...nodes);
  }

  document.getElementById('prof-id').value = m.id;
  document.getElementById('prof-title').textContent = m.name || '個人資訊';

  const subtitleParts = [getMemberTypeLabel(m.type)];
  if (isPet && m.breed) subtitleParts.push(String(m.breed).trim());
  if (isPet && ageInfo?.lifeStage) {
    subtitleParts.push(ageInfo.lifeStage);
  } else if (!isPet && ageInfo?.shortText) {
    subtitleParts.push(ageInfo.shortText);
  }
  document.getElementById('prof-subtitle').textContent =
    subtitleParts.length > 1 ? subtitleParts.join(' · ') : `${subtitleParts[0]}檔案`;

  // 頂部快速解鎖／隱藏按鈕
  const toggleBtn = document.getElementById('btn-prof-privacy-toggle');
  if (isPrivacyOn) {
    toggleBtn.classList.remove('hidden');
    toggleBtn.replaceChildren(
      createIcon(isHidden ? (hasPin ? 'lock' : 'eye') : 'eyeOff', 'w-3.5 h-3.5 shrink-0'),
      createEl('span', '', isHidden ? '檢視' : '隱藏')
    );
    toggleBtn.onclick = () => {
      if (isHidden) {
        requestMemberUnlock(m, () => openProfileModal(m.id, { onNavigateToChart }));
      } else {
        lockMember(m.id);
        showToast('已重新隱藏真實體重');
        openProfileModal(m.id, { onNavigateToChart });
      }
    };
  } else {
    toggleBtn.classList.add('hidden');
    toggleBtn.replaceChildren();
  }

  // 渲染可點擊原地修改的檢視欄位
  renderProfileViewFields();

  // 自動健康指標卡
  renderProfileHealthCard(m, latest);

  // 編輯模式欄位初始值
  document.getElementById('prof-breed-wrap').classList.toggle('hidden', !isPet);
  document.getElementById('prof-height-wrap').classList.toggle('hidden', isPet);
  document.getElementById('prof-bcs-wrap').classList.toggle('hidden', !isPet);
  fillEditInputs();
  setProfileEditMode(false);

  document.getElementById('btn-prof-unlock-edit').onclick = () => {
    requestMemberUnlock(m, () => {
      document.getElementById('prof-target').value = m.target_weight ?? '';
      syncPrivacyFormUI('prof', m);
    });
  };

  let metricLabel = '目標差距';
  let metricVal = '--';
  let metricColor = 'text-sage-700';
  const bmiRes = !isPet && latest && m.height_cm ? calculateBmi(latest.weight_kg, m.height_cm) : null;
  const goalProgress = calculateGoalProgress(recs, m.target_weight);
  if (isPet) {
    if (bcsMeta) {
      metricLabel = '體態 BCS';
      metricVal = bcsMeta.compact;
      metricColor = bcsMeta.colorClass;
    } else if (weeklyPct) {
      metricLabel = '一週變化';
      metricVal = weeklyPct.signedText;
      metricColor = weeklyPct.isAlert
        ? 'text-rosewood-600'
        : weeklyPct.pct > 0
          ? 'text-ochre-600'
          : weeklyPct.pct < 0
            ? 'text-sage-700'
            : 'text-ink-700';
    } else if (isHidden) {
      metricLabel = '目標進度';
      metricVal = goalProgress ? (goalProgress.isAchieved ? '已達標' : `${goalProgress.percent}%`) : '--';
    } else if (latest && m.target_weight) {
      const gapNum = Number((Number(latest.weight_kg) - Number(m.target_weight)).toFixed(2));
      metricVal = `${gapNum > 0 ? '+' : ''}${gapNum.toFixed(2)} kg`;
    }
  } else if (isHidden) {
    if (bmiRes) {
      metricLabel = '體位狀態';
      metricVal = bmiRes.status;
    } else if (goalProgress) {
      metricLabel = '目標進度';
      metricVal = goalProgress.isAchieved ? '已達標' : `${goalProgress.percent}%`;
    } else {
      metricLabel = '目標進度';
      metricVal = '--';
    }
  } else if (bmiRes) {
    metricLabel = '目前 BMI';
    metricVal = bmiRes.bmi.toFixed(1);
  } else if (latest && m.target_weight) {
    const gapNum = Number((Number(latest.weight_kg) - Number(m.target_weight)).toFixed(2));
    metricVal = `${gapNum > 0 ? '+' : ''}${gapNum.toFixed(2)} kg`;
  }

  const summary = document.getElementById('prof-summary');
  const col1 = createEl('div');
  col1.append(
    createEl('div', 'text-xs text-ink-400', '最新體重'),
    createEl(
      'div',
      `font-semibold text-base tabular-nums mt-0.5 ${isHidden ? 'text-ink-400' : 'text-ink'}`,
      latest ? (isHidden ? `${MASKED_WEIGHT} kg` : `${latest.weight_kg} kg`) : '--'
    )
  );
  const col2 = createEl('div');
  col2.append(
    createEl('div', 'text-xs text-ink-400', metricLabel),
    createEl('div', `font-semibold text-base tabular-nums mt-0.5 ${metricColor}`, metricVal)
  );
  summary.replaceChildren(col1, col2);

  document.getElementById('btn-prof-to-chart').onclick = () => {
    state.selectedMemberId = m.id;
    state.historyPage = 1;
    closeModal('modal-profile');
    activeProfileContext = null;
    onNavigateToChart();
  };

  // 從個人資訊面板直接為該成員開啟「單筆紀錄」模式（可填寫備註）
  document.getElementById('btn-prof-add-record').onclick = () => {
    closeModal('modal-profile');
    activeProfileContext = null;
    openRecordModal(m.id, 'single');
  };

  // 切換至編輯模式／取消編輯還原原值
  document.getElementById('btn-prof-edit').onclick = () => setProfileEditMode(true, true);
  document.getElementById('btn-prof-cancel-edit').onclick = () => {
    fillEditInputs();
    setProfileEditMode(false, true);
  };

  openModal('modal-profile');
}

function bindPrivacyControlEvents(prefix) {
  const hideCheckbox = document.getElementById(`${prefix}-hide-weight`);
  const pinWrap = document.getElementById(`${prefix}-pin-wrap`);
  const pinInput = document.getElementById(`${prefix}-pin`);
  const clearCheckbox = document.getElementById(`${prefix}-clear-pin`);

  hideCheckbox.onchange = () => {
    pinWrap.classList.toggle('hidden', !hideCheckbox.checked);
    if (!hideCheckbox.checked) {
      pinInput.value = '';
      clearCheckbox.checked = false;
      pinInput.disabled = false;
    }
  };

  clearCheckbox.onchange = () => {
    pinInput.disabled = clearCheckbox.checked;
    if (clearCheckbox.checked) pinInput.value = '';
  };

  // 僅保留數字鍵入
  pinInput.oninput = () => {
    pinInput.value = pinInput.value.replace(/\D/g, '').slice(0, 4);
  };
}

function extractPrivacySubmitPayload(prefix, existingMember) {
  const isLockedWithPin = Boolean(
    existingMember && memberHasPrivacyPin(existingMember) && !isMemberUnlocked(existingMember.id)
  );
  if (isLockedWithPin) {
    return { locked: true };
  }

  const hideWeight = document.getElementById(`${prefix}-hide-weight`).checked;
  const rawPin = document.getElementById(`${prefix}-pin`).value.trim();
  const clearPin = document.getElementById(`${prefix}-clear-pin`).checked;

  if (hideWeight && !clearPin && rawPin !== '' && !isValidPinFormat(rawPin)) {
    return { error: '個人隱私密碼須為 4 位數字（例如 1234）' };
  }

  const result = {
    locked: false,
    hide_weight: hideWeight
  };

  if (!hideWeight) {
    if (existingMember && memberHasPrivacyPin(existingMember)) {
      result.privacy_pin = null;
    }
  } else if (clearPin) {
    result.privacy_pin = null;
  } else if (rawPin !== '') {
    result.privacy_pin = rawPin;
  }

  if (existingMember && memberHasPrivacyPin(existingMember)) {
    const currentPin = getUnlockedPin(existingMember.id);
    if (currentPin) result.current_pin = currentPin;
  }

  return result;
}

export function initModals() {
  const clearProfileModalState = () => {
    activeProfileContext = null;
    activeProfileInlineField = null;
    setInlineAvatarDrawer(false);
  };

  // 關閉按鈕
  document.querySelectorAll('.btn-close-modal').forEach((btn) => {
    btn.onclick = () => {
      const modal = btn.closest('.fixed');
      closeModal(modal);
      if (modal.id === 'modal-profile') clearProfileModalState();
    };
  });

  // 點擊彈窗外部（深色背景）即可平滑關閉
  ['modal-record', 'modal-member', 'modal-profile', 'modal-pin'].forEach((id) => {
    const modal = document.getElementById(id);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        closeModal(modal);
        if (id === 'modal-profile') clearProfileModalState();
        if (id === 'modal-pin') activePinRequest = null;
      }
    });
  });

  // 支援 Esc 鍵：若個人資訊面板有展開原地編輯或頭像抽屜則先收合，否則平滑關閉最上層彈窗
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const stack = ['modal-pin', 'modal-record', 'modal-member', 'modal-profile'];
    for (const id of stack) {
      if (isModalOpen(id)) {
        if (id === 'modal-profile') {
          if (isInlineAvatarDrawerOpen) {
            setInlineAvatarDrawer(false);
            break;
          }
          if (activeProfileInlineField && activeProfileContext) {
            activeProfileInlineField = null;
            openProfileModal(activeProfileContext.memberId, {
              onNavigateToChart: activeProfileContext.onNavigateToChart
            });
            break;
          }
          clearProfileModalState();
        }
        closeModal(id);
        if (id === 'modal-pin') activePinRequest = null;
        break;
      }
    }
  });

  // PIN 解鎖彈窗操作
  const pinInput = document.getElementById('input-pin-verify');
  pinInput.oninput = () => {
    pinInput.value = pinInput.value.replace(/\D/g, '').slice(0, 4);
    document.getElementById('pin-modal-error').classList.add('hidden');
  };

  document.getElementById('btn-pin-cancel').onclick = () => {
    closeModal('modal-pin');
    activePinRequest = null;
  };

  document.getElementById('form-pin').onsubmit = async (e) => {
    e.preventDefault();
    if (!activePinRequest) return;
    const { member, onUnlocked } = activePinRequest;
    const pin = pinInput.value.trim();
    const errEl = document.getElementById('pin-modal-error');
    const submitBtn = document.getElementById('btn-pin-submit');

    if (!isValidPinFormat(pin)) {
      errEl.textContent = '請輸入 4 位數字密碼';
      errEl.classList.remove('hidden');
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = '驗證中...';

    try {
      let verified = false;
      if (isTempId(member.id)) {
        verified = await verifyLocalPin(member.id, pin);
      } else {
        const res = await FamilyAPI.verifyMemberPin(state.familyCode, member.id, pin);
        if (res?.has_privacy_pin === false) {
          // 若資料庫尚未執行 003 遷移，改以本機雜湊驗證
          verified = await verifyLocalPin(member.id, pin);
        } else {
          verified = Boolean(res?.verified);
        }
      }

      if (!verified) {
        errEl.textContent = '個人密碼不正確，請再試一次';
        errEl.classList.remove('hidden');
        pinInput.value = '';
        pinInput.focus();
        return;
      }

      closeModal('modal-pin');
      activePinRequest = null;
      unlockMember(member.id, pin);
      showToast('已暫時解鎖真實體重（5 分鐘後自動隱藏）');
      if (onUnlocked) onUnlocked();
    } catch (err) {
      errEl.textContent = err.message || '驗證失敗，請稍後再試';
      errEl.classList.remove('hidden');
      pinInput.value = '';
      pinInput.focus();
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = '解鎖檢視';
    }
  };

  bindPrivacyControlEvents('mem');
  bindPrivacyControlEvents('prof');

  // 記錄體重彈窗：批量／單筆模式切換與單筆成員遮蔽輸入切換
  document.getElementById('btn-rec-mode-batch').onclick = () => setRecordModalMode('batch', true);
  document.getElementById('btn-rec-mode-single').onclick = () => setRecordModalMode('single', true);
  document.getElementById('rec-member').onchange = () => updateSingleWeightInputMask();

  // 切換成員類型時自動切換家人（身高）與毛孩（品種、BCS）欄位，並在未手動挑頭像時貼心帶入對應風格頭像
  document.getElementById('mem-type').onchange = (e) => {
    const nextType = e.target.value;
    const isPet = isPetType(nextType);
    document.getElementById('mem-height-wrap').classList.toggle('hidden', isPet);
    document.getElementById('mem-breed-wrap').classList.toggle('hidden', !isPet);
    document.getElementById('mem-bcs-wrap').classList.toggle('hidden', !isPet);
    if (isPet) {
      document.getElementById('mem-height').value = '';
    } else {
      document.getElementById('mem-breed').value = '';
      document.getElementById('mem-bcs').value = '';
    }
    if (!memberAvatarManuallyPicked) {
      setMemberModalAvatar(getDefaultAvatarForType(nextType));
    }
  };

  // 總覽主按鈕：預設開啟「批量紀錄」模式，方便一次填完今日全家體重
  document.getElementById('btn-open-record-modal').onclick = () => {
    openRecordModal(state.selectedMemberId, 'batch');
  };

  // 開啟新增成員彈窗
  document.getElementById('btn-open-member-modal').onclick = () => {
    openMemberModal(null);
  };

  // 表單送出：支援批量與單筆樂觀新增體重
  document.getElementById('form-record').onsubmit = (e) => {
    e.preventDefault();

    if (recordModalMode === 'batch') {
      const batchDate = document.getElementById('batch-date').value.trim();
      if (!isValidRecordedDate(batchDate)) return showToast('日期格式不正確或超出合理範圍', true);

      const inputs = Array.from(document.querySelectorAll('#batch-member-rows .batch-weight-input'));
      const toSubmit = [];

      for (const input of inputs) {
        const raw = input.value.trim();
        if (raw === '') continue; // 未填寫者自動略過
        const memberId = input.dataset.memberId || '';
        const memberName = input.dataset.memberName || '成員';
        if (!isValidResourceId(memberId)) return showToast(`無效的成員識別碼：${memberName}`, true);

        const parsed = parseStrictNumber(raw, {
          required: true,
          min: 0.1,
          max: 500,
          label: `${memberName} 體重 (kg)`
        });
        if (parsed.error) return showToast(parsed.error, true);

        toSubmit.push({
          member_id: memberId,
          weight_kg: parsed.value,
          recorded_at: batchDate,
          note: ''
        });
      }

      if (toSubmit.length === 0) {
        return showToast('請至少輸入一位成員的體重', true);
      }

      closeModal('modal-record');
      e.target.reset();
      toSubmit.forEach((payload) => optimisticAddRecord(payload));
      showToast(`已記錄 ${toSubmit.length} 筆體重`);
      return;
    }

    // 單筆模式
    const memberId = document.getElementById('rec-member').value.trim();
    const weightParsed = parseStrictNumber(document.getElementById('rec-weight').value, {
      required: true,
      min: 0.1,
      max: 500,
      label: '體重 (kg)'
    });
    const recordedAt = document.getElementById('rec-date').value.trim();
    const note = document.getElementById('rec-note').value.trim();

    if (!isValidResourceId(memberId)) return showToast('請選擇有效的成員', true);
    if (weightParsed.error) return showToast(weightParsed.error, true);
    if (!isValidRecordedDate(recordedAt)) return showToast('日期格式不正確或超出合理範圍', true);
    if (note.length > 200) return showToast('備註不可超過 200 字元', true);

    closeModal('modal-record');
    e.target.reset();
    optimisticAddRecord({
      member_id: memberId,
      weight_kg: weightParsed.value,
      recorded_at: recordedAt,
      note
    });
    showToast('體重已記錄');
  };

  // 表單送出：樂觀新增或編輯成員（含自訂頭像、品種、生日、BCS 與隱私設定）
  document.getElementById('form-member').onsubmit = (e) => {
    e.preventDefault();
    const editId = document.getElementById('mem-id').value.trim();
    const existingMember = editId ? state.appData.members.find((x) => x.id === editId) : null;
    const name = document.getElementById('mem-name').value.trim();
    const type = document.getElementById('mem-type').value;
    const rawAvatar = document.getElementById('mem-avatar').value.trim();
    const avatar = isValidAvatarId(rawAvatar) ? rawAvatar : getDefaultAvatarForType(type);
    const isPet = isPetType(type);
    const rawBreed = isPet ? document.getElementById('mem-breed').value.trim() : '';
    const breed = isPet ? (rawBreed || null) : null;
    const birthParsed = parseOptionalBirthDateInput(document.getElementById('mem-birth-date').value);
    const bcsParsed = isPet ? parseOptionalBcsInput(document.getElementById('mem-bcs').value) : { value: null };
    const heightParsed = isPet
      ? { value: null }
      : parseStrictNumber(document.getElementById('mem-height').value, {
          required: false,
          min: 20,
          max: 300,
          label: '身高 (cm)'
        });

    const privacyData = extractPrivacySubmitPayload('mem', existingMember);
    if (privacyData.error) return showToast(privacyData.error, true);

    const targetParsed = privacyData.locked
      ? { value: undefined }
      : parseStrictNumber(document.getElementById('mem-target').value, {
          required: false,
          min: 0.1,
          max: 500,
          label: '目標體重 (kg)'
        });

    if (!name || name.length > 50) return showToast('名稱須為 1–50 字元', true);
    if (!VALID_MEMBER_TYPES.has(type)) return showToast('成員類型不正確', true);
    if (rawBreed.length > 40) return showToast('品種不可超過 40 字元', true);
    if (birthParsed.error) return showToast(birthParsed.error, true);
    if (bcsParsed.error) return showToast(bcsParsed.error, true);
    if (heightParsed.error) return showToast(heightParsed.error, true);
    if (targetParsed.error) return showToast(targetParsed.error, true);

    if (editId) {
      if (!isValidResourceId(editId)) return showToast('無效的成員識別碼', true);
      const updatePayload = {
        name,
        avatar,
        birth_date: birthParsed.value,
        height_cm: heightParsed.value
      };
      if (isPet) {
        updatePayload.breed = breed;
        updatePayload.bcs_score = bcsParsed.value;
      }
      if (!privacyData.locked) {
        updatePayload.target_weight = targetParsed.value;
        updatePayload.target_effective_date = getLocalTodayDate();
        updatePayload.hide_weight = privacyData.hide_weight;
        if (privacyData.privacy_pin !== undefined) updatePayload.privacy_pin = privacyData.privacy_pin;
        if (privacyData.current_pin) updatePayload.current_pin = privacyData.current_pin;
      }

      closeModal('modal-member');
      e.target.reset();
      optimisticUpdateMember(editId, updatePayload);
      showToast('成員資料已更新');
    } else {
      const addPayload = {
        name,
        type,
        avatar,
        birth_date: birthParsed.value,
        hide_weight: privacyData.hide_weight,
        height_cm: heightParsed.value,
        target_weight: targetParsed.value,
        target_effective_date: getLocalTodayDate()
      };
      if (isPet) {
        addPayload.breed = breed;
        addPayload.bcs_score = bcsParsed.value;
        addPayload.pet_activity_factor = getDefaultPetFactorNumber(type);
      }
      if (privacyData.privacy_pin) addPayload.privacy_pin = privacyData.privacy_pin;

      closeModal('modal-member');
      e.target.reset();
      optimisticAddMember(addPayload);
      showToast('成員已新增');
    }
  };

  // 表單送出：樂觀更新個人資訊（含名稱、頭像、品種、生日、BCS、隱私設定、身高、目標體重）
  document.getElementById('form-profile').onsubmit = (e) => {
    e.preventDefault();
    const id = document.getElementById('prof-id').value.trim();
    const member = state.appData.members.find((x) => x.id === id);
    const isPet = isPetType(member?.type);
    const name = document.getElementById('prof-name').value.trim();
    const rawAvatar = document.getElementById('prof-avatar').value.trim();
    const avatar = isValidAvatarId(rawAvatar) ? rawAvatar : resolveMemberAvatar(member);
    const rawBreed = isPet ? document.getElementById('prof-breed').value.trim() : '';
    const breed = isPet ? (rawBreed || null) : null;
    const birthParsed = parseOptionalBirthDateInput(document.getElementById('prof-birth-date').value);
    const bcsParsed = isPet ? parseOptionalBcsInput(document.getElementById('prof-bcs').value) : { value: null };
    const heightParsed = isPet
      ? { value: null }
      : parseStrictNumber(document.getElementById('prof-height').value, {
          required: false,
          min: 20,
          max: 300,
          label: '身高 (cm)'
        });

    const privacyData = extractPrivacySubmitPayload('prof', member);
    if (privacyData.error) return showToast(privacyData.error, true);

    const targetParsed = privacyData.locked
      ? { value: undefined }
      : parseStrictNumber(document.getElementById('prof-target').value, {
          required: false,
          min: 0.1,
          max: 500,
          label: '目標體重 (kg)'
        });

    if (!isValidResourceId(id)) return showToast('無效的成員識別碼', true);
    if (!name || name.length > 50) return showToast('名稱須為 1–50 字元', true);
    if (rawBreed.length > 40) return showToast('品種不可超過 40 字元', true);
    if (birthParsed.error) return showToast(birthParsed.error, true);
    if (bcsParsed.error) return showToast(bcsParsed.error, true);
    if (heightParsed.error) return showToast(heightParsed.error, true);
    if (targetParsed.error) return showToast(targetParsed.error, true);

    const updatePayload = {
      name,
      avatar,
      birth_date: birthParsed.value,
      height_cm: heightParsed.value
    };
    if (isPet) {
      updatePayload.breed = breed;
      updatePayload.bcs_score = bcsParsed.value;
    }
    if (!privacyData.locked) {
      updatePayload.target_weight = targetParsed.value;
      updatePayload.target_effective_date = getLocalTodayDate();
      updatePayload.hide_weight = privacyData.hide_weight;
      if (privacyData.privacy_pin !== undefined) updatePayload.privacy_pin = privacyData.privacy_pin;
      if (privacyData.current_pin) updatePayload.current_pin = privacyData.current_pin;
    }

    closeModal('modal-profile');
    activeProfileContext = null;
    optimisticUpdateMember(id, updatePayload);
    showToast('個人資訊已更新');
  };
}
