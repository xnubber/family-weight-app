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
  sanitizePinInputValue,
  unlockMember,
  validatePinConfirmation,
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
  checkWeightAnomaly,
  computePetHoldWeight,
  isTempId,
  isValidBirthDate,
  isValidRecordedDate,
  isValidResourceId,
  parseBirthDateParts,
  parseStrictNumber,
  parseWeightValue,
  sanitizeDatePartDigits,
  sanitizeWeightInputValue
} from '../utils/validation.js';
import { t } from '../utils/i18n.js';
import {
  formatWeight,
  formatWeightDelta,
  formatWeightNumber,
  getWeightInputBounds,
  getWeightUnitLabel
} from '../utils/units.js';

const CAT_FACTOR_DEFS = [
  { value: '1.2', key: 'petFactor.cat12' },
  { value: '1.4', key: 'petFactor.cat14' },
  { value: '0.8', key: 'petFactor.cat08' },
  { value: '2.5', key: 'petFactor.cat25' }
];

const DOG_FACTOR_DEFS = [
  { value: '1.6', key: 'petFactor.dog16' },
  { value: '1.8', key: 'petFactor.dog18' },
  { value: '1.0', key: 'petFactor.dog10' },
  { value: '2.0', key: 'petFactor.dog20' },
  { value: '3.0', key: 'petFactor.dog30' }
];

const VALID_MEMBER_TYPES = new Set(['human', 'cat', 'dog']);

const BCS_OPTION_KEYS = [
  { value: '', key: 'bcsOpt.none' },
  { value: '1', key: 'bcsOpt.1' },
  { value: '2', key: 'bcsOpt.2' },
  { value: '3', key: 'bcsOpt.3' },
  { value: '4', key: 'bcsOpt.4' },
  { value: '5', key: 'bcsOpt.5' },
  { value: '6', key: 'bcsOpt.6' },
  { value: '7', key: 'bcsOpt.7' },
  { value: '8', key: 'bcsOpt.8' },
  { value: '9', key: 'bcsOpt.9' }
];

function getBcsOptions() {
  return BCS_OPTION_KEYS.map((item) => ({ value: item.value, label: t(item.key) }));
}

let recordModalMode = 'batch'; // 'batch' | 'single'
let singleWeightRevealed = false;
let singlePetCalcExpanded = false;
let hasProfileHealthCard = false;
let memberAvatarManuallyPicked = false;
let activePinRequest = null; // { member, onUnlocked }
let activeProfileContext = null; // { memberId, onNavigateToChart }
let activeProfileInlineField = null; // 'name' | 'breed' | 'birth_date' | 'height_cm' | 'bcs_score' | 'target_weight' | null
let isInlineAvatarDrawerOpen = false;

function getMemberTypeLabel(type) {
  if (type === 'cat') return t('memberType.cat');
  if (type === 'dog') return t('memberType.dog');
  return t('memberType.human');
}

function isPetType(type) {
  return type === 'cat' || type === 'dog';
}

function getPetFactors(type) {
  const defs = type === 'dog' ? DOG_FACTOR_DEFS : CAT_FACTOR_DEFS;
  return defs.map((d) => ({ value: d.value, label: t(d.key) }));
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
    return { error: t('val.bcsInvalid') };
  }
  return { value: num };
}

function parseOptionalBirthDateInput(rawValue) {
  const trimmed = String(rawValue ?? '').trim();
  if (trimmed === '') return { value: null };
  if (!isValidBirthDate(trimmed)) {
    return { error: t('val.birthDateInvalid') };
  }
  return { value: trimmed };
}

// 綁定獨立「年／月／日」數字輸入格（支援全形數字清理、自動跳下一格、空欄 Backspace 返回上一格與單碼補零）
function wireBirthDateInputs(yearEl, monthEl, dayEl, { onEnter = null, onEscape = null } = {}) {
  if (!yearEl || !monthEl || !dayEl) return;

  const setupPart = (el, maxLen, { nextEl = null, prevEl = null, padTo2 = false } = {}) => {
    el.addEventListener('input', () => {
      const cleaned = sanitizeDatePartDigits(el.value, maxLen);
      if (el.value !== cleaned) el.value = cleaned;
      if (nextEl && cleaned.length >= maxLen) {
        nextEl.focus();
      }
    });

    if (padTo2) {
      el.addEventListener('blur', () => {
        const cleaned = sanitizeDatePartDigits(el.value, 2);
        if (cleaned.length === 1 && Number(cleaned) >= 1) {
          el.value = cleaned.padStart(2, '0');
        }
      });
    }

    el.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && el.value === '' && prevEl) {
        prevEl.focus();
        return;
      }
      if (e.key === 'Enter' && typeof onEnter === 'function') {
        e.preventDefault();
        e.stopPropagation();
        onEnter();
      } else if (e.key === 'Escape' && typeof onEscape === 'function') {
        e.preventDefault();
        e.stopPropagation();
        onEscape();
      }
    });
  };

  setupPart(yearEl, 4, { nextEl: monthEl });
  setupPart(monthEl, 2, { nextEl: dayEl, prevEl: yearEl, padTo2: true });
  setupPart(dayEl, 2, { prevEl: monthEl, padTo2: true });
}

function setBirthDateGroupValue(prefix, isoDate) {
  const yearEl = document.getElementById(`${prefix}-birth-year`);
  const monthEl = document.getElementById(`${prefix}-birth-month`);
  const dayEl = document.getElementById(`${prefix}-birth-day`);
  if (!yearEl || !monthEl || !dayEl) return;

  const iso = String(isoDate || '').slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    const [y, m, d] = iso.split('-');
    yearEl.value = y;
    monthEl.value = m;
    dayEl.value = d;
  } else {
    yearEl.value = '';
    monthEl.value = '';
    dayEl.value = '';
  }
}

function readBirthDateGroup(prefix) {
  const yearEl = document.getElementById(`${prefix}-birth-year`);
  const monthEl = document.getElementById(`${prefix}-birth-month`);
  const dayEl = document.getElementById(`${prefix}-birth-day`);
  return parseBirthDateParts(yearEl?.value ?? '', monthEl?.value ?? '', dayEl?.value ?? '');
}

function createBirthDateInlineControl(initialIso, { onEnter, onEscape } = {}) {
  const grid = createEl('div', 'grid grid-cols-[1.45fr_1fr_1fr] gap-2');
  const buildBox = (maxLen, placeholderKey, unitKey, ariaKey, padRightCls) => {
    const box = createEl('div', 'relative');
    const input = document.createElement('input');
    input.type = 'text';
    input.inputMode = 'numeric';
    input.maxLength = maxLen;
    input.autocomplete = 'off';
    input.placeholder = t(placeholderKey);
    input.setAttribute('aria-label', t(ariaKey));
    input.className = `w-full border border-sage-500/50 rounded-xl pl-2 ${padRightCls} py-2 text-sm text-center bg-linen text-ink tabular-nums`;
    const unit = createEl(
      'span',
      'pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-ink-400',
      t(unitKey)
    );
    box.append(input, unit);
    return { box, input };
  };

  const yPart = buildBox(4, 'birthInput.yearPlaceholder', 'birthInput.yearUnit', 'birthInput.yearAria', 'pr-6');
  const mPart = buildBox(2, 'birthInput.monthPlaceholder', 'birthInput.monthUnit', 'birthInput.monthAria', 'pr-6');
  const dPart = buildBox(2, 'birthInput.dayPlaceholder', 'birthInput.dayUnit', 'birthInput.dayAria', 'pr-6');

  const iso = String(initialIso || '').slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    const [y, m, d] = iso.split('-');
    yPart.input.value = y;
    mPart.input.value = m;
    dPart.input.value = d;
  }

  wireBirthDateInputs(yPart.input, mPart.input, dPart.input, { onEnter, onEscape });
  grid.append(yPart.box, mPart.box, dPart.box);

  return {
    el: grid,
    yearInput: yPart.input,
    readParsed: () => parseBirthDateParts(yPart.input.value, mPart.input.value, dPart.input.value)
  };
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
    showToast(t('privacy.tempUnlockedToast'));
    if (onUnlocked) onUnlocked();
    return;
  }

  activePinRequest = { member, onUnlocked };
  const titleEl = document.getElementById('pin-modal-title');
  const descEl = document.getElementById('pin-modal-desc');
  const inputEl = document.getElementById('input-pin-verify');
  const errEl = document.getElementById('pin-modal-error');
  const submitBtn = document.getElementById('btn-pin-submit');

  titleEl.textContent = t('pinModal.titleMember', { name: member.name || t('memberType.human') });
  descEl.textContent = t('pinModal.desc');
  inputEl.value = '';
  errEl.textContent = '';
  errEl.classList.add('hidden');
  submitBtn.disabled = false;
  submitBtn.textContent = t('pinModal.submit');

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

function setWeightInputErrorState(input, hasError) {
  if (!input?.classList) return;
  input.classList.toggle('border-rosewood-500', Boolean(hasError));
}

