import { state } from '../state.js';
import { FamilyAPI } from '../services/api.js';
import { createEl, showLoading, showToast } from '../utils/dom.js';
import { calculateBmi } from '../utils/metrics.js';
import { UUID_REGEX, isValidRecordedDate, parseStrictNumber } from '../utils/validation.js';

export function openProfileModal(memberId, { onNavigateToChart }) {
  const m = state.appData.members.find((x) => x.id === memberId);
  if (!m) return;
  const recs = state.appData.records.filter((r) => r.member_id === m.id);
  const latest = recs[recs.length - 1];
  const isCat = m.type === 'cat';

  document.getElementById('prof-id').value = m.id;
  document.getElementById('prof-title').textContent = `${isCat ? '🐱' : '👤'} ${m.name} 的個人資訊`;
  document.getElementById('prof-height').value = m.height_cm || '';
  document.getElementById('prof-target').value = m.target_weight || '';
  document.getElementById('prof-height-wrap').classList.toggle('hidden', isCat);

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

  // 開啟新增體重彈窗
  document.getElementById('btn-open-record-modal').onclick = () => {
    if (state.appData.members.length === 0) return showToast('請先到設定頁新增成員', true);
    const select = document.getElementById('rec-member');
    const options = state.appData.members.map((m) => {
      const opt = document.createElement('option');
      opt.value = String(m.id);
      opt.textContent = String(m.name ?? '');
      return opt;
    });
    select.replaceChildren(...options);
    document.getElementById('rec-date').value = new Date().toISOString().split('T')[0];
    document.getElementById('modal-record').classList.remove('hidden');
  };

  // 開啟新增成員彈窗
  document.getElementById('btn-open-member-modal').onclick = () => {
    document.getElementById('modal-member').classList.remove('hidden');
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

  // 表單送出：新增成員
  document.getElementById('form-member').onsubmit = async (e) => {
    e.preventDefault();
    const name = document.getElementById('mem-name').value.trim();
    const type = document.getElementById('mem-type').value;
    const heightParsed = parseStrictNumber(document.getElementById('mem-height').value, {
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
      await FamilyAPI.addMember(state.familyCode, {
        name,
        type,
        height_cm: type === 'cat' ? null : heightParsed.value,
        target_weight: targetParsed.value
      });
      document.getElementById('modal-member').classList.add('hidden');
      e.target.reset();
      showToast('成員已新增');
      await onSync();
    } catch (err) {
      showToast(err.message, true);
    } finally {
      showLoading(false);
    }
  };

  // 表單送出：更新個人資訊
  document.getElementById('form-profile').onsubmit = async (e) => {
    e.preventDefault();
    const id = document.getElementById('prof-id').value.trim();
    const heightParsed = parseStrictNumber(document.getElementById('prof-height').value, {
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
    if (heightParsed.error) return showToast(heightParsed.error, true);
    if (targetParsed.error) return showToast(targetParsed.error, true);

    showLoading(true);
    try {
      await FamilyAPI.updateMember(state.familyCode, id, {
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
