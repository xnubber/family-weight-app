import { state } from '../state.js';
import { optimisticDeleteRecord } from '../services/syncQueue.js';
import { createEl, showToast } from '../utils/dom.js';
import { createIcon } from '../utils/icons.js';
import { createAvatarNode, resolveMemberAvatar } from '../utils/avatars.js';
import { requestMemberUnlock } from './modals.js';
import {
  MASKED_WEIGHT,
  isMemberPrivacyEnabled,
  isMemberWeightHidden,
  lockMember,
  memberHasPrivacyPin
} from '../utils/privacy.js';
import {
  aggregateRecords,
  resolveTargetWeightSeries,
  calculateTargetGap,
  calculatePeriodStats,
  calculateGoalProgress,
  getDaysSinceLastRecord
} from '../utils/metrics.js';

const HISTORY_PAGE_SIZE = 10;
let chartInstance = null;

function getMemberTheme(type) {
  if (type === 'cat') {
    return {
      lineColor: '#C07A57',
      fillColor: 'rgba(192, 122, 87, 0.14)',
      progressClass: 'goal-progress-cat',
      accentText: 'text-clay-700'
    };
  }
  if (type === 'dog') {
    return {
      lineColor: '#B68A4C',
      fillColor: 'rgba(182, 138, 76, 0.14)',
      progressClass: 'goal-progress-dog',
      accentText: 'text-ochre-700'
    };
  }
  return {
    lineColor: '#587864',
    fillColor: 'rgba(88, 120, 100, 0.14)',
    progressClass: '',
    accentText: 'text-sage-700'
  };
}

