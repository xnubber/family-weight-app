import { FamilyAPI, hasInjectedApiKey } from './api.js';

const FAMILY_CODE_REGEX = /^[A-Za-z0-9_-]{12,64}$/;
const FORBIDDEN_FAMILY_CODES = new Set(['my-family-2026']);

function isValidFamilyCode(code) {
  return (
    typeof code === 'string' &&
    FAMILY_CODE_REGEX.test(code) &&
    !FORBIDDEN_FAMILY_CODES.has(code)
  );
}

function generateFamilyCode() {
  const bytes = new Uint8Array(16);
  window.crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `fam-${hex}`;
}

function initFamilyCode() {
  const saved = (localStorage.getItem('familySyncCode') || '').trim();
  if (isValidFamilyCode(saved)) return saved;
  const generated = generateFamilyCode();
  localStorage.setItem('familySyncCode', generated);
  return generated;
}

// 建立純文字 DOM 元素的共用輔助函式，徹底避免使用 innerHTML 導致 XSS
function createEl(tag, className = '', text = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== '') node.textContent = text;
  return node;
}

let familyCode = initFamilyCode();
let appData = { members: [], records: [] };
let selectedMemberId = null;
let selectedRange = 'day'; // 'day' | 'week' | 'month' | 'year'
let chartInstance = null;

const showLoading = (show) => document.getElementById('loading').classList.toggle('hidden', !show);
const showToast = (msg, isError = false) => {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `fixed top-16 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-full text-sm text-white shadow-lg ${isError ? 'bg-rose-600' : 'bg-slate-800'}`;
  setTimeout(() => el.classList.add('hidden'), 2500);
};

// 若未透過 config.js 注入 API Key，顯示設定頁的金鑰輸入欄位
function initApiKeySettingUI() {
  const wrap = document.getElementById('api-key-setting-wrap');
  const input = document.getElementById('input-api-key');
  if (!hasInjectedApiKey()) {
    wrap.classList.remove('hidden');
    input.value = localStorage.getItem('appApiKey') || '';
  }
}

// 依據 日/週/月/年 篩選並計算平均體重
function aggregateRecords(recs, range) {
  const now = new Date();
  const cutoff = new Date();

  if (range === 'day') cutoff.setDate(now.getDate() - 30);
  else if (range === 'week') cutoff.setDate(now.getDate() - 84);
  else if (range === 'month') cutoff.setMonth(now.getMonth() - 12);
  else if (range === 'year') cutoff.setFullYear(now.getFullYear() - 2);

  const cutoffStr = cutoff.toISOString().split('T')[0];
  const filtered = recs.filter(r => r.recorded_at >= cutoffStr);

  if (range === 'day') {
    return {
      labels: filtered.map(r => r.recorded_at.slice(5)),
      values: filtered.map(r => Number(r.weight_kg)),
      filteredRecords: filtered
    };
  }

  const groups = {};
  filtered.forEach(r => {
    let key;
    if (range === 'week') {
      const d = new Date(r.recorded_at + 'T00:00:00');
      const diff = d.getDate() - d.getDay() + (d.getDay() === 0 ? -6 : 1);
      d.setDate(diff);
      key = d.toISOString().split('T')[0].slice(5) + '週';
    } else {
      key = r.recorded_at.slice(0, 7);
    }
    if (!groups[key]) groups[key] = [];
    groups[key].push(Number(r.weight_kg));
  });

  const labels = Object.keys(groups);
  const values = labels.map(k => {
    const arr = groups[k];
    const avg = arr.reduce((sum, v) => sum + v, 0) / arr.length;
    return Number(avg.toFixed(2));
  });

  return { labels, values, filteredRecords: filtered };
}

async function syncData() {
  showLoading(true);
  try {
    appData = await FamilyAPI.getAllData(familyCode);
    if (!selectedMemberId && appData.members.length > 0) {
      selectedMemberId = appData.members[0].id;
    }
    renderAll();
  } catch (err) {
    renderAll();
    showToast(err.message, true);
  } finally {
    showLoading(false);
  }
}

