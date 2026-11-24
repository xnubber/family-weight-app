import { state } from '../state.js';
import {
  optimisticAddMember,
  optimisticUpdateMember,
  optimisticAddRecord
} from '../services/syncQueue.js';
import { createEl, showToast } from '../utils/dom.js';
import { createIcon } from '../utils/icons.js';
import {
  createAvatarNode,
  getDefaultAvatarForType,
  isValidAvatarId,
  renderAvatarPicker,
  resolveMemberAvatar
} from '../utils/avatars.js';
import {
  calculateBmi,
  calculateHealthyWeightRange,
  calculatePetCalories,
  getLocalTodayDate
} from '../utils/metrics.js';
import { isValidResourceId, isValidRecordedDate, parseStrictNumber } from '../utils/validation.js';

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

let recordModalMode = 'batch'; // 'batch' | 'single'
let hasProfileHealthCard = false;
let memberAvatarManuallyPicked = false;

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

function getSavedPetFactor(memberId, type) {
  const factors = getPetFactors(type);
  const defaultFactor = type === 'dog' ? '1.6' : '1.2';
  const saved =
    localStorage.getItem(`petFactor:${memberId}`) ||
    (type === 'cat' ? localStorage.getItem(`catFactor:${memberId}`) : null);
  return factors.some((f) => f.value === saved) ? saved : defaultFactor;
}

function setRecordModalMode(mode) {
  recordModalMode = mode === 'single' ? 'single' : 'batch';
  const isBatch = recordModalMode === 'batch';

  document.getElementById('rec-batch-fields').classList.toggle('hidden', !isBatch);
  document.getElementById('rec-single-fields').classList.toggle('hidden', isBatch);

  const batchBtn = document.getElementById('btn-rec-mode-batch');
  const singleBtn = document.getElementById('btn-rec-mode-single');
  batchBtn.className = isBatch
    ? 'inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-linen text-sage-700 shadow-sm'
    : 'inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-ink-500';
  singleBtn.className = !isBatch
    ? 'inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-linen text-sage-700 shadow-sm'
    : 'inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-ink-500';

  document.getElementById('btn-rec-submit').textContent = isBatch ? '一次儲存' : '儲存';
}