function attachWeightInputGuard(input) {
  if (!input || input.dataset?.weightGuardBound === 'true') return;
  if (input.dataset) input.dataset.weightGuardBound = 'true';

  input.addEventListener('input', () => {
    const bounds = getWeightInputBounds();
    const cleaned = sanitizeWeightInputValue(input.value);
    if (input.value !== cleaned) {
      input.value = cleaned;
    }
    if (cleaned === '') {
      setWeightInputErrorState(input, false);
      return;
    }
    const num = Number(cleaned);
    setWeightInputErrorState(input, Number.isFinite(num) && num > bounds.max);
  });

  input.addEventListener('blur', () => {
    const raw = input.value.trim();
    if (raw === '') {
      setWeightInputErrorState(input, false);
      return;
    }
    const parsed = parseWeightValue(raw, { required: false });
    setWeightInputErrorState(input, Boolean(parsed.error));
  });
}

function syncWeightVisibilityButton(btn, revealed) {
  if (!btn) return;
  const label = revealed ? t('record.toggleHideWeight') : t('record.toggleShowWeight');
  btn.setAttribute('aria-label', label);
  btn.setAttribute('title', label);
  btn.replaceChildren(createIcon(revealed ? 'eyeOff' : 'eye', 'w-4 h-4'));
}

function getQuickOwnerWeights({ preferBatchInputs = false } = {}) {
  const unitLabel = getWeightUnitLabel();
  const batchInputs = preferBatchInputs
    ? Array.from(document.querySelectorAll('#batch-member-rows .batch-weight-input'))
    : [];

  return state.appData.members
    .filter((m) => m.type === 'human' && !isMemberWeightHidden(m))
    .map((m) => {
      if (preferBatchInputs) {
        const matchedInput = batchInputs.find((inp) => inp.dataset.memberId === String(m.id));
        const rawBatch = matchedInput ? matchedInput.value.trim() : '';
        if (rawBatch) {
          const parsed = parseWeightValue(rawBatch, { required: false });
          if (!parsed.error && parsed.displayValue !== null) {
            return {
              id: m.id,
              name: String(m.name ?? ''),
              displayValue: parsed.displayValue.toFixed(2).replace(/\.?0+$/, ''),
              unitLabel
            };
          }
        }
      }
      const recs = state.appData.records.filter((r) => r.member_id === m.id);
      const latest = recs[recs.length - 1];
      if (!latest) return null;
      return {
        id: m.id,
        name: String(m.name ?? ''),
        displayValue: formatWeightNumber(latest.weight_kg, { trimTrailingZeros: true }),
        unitLabel
      };
    })
    .filter(Boolean);
}

function renderQuickOwnerChips(container, ownerInput, { preferBatchInputs = false, onPicked = () => {} } = {}) {
  if (!container) return;
  const owners = getQuickOwnerWeights({ preferBatchInputs });
  if (owners.length === 0) {
    container.classList.add('hidden');
    container.replaceChildren();
    return;
  }

  container.classList.remove('hidden');
  const label = createEl('span', 'text-[11px] text-ink-400', t('record.petCalcQuickOwner'));
  const chips = owners.map((owner) => {
    const btn = createEl(
      'button',
      'inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] font-medium bg-linen hover:bg-sage-50 text-ink-700 hover:text-sage-700 border border-oat-200 hover:border-sage-200 transition tabular-nums',
      `${owner.name} ${owner.displayValue} ${owner.unitLabel}`
    );
    btn.type = 'button';
    btn.onclick = () => {
      ownerInput.value = owner.displayValue;
      setWeightInputErrorState(ownerInput, false);
      onPicked();
    };
    return btn;
  });
  container.replaceChildren(label, ...chips);
}

function applyPetHoldCalculation({ withInput, ownerInput, targetInput, feedbackEl }) {
  if (!withInput || !ownerInput || !targetInput || !feedbackEl) return;
  const result = computePetHoldWeight(withInput.value, ownerInput.value);

  if (result.status === 'incomplete') {
    setWeightInputErrorState(withInput, false);
    setWeightInputErrorState(ownerInput, false);
    feedbackEl.textContent = t('record.petCalcHint');
    feedbackEl.className = 'text-[11px] text-ink-400 leading-snug tabular-nums';
    return;
  }

  if (result.status === 'error') {
    setWeightInputErrorState(withInput, true);
    setWeightInputErrorState(ownerInput, false);
    feedbackEl.textContent = result.error;
    feedbackEl.className = 'text-[11px] text-rosewood-600 leading-snug tabular-nums';
    return;
  }

  setWeightInputErrorState(withInput, false);
  setWeightInputErrorState(ownerInput, false);
  targetInput.value = result.inputValue;
  setWeightInputErrorState(targetInput, false);
  feedbackEl.textContent = t('record.petCalcResult', {
    withVal: result.withPet.toFixed(2).replace(/\.?0+$/, ''),
    ownerVal: result.owner.toFixed(2).replace(/\.?0+$/, ''),
    petVal: result.inputValue,
    unit: result.unitLabel
  });
  feedbackEl.className = 'text-[11px] text-sage-700 font-medium leading-snug tabular-nums';
}

function syncSinglePetCalcUI({ reset = false, animate = false } = {}) {
  const select = document.getElementById('rec-member');
  const wrap = document.getElementById('rec-pet-calc-wrap');
  const toggleBtn = document.getElementById('btn-rec-pet-calc-toggle');
  const chevron = document.getElementById('rec-pet-calc-chevron');
  const panel = document.getElementById('rec-pet-calc-panel');
  const quickOwners = document.getElementById('rec-pet-quick-owners');
  const withLabel = document.getElementById('rec-pet-with-label');
  const ownerLabel = document.getElementById('rec-pet-owner-label');
  const withInput = document.getElementById('rec-pet-with-weight');
  const ownerInput = document.getElementById('rec-pet-owner-weight');
  const feedbackEl = document.getElementById('rec-pet-calc-feedback');
  const targetInput = document.getElementById('rec-weight');
  if (!select || !wrap) return;

  const member = state.appData.members.find((m) => m.id === select.value);
  const isPet = isPetType(member?.type);
  const unitLabel = getWeightUnitLabel();

  if (withLabel) withLabel.textContent = t('record.petCalcWithLabel', { unit: unitLabel });
  if (ownerLabel) ownerLabel.textContent = t('record.petCalcOwnerLabel', { unit: unitLabel });

  if (reset || !isPet) {
    singlePetCalcExpanded = false;
    if (withInput) {
      withInput.value = '';
      setWeightInputErrorState(withInput, false);
    }
    if (ownerInput) {
      ownerInput.value = '';
      setWeightInputErrorState(ownerInput, false);
    }
    if (feedbackEl) {
      feedbackEl.textContent = t('record.petCalcHint');
      feedbackEl.className = 'text-[11px] text-ink-400 leading-snug tabular-nums';
    }
  }

  wrap.classList.toggle('hidden', !isPet);
  if (toggleBtn) toggleBtn.setAttribute('aria-expanded', singlePetCalcExpanded ? 'true' : 'false');
  if (chevron) chevron.classList.toggle('rotate-180', singlePetCalcExpanded);
  if (panel) {
    panel.classList.toggle('hidden', !singlePetCalcExpanded);
    if (singlePetCalcExpanded && animate) {
      playSoftFade(panel);
    }
  }

  if (isPet && singlePetCalcExpanded) {
    renderQuickOwnerChips(quickOwners, ownerInput, {
      preferBatchInputs: false,
      onPicked: () => applyPetHoldCalculation({ withInput, ownerInput, targetInput, feedbackEl })
    });
    applyPetHoldCalculation({ withInput, ownerInput, targetInput, feedbackEl });
  }
}

