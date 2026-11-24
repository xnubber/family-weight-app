import { state } from '../state.js';
import { optimisticDeleteRecord } from '../services/syncQueue.js';
import { createEl, showToast } from '../utils/dom.js';
import {
  aggregateRecords,
  resolveTargetWeightSeries,
  calculateTargetGap,
  calculatePeriodStats,
  calculateGoalProgress,
  getDaysSinceLastRecord
} from '../utils/metrics.js';

let chartInstance = null;

function createStatCell(labelText, valueText, valueClass = 'text-slate-800') {
  const cell = createEl('div', 'px-1 min-w-0 text-center');
  cell.append(
    createEl('div', 'text-[11px] text-slate-400 truncate', labelText),
    createEl('div', `text-xs font-bold tabular-nums mt-0.5 truncate ${valueClass}`, valueText)
  );
  return cell;
}

function renderStatsSummary(member, allMemberRecs, filteredRecords) {
  const container = document.getElementById('chart-stats-summary');
  if (!container) return;

  if (!member) {
    container.replaceChildren();
    return;
  }

  const blocks = [];
  const isCat = member.type === 'cat';

  // 1. 超過 7 天未量測提醒（或尚無任何紀錄）
  const daysSince = getDaysSinceLastRecord(allMemberRecs);
  if (daysSince === null) {
    blocks.push(
      createEl(
        'div',
        'bg-amber-50 border border-amber-200 text-amber-800 rounded-2xl px-3.5 py-2.5 text-xs font-medium',
        `⏰ ${member.name} 尚未有體重紀錄，快回總覽新增第一筆吧！`
      )
    );
  } else if (daysSince >= 7) {
    blocks.push(
      createEl(
        'div',
        'bg-amber-50 border border-amber-200 text-amber-800 rounded-2xl px-3.5 py-2.5 text-xs font-medium',
        `⏰ ${member.name} 已 ${daysSince} 天未記錄體重，記得定期量測追蹤變化喔！`
      )
    );
  }

  // 2. 區間統計摘要（平均 / 最低 / 最高 / 區間變化）
  const stats = calculatePeriodStats(filteredRecords);
  const statsCard = createEl(
    'div',
    'bg-white p-3.5 rounded-2xl shadow-sm border border-slate-100 grid grid-cols-4 divide-x divide-slate-100'
  );
  if (stats) {
    const deltaText = stats.delta === null
      ? '--'
      : `${stats.delta > 0 ? '+' : ''}${stats.delta.toFixed(2)}`;
    const deltaColor = stats.delta === null
      ? 'text-slate-400'
      : stats.delta > 0
        ? 'text-rose-500'
        : 'text-emerald-600';

    statsCard.append(
      createStatCell('區間平均', `${stats.avg} kg`),
      createStatCell('區間最低', `${stats.min} kg`),
      createStatCell('區間最高', `${stats.max} kg`),
      createStatCell('區間變化', deltaText === '--' ? '--' : `${deltaText} kg`, deltaColor)
    );
  } else {
    statsCard.append(
      createStatCell('區間平均', '--', 'text-slate-400'),
      createStatCell('區間最低', '--', 'text-slate-400'),
      createStatCell('區間最高', '--', 'text-slate-400'),
      createStatCell('區間變化', '--', 'text-slate-400')
    );
  }
  blocks.push(statsCard);

  // 3. 目標體重達成進度條
  const progress = calculateGoalProgress(allMemberRecs, member.target_weight);
  if (progress) {
    const progCard = createEl('div', 'bg-white p-3.5 rounded-2xl shadow-sm border border-slate-100 space-y-2');
    const headRow = createEl('div', 'flex justify-between items-center text-xs');
    headRow.append(
      createEl('span', 'font-semibold text-slate-600', '🎯 目標達成進度'),
      createEl(
        'span',
        `font-bold tabular-nums ${progress.isAchieved ? 'text-emerald-600' : (isCat ? 'text-orange-600' : 'text-teal-700')}`,
        progress.isAchieved ? '已達標 🎉 (100%)' : `${progress.percent}%`
      )
    );

    const bar = document.createElement('progress');
    bar.className = `goal-progress ${isCat ? 'goal-progress-cat' : ''}`;
    bar.value = progress.percent;
    bar.max = 100;

    const footRow = createEl('div', 'flex justify-between text-[11px] text-slate-400 tabular-nums');
    footRow.append(
      createEl('span', '', `起始 ${progress.startWeight} kg`),
      createEl('span', 'text-slate-600 font-medium', `目前 ${progress.currentWeight} kg`),
      createEl('span', '', `目標 ${progress.targetWeight} kg`)
    );

    progCard.append(headRow, bar, footRow);
    blocks.push(progCard);
  }

  container.replaceChildren(...blocks);
}

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

  renderStatsSummary(member, recs, filteredRecords);

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

  // 針對每筆歷史紀錄的日期計算「當下生效的目標體重」，與趨勢圖表規則完全一致
  const recordTargetSeries = resolveTargetWeightSeries(
    reversed.map((r) => r.recorded_at),
    memberHistory,
    member
  );

  const items = reversed.map((r, idx) => {
    const li = createEl('li', 'py-2.5 flex justify-between items-center gap-2');
    const info = createEl('div', 'min-w-0 flex-1');

    const topRow = createEl('div', 'flex items-baseline flex-wrap gap-x-2 gap-y-0.5');
    topRow.append(
      createEl('span', 'w-20 shrink-0 font-semibold text-slate-800 tabular-nums', `${r.weight_kg} kg`),
      createEl('span', 'w-20 shrink-0 text-xs text-slate-400 tabular-nums', String(r.recorded_at ?? ''))
    );

    const activeTarget = recordTargetSeries.values[idx];
    const targetGap = calculateTargetGap(r.weight_kg, activeTarget);
    if (targetGap) {
      const gapColor = targetGap.isAchieved
        ? 'text-emerald-600'
        : targetGap.gap > 0
          ? 'text-amber-600'
          : 'text-teal-600';
      topRow.appendChild(
        createEl('span', `text-xs font-medium tabular-nums shrink-0 ${gapColor}`, targetGap.compactLabel)
      );
    }

    info.appendChild(topRow);

    if (r.note) {
      info.appendChild(createEl('p', 'text-xs text-slate-500 mt-0.5 break-words', String(r.note)));
    }

    const delBtn = createEl(
      'button',
      'shrink-0 whitespace-nowrap text-xs text-rose-500 hover:bg-rose-50 px-2 py-1 rounded-lg',
      '刪除'
    );
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