function createStatCell(labelText, valueText, valueClass = 'text-ink') {
  const cell = createEl('div', 'px-1 min-w-0 text-center');
  cell.append(
    createEl('div', 'text-[11px] text-ink-400 truncate', labelText),
    createEl('div', `text-xs font-semibold tabular-nums mt-0.5 truncate ${valueClass}`, valueText)
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
  const theme = getMemberTheme(member.type);
  const isPrivacyOn = isMemberPrivacyEnabled(member);
  const isHidden = isMemberWeightHidden(member);
  const hasPin = memberHasPrivacyPin(member);

  // 0. 隱私保護狀態列（提供一鍵解鎖檢視或立即重新隱藏）
  if (isPrivacyOn) {
    const privBanner = createEl(
      'div',
      isHidden
        ? 'bg-oat-100 border border-oat-200 text-ink-700 rounded-2xl px-3.5 py-2.5 text-xs flex items-center justify-between gap-2'
        : 'bg-sage-50 border border-sage-200 text-sage-700 rounded-2xl px-3.5 py-2.5 text-xs flex items-center justify-between gap-2'
    );
    const leftText = createEl('div', 'flex items-center gap-2 min-w-0');
    leftText.append(
      createIcon(isHidden ? (hasPin ? 'lock' : 'eyeOff') : 'unlock', 'w-4 h-4 shrink-0'),
      createEl(
        'span',
        'leading-snug',
        isHidden
          ? '隱私模式：已遮蔽真實體重與圖表刻度，僅呈現變化趨勢'
          : '已暫時顯示真實體重（5 分鐘或離開畫面將自動隱藏）'
      )
    );

    const toggleBtn = createEl(
      'button',
      isHidden
        ? 'shrink-0 bg-linen border border-oat-200 text-sage-700 px-2.5 py-1 rounded-xl font-medium inline-flex items-center gap-1'
        : 'shrink-0 bg-linen border border-sage-200 text-sage-700 px-2.5 py-1 rounded-xl font-medium inline-flex items-center gap-1'
    );
    toggleBtn.type = 'button';
    toggleBtn.append(
      createIcon(isHidden ? 'eye' : 'eyeOff', 'w-3.5 h-3.5 shrink-0'),
      createEl('span', '', isHidden ? (hasPin ? '密碼解鎖' : '暫時顯示') : '立即隱藏')
    );
    toggleBtn.onclick = () => {
      if (isHidden) {
        requestMemberUnlock(member, () => renderCharts());
      } else {
        lockMember(member.id);
        showToast('已重新隱藏真實體重');
      }
    };

    privBanner.append(leftText, toggleBtn);
    blocks.push(privBanner);
  }

  // 1. 超過 7 天未量測提醒（或尚無任何紀錄）
  const daysSince = getDaysSinceLastRecord(allMemberRecs);
  if (daysSince === null || daysSince >= 7) {
    const notice = createEl(
      'div',
      'bg-ochre-50 border border-ochre-200 text-ochre-700 rounded-2xl px-3.5 py-2.5 text-xs font-medium flex items-center gap-2'
    );
    notice.append(
      createIcon('clock', 'w-4 h-4 shrink-0 text-ochre-600'),
      createEl(
        'span',
        '',
        daysSince === null
          ? `${member.name} 尚未有體重紀錄，回總覽寫下第一筆紀錄吧。`
          : `${member.name} 已 ${daysSince} 天未記錄體重，記得定期量測追蹤變化喔。`
      )
    );
    blocks.push(notice);
  }

  // 2. 區間統計摘要（隱私模式遮蔽平均／最低／最高，保留區間變化）
  const stats = calculatePeriodStats(filteredRecords);
  const statsCard = createEl(
    'div',
    'journal-card p-3.5 rounded-2xl grid grid-cols-4 divide-x divide-oat-200'
  );
  if (stats) {
    const deltaText = stats.delta === null
      ? '--'
      : `${stats.delta > 0 ? '+' : ''}${stats.delta.toFixed(2)}`;
    const deltaColor = stats.delta === null
      ? 'text-ink-400'
      : stats.delta > 0
        ? 'text-rosewood-600'
        : 'text-sage-600';

    statsCard.append(
      createStatCell('區間平均', isHidden ? MASKED_WEIGHT : `${stats.avg} kg`, isHidden ? 'text-ink-400' : 'text-ink'),
      createStatCell('區間最低', isHidden ? MASKED_WEIGHT : `${stats.min} kg`, isHidden ? 'text-ink-400' : 'text-ink'),
      createStatCell('區間最高', isHidden ? MASKED_WEIGHT : `${stats.max} kg`, isHidden ? 'text-ink-400' : 'text-ink'),
      createStatCell('區間變化', deltaText === '--' ? '--' : `${deltaText} kg`, deltaColor)
    );
  } else {
    statsCard.append(
      createStatCell('區間平均', '--', 'text-ink-400'),
      createStatCell('區間最低', '--', 'text-ink-400'),
      createStatCell('區間最高', '--', 'text-ink-400'),
      createStatCell('區間變化', '--', 'text-ink-400')
    );
  }
  blocks.push(statsCard);

  // 3. 目標體重達成進度條（隱私模式保留百分比，隱藏絕對公斤數）
  const progress = calculateGoalProgress(allMemberRecs, member.target_weight);
  if (progress) {
    const progCard = createEl('div', 'journal-card p-3.5 rounded-2xl space-y-2');
    const headRow = createEl('div', 'flex justify-between items-center text-xs');

    const titleWrap = createEl('span', 'font-medium text-ink-700 inline-flex items-center gap-1.5');
    titleWrap.append(
      createIcon('target', `w-3.5 h-3.5 shrink-0 ${theme.accentText}`),
      createEl('span', '', '目標達成進度')
    );

    const statusWrap = createEl(
      'span',
      `font-semibold tabular-nums inline-flex items-center gap-1 ${progress.isAchieved ? 'text-sage-600' : theme.accentText}`
    );
    if (progress.isAchieved) {
      statusWrap.append(
        createIcon('check', 'w-3.5 h-3.5 shrink-0'),
        createEl('span', '', '已達標 (100%)')
      );
    } else {
      statusWrap.textContent = `${progress.percent}%`;
    }

    headRow.append(titleWrap, statusWrap);

    const bar = document.createElement('progress');
    bar.className = `goal-progress ${theme.progressClass}`.trim();
    bar.value = progress.percent;
    bar.max = 100;

    const footRow = createEl('div', 'flex justify-between text-[11px] text-ink-400 tabular-nums');
    if (isHidden) {
      footRow.append(
        createEl('span', '', `起始 ${MASKED_WEIGHT} kg`),
        createEl('span', 'text-ink-500 font-medium', `目前 ${MASKED_WEIGHT} kg`),
        createEl('span', '', `目標 ${MASKED_WEIGHT} kg`)
      );
    } else {
      footRow.append(
        createEl('span', '', `起始 ${progress.startWeight} kg`),
        createEl('span', 'text-ink-700 font-medium', `目前 ${progress.currentWeight} kg`),
        createEl('span', '', `目標 ${progress.targetWeight} kg`)
      );
    }

    progCard.append(headRow, bar, footRow);
    blocks.push(progCard);
  }

  container.replaceChildren(...blocks);
}

function createPagerButton({ label = '', iconName = '', iconPosition = 'left', ariaLabel, disabled, onClick, compact = false }) {
  const btn = createEl(
    'button',
    `${compact ? 'px-2' : 'px-2.5'} py-1.5 rounded-xl border border-oat-200 bg-linen text-ink-700 font-medium whitespace-nowrap inline-flex items-center gap-1`
  );
  btn.type = 'button';
  btn.disabled = disabled;
  btn.setAttribute('aria-label', ariaLabel);

  const iconEl = iconName ? createIcon(iconName, 'w-3.5 h-3.5 shrink-0') : null;
  const textEl = label ? createEl('span', '', label) : null;

  if (iconEl && textEl) {
    if (iconPosition === 'right') btn.append(textEl, iconEl);
    else btn.append(iconEl, textEl);
  } else if (iconEl) {
    btn.appendChild(iconEl);
  } else if (textEl) {
    btn.appendChild(textEl);
  }

  if (!disabled) {
    btn.onclick = onClick;
  }
  return btn;
}

function renderHistoryList(member, memberHistory, filteredRecords) {
  const list = document.getElementById('history-list');
  const countEl = document.getElementById('history-count');
  const pagerEl = document.getElementById('history-pagination');

  const reversed = filteredRecords.slice().reverse();
  const total = reversed.length;

  if (total === 0) {
    state.historyPage = 1;
    if (countEl) countEl.textContent = '';
    list.replaceChildren(createEl('li', 'py-3 text-center text-ink-400', '此區間尚無紀錄'));
    if (pagerEl) {
      pagerEl.classList.add('hidden');
      pagerEl.replaceChildren();
    }
    return;
  }

  const isHidden = isMemberWeightHidden(member);
  const totalPages = Math.max(1, Math.ceil(total / HISTORY_PAGE_SIZE));
  state.historyPage = Math.min(Math.max(1, Number(state.historyPage) || 1), totalPages);

  const startIdx = (state.historyPage - 1) * HISTORY_PAGE_SIZE;
  const endIdx = Math.min(startIdx + HISTORY_PAGE_SIZE, total);
  const pageRecords = reversed.slice(startIdx, endIdx);

  if (countEl) {
    countEl.textContent = totalPages > 1
      ? `第 ${startIdx + 1}–${endIdx} 筆 / 共 ${total} 筆`
      : `共 ${total} 筆`;
  }

  // 僅針對目前分頁顯示的紀錄計算「當下生效的目標體重」，與趨勢圖表規則完全一致
  const recordTargetSeries = resolveTargetWeightSeries(
    pageRecords.map((r) => r.recorded_at),
    memberHistory,
    member
  );

  const items = pageRecords.map((r, idx) => {
    const li = createEl('li', 'py-2.5 flex justify-between items-center gap-2');
    const info = createEl('div', 'min-w-0 flex-1');

    const topRow = createEl('div', 'flex items-baseline flex-wrap gap-x-2 gap-y-0.5');
    topRow.append(
      createEl(
        'span',
        `w-20 shrink-0 font-semibold tabular-nums ${isHidden ? 'text-ink-400' : 'text-ink'}`,
        isHidden ? `${MASKED_WEIGHT} kg` : `${r.weight_kg} kg`
      ),
      createEl('span', 'w-20 shrink-0 text-xs text-ink-400 tabular-nums', String(r.recorded_at ?? ''))
    );

    const activeTarget = recordTargetSeries.values[idx];
    const targetGap = calculateTargetGap(r.weight_kg, activeTarget);
    if (targetGap) {
      if (isHidden) {
        if (targetGap.isAchieved) {
          topRow.appendChild(createEl('span', 'text-xs font-medium shrink-0 text-sage-600', '已達標'));
        }
      } else {
        const gapColor = targetGap.isAchieved
          ? 'text-sage-600'
          : targetGap.gap > 0
            ? 'text-ochre-600'
            : 'text-sage-700';
        topRow.appendChild(
          createEl('span', `text-xs font-medium tabular-nums shrink-0 ${gapColor}`, targetGap.compactLabel)
        );
      }
    }

    info.appendChild(topRow);

    if (r.note) {
      info.appendChild(createEl('p', 'text-xs text-ink-500 mt-0.5 break-words', String(r.note)));
    }

    const delBtn = createEl(
      'button',
      'shrink-0 whitespace-nowrap text-xs text-rosewood-600 hover:bg-rosewood-50 px-2 py-1 rounded-lg',
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

  if (!pagerEl) return;
  if (totalPages <= 1) {
    pagerEl.classList.add('hidden');
    pagerEl.replaceChildren();
    return;
  }

  const goToPage = (targetPage) => {
    state.historyPage = targetPage;
    renderHistoryList(member, memberHistory, filteredRecords);
  };

  const isFirst = state.historyPage <= 1;
  const isLast = state.historyPage >= totalPages;

  const leftGroup = createEl('div', 'flex items-center gap-1');
  if (totalPages > 2) {
    leftGroup.appendChild(
      createPagerButton({ iconName: 'chevronsLeft', ariaLabel: '第一頁', disabled: isFirst, onClick: () => goToPage(1), compact: true })
    );
  }
  leftGroup.appendChild(
    createPagerButton({ label: '上一頁', iconName: 'chevronLeft', iconPosition: 'left', ariaLabel: '上一頁', disabled: isFirst, onClick: () => goToPage(state.historyPage - 1) })
  );

  const pageLabel = createEl(
    'span',
    'text-ink-500 font-medium tabular-nums whitespace-nowrap',
    totalPages > 2 ? `${state.historyPage} / ${totalPages} 頁` : `第 ${state.historyPage} / ${totalPages} 頁`
  );

  const rightGroup = createEl('div', 'flex items-center gap-1');
  rightGroup.appendChild(
    createPagerButton({ label: '下一頁', iconName: 'chevronRight', iconPosition: 'right', ariaLabel: '下一頁', disabled: isLast, onClick: () => goToPage(state.historyPage + 1) })
  );
  if (totalPages > 2) {
    rightGroup.appendChild(
      createPagerButton({ iconName: 'chevronsRight', ariaLabel: '最後一頁', disabled: isLast, onClick: () => goToPage(totalPages), compact: true })
    );
  }

  pagerEl.classList.remove('hidden');
  pagerEl.replaceChildren(leftGroup, pageLabel, rightGroup);
}

export function renderCharts() {
  const pills = document.getElementById('chart-member-pills');
  const pillButtons = state.appData.members.map((m) => {
    const isActive = m.id === state.selectedMemberId;
    const btn = createEl(
      'button',
      `pill-btn shrink-0 inline-flex items-center gap-1.5 pl-1.5 pr-3 py-1 rounded-full text-xs font-medium ${isActive ? 'bg-sage-600 text-linen shadow-sm' : 'bg-linen border border-oat-200 text-ink-700'}`
    );
    btn.type = 'button';
    btn.dataset.id = String(m.id);
    btn.append(
      createAvatarNode(resolveMemberAvatar(m), 'w-5 h-5'),
      createEl('span', '', String(m.name ?? ''))
    );
    if (isMemberWeightHidden(m)) {
      btn.appendChild(
        createIcon(memberHasPrivacyPin(m) ? 'lock' : 'eyeOff', `w-3 h-3 shrink-0 ${isActive ? 'text-linen/85' : 'text-ink-400'}`)
      );
    }
    btn.onclick = () => {
      if (state.selectedMemberId !== m.id) {
        state.selectedMemberId = m.id;
        state.historyPage = 1;
        renderCharts();
      }
    };
    return btn;
  });
  pills.replaceChildren(...pillButtons);

  const member = state.appData.members.find((m) => m.id === state.selectedMemberId);
  const recs = state.appData.records.filter((r) => r.member_id === state.selectedMemberId);
  const memberHistory = (state.appData.targetHistory || []).filter((h) => h.member_id === state.selectedMemberId);
  const { labels, values, pointDates, filteredRecords } = aggregateRecords(recs, state.selectedRange);
  const isHidden = isMemberWeightHidden(member);

  renderStatsSummary(member, recs, filteredRecords);

  const ctx = document.getElementById('weightChart').getContext('2d');
  if (chartInstance) chartInstance.destroy();
  const theme = getMemberTheme(member?.type);
  const baselineWeight = values.length > 0 ? Number(values[0]) : null;

  const datasets = [{
    label: isHidden
      ? `${member?.name || ''} 體重趨勢（已隱藏數值）`
      : `${member?.name || ''} 體重 (kg)${state.selectedRange === 'day' ? '' : '（平均）'}`,
    data: values,
    borderColor: theme.lineColor,
    backgroundColor: theme.fillColor,
    borderWidth: 2,
    pointRadius: 2.5,
    pointHoverRadius: 5,
    fill: true,
    tension: 0.32
  }];

  const targetSeries = resolveTargetWeightSeries(pointDates, memberHistory, member);
  if (targetSeries.hasAnyTarget && labels.length > 0) {
    const targetLabel = isHidden
      ? '目標線（已隱藏數值）'
      : member?.target_weight
        ? `目標體重（目前 ${member.target_weight} kg）`
        : '歷史目標體重 (kg)';
    datasets.push({
      label: targetLabel,
      data: targetSeries.values,
      borderColor: '#A8A295',
      backgroundColor: '#A8A295',
      borderWidth: 1.8,
      borderDash: [5, 5],
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
    options: {
      responsive: true,
      plugins: {
        legend: {
          display: true,
          labels: { color: '#494C45', boxWidth: 12, usePointStyle: true }
        },
        tooltip: {
          callbacks: {
            label: (ctxItem) => {
              if (!isHidden) {
                return `${ctxItem.dataset.label}: ${ctxItem.parsed.y} kg`;
              }
              if (ctxItem.datasetIndex === 0 && baselineWeight !== null && Number.isFinite(ctxItem.parsed.y)) {
                const delta = Number((ctxItem.parsed.y - baselineWeight).toFixed(2));
                const sign = delta > 0 ? '+' : '';
                return `較區間起點：${sign}${delta.toFixed(2)} kg`;
              }
              return '目標體重：已隱藏';
            }
          }
        }
      },
      scales: {
        x: {
          ticks: { color: '#727068' },
          grid: { color: '#EFECE4' }
        },
        y: {
          ticks: {
            display: !isHidden,
            color: '#727068'
          },
          grid: { color: '#EFECE4' }
        }
      }
    }
  });

  renderHistoryList(member, memberHistory, filteredRecords);
}

export function initChartRangeControls({ onRangeChange }) {
  document.querySelectorAll('.range-btn').forEach((btn) => {
    btn.onclick = () => {
      state.selectedRange = btn.dataset.range;
      state.historyPage = 1;
      document.querySelectorAll('.range-btn').forEach((b) => {
        b.className = 'range-btn flex-1 py-1.5 rounded-xl text-ink-500';
      });
      btn.className = 'range-btn flex-1 py-1.5 rounded-xl bg-linen text-sage-700 shadow-sm';
      onRangeChange();
    };
  });
}