function updateSingleWeightInputMask({ resetReveal = false } = {}) {
  const select = document.getElementById('rec-member');
  const weightInput = document.getElementById('rec-weight');
  const toggleBtn = document.getElementById('btn-rec-weight-visibility');
  if (!select || !weightInput) return;
  if (resetReveal) singleWeightRevealed = false;

  const member = state.appData.members.find((m) => m.id === select.value);
  const masked = isMemberWeightHidden(member);
  const unitLabel = getWeightUnitLabel();

  weightInput.inputMode = 'decimal';
  weightInput.autocomplete = 'off';

  if (masked) {
    weightInput.type = singleWeightRevealed ? 'text' : 'password';
    weightInput.placeholder = t('record.weightPlaceholderHidden');
    weightInput.classList.add('pr-10');
    if (toggleBtn) {
      toggleBtn.classList.remove('hidden');
      syncWeightVisibilityButton(toggleBtn, singleWeightRevealed);
    }
  } else {
    singleWeightRevealed = false;
    weightInput.type = 'text';
    weightInput.placeholder = t('record.weightPlaceholder', { unit: unitLabel });
    weightInput.classList.remove('pr-10');
    if (toggleBtn) {
      toggleBtn.classList.add('hidden');
      toggleBtn.replaceChildren();
    }
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

  document.getElementById('btn-rec-submit').textContent = isBatch
    ? t('record.saveBatch')
    : t('record.saveSingle');
  if (!isBatch) {
    updateSingleWeightInputMask({ resetReveal: true });
    syncSinglePetCalcUI({ reset: false });
  }
}

function renderBatchMemberRows() {
  const container = document.getElementById('batch-member-rows');
  const unitLabel = getWeightUnitLabel();
  const rows = state.appData.members.map((m) => {
    const recs = state.appData.records.filter((r) => r.member_id === m.id);
    const latest = recs[recs.length - 1];
    const isHidden = isMemberWeightHidden(m);
    const isPet = isPetType(m.type);

    const rowWrap = createEl('div', 'py-2.5');
    const row = createEl('div', 'flex items-center justify-between gap-2.5');
    const leftGroup = createEl('div', 'flex items-center gap-2.5 min-w-0 flex-1');
    const labelWrap = createEl('div', 'min-w-0 flex-1');
    const subtitleText = isHidden
      ? (latest ? `${MASKED_WEIGHT} ${unitLabel}` : t('settings.privacyHideSuffix'))
      : (latest ? formatWeight(latest.weight_kg, { trimTrailingZeros: true }) : t('overview.noRecords'));

    const subLine = createEl('div', 'flex flex-wrap items-center gap-1.5 mt-0.5');
    subLine.append(createEl('span', 'text-fluid-label text-ink-400 tabular-nums', subtitleText));

    labelWrap.append(
      createEl('div', 'font-medium text-sm text-ink leading-snug break-words', String(m.name ?? '')),
      subLine
    );
    leftGroup.append(createAvatarNode(resolveMemberAvatar(m), 'w-8 h-8'), labelWrap);

    const inputWrap = createEl('div', 'flex items-center gap-1.5 shrink-0');
    const input = document.createElement('input');
    input.type = isHidden ? 'password' : 'text';
    input.inputMode = 'decimal';
    input.autocomplete = 'off';
    const latestDisplay = latest ? formatWeightNumber(latest.weight_kg, { trimTrailingZeros: true }) : '';
    input.placeholder = isHidden
      ? t('record.batchPlaceholderHidden', { unit: unitLabel })
      : (latestDisplay || t('record.batchPlaceholder', { unit: unitLabel }));
    input.dataset.memberId = String(m.id);
    input.dataset.memberName = String(m.name ?? '');
    input.className = isHidden
      ? 'batch-weight-input w-28 border rounded-xl pl-2.5 pr-8 py-1.5 text-sm text-right tabular-nums'
      : 'batch-weight-input w-24 border rounded-xl px-2.5 py-1.5 text-sm text-right tabular-nums';
    attachWeightInputGuard(input);

    if (isHidden) {
      let revealed = false;
      const fieldBox = createEl('div', 'relative');
      const eyeBtn = createEl(
        'button',
        'absolute right-1.5 top-1/2 -translate-y-1/2 p-1 rounded-md text-ink-400 hover:text-ink-700 hover:bg-oat-100'
      );
      eyeBtn.type = 'button';
      syncWeightVisibilityButton(eyeBtn, revealed);
      eyeBtn.onclick = () => {
        revealed = !revealed;
        input.type = revealed ? 'text' : 'password';
        syncWeightVisibilityButton(eyeBtn, revealed);
      };
      fieldBox.append(input, eyeBtn);
      inputWrap.append(fieldBox, createEl('span', 'text-xs text-ink-400', unitLabel));
    } else {
      inputWrap.append(input, createEl('span', 'text-xs text-ink-400', unitLabel));
    }

    row.append(leftGroup, inputWrap);
    rowWrap.append(row);

    // 毛孩專屬：批量模式內嵌「抱著量」自動相減小面板（並支援一鍵帶入上方剛輸入或最新的主人體重）
    if (isPet) {
      let calcOpen = false;
      const calcToggleBtn = createEl(
        'button',
        'inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[11px] font-medium bg-sage-50 hover:bg-sage-100 text-sage-700 border border-sage-200/80 transition',
        t('record.petCalcShortBtn')
      );
      calcToggleBtn.type = 'button';
      calcToggleBtn.setAttribute('aria-expanded', 'false');
      subLine.append(calcToggleBtn);

      const calcPanel = createEl('div', 'hidden mt-2 bg-oat-50 border border-oat-200 rounded-xl p-2.5 space-y-2');
      const quickOwnersEl = createEl('div', 'hidden flex flex-wrap items-center gap-1.5');
      const grid = createEl('div', 'grid grid-cols-2 gap-2');

      const withBox = createEl('div');
      withBox.append(createEl('label', 'block text-[11px] text-ink-500', t('record.petCalcWithLabel', { unit: unitLabel })));
      const withInput = document.createElement('input');
      withInput.type = 'text';
      withInput.inputMode = 'decimal';
      withInput.autocomplete = 'off';
      withInput.placeholder = t('record.petCalcWithPlaceholder');
      withInput.className = 'w-full border rounded-lg px-2 py-1.5 text-xs tabular-nums mt-1 bg-linen';
      attachWeightInputGuard(withInput);
      withBox.append(withInput);

      const ownerBox = createEl('div');
      ownerBox.append(createEl('label', 'block text-[11px] text-ink-500', t('record.petCalcOwnerLabel', { unit: unitLabel })));
      const ownerInput = document.createElement('input');
      ownerInput.type = 'text';
      ownerInput.inputMode = 'decimal';
      ownerInput.autocomplete = 'off';
      ownerInput.placeholder = t('record.petCalcOwnerPlaceholder');
      ownerInput.className = 'w-full border rounded-lg px-2 py-1.5 text-xs tabular-nums mt-1 bg-linen';
      attachWeightInputGuard(ownerInput);
      ownerBox.append(ownerInput);

      grid.append(withBox, ownerBox);
      const feedbackEl = createEl('p', 'text-[11px] text-ink-400 leading-snug tabular-nums', t('record.petCalcHint'));
      calcPanel.append(quickOwnersEl, grid, feedbackEl);
      rowWrap.append(calcPanel);

      const recalc = () =>
        applyPetHoldCalculation({ withInput, ownerInput, targetInput: input, feedbackEl });

      withInput.addEventListener('input', recalc);
      ownerInput.addEventListener('input', recalc);

      calcToggleBtn.onclick = () => {
        calcOpen = !calcOpen;
        calcToggleBtn.setAttribute('aria-expanded', calcOpen ? 'true' : 'false');
        calcPanel.classList.toggle('hidden', !calcOpen);
        if (calcOpen) {
          renderQuickOwnerChips(quickOwnersEl, ownerInput, {
            preferBatchInputs: true,
            onPicked: recalc
          });
          playSoftFade(calcPanel);
          recalc();
        }
      };
    }

    return rowWrap;
  });

  container.replaceChildren(...rows);
}

// 同步各彈窗的體重單位標籤（kg / lb）與 BCS 下拉選項
export function syncModalDynamicLabels() {
  const unitLabel = getWeightUnitLabel();
  const memTargetLabel = document.getElementById('mem-target-label');
  const profTargetLabel = document.getElementById('prof-target-label');
  const recWeightLabel = document.getElementById('rec-weight-label');
  const recPetWithLabel = document.getElementById('rec-pet-with-label');
  const recPetOwnerLabel = document.getElementById('rec-pet-owner-label');
  if (memTargetLabel) memTargetLabel.textContent = t('memberModal.targetWeight', { unit: unitLabel });
  if (profTargetLabel) profTargetLabel.textContent = t('memberModal.targetWeight', { unit: unitLabel });
  if (recWeightLabel) recWeightLabel.textContent = t('record.weightLabel', { unit: unitLabel });
  if (recPetWithLabel) recPetWithLabel.textContent = t('record.petCalcWithLabel', { unit: unitLabel });
  if (recPetOwnerLabel) recPetOwnerLabel.textContent = t('record.petCalcOwnerLabel', { unit: unitLabel });

  const bcsOpts = getBcsOptions();
  ['mem-bcs', 'prof-bcs'].forEach((id) => {
    const sel = document.getElementById(id);
    if (!sel) return;
    const prevVal = sel.value;
    sel.replaceChildren(
      ...bcsOpts.map((item) => {
        const opt = document.createElement('option');
        opt.value = item.value;
        opt.textContent = item.label;
        return opt;
      })
    );
    sel.value = prevVal;
  });
}

// 開啟新增體重彈窗（預設批量模式；從個人資訊面板點入則預設單筆模式並預選該成員）
export function openRecordModal(preselectedMemberId = null, mode = 'batch') {
  if (state.appData.members.length === 0) return showToast(t('record.noMembers'), true);
  syncModalDynamicLabels();
  const today = getLocalTodayDate();

  // 準備單筆模式欄位
  const select = document.getElementById('rec-member');
  const options = state.appData.members.map((m) => {
    const opt = document.createElement('option');
    opt.value = String(m.id);
    opt.textContent = `${m.name ?? ''} (${getMemberTypeLabel(m.type)})`;
    return opt;
  });
  select.replaceChildren(...options);

  if (preselectedMemberId && state.appData.members.some((m) => m.id === preselectedMemberId)) {
    select.value = String(preselectedMemberId);
  }

  const singleWeightInput = document.getElementById('rec-weight');
  singleWeightInput.value = '';
  setWeightInputErrorState(singleWeightInput, false);
  singleWeightRevealed = false;
  syncSinglePetCalcUI({ reset: true });
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

function setPinFeedbackMessage(feedbackEl, message = '', tone = 'muted') {
  if (!feedbackEl) return;
  if (!message) {
    feedbackEl.textContent = '';
    feedbackEl.className = 'hidden text-[11px] mt-1 leading-snug';
    return;
  }
  const toneClass =
    tone === 'error'
      ? 'text-rosewood-600'
      : tone === 'success'
        ? 'text-sage-700'
        : 'text-ink-400';
  feedbackEl.textContent = message;
  feedbackEl.className = `text-[11px] mt-1 leading-snug ${toneClass}`;
}

function syncPrivacyPinConfirmState(prefix) {
  const hideCheckbox = document.getElementById(`${prefix}-hide-weight`);
  const clearCheckbox = document.getElementById(`${prefix}-clear-pin`);
  const pinInput = document.getElementById(`${prefix}-pin`);
  const pinConfirmWrap = document.getElementById(`${prefix}-pin-confirm-wrap`);
  const pinConfirmInput = document.getElementById(`${prefix}-pin-confirm`);
  const feedbackEl = document.getElementById(`${prefix}-pin-feedback`);
  if (!pinInput || !pinConfirmWrap || !pinConfirmInput) return;

  pinInput.classList.remove('border-rosewood-500');
  pinConfirmInput.classList.remove('border-rosewood-500');

  if (!hideCheckbox?.checked || clearCheckbox?.checked) {
    pinConfirmWrap.classList.add('hidden');
    setPinFeedbackMessage(feedbackEl, '');
    return;
  }

  const pin = pinInput.value;
  const confirm = pinConfirmInput.value;
  const shouldShowConfirm = pin.length > 0 || confirm.length > 0;
  pinConfirmWrap.classList.toggle('hidden', !shouldShowConfirm);

  if (!shouldShowConfirm) {
    setPinFeedbackMessage(feedbackEl, '');
    return;
  }

  if (pin.length === 0 && confirm.length > 0) {
    pinInput.classList.add('border-rosewood-500');
    setPinFeedbackMessage(feedbackEl, t('privacy.pinFirstRequired'), 'error');
  } else if (pin.length < 4 && confirm.length > 0) {
    pinInput.classList.add('border-rosewood-500');
    setPinFeedbackMessage(feedbackEl, t('privacy.pinMustBe4'), 'error');
  } else if (pin.length < 4) {
    setPinFeedbackMessage(feedbackEl, t('privacy.pinProgress', { count: pin.length }), 'muted');
  } else if (confirm.length === 0) {
    setPinFeedbackMessage(feedbackEl, t('privacy.pinConfirmRequired'), 'muted');
  } else if (confirm.length === 4 && confirm === pin) {
    setPinFeedbackMessage(feedbackEl, t('privacy.pinMatched'), 'success');
  } else if (!pin.startsWith(confirm) || confirm.length === 4) {
    pinConfirmInput.classList.add('border-rosewood-500');
    setPinFeedbackMessage(feedbackEl, t('privacy.pinMismatch'), 'error');
  } else {
    setPinFeedbackMessage(feedbackEl, t('privacy.pinConfirmProgress', { count: confirm.length }), 'muted');
  }
}

function showPrivacyPinSubmitError(prefix, errorMessage, focusField) {
  const pinInput = document.getElementById(`${prefix}-pin`);
  const pinConfirmWrap = document.getElementById(`${prefix}-pin-confirm-wrap`);
  const pinConfirmInput = document.getElementById(`${prefix}-pin-confirm`);
  const feedbackEl = document.getElementById(`${prefix}-pin-feedback`);
  if (!pinInput || !pinConfirmInput) return;

  if (pinConfirmWrap && (focusField === 'confirm' || pinInput.value.length > 0 || pinConfirmInput.value.length > 0)) {
    pinConfirmWrap.classList.remove('hidden');
  }
  const targetIsConfirm = focusField === 'confirm';
  pinInput.classList.toggle('border-rosewood-500', !targetIsConfirm);
  pinConfirmInput.classList.toggle('border-rosewood-500', targetIsConfirm);
  setPinFeedbackMessage(feedbackEl, errorMessage, 'error');
  (targetIsConfirm ? pinConfirmInput : pinInput).focus();
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
  const pinConfirmInput = document.getElementById(`${prefix}-pin-confirm`);
  const clearWrap = document.getElementById(`${prefix}-clear-pin-wrap`);
  const clearCheckbox = document.getElementById(`${prefix}-clear-pin`);

  if (targetWrap) targetWrap.classList.toggle('hidden', isLockedWithPin);
  lockedBox.classList.toggle('hidden', !isLockedWithPin);
  controls.classList.toggle('hidden', isLockedWithPin);

  hideCheckbox.checked = hideEnabled;
  pinInput.value = '';
  if (pinConfirmInput) {
    pinConfirmInput.value = '';
    pinConfirmInput.disabled = false;
  }
  clearCheckbox.checked = false;
  pinInput.disabled = false;

  pinLabel.textContent = hasPin ? t('privacy.pinLabelChange') : t('privacy.pinLabelNew');
  pinInput.placeholder = hasPin ? t('privacy.pinPlaceholderChange') : t('privacy.pinPlaceholderNew');

  pinWrap.classList.toggle('hidden', !hideEnabled);
  clearWrap.classList.toggle('hidden', !hideEnabled || !hasPin);
  syncPrivacyPinConfirmState(prefix);
}

// 開啟新增／編輯成員彈窗（傳入 member 物件則進入編輯模式，支援修改名稱、頭像、品種、生日、BCS、隱私設定、身高與目標體重）
export function openMemberModal(member = null) {
  syncModalDynamicLabels();
  const form = document.getElementById('form-member');
  const titleEl = document.getElementById('mem-modal-title');
  const submitBtn = document.getElementById('btn-mem-submit');
  const idInput = document.getElementById('mem-id');
  const nameInput = document.getElementById('mem-name');
  const typeSelect = document.getElementById('mem-type');
  const breedWrap = document.getElementById('mem-breed-wrap');
  const breedInput = document.getElementById('mem-breed');
  const heightWrap = document.getElementById('mem-height-wrap');
  const heightInput = document.getElementById('mem-height');
  const bcsWrap = document.getElementById('mem-bcs-wrap');
  const bcsSelect = document.getElementById('mem-bcs');
  const targetInput = document.getElementById('mem-target');

  form.reset();

  if (member) {
    const isPet = isPetType(member.type);
    const isLockedWithPin = memberHasPrivacyPin(member) && !isMemberUnlocked(member.id);
    const targetDisplay = member.target_weight !== null && member.target_weight !== undefined
      ? formatWeightNumber(member.target_weight, { trimTrailingZeros: true })
      : '';
    memberAvatarManuallyPicked = true;
    titleEl.textContent = t('memberModal.editTitle');
    submitBtn.textContent = t('common.saveChanges');
    idInput.value = member.id;
    nameInput.value = member.name || '';
    typeSelect.value = VALID_MEMBER_TYPES.has(member.type) ? member.type : 'human';
    typeSelect.disabled = true;
    breedWrap.classList.toggle('hidden', !isPet);
    breedInput.value = isPet ? (member.breed || '') : '';
    setBirthDateGroupValue('mem', member.birth_date);
    heightWrap.classList.toggle('hidden', isPet);
    heightInput.value = isPet ? '' : (member.height_cm ?? '');
    bcsWrap.classList.toggle('hidden', !isPet);
    bcsSelect.value = isPet && member.bcs_score ? String(member.bcs_score) : '';
    targetInput.value = isLockedWithPin ? '' : targetDisplay;
    setMemberModalAvatar(resolveMemberAvatar(member));
    syncPrivacyFormUI('mem', member);

    document.getElementById('btn-mem-unlock').onclick = () => {
      requestMemberUnlock(member, () => {
        targetInput.value = targetDisplay;
        syncPrivacyFormUI('mem', member);
      });
    };
  } else {
    memberAvatarManuallyPicked = false;
    titleEl.textContent = t('memberModal.addTitle');
    submitBtn.textContent = t('common.add');
    idInput.value = '';
    typeSelect.value = 'human';
    typeSelect.disabled = false;
    breedWrap.classList.add('hidden');
    breedInput.value = '';
    setBirthDateGroupValue('mem', null);
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
      createEl('span', '', t('health.humanTitle'))
    );
    header.appendChild(titleWrap);

    if (bmiRes) {
      const badgeClass = bmiRes.statusKey === 'normal'
        ? 'bg-sage-100 text-sage-700 border border-sage-200'
        : bmiRes.statusKey === 'under'
          ? 'bg-oat-100 text-ink-700 border border-oat-200'
          : 'bg-ochre-100 text-ochre-700 border border-ochre-200';
      const badgeText = isHidden
        ? bmiRes.status
        : `BMI ${bmiRes.bmi.toFixed(1)} · ${bmiRes.status}`;
      header.appendChild(
        createEl('span', `text-xs font-medium px-2 py-0.5 rounded-full tabular-nums whitespace-nowrap ${badgeClass}`, badgeText)
      );
    }

    const children = [header];
    if (range) {
      const minDisp = formatWeightNumber(range.minKg, { decimals: 1, trimTrailingZeros: true });
      const maxDisp = formatWeight(range.maxKg, { decimals: 1, trimTrailingZeros: true });
      const row = createEl('div', 'flex flex-wrap justify-between items-baseline gap-x-2 gap-y-0.5 text-xs text-ink-500');
      row.append(
        createEl('span', '', 'BMI 18.5–24.0'),
        createEl('strong', 'text-ink font-semibold tabular-nums whitespace-nowrap', `${minDisp}–${maxDisp}`)
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
      createEl('span', '', isDog ? t('health.dogTitle') : t('health.catTitle'))
    );
    header.appendChild(titleWrap);

    if (isHidden) {
      children.push(
        header,
        createEl('p', 'text-xs text-ink-500 leading-relaxed', t('health.petHiddenHint'))
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
          createEl('div', 'text-fluid-label text-ink-400', t('health.rerLabel')),
          createEl('div', 'text-fluid-metric font-semibold text-ink tabular-nums whitespace-nowrap mt-0.5', `${res.rer} kcal`)
        );
        const colDer = createEl('div', 'min-w-0');
        colDer.append(
          createEl('div', 'text-fluid-label text-ink-400', t('health.derLabel')),
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
      createEl('span', `text-xs font-medium ${isDog ? 'text-ochre-700' : 'text-clay-700'}`, t('profile.fieldBcs')),
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
  syncModalDynamicLabels();
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
  const unitLabel = getWeightUnitLabel();
  const targetDisplay = m.target_weight !== null && m.target_weight !== undefined
    ? formatWeightNumber(m.target_weight, { trimTrailingZeros: true })
    : '';

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
      showToast(t('profile.avatarUpdated'));
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
    setBirthDateGroupValue('prof', m.birth_date);
    document.getElementById('prof-height').value = isPet ? '' : (m.height_cm ?? '');
    document.getElementById('prof-bcs').value = isPet && m.bcs_score ? String(m.bcs_score) : '';
    document.getElementById('prof-target').value = isLockedWithPin ? '' : targetDisplay;
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
        label: t('profile.fieldName'),
        value: m.name || '--',
        editable: true,
        valueClass: 'font-medium text-ink text-right break-words min-w-0'
      },
      {
        key: 'type',
        label: t('profile.fieldType'),
        value: getMemberTypeLabel(m.type),
        editable: false,
        valueClass: 'font-medium text-ink-500 text-right break-words min-w-0'
      }
    ];

    if (isPet) {
      fieldDefs.push({
        key: 'breed',
        label: t('profile.fieldBreed'),
        value: m.breed ? String(m.breed).trim() : t('common.unset'),
        isEmpty: !m.breed,
        editable: true,
        valueClass: 'font-medium text-right break-words min-w-0'
      });
    }

    fieldDefs.push({
      key: 'birth_date',
      label: t('profile.fieldBirthDate'),
      value: ageInfo ? ageInfo.displayText : t('common.unset'),
      isEmpty: !ageInfo,
      editable: true,
      valueClass: 'font-medium text-right tabular-nums whitespace-nowrap'
    });

    if (!isPet) {
      fieldDefs.push({
        key: 'height_cm',
        label: t('profile.fieldHeight'),
        value: m.height_cm ? `${m.height_cm} cm` : t('common.unset'),
        isEmpty: !m.height_cm,
        editable: true,
        valueClass: 'font-medium text-right tabular-nums whitespace-nowrap'
      });
    }

    if (isPet) {
      fieldDefs.push({
        key: 'bcs_score',
        label: t('profile.fieldBcs'),
        value: bcsMeta ? bcsMeta.compact : t('common.unrated'),
        isEmpty: !bcsMeta,
        editable: true,
        valueClass: `font-medium text-right whitespace-nowrap ${bcsMeta ? bcsMeta.colorClass : ''}`
      });
    }

    fieldDefs.push(
      {
        key: 'target_weight',
        label: t('profile.fieldTargetWeight'),
        value: isHidden
          ? (m.target_weight ? `${MASKED_WEIGHT} ${unitLabel}` : t('common.unset'))
          : (m.target_weight ? formatWeight(m.target_weight, { trimTrailingZeros: true }) : t('common.unset')),
        isEmpty: !m.target_weight,
        editable: true,
        valueClass: `font-medium text-right tabular-nums whitespace-nowrap ${isHidden && m.target_weight ? 'text-ink-400' : ''}`.trim()
      },
      {
        key: 'privacy',
        label: t('profile.fieldPrivacy'),
        value: !isPrivacyOn
          ? t('profile.privacyPublic')
          : (hasPin ? t('profile.privacyHiddenPin') : t('profile.privacyHiddenClick')),
        editable: true,
        valueClass: 'font-medium text-ink text-right break-words min-w-0'
      }
    );

    const startInlineEdit = (fieldKey) => {
      setInlineAvatarDrawer(false);
      if (fieldKey === 'privacy') {
        if (activeProfileInlineField) {
          activeProfileInlineField = null;
          renderProfileViewFields();
        }
        if (isLockedWithPin) {
          requestMemberUnlock(m, () => {
            openProfileModal(m.id, { onNavigateToChart });
            openPrivacySettingsModal(m.id);
          });
          return;
        }
        openPrivacySettingsModal(m.id);
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
      let toastMsg = t('common.updated');

      if (fieldKey === 'name') {
        const nextName = String(rawVal ?? '').trim();
        if (!nextName || nextName.length > 50) {
          showToast(t('val.nameLength'), true);
          return false;
        }
        payload = { name: nextName };
        toastMsg = t('profile.nameUpdated');
      } else if (fieldKey === 'breed') {
        const nextBreed = String(rawVal ?? '').trim();
        if (nextBreed.length > 40) {
          showToast(t('val.breedLength'), true);
          return false;
        }
        payload = { breed: nextBreed || null };
        toastMsg = t('profile.breedUpdated');
      } else if (fieldKey === 'birth_date') {
        const parsed = rawVal && typeof rawVal === 'object' && ('value' in rawVal || 'error' in rawVal)
          ? rawVal
          : parseOptionalBirthDateInput(rawVal);
        if (parsed.error) {
          showToast(parsed.error, true);
          return false;
        }
        payload = { birth_date: parsed.value };
        toastMsg = parsed.value ? t('profile.birthUpdated') : t('profile.birthCleared');
      } else if (fieldKey === 'height_cm') {
        const parsed = parseStrictNumber(rawVal, {
          required: false,
          min: 20,
          max: 300,
          label: t('memberModal.height')
        });
        if (parsed.error) {
          showToast(parsed.error, true);
          return false;
        }
        payload = { height_cm: parsed.value };
        toastMsg = t('profile.heightUpdated');
      } else if (fieldKey === 'bcs_score') {
        const parsed = parseOptionalBcsInput(rawVal);
        if (parsed.error) {
          showToast(parsed.error, true);
          return false;
        }
        payload = { bcs_score: parsed.value };
        toastMsg = parsed.value ? t('profile.bcsUpdated') : t('profile.bcsCleared');
      } else if (fieldKey === 'target_weight') {
        const parsed = parseWeightValue(rawVal, {
          required: false,
          label: t('memberModal.targetWeight', { unit: unitLabel })
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
        toastMsg = parsed.value !== null ? t('profile.targetUpdated') : t('profile.targetCleared');
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
        let birthDateInline = null;
        if (field.key === 'birth_date') {
          birthDateInline = createBirthDateInlineControl(m.birth_date, {
            onEnter: () => commitInlineField('birth_date', birthDateInline.readParsed()),
            onEscape: () => {
              activeProfileInlineField = null;
              renderProfileViewFields();
            }
          });
          controlEl = birthDateInline.el;
        } else if (field.key === 'bcs_score') {
          controlEl = document.createElement('select');
          controlEl.className = 'w-full border border-sage-500/50 rounded-xl px-2.5 py-2 text-sm bg-linen text-ink';
          getBcsOptions().forEach((optCfg) => {
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
            controlEl.placeholder = t('profile.namePlaceholder');
            controlEl.value = m.name || '';
          } else if (field.key === 'breed') {
            controlEl.type = 'text';
            controlEl.maxLength = 40;
            controlEl.placeholder = t('memberModal.breedPlaceholder');
            controlEl.value = m.breed || '';
          } else if (field.key === 'height_cm') {
            controlEl.type = 'number';
            controlEl.min = '20';
            controlEl.max = '300';
            controlEl.step = '0.1';
            controlEl.placeholder = t('profile.heightInlinePlaceholder');
            controlEl.value = m.height_cm ?? '';
          } else if (field.key === 'target_weight') {
            controlEl.type = 'text';
            controlEl.inputMode = 'decimal';
            controlEl.autocomplete = 'off';
            controlEl.placeholder = t('profile.targetInlinePlaceholder', {
              sample: unitLabel === 'lb' ? '145.0' : '65.0'
            });
            controlEl.value = targetDisplay;
            attachWeightInputGuard(controlEl);
          }
        }

        if (!birthDateInline) {
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
        }

        const btnRow = createEl('div', 'flex items-center justify-end gap-1.5');
        if (field.key === 'birth_date' && m.birth_date) {
          const clearBtn = createEl(
            'button',
            'mr-auto text-xs text-rosewood-600 hover:bg-rosewood-50 px-2.5 py-1.5 rounded-xl font-medium',
            t('common.clear')
          );
          clearBtn.type = 'button';
          clearBtn.onclick = () => commitInlineField('birth_date', '');
          btnRow.appendChild(clearBtn);
        }

        const cancelBtn = createEl(
          'button',
          'text-xs bg-oat-100 text-ink-700 px-3 py-1.5 rounded-xl font-medium',
          t('common.cancel')
        );
        cancelBtn.type = 'button';
        cancelBtn.onclick = () => {
          activeProfileInlineField = null;
          renderProfileViewFields();
        };

        const saveBtn = createEl(
          'button',
          'text-xs bg-sage-600 text-linen px-3.5 py-1.5 rounded-xl font-medium',
          t('common.save')
        );
        saveBtn.type = 'button';
        saveBtn.onclick = () =>
          commitInlineField(field.key, birthDateInline ? birthDateInline.readParsed() : controlEl.value);

        btnRow.append(cancelBtn, saveBtn);
        editRow.append(labelRow, controlEl, btnRow);

        if (field.key === 'birth_date' && birthDateInline?.yearInput) {
          queueMicrotask(() => birthDateInline.yearInput.focus());
        } else if (field.key !== 'bcs_score') {
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
      rowBtn.setAttribute('aria-label', t('profile.editFieldAria', { label: field.label }));

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
  document.getElementById('prof-title').textContent = m.name || t('profile.titleFallback');

  const subtitleParts = [getMemberTypeLabel(m.type)];
  if (isPet && m.breed) subtitleParts.push(String(m.breed).trim());
  if (isPet && ageInfo?.lifeStage) {
    subtitleParts.push(ageInfo.lifeStage);
  } else if (!isPet && ageInfo?.shortText) {
    subtitleParts.push(ageInfo.shortText);
  }
  document.getElementById('prof-subtitle').textContent =
    subtitleParts.length > 1 ? subtitleParts.join(' · ') : t('profile.fileSubtitle', { type: subtitleParts[0] });

  // 頂部快速解鎖／隱藏按鈕
  const toggleBtn = document.getElementById('btn-prof-privacy-toggle');
  if (isPrivacyOn) {
    toggleBtn.classList.remove('hidden');
    toggleBtn.replaceChildren(
      createIcon(isHidden ? (hasPin ? 'lock' : 'eye') : 'eyeOff', 'w-3.5 h-3.5 shrink-0'),
      createEl('span', '', isHidden ? t('profile.viewToggleShow') : t('profile.viewToggleHide'))
    );
    toggleBtn.onclick = () => {
      if (isHidden) {
        requestMemberUnlock(m, () => openProfileModal(m.id, { onNavigateToChart }));
      } else {
        lockMember(m.id);
        showToast(t('privacy.relockedToast'));
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
      document.getElementById('prof-target').value = targetDisplay;
      syncPrivacyFormUI('prof', m);
    });
  };

  let metricLabel = t('profile.targetGap');
  let metricVal = '--';
  let metricColor = 'text-sage-700';
  const bmiRes = !isPet && latest && m.height_cm ? calculateBmi(latest.weight_kg, m.height_cm) : null;
  const goalProgress = calculateGoalProgress(recs, m.target_weight);
  if (isPet) {
    if (bcsMeta) {
      metricLabel = t('overview.bcs');
      metricVal = bcsMeta.compact;
      metricColor = bcsMeta.colorClass;
    } else if (weeklyPct) {
      metricLabel = t('overview.weeklyChange');
      metricVal = weeklyPct.signedText;
      metricColor = weeklyPct.isAlert
        ? 'text-rosewood-600'
        : weeklyPct.pct > 0
          ? 'text-ochre-600'
          : weeklyPct.pct < 0
            ? 'text-sage-700'
            : 'text-ink-700';
    } else if (isHidden) {
      metricLabel = t('overview.goalProgress');
      metricVal = goalProgress ? (goalProgress.isAchieved ? t('overview.achieved') : `${goalProgress.percent}%`) : '--';
    } else if (latest && m.target_weight) {
      const gapNum = Number((Number(latest.weight_kg) - Number(m.target_weight)).toFixed(2));
      metricVal = formatWeightDelta(gapNum);
    }
  } else if (isHidden) {
    if (bmiRes) {
      metricLabel = t('profile.bodyStatus');
      metricVal = bmiRes.status;
    } else if (goalProgress) {
      metricLabel = t('overview.goalProgress');
      metricVal = goalProgress.isAchieved ? t('overview.achieved') : `${goalProgress.percent}%`;
    } else {
      metricLabel = t('overview.goalProgress');
      metricVal = '--';
    }
  } else if (bmiRes) {
    metricLabel = t('overview.bmi');
    metricVal = bmiRes.bmi.toFixed(1);
  } else if (latest && m.target_weight) {
    const gapNum = Number((Number(latest.weight_kg) - Number(m.target_weight)).toFixed(2));
    metricVal = formatWeightDelta(gapNum);
  }

  const summary = document.getElementById('prof-summary');
  const col1 = createEl('div');
  col1.append(
    createEl('div', 'text-xs text-ink-400', t('profile.latestWeight')),
    createEl(
      'div',
      `font-semibold text-base tabular-nums mt-0.5 ${isHidden ? 'text-ink-400' : 'text-ink'}`,
      latest
        ? (isHidden ? `${MASKED_WEIGHT} ${unitLabel}` : formatWeight(latest.weight_kg, { trimTrailingZeros: true }))
        : '--'
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
  const pinConfirmInput = document.getElementById(`${prefix}-pin-confirm`);
  const clearCheckbox = document.getElementById(`${prefix}-clear-pin`);

  hideCheckbox.onchange = () => {
    pinWrap.classList.toggle('hidden', !hideCheckbox.checked);
    if (!hideCheckbox.checked) {
      pinInput.value = '';
      if (pinConfirmInput) {
        pinConfirmInput.value = '';
        pinConfirmInput.disabled = false;
      }
      clearCheckbox.checked = false;
      pinInput.disabled = false;
    }
    syncPrivacyPinConfirmState(prefix);
  };

  clearCheckbox.onchange = () => {
    const clearing = clearCheckbox.checked;
    pinInput.disabled = clearing;
    if (pinConfirmInput) pinConfirmInput.disabled = clearing;
    if (clearing) {
      pinInput.value = '';
      if (pinConfirmInput) pinConfirmInput.value = '';
    }
    syncPrivacyPinConfirmState(prefix);
  };

  // 僅保留數字鍵入並即時更新二次輸入比對狀態
  pinInput.oninput = () => {
    pinInput.value = sanitizePinInputValue(pinInput.value);
    syncPrivacyPinConfirmState(prefix);
  };

  if (pinConfirmInput) {
    pinConfirmInput.oninput = () => {
      pinConfirmInput.value = sanitizePinInputValue(pinConfirmInput.value);
      syncPrivacyPinConfirmState(prefix);
    };
  }
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
  const rawPinConfirm = document.getElementById(`${prefix}-pin-confirm`)?.value.trim() ?? '';
  const clearPin = document.getElementById(`${prefix}-clear-pin`).checked;

  let validatedPin = null;
  if (hideWeight && !clearPin) {
    const pinCheck = validatePinConfirmation(rawPin, rawPinConfirm);
    if (pinCheck.error) {
      return { error: pinCheck.error, focusField: pinCheck.focusField };
    }
    validatedPin = pinCheck.pin;
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
  } else if (validatedPin) {
    result.privacy_pin = validatedPin;
  }

  if (existingMember && memberHasPrivacyPin(existingMember)) {
    const currentPin = getUnlockedPin(existingMember.id);
    if (currentPin) result.current_pin = currentPin;
  }

  return result;
}

export function openPrivacySettingsModal(memberId) {
  const m = state.appData.members.find((x) => x.id === memberId);
  if (!m) return;

  const isLockedWithPin = memberHasPrivacyPin(m) && !isMemberUnlocked(m.id);
  document.getElementById('priv-member-id').value = m.id;
  document.getElementById('priv-modal-subtitle').textContent = m.name
    ? t('privacy.modalSubtitleMember', { name: m.name })
    : t('privacy.modalSubtitle');
  syncPrivacyFormUI('priv', m);
  document.getElementById('btn-priv-submit')?.classList.toggle('hidden', isLockedWithPin);

  document.getElementById('btn-priv-unlock').onclick = () => {
    requestMemberUnlock(m, () => {
      syncPrivacyFormUI('priv', m);
      document.getElementById('btn-priv-submit')?.classList.remove('hidden');
      if (activeProfileContext?.memberId === m.id && isModalOpen('modal-profile')) {
        openProfileModal(m.id, { onNavigateToChart: activeProfileContext.onNavigateToChart });
      }
    });
  };

  openModal('modal-privacy');
}

const MODAL_BACK_STACK = ['modal-pin', 'modal-privacy', 'modal-record', 'modal-member', 'modal-profile'];

function clearProfileModalState() {
  activeProfileContext = null;
  activeProfileInlineField = null;
  setInlineAvatarDrawer(false);
}

export function hasOpenModal() {
  return MODAL_BACK_STACK.some((id) => isModalOpen(id));
}

// 統一返回動作（供手機左／右滑返回、Android 系統返回鍵與 Esc 鍵共用）
export function handleModalBackAction() {
  for (const id of MODAL_BACK_STACK) {
    if (!isModalOpen(id)) continue;

    if (id === 'modal-profile') {
      if (isInlineAvatarDrawerOpen) {
        setInlineAvatarDrawer(false);
        return true;
      }
      if (activeProfileInlineField && activeProfileContext) {
        activeProfileInlineField = null;
        openProfileModal(activeProfileContext.memberId, {
          onNavigateToChart: activeProfileContext.onNavigateToChart
        });
        return true;
      }
      const editFields = document.getElementById('prof-edit-fields');
      if (editFields && !editFields.classList.contains('hidden')) {
        // 完整編輯模式先退回個人資訊檢視模式
        document.getElementById('btn-prof-cancel-edit')?.click?.();
        return true;
      }
      clearProfileModalState();
    }

    closeModal(id);
    if (id === 'modal-pin') activePinRequest = null;
    return true;
  }
  return false;
}

export function initModals() {
  // 關閉按鈕
  document.querySelectorAll('.btn-close-modal').forEach((btn) => {
    btn.onclick = () => {
      const modal = btn.closest('.fixed');
      closeModal(modal);
      if (modal.id === 'modal-profile') clearProfileModalState();
    };
  });

  // 點擊彈窗外部（深色背景）即可平滑關閉
  ['modal-record', 'modal-member', 'modal-profile', 'modal-privacy', 'modal-pin'].forEach((id) => {
    const modal = document.getElementById(id);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        closeModal(modal);
        if (id === 'modal-profile') clearProfileModalState();
        if (id === 'modal-pin') activePinRequest = null;
      }
    });
  });

  // 支援 Esc 鍵：沿用統一返回邏輯逐層收合彈窗／原地編輯／頭像抽屜
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    handleModalBackAction();
  });

  // PIN 解鎖彈窗操作
  const pinInput = document.getElementById('input-pin-verify');
  pinInput.oninput = () => {
    pinInput.value = sanitizePinInputValue(pinInput.value);
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
      errEl.textContent = t('pinModal.errFormat');
      errEl.classList.remove('hidden');
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = t('pinModal.verifying');

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
        errEl.textContent = t('pinModal.errIncorrect');
        errEl.classList.remove('hidden');
        pinInput.value = '';
        pinInput.focus();
        return;
      }

      closeModal('modal-pin');
      activePinRequest = null;
      unlockMember(member.id, pin);
      showToast(t('privacy.pinUnlockedToast'));
      if (onUnlocked) onUnlocked();
    } catch (err) {
      errEl.textContent = err.message || t('pinModal.errFailed');
      errEl.classList.remove('hidden');
      pinInput.value = '';
      pinInput.focus();
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = t('pinModal.submit');
    }
  };

  bindPrivacyControlEvents('mem');
  bindPrivacyControlEvents('prof');
  bindPrivacyControlEvents('priv');

  // 獨立體重隱私設定彈窗：取消與儲存（不切換至個人資訊完整編輯面板）
  document.getElementById('btn-priv-cancel').onclick = () => {
    closeModal('modal-privacy');
  };

  document.getElementById('form-privacy').onsubmit = (e) => {
    e.preventDefault();
    const id = document.getElementById('priv-member-id').value.trim();
    if (!isValidResourceId(id)) return showToast(t('val.invalidMemberId'), true);
    const member = state.appData.members.find((x) => x.id === id);
    if (!member) return showToast(t('val.memberNotFound'), true);

    const privacyData = extractPrivacySubmitPayload('priv', member);
    if (privacyData.locked) {
      syncPrivacyFormUI('priv', member);
      document.getElementById('btn-priv-submit')?.classList.add('hidden');
      return showToast(t('privacy.sessionExpired'), true);
    }
    if (privacyData.error) {
      showPrivacyPinSubmitError('priv', privacyData.error, privacyData.focusField);
      return showToast(privacyData.error, true);
    }

    const updatePayload = {
      hide_weight: privacyData.hide_weight
    };
    if (privacyData.privacy_pin !== undefined) updatePayload.privacy_pin = privacyData.privacy_pin;
    if (privacyData.current_pin) updatePayload.current_pin = privacyData.current_pin;

    closeModal('modal-privacy');
    optimisticUpdateMember(id, updatePayload);

    if (!updatePayload.hide_weight) {
      showToast(t('privacy.disabledToast'));
    } else if (updatePayload.privacy_pin) {
      showToast(t('privacy.savedWithPinToast'));
    } else if (updatePayload.privacy_pin === null) {
      showToast(t('privacy.clearedPinToast'));
    } else {
      showToast(t('privacy.updatedToast'));
    }

    if (activeProfileContext?.memberId === id && isModalOpen('modal-profile')) {
      openProfileModal(id, { onNavigateToChart: activeProfileContext.onNavigateToChart });
    }
  };

  // 記錄體重彈窗：批量／單筆模式切換、單筆成員遮蔽輸入與可視切換、全站體重即時防呆
  document.getElementById('btn-rec-mode-batch').onclick = () => setRecordModalMode('batch', true);
  document.getElementById('btn-rec-mode-single').onclick = () => setRecordModalMode('single', true);
  document.getElementById('rec-member').onchange = () => {
    updateSingleWeightInputMask({ resetReveal: true });
    syncSinglePetCalcUI({ reset: true });
  };
  const singleVisBtn = document.getElementById('btn-rec-weight-visibility');
  if (singleVisBtn) {
    singleVisBtn.onclick = () => {
      singleWeightRevealed = !singleWeightRevealed;
      updateSingleWeightInputMask();
    };
  }
  const recPetCalcToggle = document.getElementById('btn-rec-pet-calc-toggle');
  if (recPetCalcToggle) {
    recPetCalcToggle.onclick = () => {
      singlePetCalcExpanded = !singlePetCalcExpanded;
      syncSinglePetCalcUI({ reset: false, animate: true });
    };
  }
  const recPetWithInput = document.getElementById('rec-pet-with-weight');
  const recPetOwnerInput = document.getElementById('rec-pet-owner-weight');
  const recPetFeedback = document.getElementById('rec-pet-calc-feedback');
  const recWeightInput = document.getElementById('rec-weight');
  if (recPetWithInput && recPetOwnerInput) {
    attachWeightInputGuard(recPetWithInput);
    attachWeightInputGuard(recPetOwnerInput);
    const recalcSinglePet = () =>
      applyPetHoldCalculation({
        withInput: recPetWithInput,
        ownerInput: recPetOwnerInput,
        targetInput: recWeightInput,
        feedbackEl: recPetFeedback
      });
    recPetWithInput.addEventListener('input', recalcSinglePet);
    recPetOwnerInput.addEventListener('input', recalcSinglePet);
  }
  attachWeightInputGuard(recWeightInput);
  attachWeightInputGuard(document.getElementById('mem-target'));
  attachWeightInputGuard(document.getElementById('prof-target'));
  wireBirthDateInputs(
    document.getElementById('mem-birth-year'),
    document.getElementById('mem-birth-month'),
    document.getElementById('mem-birth-day')
  );
  wireBirthDateInputs(
    document.getElementById('prof-birth-year'),
    document.getElementById('prof-birth-month'),
    document.getElementById('prof-birth-day')
  );

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

  const getLatestWeightForMember = (memberId) => {
    const recs = state.appData.records.filter((r) => r.member_id === memberId);
    return recs.length > 0 ? recs[recs.length - 1].weight_kg : null;
  };

  // 表單送出：支援批量與單筆樂觀新增體重（含前端格式／範圍防呆與異常值確認）
  document.getElementById('form-record').onsubmit = (e) => {
    e.preventDefault();
    const unitLabel = getWeightUnitLabel();

    if (recordModalMode === 'batch') {
      const batchDate = document.getElementById('batch-date').value.trim();
      if (!isValidRecordedDate(batchDate)) return showToast(t('record.errInvalidDate'), true);

      const inputs = Array.from(document.querySelectorAll('#batch-member-rows .batch-weight-input'));
      const toSubmit = [];

      for (const input of inputs) {
        const raw = input.value.trim();
        if (raw === '') {
          setWeightInputErrorState(input, false);
          continue; // 未填寫者自動略過
        }
        const memberId = input.dataset.memberId || '';
        const memberName = input.dataset.memberName || t('memberType.human');
        if (!isValidResourceId(memberId)) return showToast(t('val.invalidMemberId'), true);

        const parsed = parseWeightValue(raw, {
          required: true,
          label: `${memberName} ${t('record.weightLabel', { unit: unitLabel })}`
        });
        if (parsed.error) {
          setWeightInputErrorState(input, true);
          input.focus();
          return showToast(parsed.error, true);
        }
        setWeightInputErrorState(input, false);

        const member = state.appData.members.find((m) => m.id === memberId);
        const warning = checkWeightAnomaly({
          member,
          weightKg: parsed.value,
          latestWeightKg: getLatestWeightForMember(memberId),
          isHidden: isMemberWeightHidden(member)
        });
        if (warning && !confirm(warning)) {
          input.focus();
          return;
        }

        toSubmit.push({
          member_id: memberId,
          weight_kg: parsed.value,
          recorded_at: batchDate,
          note: ''
        });
      }

      if (toSubmit.length === 0) {
        return showToast(t('record.errNoBatchEntries'), true);
      }

      closeModal('modal-record');
      e.target.reset();
      toSubmit.forEach((payload) => optimisticAddRecord(payload));
      showToast(t('record.savedBatch', { count: toSubmit.length }));
      return;
    }

    // 單筆模式
    const memberId = document.getElementById('rec-member').value.trim();
    const weightInput = document.getElementById('rec-weight');
    const weightParsed = parseWeightValue(weightInput.value, {
      required: true,
      label: t('record.weightLabel', { unit: unitLabel })
    });
    const recordedAt = document.getElementById('rec-date').value.trim();
    const note = document.getElementById('rec-note').value.trim();

    if (!isValidResourceId(memberId)) return showToast(t('record.errMember'), true);
    if (weightParsed.error) {
      setWeightInputErrorState(weightInput, true);
      weightInput.focus();
      return showToast(weightParsed.error, true);
    }
    setWeightInputErrorState(weightInput, false);
    if (!isValidRecordedDate(recordedAt)) return showToast(t('record.errInvalidDate'), true);
    if (note.length > 200) return showToast(t('record.errNoteLength'), true);

    const member = state.appData.members.find((m) => m.id === memberId);
    const warning = checkWeightAnomaly({
      member,
      weightKg: weightParsed.value,
      latestWeightKg: getLatestWeightForMember(memberId),
      isHidden: isMemberWeightHidden(member)
    });
    if (warning && !confirm(warning)) {
      weightInput.focus();
      return;
    }

    singleWeightRevealed = false;
    closeModal('modal-record');
    e.target.reset();
    optimisticAddRecord({
      member_id: memberId,
      weight_kg: weightParsed.value,
      recorded_at: recordedAt,
      note
    });
    showToast(t('record.savedSingle'));
  };

  // 表單送出：樂觀新增或編輯成員（含自訂頭像、品種、生日、BCS 與隱私設定）
  document.getElementById('form-member').onsubmit = (e) => {
    e.preventDefault();
    const unitLabel = getWeightUnitLabel();
    const editId = document.getElementById('mem-id').value.trim();
    const existingMember = editId ? state.appData.members.find((x) => x.id === editId) : null;
    const name = document.getElementById('mem-name').value.trim();
    const type = document.getElementById('mem-type').value;
    const rawAvatar = document.getElementById('mem-avatar').value.trim();
    const avatar = isValidAvatarId(rawAvatar) ? rawAvatar : getDefaultAvatarForType(type);
    const isPet = isPetType(type);
    const rawBreed = isPet ? document.getElementById('mem-breed').value.trim() : '';
    const breed = isPet ? (rawBreed || null) : null;
    const birthParsed = readBirthDateGroup('mem');
    const bcsParsed = isPet ? parseOptionalBcsInput(document.getElementById('mem-bcs').value) : { value: null };
    const heightParsed = isPet
      ? { value: null }
      : parseStrictNumber(document.getElementById('mem-height').value, {
          required: false,
          min: 20,
          max: 300,
          label: t('memberModal.height')
        });

    const privacyData = extractPrivacySubmitPayload('mem', existingMember);
    if (privacyData.error) {
      showPrivacyPinSubmitError('mem', privacyData.error, privacyData.focusField);
      return showToast(privacyData.error, true);
    }

    const memTargetInput = document.getElementById('mem-target');
    const targetParsed = privacyData.locked
      ? { value: undefined }
      : parseWeightValue(memTargetInput.value, {
          required: false,
          label: t('memberModal.targetWeight', { unit: unitLabel })
        });

    if (!name || name.length > 50) return showToast(t('val.nameLength'), true);
    if (!VALID_MEMBER_TYPES.has(type)) return showToast(t('val.memberTypeInvalid'), true);
    if (rawBreed.length > 40) return showToast(t('val.breedLength'), true);
    if (birthParsed.error) return showToast(birthParsed.error, true);
    if (bcsParsed.error) return showToast(bcsParsed.error, true);
    if (heightParsed.error) return showToast(heightParsed.error, true);
    if (targetParsed.error) {
      setWeightInputErrorState(memTargetInput, true);
      memTargetInput.focus();
      return showToast(targetParsed.error, true);
    }
    setWeightInputErrorState(memTargetInput, false);

    if (editId) {
      if (!isValidResourceId(editId)) return showToast(t('val.invalidMemberId'), true);
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
      showToast(t('memberModal.updated'));
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
      showToast(t('memberModal.added'));
    }
  };

  // 表單送出：樂觀更新個人資訊（含名稱、頭像、品種、生日、BCS、隱私設定、身高、目標體重）
  document.getElementById('form-profile').onsubmit = (e) => {
    e.preventDefault();
    const unitLabel = getWeightUnitLabel();
    const id = document.getElementById('prof-id').value.trim();
    const member = state.appData.members.find((x) => x.id === id);
    const isPet = isPetType(member?.type);
    const name = document.getElementById('prof-name').value.trim();
    const rawAvatar = document.getElementById('prof-avatar').value.trim();
    const avatar = isValidAvatarId(rawAvatar) ? rawAvatar : resolveMemberAvatar(member);
    const rawBreed = isPet ? document.getElementById('prof-breed').value.trim() : '';
    const breed = isPet ? (rawBreed || null) : null;
    const birthParsed = readBirthDateGroup('prof');
    const bcsParsed = isPet ? parseOptionalBcsInput(document.getElementById('prof-bcs').value) : { value: null };
    const heightParsed = isPet
      ? { value: null }
      : parseStrictNumber(document.getElementById('prof-height').value, {
          required: false,
          min: 20,
          max: 300,
          label: t('memberModal.height')
        });

    const privacyData = extractPrivacySubmitPayload('prof', member);
    if (privacyData.error) {
      showPrivacyPinSubmitError('prof', privacyData.error, privacyData.focusField);
      return showToast(privacyData.error, true);
    }

    const profTargetInput = document.getElementById('prof-target');
    const targetParsed = privacyData.locked
      ? { value: undefined }
      : parseWeightValue(profTargetInput.value, {
          required: false,
          label: t('memberModal.targetWeight', { unit: unitLabel })
        });

    if (!isValidResourceId(id)) return showToast(t('val.invalidMemberId'), true);
    if (!name || name.length > 50) return showToast(t('val.nameLength'), true);
    if (rawBreed.length > 40) return showToast(t('val.breedLength'), true);
    if (birthParsed.error) return showToast(birthParsed.error, true);
    if (bcsParsed.error) return showToast(bcsParsed.error, true);
    if (heightParsed.error) return showToast(heightParsed.error, true);
    if (targetParsed.error) {
      setWeightInputErrorState(profTargetInput, true);
      profTargetInput.focus();
      return showToast(targetParsed.error, true);
    }
    setWeightInputErrorState(profTargetInput, false);

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
    showToast(t('profile.updated'));
  };
}
