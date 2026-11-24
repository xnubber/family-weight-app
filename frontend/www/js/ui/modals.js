import { state } from '../state.js';
import { FamilyAPI } from '../services/api.js';
import { createEl, showLoading, showToast } from '../utils/dom.js';
import { calculateBmi } from '../utils/metrics.js';
import { UUID_REGEX, isValidRecordedDate, parseStrictNumber } from '../utils/validation.js';

// 開啟新增體重彈窗（可指定預選成員）
export function openRecordModal(preselectedMemberId = null) {
  if (state.appData.members.length === 0) return showToast('請先到設定頁新增成員', true);
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
  document.getElementById('rec-date').value = new Date().toISOString().split('T')[0];
  document.getElementById('modal-record').classList.remove('hidden');
  document.getElementById('rec-weight').focus();
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

function setProfileEditMode(isEditing) {
  document.getElementById('prof-view-fields').classList.toggle('hidden', isEditing);
  document.getElementById('prof-view-actions').classList.toggle('hidden', isEditing);
  document.getElementById('btn-prof-add-record').classList.toggle('hidden', isEditing);
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
    createEl('div', 'font-bold text-base text-slate-800', latest ? `${latest.weight_kg} kg` : '--')
  );
  const col2 = createEl('div');
  col2.append(
    createEl('div', 'text-xs text-slate-400', metricLabel),
    createEl('div', 'font-bold text-base text-teal-700', metricVal)
  );
  summary.replaceChildren(col1, col2);

  document.getElementById('btn-prof-to-chart').onclick = () => {
    state.selectedMemberId = m.id;
    document.getElementById('modal-profile').classList.add('hidden');
    onNavigateToChart();
  };

  // 從個人資訊面板直接為該成員新增體重
  document.getElementById('btn-prof-add-record').onclick = () => {
    document.getElementById('modal-profile').classList.add('hidden');
    openRecordModal(m.id);
  };

  // 切換至編輯模式／取消編輯還原原值
  document.getElementById('btn-prof-edit').onclick = () => setProfileEditMode(true);
  document.getElementById('btn-prof-cancel-edit').onclick = () => {
    fillEditInputs();
    setProfileEditMode(false);
  };

  document.getElementById('modal-profile').classList.remove('hidden');
}

export function initModals({ onSync }) {
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

  // 切換成員類型時自動隱藏／顯示身高欄位
  document.getElementById('mem-type').onchange = (e) => {
    const isCat = e.target.value === 'cat';
    document.getElementById('mem-height-wrap').classList.toggle('hidden', isCat);
    if (isCat) document.getElementById('mem-height').value = '';
  };

  // 開啟新增體重彈窗
  document.getElementById('btn-open-record-modal').onclick = () => {
    openRecordModal(state.selectedMemberId);
  };

  // 開啟新增成員彈窗
  document.getElementById('btn-open-member-modal').onclick = () => {
    openMemberModal(null);
  };

  // 表單送出：新增體重
  document.getElementById('form-record').onsubmit = async (e) => {
    e.preventDefault();
    const memberId = document.getElementById('rec-member').value.trim();
    const weightParsed = parseStrictNumber(document.getElementById('rec-weight').value, {
      required: true,
      min: 0.1,
      max: 500,
      label: '體重 (kg)'
    });
    const recordedAt = document.getElementById('rec-date').value.trim();
    const note = document.getElementById('rec-note').value.trim();

    if (!UUID_REGEX.test(memberId)) return showToast('請選擇有效的成員', true);
    if (weightParsed.error) return showToast(weightParsed.error, true);
    if (!isValidRecordedDate(recordedAt)) return showToast('日期格式不正確或超出合理範圍', true);
    if (note.length > 200) return showToast('備註不可超過 200 字元', true);

    showLoading(true);
    try {
      await FamilyAPI.addRecord(state.familyCode, {
        member_id: memberId,
        weight_kg: weightParsed.value,
        recorded_at: recordedAt,
        note
      });
      document.getElementById('modal-record').classList.add('hidden');
      e.target.reset();
      showToast('體重已同步至雲端');
      await onSync();
    } catch (err) {
      showToast(err.message, true);
    } finally {
      showLoading(false);
    }
  };

  // 表單送出：新增或編輯成員
  document.getElementById('form-member').onsubmit = async (e) => {
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

    showLoading(true);
    try {
      if (editId) {
        if (!UUID_REGEX.test(editId)) {
          showToast('無效的成員識別碼', true);
          return;
        }
        await FamilyAPI.updateMember(state.familyCode, editId, {
          name,
          height_cm: heightParsed.value,
          target_weight: targetParsed.value
        });
        showToast('成員資料已更新');
      } else {
        await FamilyAPI.addMember(state.familyCode, {
          name,
          type,
          height_cm: heightParsed.value,
          target_weight: targetParsed.value
        });
        showToast('成員已新增');
      }
      document.getElementById('modal-member').classList.add('hidden');
      e.target.reset();
      await onSync();
    } catch (err) {
      showToast(err.message, true);
    } finally {
      showLoading(false);
    }
  };

  // 表單送出：更新個人資訊（含名稱、身高、目標體重）
  document.getElementById('form-profile').onsubmit = async (e) => {
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

    if (!UUID_REGEX.test(id)) return showToast('無效的成員識別碼', true);
    if (!name || name.length > 50) return showToast('名稱須為 1–50 字元', true);
    if (heightParsed.error) return showToast(heightParsed.error, true);
    if (targetParsed.error) return showToast(targetParsed.error, true);

    showLoading(true);
    try {
      await FamilyAPI.updateMember(state.familyCode, id, {
        name,
        height_cm: heightParsed.value,
        target_weight: targetParsed.value
      });
      document.getElementById('modal-profile').classList.add('hidden');
      showToast('個人資訊已更新');
      await onSync();
    } catch (err) {
      showToast(err.message, true);
    } finally {
      showLoading(false);
    }
  };
}