function renderBatchMemberRows() {
  const container = document.getElementById('batch-member-rows');
  const rows = state.appData.members.map((m) => {
    const recs = state.appData.records.filter((r) => r.member_id === m.id);
    const latest = recs[recs.length - 1];

    const row = createEl('div', 'py-2.5 flex items-center justify-between gap-3');
    const leftGroup = createEl('div', 'flex items-center gap-2.5 min-w-0 flex-1');
    const labelWrap = createEl('div', 'min-w-0 flex-1');
    labelWrap.append(
      createEl('div', 'font-medium text-sm text-ink truncate', String(m.name ?? '')),
      createEl(
        'div',
        'text-[11px] text-ink-400 tabular-nums',
        latest ? `上次 ${latest.weight_kg} kg（${latest.recorded_at}）` : '尚未有紀錄'
      )
    );
    leftGroup.append(createAvatarNode(resolveMemberAvatar(m), 'w-8 h-8'), labelWrap);

    const inputWrap = createEl('div', 'flex items-center gap-1.5 shrink-0');
    const input = document.createElement('input');
    input.type = 'number';
    input.min = '0.1';
    input.max = '500';
    input.step = '0.01';
    input.placeholder = latest ? String(latest.weight_kg) : '體重';
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
  document.getElementById('modal-record').classList.remove('hidden');

  if (mode === 'single') {
    document.getElementById('rec-weight').focus();
  } else {
    document.querySelector('#batch-member-rows .batch-weight-input')?.focus();
  }
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

// 開啟新增／編輯成員彈窗（傳入 member 物件則進入編輯模式，支援修改名稱、頭像、身高與目標體重）
export function openMemberModal(member = null) {
  const form = document.getElementById('form-member');
  const titleEl = document.getElementById('mem-modal-title');
  const submitBtn = document.getElementById('btn-mem-submit');
  const idInput = document.getElementById('mem-id');
  const nameInput = document.getElementById('mem-name');
  const typeSelect = document.getElementById('mem-type');
  const heightWrap = document.getElementById('mem-height-wrap');
  const heightInput = document.getElementById('mem-height');
  const targetInput = document.getElementById('mem-target');

  form.reset();

  if (member) {
    const isPet = isPetType(member.type);
    memberAvatarManuallyPicked = true;
    titleEl.textContent = '編輯成員';
    submitBtn.textContent = '儲存修改';
    idInput.value = member.id;
    nameInput.value = member.name || '';
    typeSelect.value = VALID_MEMBER_TYPES.has(member.type) ? member.type : 'human';
    typeSelect.disabled = true;
    heightWrap.classList.toggle('hidden', isPet);
    heightInput.value = isPet ? '' : (member.height_cm ?? '');
    targetInput.value = member.target_weight ?? '';
    setMemberModalAvatar(resolveMemberAvatar(member));
  } else {
    memberAvatarManuallyPicked = false;
    titleEl.textContent = '新增成員';
    submitBtn.textContent = '新增';
    idInput.value = '';
    typeSelect.value = 'human';
    typeSelect.disabled = false;
    heightWrap.classList.remove('hidden');
    setMemberModalAvatar(getDefaultAvatarForType('human'));
  }

  document.getElementById('modal-member').classList.remove('hidden');
  nameInput.focus();
}

// 繪製個人資訊面板中的「自動健康指標卡」（家人 BMI / 區間、貓咪與狗狗 RER / DER）
function renderProfileHealthCard(member, latest) {
  const card = document.getElementById('prof-health-card');
  const isHuman = member.type === 'human';

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

    const header = createEl('div', 'flex justify-between items-center gap-2');
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
      header.appendChild(
        createEl('span', `text-xs font-medium px-2 py-0.5 rounded-full tabular-nums ${badgeClass}`, `BMI ${bmiRes.bmi.toFixed(1)} · ${bmiRes.status}`)
      );
    }

    const children = [header];
    if (range) {
      const row = createEl('div', 'flex justify-between items-center text-xs text-ink-500');
      row.append(
        createEl('span', '', '建議健康體重區間（BMI 18.5–24）'),
        createEl('strong', 'text-ink font-semibold tabular-nums', `${range.minKg}–${range.maxKg} kg`)
      );
      children.push(row);
    }

    card.replaceChildren(...children);
    return;
  }

  // 貓咪／狗狗自動每日熱量建議（RER / DER）
  if (!latest) {
    hasProfileHealthCard = false;
    card.classList.add('hidden');
    card.replaceChildren();
    return;
  }

  const isDog = member.type === 'dog';
  const factors = getPetFactors(member.type);
  hasProfileHealthCard = true;
  card.className = isDog
    ? 'rounded-2xl p-3.5 text-sm space-y-2.5 border bg-ochre-50/80 border-ochre-200'
    : 'rounded-2xl p-3.5 text-sm space-y-2.5 border bg-clay-50/80 border-clay-200';

  const header = createEl('div', 'flex justify-between items-center gap-2');
  const titleWrap = createEl(
    'span',
    `font-medium text-xs shrink-0 inline-flex items-center gap-1.5 ${isDog ? 'text-ochre-700' : 'text-clay-700'}`
  );
  titleWrap.append(
    createIcon('paw', 'w-3.5 h-3.5 shrink-0'),
    createEl('span', '', isDog ? '狗狗每日熱量建議' : '貓咪每日熱量建議')
  );
  header.appendChild(titleWrap);

  const factorSelect = document.createElement('select');
  factorSelect.className = `border rounded-lg px-2 py-1 text-xs bg-linen text-ink-700 ${isDog ? 'border-ochre-200' : 'border-clay-200'}`;
  factors.forEach((optCfg) => {
    const opt = document.createElement('option');
    opt.value = optCfg.value;
    opt.textContent = optCfg.label;
    factorSelect.appendChild(opt);
  });
  factorSelect.value = getSavedPetFactor(member.id, member.type);

  const resultGrid = createEl('div', 'grid grid-cols-2 gap-2 bg-linen/90 border border-oat-200/70 rounded-xl p-2.5 text-center');
  const renderPetResult = () => {
    const res = calculatePetCalories(latest.weight_kg, factorSelect.value);
    if (!res) return;
    const colRer = createEl('div');
    colRer.append(
      createEl('div', 'text-[11px] text-ink-400', '基礎代謝 RER'),
      createEl('div', 'font-semibold text-ink tabular-nums', `${res.rer} kcal`)
    );
    const colDer = createEl('div');
    colDer.append(
      createEl('div', 'text-[11px] text-ink-400', '每日建議攝取 DER'),
      createEl('div', `font-semibold tabular-nums ${isDog ? 'text-ochre-700' : 'text-clay-700'}`, `${res.der} kcal`)
    );
    resultGrid.replaceChildren(colRer, colDer);
  };

  factorSelect.onchange = () => {
    localStorage.setItem(`petFactor:${member.id}`, factorSelect.value);
    renderPetResult();
  };

  header.appendChild(factorSelect);
  renderPetResult();
  card.replaceChildren(header, resultGrid);
}

function setProfileEditMode(isEditing) {
  document.getElementById('prof-view-fields').classList.toggle('hidden', isEditing);
  document.getElementById('prof-view-actions').classList.toggle('hidden', isEditing);
  document.getElementById('btn-prof-add-record').classList.toggle('hidden', isEditing);
  document.getElementById('prof-health-card').classList.toggle('hidden', isEditing || !hasProfileHealthCard);
  document.getElementById('prof-edit-fields').classList.toggle('hidden', !isEditing);
  document.getElementById('prof-edit-actions').classList.toggle('hidden', !isEditing);

  if (isEditing) {
    document.getElementById('prof-name').focus();
  }
}

export function openProfileModal(memberId, { onNavigateToChart }) {
  const m = state.appData.members.find((x) => x.id === memberId);
  if (!m) return;
  const recs = state.appData.records.filter((r) => r.member_id === m.id);
  const latest = recs[recs.length - 1];
  const isPet = isPetType(m.type);
  const initialAvatar = resolveMemberAvatar(m);

  const renderProfileAvatarPreview = (avatarId) => {
    const slot = document.getElementById('prof-avatar-slot');
    if (slot) {
      slot.replaceChildren(createAvatarNode(avatarId, 'w-11 h-11'));
    }
  };

  const fillEditInputs = () => {
    document.getElementById('prof-name').value = m.name || '';
    document.getElementById('prof-height').value = isPet ? '' : (m.height_cm ?? '');
    document.getElementById('prof-target').value = m.target_weight ?? '';
    document.getElementById('prof-avatar').value = initialAvatar;
    renderProfileAvatarPreview(initialAvatar);
    renderAvatarPicker(document.getElementById('prof-avatar-picker'), initialAvatar, (picked) => {
      document.getElementById('prof-avatar').value = picked;
      renderProfileAvatarPreview(picked);
    });
  };

  document.getElementById('prof-id').value = m.id;
  document.getElementById('prof-title').textContent = m.name || '個人資訊';
  document.getElementById('prof-subtitle').textContent = `${getMemberTypeLabel(m.type)}檔案`;

  // 檢視模式文字
  document.getElementById('prof-view-name').textContent = m.name || '--';
  document.getElementById('prof-view-type').textContent = getMemberTypeLabel(m.type);
  document.getElementById('prof-view-height-row').classList.toggle('hidden', isPet);
  document.getElementById('prof-view-height').textContent = m.height_cm ? `${m.height_cm} cm` : '未設定';
  document.getElementById('prof-view-target').textContent = m.target_weight ? `${m.target_weight} kg` : '未設定';

  // 自動健康指標卡（家人 BMI / 健康區間、貓咪與狗狗 RER / DER）
  renderProfileHealthCard(m, latest);

  // 編輯模式欄位初始值
  document.getElementById('prof-height-wrap').classList.toggle('hidden', isPet);
  fillEditInputs();
  setProfileEditMode(false);

  let metricLabel = '目標差距';
  let metricVal = '--';
  const bmiRes = !isPet && latest && m.height_cm ? calculateBmi(latest.weight_kg, m.height_cm) : null;
  if (bmiRes) {
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
    createEl('div', 'font-semibold text-base text-ink tabular-nums mt-0.5', latest ? `${latest.weight_kg} kg` : '--')
  );
  const col2 = createEl('div');
  col2.append(
    createEl('div', 'text-xs text-ink-400', metricLabel),
    createEl('div', 'font-semibold text-base text-sage-700 tabular-nums mt-0.5', metricVal)
  );
  summary.replaceChildren(col1, col2);

  document.getElementById('btn-prof-to-chart').onclick = () => {
    state.selectedMemberId = m.id;
    state.historyPage = 1;
    document.getElementById('modal-profile').classList.add('hidden');
    onNavigateToChart();
  };

  // 從個人資訊面板直接為該成員開啟「單筆紀錄」模式（可填寫備註）
  document.getElementById('btn-prof-add-record').onclick = () => {
    document.getElementById('modal-profile').classList.add('hidden');
    openRecordModal(m.id, 'single');
  };

  // 切換至編輯模式／取消編輯還原原值
  document.getElementById('btn-prof-edit').onclick = () => setProfileEditMode(true);
  document.getElementById('btn-prof-cancel-edit').onclick = () => {
    fillEditInputs();
    setProfileEditMode(false);
  };

  document.getElementById('modal-profile').classList.remove('hidden');
}

export function initModals() {
  // 關閉按鈕
  document.querySelectorAll('.btn-close-modal').forEach((btn) => {
    btn.onclick = () => btn.closest('.fixed').classList.add('hidden');
  });

  // 點擊彈窗外部（深色背景）即可關閉
  ['modal-record', 'modal-member', 'modal-profile'].forEach((id) => {
    const modal = document.getElementById(id);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.classList.add('hidden');
      }
    });
  });

  // 記錄體重彈窗：批量／單筆模式切換
  document.getElementById('btn-rec-mode-batch').onclick = () => setRecordModalMode('batch');
  document.getElementById('btn-rec-mode-single').onclick = () => setRecordModalMode('single');

  // 切換成員類型時自動隱藏／顯示身高欄位，並在未手動挑頭像時貼心帶入對應風格頭像
  document.getElementById('mem-type').onchange = (e) => {
    const nextType = e.target.value;
    const isPet = isPetType(nextType);
    document.getElementById('mem-height-wrap').classList.toggle('hidden', isPet);
    if (isPet) document.getElementById('mem-height').value = '';
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

      document.getElementById('modal-record').classList.add('hidden');
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

    document.getElementById('modal-record').classList.add('hidden');
    e.target.reset();
    optimisticAddRecord({
      member_id: memberId,
      weight_kg: weightParsed.value,
      recorded_at: recordedAt,
      note
    });
    showToast('體重已記錄');
  };

  // 表單送出：樂觀新增或編輯成員（含自訂頭像與狗狗類型）
  document.getElementById('form-member').onsubmit = (e) => {
    e.preventDefault();
    const editId = document.getElementById('mem-id').value.trim();
    const name = document.getElementById('mem-name').value.trim();
    const type = document.getElementById('mem-type').value;
    const rawAvatar = document.getElementById('mem-avatar').value.trim();
    const avatar = isValidAvatarId(rawAvatar) ? rawAvatar : getDefaultAvatarForType(type);
    const isPet = isPetType(type);
    const heightParsed = isPet
      ? { value: null }
      : parseStrictNumber(document.getElementById('mem-height').value, {
          required: false,
          min: 20,
          max: 300,
          label: '身高 (cm)'
        });
    const targetParsed = parseStrictNumber(document.getElementById('mem-target').value, {
      required: false,
      min: 0.1,
      max: 500,
      label: '目標體重 (kg)'
    });

    if (!name || name.length > 50) return showToast('名稱須為 1–50 字元', true);
    if (!VALID_MEMBER_TYPES.has(type)) return showToast('成員類型不正確', true);
    if (heightParsed.error) return showToast(heightParsed.error, true);
    if (targetParsed.error) return showToast(targetParsed.error, true);

    if (editId) {
      if (!isValidResourceId(editId)) return showToast('無效的成員識別碼', true);
      document.getElementById('modal-member').classList.add('hidden');
      e.target.reset();
      optimisticUpdateMember(editId, {
        name,
        avatar,
        height_cm: heightParsed.value,
        target_weight: targetParsed.value,
        target_effective_date: getLocalTodayDate()
      });
      showToast('成員資料已更新');
    } else {
      document.getElementById('modal-member').classList.add('hidden');
      e.target.reset();
      optimisticAddMember({
        name,
        type,
        avatar,
        height_cm: heightParsed.value,
        target_weight: targetParsed.value,
        target_effective_date: getLocalTodayDate()
      });
      showToast('成員已新增');
    }
  };

  // 表單送出：樂觀更新個人資訊（含名稱、頭像、身高、目標體重）
  document.getElementById('form-profile').onsubmit = (e) => {
    e.preventDefault();
    const id = document.getElementById('prof-id').value.trim();
    const member = state.appData.members.find((x) => x.id === id);
    const isPet = isPetType(member?.type);
    const name = document.getElementById('prof-name').value.trim();
    const rawAvatar = document.getElementById('prof-avatar').value.trim();
    const avatar = isValidAvatarId(rawAvatar) ? rawAvatar : resolveMemberAvatar(member);
    const heightParsed = isPet
      ? { value: null }
      : parseStrictNumber(document.getElementById('prof-height').value, {
          required: false,
          min: 20,
          max: 300,
          label: '身高 (cm)'
        });
    const targetParsed = parseStrictNumber(document.getElementById('prof-target').value, {
      required: false,
      min: 0.1,
      max: 500,
      label: '目標體重 (kg)'
    });

    if (!isValidResourceId(id)) return showToast('無效的成員識別碼', true);
    if (!name || name.length > 50) return showToast('名稱須為 1–50 字元', true);
    if (heightParsed.error) return showToast(heightParsed.error, true);
    if (targetParsed.error) return showToast(targetParsed.error, true);

    document.getElementById('modal-profile').classList.add('hidden');
    optimisticUpdateMember(id, {
      name,
      avatar,
      height_cm: heightParsed.value,
      target_weight: targetParsed.value,
      target_effective_date: getLocalTodayDate()
    });
    showToast('個人資訊已更新');
  };
}