function renderAll() {
  document.getElementById('header-family-code').textContent = `同步碼：${familyCode}`;
  document.getElementById('input-family-code').value = familyCode;
  renderOverview();
  renderCharts();
  renderSettingsMembers();
}

function renderOverview() {
  const container = document.getElementById('member-cards');
  if (appData.members.length === 0) {
    const emptyBox = createEl(
      'div',
      'bg-white p-6 rounded-2xl text-center text-slate-400 text-sm',
      '尚無成員，請先到「⚙️ 設定」新增家人或貓咪。'
    );
    container.replaceChildren(emptyBox);
    return;
  }

  const cards = appData.members.map(m => {
    const recs = appData.records.filter(r => r.member_id === m.id);
    const latest = recs[recs.length - 1];
    const prev = recs[recs.length - 2];
    const diffNum = latest && prev ? Number((latest.weight_kg - prev.weight_kg).toFixed(2)) : null;
    const diffStr = diffNum !== null ? diffNum.toFixed(2) : null;
    const isCat = m.type === 'cat';

    const card = createEl(
      'div',
      `member-card cursor-pointer active:scale-[0.99] transition bg-white p-4 rounded-2xl shadow-sm border-l-4 ${isCat ? 'border-orange-400' : 'border-teal-500'} flex justify-between items-center`
    );
    card.dataset.memberId = String(m.id);
    card.onclick = () => openProfileModal(m.id);

    const leftWrap = createEl('div');
    const titleRow = createEl('div', 'flex items-center gap-2');
    titleRow.appendChild(createEl('span', 'font-bold text-base', `${isCat ? '🐱' : '👤'} ${m.name ?? ''}`));

    if (!isCat && latest && m.height_cm && Number(m.height_cm) > 0) {
      const bmi = (Number(latest.weight_kg) / ((Number(m.height_cm) / 100) ** 2)).toFixed(1);
      titleRow.appendChild(createEl('span', 'text-xs px-2 py-0.5 rounded-full bg-teal-50 text-teal-700', `BMI ${bmi}`));
    } else if (m.target_weight) {
      titleRow.appendChild(createEl('span', 'text-xs px-2 py-0.5 rounded-full bg-orange-50 text-orange-700', `目標 ${m.target_weight} kg`));
    }

    const subText = createEl(
      'p',
      'text-xs text-slate-400 mt-1',
      `${latest ? `最後更新：${latest.recorded_at}` : '尚未有體重紀錄'} · 點擊編輯`
    );
    leftWrap.append(titleRow, subText);

    const rightWrap = createEl('div', 'text-right');
    const weightRow = createEl('div', 'text-2xl font-bold');
    weightRow.append(
      document.createTextNode(`${latest ? latest.weight_kg : '--'} `),
      createEl('span', 'text-xs font-normal text-slate-500', 'kg')
    );
    rightWrap.appendChild(weightRow);

    if (diffStr !== null) {
      rightWrap.appendChild(
        createEl(
          'div',
          `text-xs ${diffNum > 0 ? 'text-rose-500' : 'text-emerald-600'}`,
          `${diffNum > 0 ? '+' : ''}${diffStr} kg`
        )
      );
    }

    card.append(leftWrap, rightWrap);
    return card;
  });

  container.replaceChildren(...cards);
}

