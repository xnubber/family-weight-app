import { state } from '../state.js';
import { optimisticDeleteRecord } from '../services/syncQueue.js';
import { createEl, showToast } from '../utils/dom.js';
import { aggregateRecords, resolveTargetWeightSeries } from '../utils/metrics.js';

let chartInstance = null;

export function renderCharts() {
  const pills = document.getElementById('chart-member-pills');
  const pillButtons = state.appData.members.map((m) => {
    const btn = createEl(
      'button',
      `pill-btn shrink-0 px-3 py-1.5 rounded-full text-xs font-medium ${m.id === state.selectedMemberId ? 'bg-teal-600 text-white' : 'bg-white border text-slate-600'}`,
      `${m.type === 'cat' ? '🐱' : '👤'} ${m.name ?? ''}`
    );
    btn.type = 'button';
    btn.dataset.id = String(m.id);
    btn.onclick = () => {
      state.selectedMemberId = m.id;
      renderCharts();
    };
    return btn;
  });
  pills.replaceChildren(...pillButtons);

  const member = state.appData.members.find((m) => m.id === state.selectedMemberId);
  const recs = state.appData.records.filter((r) => r.member_id === state.selectedMemberId);
  const memberHistory = (state.appData.targetHistory || []).filter((h) => h.member_id === state.selectedMemberId);
  const { labels, values, pointDates, filteredRecords } = aggregateRecords(recs, state.selectedRange);

  const ctx = document.getElementById('weightChart').getContext('2d');
  if (chartInstance) chartInstance.destroy();
  const color = member?.type === 'cat' ? '#f97316' : '#0d9488';

  const datasets = [{
    label: `${member?.name || ''} 體重 (kg)${state.selectedRange === 'day' ? '' : '（平均）'}`,
    data: values,
    borderColor: color,
    backgroundColor: color + '20',
    fill: true,
    tension: 0.3
  }];

  const targetSeries = resolveTargetWeightSeries(pointDates, memberHistory, member);
  if (targetSeries.hasAnyTarget && labels.length > 0) {
    const targetLabel = member?.target_weight
      ? `目標體重（目前 ${member.target_weight} kg）`
      : '歷史目標體重 (kg)';
    datasets.push({
      label: targetLabel,
      data: targetSeries.values,
      borderColor: '#94a3b8',
      backgroundColor: '#94a3b8',
      borderWidth: 2,
      borderDash: [6, 6],
      stepped: 'before',
      spanGaps: false,
      pointRadius: targetSeries.pointRadii,
      pointHoverRadius: 4,
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

  const items = reversed.map((r) => {
    const li = createEl('li', 'py-2.5 flex justify-between items-center gap-3');
    const info = createEl('div', 'min-w-0 flex-1');

    const topRow = createEl('div', 'flex items-baseline gap-3');
    topRow.append(
      createEl('span', 'w-20 shrink-0 font-semibold text-slate-800 tabular-nums', `${r.weight_kg} kg`),
      createEl('span', 'text-xs text-slate-400 tabular-nums shrink-0', String(r.recorded_at ?? ''))
    );
    info.appendChild(topRow);

    if (r.note) {
      info.appendChild(createEl('p', 'text-xs text-slate-500 mt-0.5 break-words', String(r.note)));
    }

    const delBtn = createEl('button', 'shrink-0 whitespace-nowrap text-xs text-rose-500 hover:underline px-1', '刪除');
    delBtn.type = 'button';
    delBtn.onclick = () => {
      if (!confirm('確定刪除此筆體重紀錄？')) return;
      optimisticDeleteRecord(r.id);
      showToast('已刪除紀錄');
    };

    li.append(info, delBtn);
    return li;
  });
  list.replaceChildren(...items);
}

export function initChartRangeControls({ onRangeChange }) {
  document.querySelectorAll('.range-btn').forEach((btn) => {
    btn.onclick = () => {
      state.selectedRange = btn.dataset.range;
      document.querySelectorAll('.range-btn').forEach((b) => {
        b.className = 'range-btn flex-1 py-1.5 rounded-lg text-slate-600';
      });
      btn.className = 'range-btn flex-1 py-1.5 rounded-lg bg-white text-teal-700 shadow-sm';
      onRangeChange();
    };
  });
}
