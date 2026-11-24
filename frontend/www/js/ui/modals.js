import { state } from '../state.js';
import {
  optimisticAddMember,
  optimisticUpdateMember,
  optimisticAddRecord
} from '../services/syncQueue.js';
import { createEl, showToast } from '../utils/dom.js';
import {
  calculateBmi,
  calculateHealthyWeightRange,
  calculateCatCalories,
  getLocalTodayDate
} from '../utils/metrics.js';
import { isValidResourceId, isValidRecordedDate, parseStrictNumber } from '../utils/validation.js';

const CAT_FACTORS = [
  { value: '1.2', label: '已結紮成貓 (1.2x)' },
  { value: '1.4', label: '未結紮成貓 (1.4x)' },
  { value: '0.8', label: '減重中貓咪 (0.8x)' },
  { value: '2.5', label: '幼貓成長期 (2.5x)' }
];

let recordModalMode = 'batch'; // 'batch' | 'single'
let hasProfileHealthCard = false;

function getSavedCatFactor(memberId) {
  const saved = localStorage.getItem(`catFactor:${memberId}`);
  return CAT_FACTORS.some((f) => f.value === saved) ? saved : '1.2';
}

function setRecordModalMode(mode) {
  recordModalMode = mode === 'single' ? 'single' : 'batch';
  const isBatch = recordModalMode === 'batch';

  document.getElementById('rec-batch-fields').classList.toggle('hidden', !isBatch);
  document.getElementById('rec-single-fields').classList.toggle('hidden', isBatch);

  const batchBtn = document.getElementById('btn-rec-mode-batch');
  const singleBtn = document.getElementById('btn-rec-mode-single');
  batchBtn.className = isBatch
    ? 'px-2.5 py-1 rounded-lg bg-white text-teal-700 shadow-sm'
    : 'px-2.5 py-1 rounded-lg text-slate-600';
  singleBtn.className = !isBatch
    ? 'px-2.5 py-1 rounded-lg bg-white text-teal-700 shadow-sm'
    : 'px-2.5 py-1 rounded-lg text-slate-600';

  document.getElementById('btn-rec-submit').textContent = isBatch ? '一次儲存' : '儲存';
}