function openProfileModal(memberId) {
  const m = appData.members.find(x => x.id === memberId);
  if (!m) return;
  const recs = appData.records.filter(r => r.member_id === m.id);
  const latest = recs[recs.length - 1];
  const isCat = m.type === 'cat';

  document.getElementById('prof-id').value = m.id;
  document.getElementById('prof-title').textContent = `${isCat ? '🐱' : '👤'} ${m.name} 的個人資訊`;
  document.getElementById('prof-height').value = m.height_cm || '';
  document.getElementById('prof-target').value = m.target_weight || '';
  document.getElementById('prof-height-wrap').classList.toggle('hidden', isCat);

  let metricLabel = '目標差距';
  let metricVal = '--';
  if (!isCat && latest && m.height_cm && Number(m.height_cm) > 0) {
    metricLabel = '目前 BMI';
    metricVal = (Number(latest.weight_kg) / ((Number(m.height_cm) / 100) ** 2)).toFixed(1);
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
    selectedMemberId = m.id;
    document.getElementById('modal-profile').classList.add('hidden');
    document.querySelector('.nav-btn[data-tab="charts"]').click();
    renderCharts();
  };

  document.getElementById('modal-profile').classList.remove('hidden');
}

function renderCharts() {
  const pills = document.getElementById('chart-member-pills');
  const pillButtons = appData.members.map(m => {
    const btn = createEl(
      'button',
      `pill-btn shrink-0 px-3 py-1.5 rounded-full text-xs font-medium ${m.id === selectedMemberId ? 'bg-teal-600 text-white' : 'bg-white border text-slate-600'}`,
      `${m.type === 'cat' ? '🐱' : '👤'} ${m.name ?? ''}`
    );
    btn.type = 'button';
    btn.dataset.id = String(m.id);
    btn.onclick = () => { selectedMemberId = m.id; renderCharts(); };
    return btn;
  });
  pills.replaceChildren(...pillButtons);

  const member = appData.members.find(m => m.id === selectedMemberId);
  const recs = appData.records.filter(r => r.member_id === selectedMemberId);
  const { labels, values, filteredRecords } = aggregateRecords(recs, selectedRange);

  const ctx = document.getElementById('weightChart').getContext('2d');
  if (chartInstance) chartInstance.destroy();
  const color = member?.type === 'cat' ? '#f97316' : '#0d9488';

  const datasets = [{
    label: `${member?.name || ''} 體重 (kg)${selectedRange === 'day' ? '' : '（平均）'}`,
    data: values,
    borderColor: color,
    backgroundColor: color + '20',
    fill: true,
    tension: 0.3
  }];

  if (member?.target_weight && labels.length > 0) {
    datasets.push({
      label: `目標體重 (${member.target_weight} kg)`,
      data: labels.map(() => Number(member.target_weight)),
      borderColor: '#94a3b8',
      borderWidth: 2,
      borderDash: [6, 6],
      pointRadius: 0,
      fill: false
    });
  }

  chartInstance = new window.Chart(ctx, {
    type: 'line',
    data: { labels, datasets },
    options: { responsive: true, plugins: { legend: { display: true } } }
  });

  const list = document.getElementById('history-list');
  const reversed = filteredRecords.slice().reverse();
  if (reversed.length === 0) {
    list.replaceChildren(createEl('li', 'py-3 text-center text-slate-400', '此區間尚無紀錄'));
    return;
  }

  const items = reversed.map(r => {
    const li = createEl('li', 'py-2.5 flex justify-between items-center');
    const info = createEl('div');
    info.append(
      createEl('span', 'font-semibold', `${r.weight_kg} kg`),
      createEl('span', 'text-xs text-slate-400 ml-2', String(r.recorded_at ?? ''))
    );
    if (r.note) {
      info.appendChild(createEl('p', 'text-xs text-slate-500', String(r.note)));
    }

    const delBtn = createEl('button', 'text-xs text-rose-500 hover:underline', '刪除');
    delBtn.type = 'button';
    delBtn.onclick = async () => {
      if (!confirm('確定刪除此筆體重紀錄？')) return;
      showLoading(true);
      try {
        await FamilyAPI.deleteRecord(familyCode, r.id);
        showToast('已刪除紀錄');
        await syncData();
      } catch (err) {
        showToast(err.message, true);
      } finally {
        showLoading(false);
      }
    };

    li.append(info, delBtn);
    return li;
  });
  list.replaceChildren(...items);
}

function renderSettingsMembers() {
  const list = document.getElementById('settings-member-list');
  if (appData.members.length === 0) {
    list.replaceChildren(createEl('li', 'py-3 text-center text-slate-400', '尚無成員'));
    return;
  }

  const items = appData.members.map(m => {
    const li = createEl('li', 'py-2.5 flex justify-between items-center');
    li.appendChild(createEl('span', '', `${m.type === 'cat' ? '🐱' : '👤'} ${m.name ?? ''}`));

    const delBtn = createEl('button', 'text-xs text-rose-500 hover:underline', '刪除');
    delBtn.type = 'button';
    delBtn.onclick = async () => {
      if (!confirm('刪除成員會連同所有體重紀錄一起刪除，確定嗎？')) return;
      showLoading(true);
      try {
        await FamilyAPI.deleteMember(familyCode, m.id);
        if (selectedMemberId === m.id) selectedMemberId = null;
        showToast('已刪除成員');
        await syncData();
      } catch (err) {
        showToast(err.message, true);
      } finally {
        showLoading(false);
      }
    };

    li.appendChild(delBtn);
    return li;
  });
  list.replaceChildren(...items);
}

// 綁定 日/週/月/年 按鈕事件
document.querySelectorAll('.range-btn').forEach(btn => {
  btn.onclick = () => {
    selectedRange = btn.dataset.range;
    document.querySelectorAll('.range-btn').forEach(b => {
      b.className = 'range-btn flex-1 py-1.5 rounded-lg text-slate-600';
    });
    btn.className = 'range-btn flex-1 py-1.5 rounded-lg bg-white text-teal-700 shadow-sm';
    renderCharts();
  };
});

// 分頁切換
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll('main > section').forEach(s => s.classList.add('hidden'));
    document.getElementById(`view-${btn.dataset.tab}`).classList.remove('hidden');
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('tab-active'));
    btn.classList.add('tab-active');
  };
});

// 彈窗控制
document.querySelectorAll('.btn-close-modal').forEach(btn => {
  btn.onclick = () => btn.closest('.fixed').classList.add('hidden');
});

// 點擊彈窗外部（深色背景）即可關閉
['modal-record', 'modal-member', 'modal-profile'].forEach(id => {
  const modal = document.getElementById(id);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.classList.add('hidden');
    }
  });
});

document.getElementById('btn-open-record-modal').onclick = () => {
  if (appData.members.length === 0) return showToast('請先到設定頁新增成員', true);
  const select = document.getElementById('rec-member');
  const options = appData.members.map(m => {
    const opt = document.createElement('option');
    opt.value = String(m.id);
    opt.textContent = String(m.name ?? '');
    return opt;
  });
  select.replaceChildren(...options);
  document.getElementById('rec-date').value = new Date().toISOString().split('T')[0];
  document.getElementById('modal-record').classList.remove('hidden');
};