function renderBatchMemberRows() {
  const container = document.getElementById('batch-member-rows');
  const rows = state.appData.members.map((m) => {
    const recs = state.appData.records.filter((r) => r.member_id === m.id);
    const latest = recs[recs.length - 1];
    const isCat = m.type === 'cat';

    const row = createEl('div', 'py-2.5 flex items-center justify-between gap-3');
    const labelWrap = createEl('div', 'min-w-0 flex-1');
    labelWrap.append(
      createEl('div', 'font-medium text-sm text-slate-800 truncate', `${isCat ? '🐱' : '👤'} ${m.name ?? ''}`),
      createEl(
        'div',
        'text-[11px] text-slate-400 tabular-nums',
        latest ? `上次 ${latest.weight_kg} kg（${latest.recorded_at}）` : '尚未有紀錄'
      )
    );

    const inputWrap = createEl('div', 'flex items-center gap-1.5 shrink-0');
    const input = document.createElement('input');
    input.type = 'number';
    input.min = '0.1';
    input.max = '500';
    input.step = '0.01';
    input.placeholder = latest ? String(latest.weight_kg) : '體重';
    input.dataset.memberId = String(m.id);
    input.dataset.memberName = String(m.name ?? '');
    input.className = 'batch-weight-input w-24 border rounded-lg px-2.5 py-1.5 text-sm text-right tabular-nums';

    inputWrap.append(input, createEl('span', 'text-xs text-slate-400', 'kg'));
    row.append(labelWrap, inputWrap);
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
    opt.textContent = String(m.name ?? '');
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

// 開啟新增／編輯成員彈窗（傳入 member 物件則進入編輯模式，支援修改名稱、身高與目標體重）
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
    const isCat = member.type === 'cat';
    titleEl.textContent = '編輯成員';
    submitBtn.textContent = '儲存修改';
    idInput.value = member.id;
    nameInput.value = member.name || '';
    typeSelect.value = member.type || 'human';
    typeSelect.disabled = true;
    heightWrap.classList.toggle('hidden', isCat);
    heightInput.value = isCat ? '' : (member.height_cm ?? '');
    targetInput.value = member.target_weight ?? '';
  } else {
    titleEl.textContent = '新增成員';
    submitBtn.textContent = '新增';
    idInput.value = '';
    typeSelect.value = 'human';
    typeSelect.disabled = false;
    heightWrap.classList.remove('hidden');
  }

  document.getElementById('modal-member').classList.remove('hidden');
  nameInput.focus();
}

// 繪製個人資訊面板中的「自動健康指標卡」（取代原本獨立的指標分頁）
function renderProfileHealthCard(member, latest) {
  const card = document.getElementById('prof-health-card');
  const isCat = member.type === 'cat';

  if (!isCat) {
    const bmiRes = latest && member.height_cm ? calculateBmi(latest.weight_kg, member.height_cm) : null;
    const range = member.height_cm ? calculateHealthyWeightRange(member.height_cm) : null;

    if (!bmiRes && !range) {
      hasProfileHealthCard = false;
      card.classList.add('hidden');
      card.replaceChildren();
      return;
    }

    hasProfileHealthCard = true;
    card.className = 'rounded-xl p-3.5 text-sm space-y-2 border bg-teal-50/60 border-teal-100';

    const header = createEl('div', 'flex justify-between items-center');
    header.appendChild(createEl('span', 'font-semibold text-teal-800 text-xs', '👤 衛福部成人健康指標'));

    if (bmiRes) {
      const badgeClass = bmiRes.status === '正常範圍'
        ? 'bg-emerald-100 text-emerald-700'
        : bmiRes.status === '過輕'
          ? 'bg-sky-100 text-sky-700'
          : 'bg-amber-100 text-amber-700';
      header.appendChild(
        createEl('span', `text-xs font-semibold px-2 py-0.5 rounded-full ${badgeClass}`, `BMI ${bmiRes.bmi.toFixed(1)} · ${bmiRes.status}`)
      );
    }

    const children = [header];
    if (range) {
      const row = createEl('div', 'flex justify-between items-center text-xs text-slate-600');
      row.append(
        createEl('span', '', '建議健康體重區間（BMI 18.5–24）'),
        createEl('strong', 'text-slate-800 tabular-nums', `${range.minKg}–${range.maxKg} kg`)
      );
      children.push(row);
    }

    card.replaceChildren(...children);
    return;
  }

  // 貓咪自動每日熱量建議（RER / DER）
  if (!latest) {
    hasProfileHealthCard = false;
    card.classList.add('hidden');
    card.replaceChildren();
    return;
  }

  hasProfileHealthCard = true;
  card.className = 'rounded-xl p-3.5 text-sm space-y-2.5 border bg-orange-50/70 border-orange-100';

  const header = createEl('div', 'flex justify-between items-center gap-2');
  header.appendChild(createEl('span', 'font-semibold text-orange-700 text-xs shrink-0', '🐱 貓咪每日熱量建議'));

  const factorSelect = document.createElement('select');
  factorSelect.className = 'border border-orange-200 rounded-lg px-2 py-1 text-xs bg-white text-slate-700';
  CAT_FACTORS.forEach((optCfg) => {
    const opt = document.createElement('option');
    opt.value = optCfg.value;
    opt.textContent = optCfg.label;
    factorSelect.appendChild(opt);
  });
  factorSelect.value = getSavedCatFactor(member.id);

  const resultGrid = createEl('div', 'grid grid-cols-2 gap-2 bg-white/80 rounded-lg p-2.5 text-center');
  const renderCatResult = () => {
    const res = calculateCatCalories(latest.weight_kg, factorSelect.value);
    if (!res) return;
    const colRer = createEl('div');
    colRer.append(
      createEl('div', 'text-[11px] text-slate-400', '基礎代謝 RER'),
      createEl('div', 'font-bold text-slate-800 tabular-nums', `${res.rer} kcal`)
    );
    const colDer = createEl('div');
    colDer.append(
      createEl('div', 'text-[11px] text-slate-400', '每日建議攝取 DER'),
      createEl('div', 'font-bold text-orange-600 tabular-nums', `${res.der} kcal`)
    );
    resultGrid.replaceChildren(colRer, colDer);
  };

  factorSelect.onchange = () => {
    localStorage.setItem(`catFactor:${member.id}`, factorSelect.value);
    renderCatResult();
  };

  header.appendChild(factorSelect);
  renderCatResult();
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
  const isCat = m.type === 'cat';

  const fillEditInputs = () => {
    document.getElementById('prof-name').value = m.name || '';
    document.getElementById('prof-height').value = isCat ? '' : (m.height_cm ?? '');
    document.getElementById('prof-target').value = m.target_weight ?? '';
  };

  document.getElementById('prof-id').value = m.id;
  document.getElementById('prof-title').textContent = `${isCat ? '🐱' : '👤'} ${m.name} 的個人資訊`;

  // 檢視模式文字
  document.getElementById('prof-view-name').textContent = m.name || '--';
  document.getElementById('prof-view-height-row').classList.toggle('hidden', isCat);
  document.getElementById('prof-view-height').textContent = m.height_cm ? `${m.height_cm} cm` : '未設定';
  document.getElementById('prof-view-target').textContent = m.target_weight ? `${m.target_weight} kg` : '未設定';

  // 自動健康指標卡（家人 BMI / 健康區間、貓咪 RER / DER）
  renderProfileHealthCard(m, latest);

  // 編輯模式欄位初始值
  document.getElementById('prof-height-wrap').classList.toggle('hidden', isCat);
  fillEditInputs();
  setProfileEditMode(false);

  let metricLabel = '目標差距';
  let metricVal = '--';
  const bmiRes = !isCat && latest && m.height_cm ? calculateBmi(latest.weight_kg, m.height_cm) : null;
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
    createEl('div', 'text-xs text-slate-400', '最新體重'),
    createEl('div', 'font-bold text-base text-slate-800 tabular-nums', latest ? `${latest.weight_kg} kg` : '--')
  );
  const col2 = createEl('div');
  col2.append(
    createEl('div', 'text-xs text-slate-400', metricLabel),
    createEl('div', 'font-bold text-base text-teal-700 tabular-nums', metricVal)
  );
  summary.replaceChildren(col1, col2);

  document.getElementById('btn-prof-to-chart').onclick = () => {
    state.selectedMemberId = m.id;
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

  // 切換成員類型時自動隱藏／顯示身高欄位
  document.getElementById('mem-type').onchange = (e) => {
    const isCat = e.target.value === 'cat';
    document.getElementById('mem-height-wrap').classList.toggle('hidden', isCat);
    if (isCat) document.getElementById('mem-height').value = '';
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

  // 表單送出：樂觀新增或編輯成員
  document.getElementById('form-member').onsubmit = (e) => {
    e.preventDefault();
    const editId = document.getElementById('mem-id').value.trim();
    const name = document.getElementById('mem-name').value.trim();
    const type = document.getElementById('mem-type').value;
    const isCat = type === 'cat';
    const heightParsed = isCat
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
    if (type !== 'human' && type !== 'cat') return showToast('成員類型不正確', true);
    if (heightParsed.error) return showToast(heightParsed.error, true);
    if (targetParsed.error) return showToast(targetParsed.error, true);

    if (editId) {
      if (!isValidResourceId(editId)) return showToast('無效的成員識別碼', true);
      document.getElementById('modal-member').classList.add('hidden');
      e.target.reset();
      optimisticUpdateMember(editId, {
        name,
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
        height_cm: heightParsed.value,
        target_weight: targetParsed.value,
        target_effective_date: getLocalTodayDate()
      });
      showToast('成員已新增');
    }
  };

  // 表單送出：樂觀更新個人資訊（含名稱、身高、目標體重）
  document.getElementById('form-profile').onsubmit = (e) => {
    e.preventDefault();
    const id = document.getElementById('prof-id').value.trim();
    const member = state.appData.members.find((x) => x.id === id);
    const isCat = member?.type === 'cat';
    const name = document.getElementById('prof-name').value.trim();
    const heightParsed = isCat
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
      height_cm: heightParsed.value,
      target_weight: targetParsed.value,
      target_effective_date: getLocalTodayDate()
    });
    showToast('個人資訊已更新');
  };
}