document.getElementById('btn-open-member-modal').onclick = () => {
  document.getElementById('modal-member').classList.remove('hidden');
};

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidRecordedDate(dateStr) {
  if (typeof dateStr !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const [y, m, d] = dateStr.split('-').map(Number);
  const parsed = new Date(Date.UTC(y, m - 1, d));
  if (
    parsed.getUTCFullYear() !== y ||
    parsed.getUTCMonth() + 1 !== m ||
    parsed.getUTCDate() !== d
  ) {
    return false;
  }
  const minTime = Date.UTC(2000, 0, 1);
  const maxTime = Date.now() + 2 * 24 * 60 * 60 * 1000;
  return parsed.getTime() >= minTime && parsed.getTime() <= maxTime;
}

// 嚴格解析數字欄位（使用 Number() 避免 parseFloat 接受 "65abc"，且不讓 0 或 NaN 靜默轉為 null）
function parseStrictNumber(raw, { required = false, min, max, label }) {
  const trimmed = String(raw ?? '').trim();
  if (trimmed === '') {
    if (required) return { error: `${label}不可為空` };
    return { value: null };
  }
  const num = Number(trimmed);
  if (!Number.isFinite(num)) {
    return { error: `${label}必須為有效數字` };
  }
  if (num < min || num > max) {
    return { error: `${label}須介於 ${min}–${max}` };
  }
  return { value: num };
}

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
    await FamilyAPI.addRecord(familyCode, {
      member_id: memberId,
      weight_kg: weightParsed.value,
      recorded_at: recordedAt,
      note
    });
    document.getElementById('modal-record').classList.add('hidden');
    e.target.reset();
    showToast('體重已同步至雲端');
    await syncData();
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
    await FamilyAPI.addMember(familyCode, {
      name,
      type,
      height_cm: type === 'cat' ? null : heightParsed.value,
      target_weight: targetParsed.value
    });
    document.getElementById('modal-member').classList.add('hidden');
    e.target.reset();
    showToast('成員已新增');
    await syncData();
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
    await FamilyAPI.updateMember(familyCode, id, {
      height_cm: heightParsed.value,
      target_weight: targetParsed.value
    });
    document.getElementById('modal-profile').classList.add('hidden');
    showToast('個人資訊已更新');
    await syncData();
  } catch (err) {
    showToast(err.message, true);
  } finally {
    showLoading(false);
  }
};

// 隨機產生新的高強度同步碼
document.getElementById('btn-generate-code').onclick = () => {
  document.getElementById('input-family-code').value = generateFamilyCode();
  showToast('已產生新同步碼，請點擊儲存生效');
};

// 儲存家庭同步碼（與本機 API 金鑰設定）
document.getElementById('btn-save-settings').onclick = () => {
  const nextCode = document.getElementById('input-family-code').value.trim();
  if (!isValidFamilyCode(nextCode)) {
    showToast('同步碼需為 12-64 字元英數字、- 或 _，且不可使用舊預設碼', true);
    return;
  }

  if (!hasInjectedApiKey()) {
    const apiKeyVal = document.getElementById('input-api-key').value.trim();
    if (apiKeyVal) {
      localStorage.setItem('appApiKey', apiKeyVal);
    }
  }

  familyCode = nextCode;
  selectedMemberId = null;
  localStorage.setItem('familySyncCode', familyCode);
  showToast('設定已儲存');
  syncData();
};

// 計算機邏輯
document.getElementById('btn-calc-bmi').onclick = () => {
  const h = parseFloat(document.getElementById('calc-height').value) / 100;
  const w = parseFloat(document.getElementById('calc-weight').value);
  if (!(h > 0) || !(w > 0)) return;
  const bmi = Number((w / (h * h)).toFixed(1));
  const status = bmi < 18.5 ? '過輕' : bmi < 24 ? '正常範圍' : bmi < 27 ? '過重' : '肥胖';
  const el = document.getElementById('bmi-result');
  el.replaceChildren(
    document.createTextNode('BMI：'),
    createEl('strong', '', bmi.toFixed(1)),
    document.createTextNode(`（${status}）`)
  );
  el.classList.remove('hidden');
};

document.getElementById('btn-calc-cat').onclick = () => {
  const w = parseFloat(document.getElementById('calc-cat-weight').value);
  const f = parseFloat(document.getElementById('calc-cat-factor').value);
  if (!(w > 0) || !(f > 0)) return;
  const rer = Math.round(70 * Math.pow(w, 0.75));
  const der = Math.round(rer * f);
  const el = document.getElementById('cat-result');
  el.replaceChildren(
    document.createTextNode('基礎代謝 RER：'),
    createEl('strong', '', `${rer} kcal`),
    document.createElement('br'),
    document.createTextNode('每日建議攝取 DER：'),
    createEl('strong', '', `${der} kcal`)
  );
  el.classList.remove('hidden');
};

document.getElementById('btn-refresh').onclick = syncData;

initApiKeySettingUI();
syncData();
