import { state } from '../state.js';
import { optimisticDeleteRecord } from '../services/syncQueue.js';
import { createEl, playSoftFade, showToast } from '../utils/dom.js';
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
  getDaysSinceLastRecord,
  getLocalTodayDate,
  getPresetHistoryRange,
  filterRecordsByDateRange
} from '../utils/metrics.js';
import { addCalendarYears, validateHistoryDateRange } from '../utils/validation.js';

const HISTORY_PAGE_SIZE = 10;
const LONG_PRESS_MS = 260;
const LONG_PRESS_MOVE_TOLERANCE_PX = 10;

let chartInstance = null;

const inspectState = {
  activeIndex: null,
  isInspecting: false,
  isPointerDown: false,
  activePointerId: null,
  pressTimer: null,
  startX: 0,
  startY: 0,
  lastClientX: 0,
  context: null // { labels, values, pointDates, targetValues, isHidden, theme, range }
};

function getMemberTheme(type) {
  if (type === 'cat') {
    return {
      lineColor: '#C07A57',
      fillColor: 'rgba(192, 122, 87, 0.16)',
      progressClass: 'goal-progress-cat',
      accentText: 'text-clay-700',
      inspectBarClass: 'bg-clay-50 border-clay-200 text-clay-700',
      dotBgClass: 'bg-clay-500'
    };
  }
  if (type === 'dog') {
    return {
      lineColor: '#B68A4C',
      fillColor: 'rgba(182, 138, 76, 0.16)',
      progressClass: 'goal-progress-dog',
      accentText: 'text-ochre-700',
      inspectBarClass: 'bg-ochre-50 border-ochre-200 text-ochre-700',
      dotBgClass: 'bg-ochre-500'
    };
  }
  return {
    lineColor: '#587864',
    fillColor: 'rgba(88, 120, 100, 0.16)',
    progressClass: '',
    accentText: 'text-sage-700',
    inspectBarClass: 'bg-sage-50 border-sage-200 text-sage-700',
    dotBgClass: 'bg-sage-600'
  };
}

// 在 Canvas 上直接繪製長按檢視的垂直／水平引導線、雙環焦點圓點與 X 軸日期標籤（絕不繪製體重數字）
const inspectCrosshairPlugin = {
  id: 'inspectCrosshair',
  afterDatasetsDraw(chart) {
    const idx = inspectState.activeIndex;
    const ctxData = inspectState.context;
    if (idx === null || !ctxData) return;

    const meta = chart.getDatasetMeta?.(0);
    const point = meta?.data?.[idx];
    const chartArea = chart.chartArea;
    if (!point || !chartArea) return;

    const c = chart.ctx;
    const theme = ctxData.theme;
    const px = point.x;
    const py = point.y;

    c.save();

    // 1. 垂直虛線引導線
    c.beginPath();
    c.setLineDash([4, 4]);
    c.lineWidth = 1.5;
    c.strokeStyle = theme.lineColor;
    c.globalAlpha = 0.5;
    c.moveTo(px, chartArea.top);
    c.lineTo(px, chartArea.bottom);
    c.stroke();

    // 2. 水平細虛線引導線（對齊該點高度）
    c.beginPath();
    c.setLineDash([3, 4]);
    c.lineWidth = 1;
    c.globalAlpha = 0.28;
    c.moveTo(chartArea.left, py);
    c.lineTo(px, py);
    c.stroke();

    c.setLineDash([]);
    c.globalAlpha = 1;

    // 3. 外圈柔和光暈 + 暖白雙環焦點圓點
    c.beginPath();
    c.arc(px, py, 11, 0, Math.PI * 2);
    c.fillStyle = theme.fillColor;
    c.fill();

    c.beginPath();
    c.arc(px, py, 6, 0, Math.PI * 2);
    c.fillStyle = '#FCFBF8';
    c.fill();
    c.lineWidth = 2.5;
    c.strokeStyle = theme.lineColor;
    c.stroke();

    c.beginPath();
    c.arc(px, py, 2.5, 0, Math.PI * 2);
    c.fillStyle = theme.lineColor;
    c.fill();

    // 4. 底部 X 軸日期膠囊標記，明確指出目前檢視的點位
    const tagLabel = String(ctxData.tagLabels?.[idx] ?? ctxData.labels[idx] ?? '');
    if (tagLabel) {
      c.font = '600 11.5px -apple-system, BlinkMacSystemFont, "Noto Sans TC", sans-serif';
      const textWidth = c.measureText(tagLabel).width;
      const pillW = textWidth + 14;
      const pillH = 20;
      const rawX = px - pillW / 2;
      const clampedX = Math.max(chartArea.left, Math.min(rawX, chartArea.right - pillW));
      const pillY = chartArea.bottom - pillH - 2;
      const radius = 10;

      c.beginPath();
      c.moveTo(clampedX + radius, pillY);
      c.lineTo(clampedX + pillW - radius, pillY);
      c.quadraticCurveTo(clampedX + pillW, pillY, clampedX + pillW, pillY + radius);
      c.lineTo(clampedX + pillW, pillY + pillH - radius);
      c.quadraticCurveTo(clampedX + pillW, pillY + pillH, clampedX + pillW - radius, pillY + pillH);
      c.lineTo(clampedX + radius, pillY + pillH);
      c.quadraticCurveTo(clampedX, pillY + pillH, clampedX, pillY + pillH - radius);
      c.lineTo(clampedX, pillY + radius);
      c.quadraticCurveTo(clampedX, pillY, clampedX + radius, pillY);
      c.closePath();
      c.fillStyle = theme.lineColor;
      c.fill();

      c.fillStyle = '#FCFBF8';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(tagLabel, clampedX + pillW / 2, pillY + pillH / 2 + 0.5);
    }

    c.restore();
  }
};

function renderInspectBar() {
  const bar = document.getElementById('chart-inspect-bar');
  if (!bar) return;

  const ctxData = inspectState.context;
  if (!ctxData || ctxData.values.length === 0) {
    bar.className = 'min-h-[34px] rounded-xl px-3 py-1.5 flex items-center justify-between gap-2 text-fluid-label bg-oat-50 border border-oat-200/70 text-ink-400';
    bar.classList.remove('hidden');
    bar.replaceChildren(
      createEl('span', 'font-medium text-ink-500 min-w-0 leading-snug', ctxData?.rangeSummary || '體重趨勢'),
      createEl('span', 'shrink-0 whitespace-nowrap text-ink-400', '尚無資料')
    );
    return;
  }

  bar.classList.remove('hidden');
  const idx = inspectState.activeIndex;

  if (idx === null || idx < 0 || idx >= ctxData.values.length) {
    bar.className = 'min-h-[34px] rounded-xl px-3 py-1.5 flex items-center justify-between gap-2 text-fluid-label bg-oat-50 border border-oat-200/70 text-ink-400';
    const hintText = ctxData.isHidden ? '長按檢視趨勢' : '長按左右拖曳檢視';
    bar.replaceChildren(
      createEl('span', 'font-medium text-ink-600 min-w-0 leading-snug', ctxData.rangeSummary || '體重趨勢'),
      createEl('span', 'shrink-0 whitespace-nowrap text-ink-400', hintText)
    );
    return;
  }

  const { labels, detailLabels, bucketCounts, values, pointDates, isHidden, theme, range } = ctxData;
  const val = Number(values[idx]);
  const count = bucketCounts?.[idx] || 1;
  const baseDateLabel = detailLabels?.[idx] || (range === 'day'
    ? String(pointDates[idx] || labels[idx] || '')
    : `${labels[idx] || ''}（平均）`);
  const dateDisplay = range !== 'day' && count > 1
    ? `${baseDateLabel} · ${count}筆`
    : baseDateLabel;

  bar.className = `min-h-[34px] rounded-xl px-3 py-1.5 flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-xs border transition-colors ${theme.inspectBarClass}`;

  const leftWrap = createEl('div', 'flex items-center gap-2 min-w-0');
  leftWrap.append(
    createEl('span', `w-2 h-2 rounded-full shrink-0 ${theme.dotBgClass}`),
    createEl('span', 'font-medium tabular-nums truncate', dateDisplay)
  );

  const rightWrap = createEl('div', 'flex items-center gap-2 shrink-0 tabular-nums whitespace-nowrap');

  if (isHidden) {
    const baseline = Number(values[0]);
    let relText = '區間起點';
    if (idx > 0 && Number.isFinite(val) && Number.isFinite(baseline)) {
      const delta = Number((val - baseline).toFixed(2));
      const sign = delta > 0 ? '+' : '';
      relText = `較起點 ${sign}${delta.toFixed(2)} kg`;
    }
    rightWrap.append(
      createEl('span', 'text-fluid-label opacity-80', relText),
      createEl('span', 'font-semibold text-sm text-ink-400 inline-flex items-center gap-1', `${MASKED_WEIGHT} kg`)
    );
  } else {
    if (idx > 0 && Number.isFinite(val) && Number.isFinite(Number(values[idx - 1]))) {
      const stepDelta = Number((val - Number(values[idx - 1])).toFixed(2));
      const sign = stepDelta > 0 ? '+' : '';
      const deltaClass = stepDelta > 0 ? 'text-rosewood-600' : 'text-sage-700';
      rightWrap.appendChild(
        createEl('span', `text-fluid-label font-medium ${deltaClass}`, `${sign}${stepDelta.toFixed(2)}`)
      );
    }
    rightWrap.appendChild(
      createEl('span', 'font-semibold text-sm text-ink', `${val} kg`)
    );
  }

  bar.replaceChildren(leftWrap, rightWrap);
}

function findNearestPointIndex(canvas, clientX) {
  if (!chartInstance || !inspectState.context || inspectState.context.values.length === 0) {
    return null;
  }
  const meta = chartInstance.getDatasetMeta?.(0);
  const points = meta?.data;
  if (!Array.isArray(points) || points.length === 0) return null;

  const rect = canvas.getBoundingClientRect();
  const localX = clientX - rect.left;

  let nearestIdx = 0;
  let minDist = Infinity;
  for (let i = 0; i < points.length; i++) {
    const dist = Math.abs(points[i].x - localX);
    if (dist < minDist) {
      minDist = dist;
      nearestIdx = i;
    }
  }
  return nearestIdx;
}

function setInspectIndex(nextIndex) {
  if (inspectState.activeIndex === nextIndex) return;
  const wasInspecting = inspectState.activeIndex !== null;
  inspectState.activeIndex = nextIndex;
  renderInspectBar();
  chartInstance?.draw?.();
  if (nextIndex !== null && typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    navigator.vibrate(wasInspecting ? 4 : 12);
  }
}

function clearInspection(shouldRedraw = true) {
  if (inspectState.pressTimer) {
    clearTimeout(inspectState.pressTimer);
    inspectState.pressTimer = null;
  }
  inspectState.isPointerDown = false;
  inspectState.activePointerId = null;
  inspectState.isInspecting = false;
  if (inspectState.activeIndex !== null) {
    inspectState.activeIndex = null;
    renderInspectBar();
    if (shouldRedraw) chartInstance?.draw?.();
  }
}

function bindChartLongPressEvents(canvas) {
  if (!canvas || canvas.dataset?.inspectBound === '1') return;
  if (canvas.dataset) canvas.dataset.inspectBound = '1';

  // 禁止長按彈出系統右鍵／儲存圖片選單
  canvas.addEventListener?.('contextmenu', (e) => e.preventDefault());

  const activateInspection = (clientX) => {
    inspectState.pressTimer = null;
    if (!inspectState.isPointerDown) return;
    inspectState.isInspecting = true;
    const idx = findNearestPointIndex(canvas, clientX);
    if (idx !== null) {
      setInspectIndex(idx);
    }
  };

  canvas.addEventListener?.('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (!inspectState.context || inspectState.context.values.length === 0) return;

    if (inspectState.pressTimer) clearTimeout(inspectState.pressTimer);
    inspectState.isPointerDown = true;
    inspectState.activePointerId = e.pointerId ?? null;
    inspectState.isInspecting = false;
    inspectState.startX = e.clientX;
    inspectState.startY = e.clientY;
    inspectState.lastClientX = e.clientX;

    inspectState.pressTimer = setTimeout(() => {
      activateInspection(inspectState.lastClientX);
    }, LONG_PRESS_MS);
  });

  // 啟動長按檢視後鎖定畫面捲動，讓手指可流暢左右滑動檢視每個點位
  canvas.addEventListener?.(
    'touchmove',
    (e) => {
      if (inspectState.isInspecting && e.cancelable) {
        e.preventDefault();
      }
    },
    { passive: false }
  );

  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('pointermove', (e) => {
      if (!inspectState.isPointerDown) return;
      if (inspectState.activePointerId !== null && e.pointerId !== undefined && e.pointerId !== inspectState.activePointerId) {
        return;
      }

      if (!inspectState.isInspecting) {
        const dist = Math.hypot(e.clientX - inspectState.startX, e.clientY - inspectState.startY);
        if (dist > LONG_PRESS_MOVE_TOLERANCE_PX) {
          // 尚未觸發長按前大幅移動，視為一般頁面捲動並取消長按計時
          if (inspectState.pressTimer) {
            clearTimeout(inspectState.pressTimer);
            inspectState.pressTimer = null;
          }
          inspectState.isPointerDown = false;
          inspectState.activePointerId = null;
          return;
        }
        inspectState.lastClientX = e.clientX;
        return;
      }

      const idx = findNearestPointIndex(canvas, e.clientX);
      if (idx !== null) {
        setInspectIndex(idx);
      }
    });

    const handleRelease = (e) => {
      if (!inspectState.isPointerDown && !inspectState.isInspecting) return;
      if (inspectState.activePointerId !== null && e.pointerId !== undefined && e.pointerId !== inspectState.activePointerId) {
        return;
      }
      clearInspection(true);
    };

    window.addEventListener('pointerup', handleRelease);
    window.addEventListener('pointercancel', handleRelease);
  }
}

function createStatCell(labelText, valueText, valueClass = 'text-ink') {
  const cell = createEl('div', 'bg-oat-50 border border-oat-200/70 rounded-xl px-3 py-2 text-center min-w-0');
  cell.append(
    createEl('div', 'text-fluid-label text-ink-400', labelText),
    createEl('div', `text-fluid-metric font-semibold tabular-nums mt-0.5 whitespace-nowrap ${valueClass}`, valueText)
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
        ? 'bg-oat-100 border border-oat-200 text-ink-700 rounded-2xl px-3.5 py-2.5 text-xs flex flex-wrap items-center justify-between gap-2'
        : 'bg-sage-50 border border-sage-200 text-sage-700 rounded-2xl px-3.5 py-2.5 text-xs flex flex-wrap items-center justify-between gap-2'
    );
    const leftText = createEl('div', 'flex items-center gap-2 min-w-0 flex-1');
    leftText.append(
      createIcon(isHidden ? (hasPin ? 'lock' : 'eyeOff') : 'unlock', 'w-4 h-4 shrink-0'),
      createEl(
        'span',
        'leading-snug',
        isHidden
          ? '隱私模式：已遮蔽體重並鎖定刪除'
          : '已暫時顯示（5 分鐘或離頁自動隱藏）'
      )
    );

    const toggleBtn = createEl(
      'button',
      isHidden
        ? 'shrink-0 whitespace-nowrap bg-linen border border-oat-200 text-sage-700 px-2.5 py-1 rounded-xl font-medium inline-flex items-center gap-1'
        : 'shrink-0 whitespace-nowrap bg-linen border border-sage-200 text-sage-700 px-2.5 py-1 rounded-xl font-medium inline-flex items-center gap-1'
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
      'bg-ochre-50 border border-ochre-200 text-ochre-700 rounded-2xl px-3.5 py-2.5 text-xs font-medium flex items-start gap-2 leading-relaxed'
    );
    notice.append(
      createIcon('clock', 'w-4 h-4 shrink-0 mt-0.5 text-ochre-600'),
      createEl(
        'span',
        'min-w-0 break-words',
        daysSince === null
          ? `${member.name} 尚未有體重紀錄，回總覽寫下第一筆紀錄吧。`
          : `${member.name} 已 ${daysSince} 天未記錄體重，記得定期量測追蹤變化喔。`
      )
    );
    blocks.push(notice);
  }

  // 2. 區間統計摘要（2 × 2 格狀，避免窄螢幕擠壓裁切；隱私模式保留區間變化）
  const stats = calculatePeriodStats(filteredRecords);
  const statsCard = createEl(
    'div',
    'journal-card p-3 rounded-2xl grid grid-cols-2 gap-2'
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
      createStatCell('區間平均', isHidden ? `${MASKED_WEIGHT} kg` : `${stats.avg} kg`, isHidden ? 'text-ink-400' : 'text-ink'),
      createStatCell('區間變化', deltaText === '--' ? '--' : `${deltaText} kg`, deltaColor),
      createStatCell('區間最低', isHidden ? `${MASKED_WEIGHT} kg` : `${stats.min} kg`, isHidden ? 'text-ink-400' : 'text-ink'),
      createStatCell('區間最高', isHidden ? `${MASKED_WEIGHT} kg` : `${stats.max} kg`, isHidden ? 'text-ink-400' : 'text-ink')
    );
  } else {
    statsCard.append(
      createStatCell('區間平均', '--', 'text-ink-400'),
      createStatCell('區間變化', '--', 'text-ink-400'),
      createStatCell('區間最低', '--', 'text-ink-400'),
      createStatCell('區間最高', '--', 'text-ink-400')
    );
  }
  blocks.push(statsCard);

  // 3. 目標體重達成進度條（隱私模式保留百分比，隱藏絕對公斤數）
  const progress = calculateGoalProgress(allMemberRecs, member.target_weight);
  if (progress) {
    const progCard = createEl('div', 'journal-card p-3.5 rounded-2xl space-y-2');
    const headRow = createEl('div', 'flex flex-wrap justify-between items-center gap-x-2 gap-y-0.5 text-xs');

    const titleWrap = createEl('span', 'font-medium text-ink-700 inline-flex items-center gap-1.5');
    titleWrap.append(
      createIcon('target', `w-3.5 h-3.5 shrink-0 ${theme.accentText}`),
      createEl('span', '', '目標達成進度')
    );

    const statusWrap = createEl(
      'span',
      `font-semibold tabular-nums whitespace-nowrap inline-flex items-center gap-1 ${progress.isAchieved ? 'text-sage-600' : theme.accentText}`
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

    const footRow = createEl('div', 'flex flex-wrap justify-between gap-x-2 gap-y-0.5 text-fluid-label text-ink-400 tabular-nums');
    if (isHidden) {
      footRow.append(
        createEl('span', 'whitespace-nowrap', `起始 ${MASKED_WEIGHT} kg`),
        createEl('span', 'text-ink-500 font-medium whitespace-nowrap', `目前 ${MASKED_WEIGHT} kg`),
        createEl('span', 'whitespace-nowrap', `目標 ${MASKED_WEIGHT} kg`)
      );
    } else {
      footRow.append(
        createEl('span', 'whitespace-nowrap', `起始 ${progress.startWeight} kg`),
        createEl('span', 'text-ink-700 font-medium whitespace-nowrap', `目前 ${progress.currentWeight} kg`),
        createEl('span', 'whitespace-nowrap', `目標 ${progress.targetWeight} kg`)
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

let isHistoryFilterPanelOpen = false;

function resolveHistoryRecords(allMemberRecs, chartFilteredRecords) {
  const filter = state.historyFilter;
  if (filter?.active && filter.startDate && filter.endDate) {
    return filterRecordsByDateRange(allMemberRecs, filter.startDate, filter.endDate);
  }
  return chartFilteredRecords;
}

function syncHistoryDateInputBounds() {
  const startInput = document.getElementById('history-start-date');
  const endInput = document.getElementById('history-end-date');
  if (!startInput || !endInput) return;

  const today = getLocalTodayDate();
  startInput.max = today;
  endInput.max = today;

  if (startInput.value && /^\d{4}-\d{2}-\d{2}$/.test(startInput.value)) {
    const oneYearAfterStart = addCalendarYears(startInput.value, 1);
    endInput.min = startInput.value;
    endInput.max = oneYearAfterStart && oneYearAfterStart < today ? oneYearAfterStart : today;
  } else {
    endInput.min = '2000-01-01';
  }
}

function syncHistoryFilterUI() {
  const toggleBtn = document.getElementById('btn-history-filter-toggle');
  const panel = document.getElementById('history-filter-panel');
  const activeBar = document.getElementById('history-active-filter');
  const filter = state.historyFilter;
  const isActive = Boolean(filter?.active && filter.startDate && filter.endDate);

  if (toggleBtn) {
    toggleBtn.setAttribute('aria-expanded', isHistoryFilterPanelOpen ? 'true' : 'false');
    toggleBtn.className = isActive || isHistoryFilterPanelOpen
      ? 'inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-xl border border-sage-200 bg-sage-50 text-sage-700 font-medium whitespace-nowrap'
      : 'inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-xl border border-oat-200 bg-oat-50 text-ink-600 hover:bg-oat-100 font-medium whitespace-nowrap';
  }

  if (panel) {
    panel.classList.toggle('hidden', !isHistoryFilterPanelOpen);
  }

  if (activeBar) {
    if (!isActive) {
      activeBar.classList.add('hidden');
      activeBar.replaceChildren();
    } else {
      activeBar.classList.remove('hidden');
      const pill = createEl(
        'div',
        'inline-flex items-center gap-1.5 max-w-full px-2.5 py-1 rounded-xl bg-sage-50 border border-sage-200 text-sage-700 text-xs'
      );
      const clearBtn = createEl(
        'button',
        'p-0.5 rounded-md hover:bg-sage-100 text-sage-700 shrink-0'
      );
      clearBtn.type = 'button';
      clearBtn.setAttribute('aria-label', '清除查詢區間');
      clearBtn.setAttribute('title', '清除查詢區間');
      clearBtn.appendChild(createIcon('close', 'w-3.5 h-3.5'));
      clearBtn.onclick = () => {
        state.historyFilter = { active: false, startDate: '', endDate: '' };
        state.historyPage = 1;
        isHistoryFilterPanelOpen = false;
        syncHistoryFilterUI();
        refreshCurrentMemberHistoryOnly(true);
      };
      pill.append(
        createIcon('calendar', 'w-3.5 h-3.5 shrink-0'),
        createEl('span', 'tabular-nums truncate font-medium', `${filter.startDate} ～ ${filter.endDate}`),
        clearBtn
      );
      activeBar.replaceChildren(pill);
    }
  }
}

function refreshCurrentMemberHistoryOnly(animate = false) {
  const member = state.appData.members.find((m) => m.id === state.selectedMemberId);
  const recs = state.appData.records.filter((r) => r.member_id === state.selectedMemberId);
  const memberHistory = (state.appData.targetHistory || []).filter((h) => h.member_id === state.selectedMemberId);
  const { filteredRecords } = aggregateRecords(recs, state.selectedRange);
  const historyRecords = resolveHistoryRecords(recs, filteredRecords);
  renderHistoryList(member, memberHistory, historyRecords);
  if (animate) {
    playSoftFade(document.getElementById('history-list'));
  }
}

const SWIPE_ACTION_WIDTH_PX = 64;
const SWIPE_OPEN_THRESHOLD_PX = 32;
const SWIPE_ARM_DELETE_PX = 132;
const SWIPE_LOCK_PX = 8;
const SWIPE_SYNTHETIC_MOUSE_GUARD_MS = 700;

let activeHistorySwipe = null;
let openHistorySwipeRow = null; // { row, content }
let historySwipeListenersBound = false;
let suppressHistoryClickUntil = 0;
let lastHistorySwipeTouchAt = 0;

function closeOpenHistorySwipeRow(exceptRow = null) {
  if (!openHistorySwipeRow || openHistorySwipeRow.row === exceptRow) return;
  const { row, content } = openHistorySwipeRow;
  openHistorySwipeRow = null;
  row.classList.remove('is-swiping', 'is-armed');
  if (content?.style) content.style.transform = 'translate3d(0, 0, 0)';
}

function updateHistorySwipeMove(clientX, clientY, nativeEvent = null) {
  if (!activeHistorySwipe) return;
  const s = activeHistorySwipe;
  const dx = clientX - s.startX;
  const dy = clientY - s.startY;

  if (s.locked === null) {
    if (Math.hypot(dx, dy) < SWIPE_LOCK_PX) return;
    if (Math.abs(dy) > Math.abs(dx) * 0.8) {
      s.locked = 'vertical';
      return;
    }
    if (s.baseOffset === 0 && dx >= 0) {
      s.locked = 'ignore';
      return;
    }
    s.locked = 'horizontal';
    closeOpenHistorySwipeRow(s.row);
    s.row.classList.add('is-swiping');
  }

  if (s.locked !== 'horizontal') return;
  if (s.inputKind === 'touch' && nativeEvent?.cancelable) {
    nativeEvent.preventDefault();
  }

  const rawX = s.baseOffset + dx;
  let nextX;
  if (rawX >= 0) {
    nextX = 0;
  } else if (rawX >= -SWIPE_ACTION_WIDTH_PX) {
    nextX = rawX;
  } else {
    const extra = rawX + SWIPE_ACTION_WIDTH_PX;
    const maxPull = Math.max(168, (s.rowWidth || 280) * 0.65);
    nextX = Math.max(-maxPull, -SWIPE_ACTION_WIDTH_PX + extra * 0.75);
  }

  s.currentOffset = nextX;
  if (s.content?.style) {
    s.content.style.transform = `translate3d(${nextX.toFixed(1)}px, 0, 0)`;
  }

  const shouldArm = nextX <= -SWIPE_ARM_DELETE_PX;
  if (shouldArm !== s.armed) {
    s.armed = shouldArm;
    s.row.classList.toggle('is-armed', shouldArm);
    if (shouldArm && typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(10);
    }
  }
}

function finishHistorySwipe(canceled = false) {
  if (!activeHistorySwipe) return;
  const s = activeHistorySwipe;
  activeHistorySwipe = null;

  s.row.classList.remove('is-swiping', 'is-armed');
  if (s.locked !== 'horizontal') return;

  suppressHistoryClickUntil = Date.now() + 260;

  if (canceled) {
    const restoreX = s.baseOffset;
    if (s.content?.style) s.content.style.transform = `translate3d(${restoreX}px, 0, 0)`;
    return;
  }

  if (s.armed) {
    if (s.content?.style) s.content.style.transform = `translate3d(-${SWIPE_ACTION_WIDTH_PX}px, 0, 0)`;
    openHistorySwipeRow = { row: s.row, content: s.content };
    const deleted = s.onDelete();
    if (!deleted) {
      closeOpenHistorySwipeRow();
    }
    return;
  }

  if (s.currentOffset <= -SWIPE_OPEN_THRESHOLD_PX) {
    if (s.content?.style) s.content.style.transform = `translate3d(-${SWIPE_ACTION_WIDTH_PX}px, 0, 0)`;
    openHistorySwipeRow = { row: s.row, content: s.content };
  } else {
    if (s.content?.style) s.content.style.transform = 'translate3d(0, 0, 0)';
    if (openHistorySwipeRow?.row === s.row) {
      openHistorySwipeRow = null;
    }
  }
}

function bindGlobalHistorySwipeListeners() {
  if (historySwipeListenersBound || typeof document === 'undefined' || typeof window === 'undefined') {
    return;
  }
  historySwipeListenersBound = true;

  document.addEventListener(
    'touchmove',
    (e) => {
      if (!activeHistorySwipe || activeHistorySwipe.inputKind !== 'touch') return;
      if (!e.touches || e.touches.length !== 1) {
        finishHistorySwipe(true);
        return;
      }
      const touch = e.touches[0];
      updateHistorySwipeMove(touch.clientX, touch.clientY, e);
    },
    { passive: false }
  );

  document.addEventListener(
    'touchend',
    () => {
      lastHistorySwipeTouchAt = Date.now();
      if (activeHistorySwipe && activeHistorySwipe.inputKind === 'touch') {
        finishHistorySwipe(false);
      }
    },
    { passive: true }
  );

  document.addEventListener(
    'touchcancel',
    () => {
      lastHistorySwipeTouchAt = Date.now();
      if (activeHistorySwipe && activeHistorySwipe.inputKind === 'touch') {
        finishHistorySwipe(true);
      }
    },
    { passive: true }
  );

  window.addEventListener('mousemove', (e) => {
    if (!activeHistorySwipe || activeHistorySwipe.inputKind !== 'mouse') return;
    updateHistorySwipeMove(e.clientX, e.clientY, e);
  });

  window.addEventListener('mouseup', () => {
    if (activeHistorySwipe && activeHistorySwipe.inputKind === 'mouse') {
      finishHistorySwipe(false);
    }
  });

  window.addEventListener('blur', () => {
    finishHistorySwipe(true);
  });
}

function renderHistoryList(member, memberHistory, filteredRecords) {
  const list = document.getElementById('history-list');
  const countEl = document.getElementById('history-count');
  const pagerEl = document.getElementById('history-pagination');

  activeHistorySwipe = null;
  openHistorySwipeRow = null;
  bindGlobalHistorySwipeListeners();
  syncHistoryFilterUI();

  const reversed = filteredRecords.slice().reverse();
  const total = reversed.length;

  if (total === 0) {
    state.historyPage = 1;
    if (countEl) countEl.textContent = '共 0 筆';
    const emptyText = state.historyFilter?.active
      ? '查詢區間內尚無紀錄'
      : '此區間尚無紀錄';
    list.replaceChildren(createEl('li', 'py-3 text-center text-ink-400', emptyText));
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
      ? `第 ${startIdx + 1}–${endIdx} / ${total} 筆`
      : `共 ${total} 筆`;
  }

  // 僅針對目前分頁顯示的紀錄計算「當下生效的目標體重」，與趨勢圖表規則完全一致
  const recordTargetSeries = resolveTargetWeightSeries(
    pageRecords.map((r) => r.recorded_at),
    memberHistory,
    member
  );

  const items = pageRecords.map((r, idx) => {
    const li = createEl('li', 'history-swipe-row');
    const contentEl = createEl('div', 'history-swipe-content py-2.5');
    const info = createEl('div', 'min-w-0');

    const numericWeight = Number(r.weight_kg);
    const weightDisplay = isHidden
      ? `${MASKED_WEIGHT} kg`
      : Number.isFinite(numericWeight)
        ? `${numericWeight.toFixed(2)} kg`
        : `${r.weight_kg} kg`;

    // 第 1 行：固定欄寬體重（小數兩位等寬對齊）＋ 垂直對齊之目標差距膠囊（固定列高避免有無膠囊高低不一）
    const topRow = createEl('div', 'grid grid-cols-[5.25rem_minmax(0,1fr)] items-center gap-x-2 min-h-[22px]');
    topRow.appendChild(
      createEl(
        'span',
        `font-semibold text-sm leading-5 tabular-nums whitespace-nowrap ${isHidden ? 'text-ink-400' : 'text-ink'}`,
        weightDisplay
      )
    );

    const pillSlot = createEl('div', 'flex items-center min-w-0 min-h-[22px]');
    const activeTarget = recordTargetSeries.values[idx];
    const targetGap = calculateTargetGap(r.weight_kg, activeTarget);
    if (targetGap) {
      if (isHidden) {
        if (targetGap.isAchieved) {
          pillSlot.appendChild(
            createEl(
              'span',
              'inline-flex items-center rounded-full px-2 py-0.5 text-[12px] leading-4 font-medium whitespace-nowrap bg-sage-50 text-sage-700 border border-sage-200/80',
              '已達標'
            )
          );
        }
      } else {
        const pillStyle = targetGap.isAchieved
          ? 'bg-sage-50 text-sage-700 border border-sage-200/80'
          : targetGap.gap > 0
            ? 'bg-ochre-50 text-ochre-700 border border-ochre-200/80'
            : 'bg-sage-50 text-sage-700 border border-sage-200/80';
        pillSlot.appendChild(
          createEl(
            'span',
            `inline-flex items-center rounded-full px-2 py-0.5 text-[12px] leading-4 font-medium tabular-nums whitespace-nowrap ${pillStyle}`,
            targetGap.compactLabel
          )
        );
      }
    }
    topRow.appendChild(pillSlot);

    // 第 2 行：量測日期 ＋ 單行省略備註（同欄寬對齊且固定高度，確保每筆歷史紀錄版面完全一致）
    const bottomRow = createEl('div', 'grid grid-cols-[5.25rem_minmax(0,1fr)] items-center gap-x-2 h-4 mt-1');
    const dateCell = createEl(
      'span',
      'text-fluid-label text-ink-400 tabular-nums leading-4 whitespace-nowrap',
      String(r.recorded_at ?? '')
    );
    const noteSlot = createEl('div', 'min-w-0 flex items-center');
    const noteText = String(r.note ?? '').trim();
    if (noteText) {
      const noteBtn = createEl(
        'button',
        'block w-full text-left text-xs leading-4 text-ink-500 hover:text-ink truncate',
        noteText
      );
      noteBtn.type = 'button';
      noteBtn.setAttribute('title', noteText);
      noteBtn.setAttribute('aria-label', `查看備註：${noteText}`);
      noteBtn.onclick = (e) => {
        if (Date.now() < suppressHistoryClickUntil) return;
        if (openHistorySwipeRow?.row === li) {
          e.stopPropagation();
          closeOpenHistorySwipeRow();
          return;
        }
        showToast(`${r.recorded_at} 備註：${noteText}`, false, 4000);
      };
      noteSlot.appendChild(noteBtn);
    }
    bottomRow.append(dateCell, noteSlot);

    info.append(topRow, bottomRow);
    contentEl.appendChild(info);

    if (!isHidden) {
      li.dataset.swipeDeleteRow = 'true';

      const triggerDelete = () => {
        if (isMemberWeightHidden(member)) {
          showToast('隱藏體重狀態下無法刪除紀錄，請先解鎖顯示', true);
          renderCharts();
          return false;
        }
        if (!confirm('確定刪除此筆體重紀錄？')) return false;
        if (optimisticDeleteRecord(r.id)) {
          showToast('已刪除紀錄');
          return true;
        }
        return false;
      };

      const actionBtn = createEl('button', 'history-swipe-action');
      actionBtn.type = 'button';
      actionBtn.setAttribute('aria-label', '刪除此筆體重紀錄');
      actionBtn.setAttribute('title', '刪除此筆體重紀錄');
      actionBtn.appendChild(createIcon('trash', 'w-4 h-4 shrink-0'));
      actionBtn.onclick = (e) => {
        e.stopPropagation();
        const deleted = triggerDelete();
        if (!deleted) closeOpenHistorySwipeRow();
      };

      const startSwipe = (inputKind, clientX, clientY) => {
        const isCurrentlyOpen = openHistorySwipeRow?.row === li;
        activeHistorySwipe = {
          row: li,
          content: contentEl,
          inputKind,
          startX: clientX,
          startY: clientY,
          baseOffset: isCurrentlyOpen ? -SWIPE_ACTION_WIDTH_PX : 0,
          currentOffset: isCurrentlyOpen ? -SWIPE_ACTION_WIDTH_PX : 0,
          rowWidth: li.getBoundingClientRect?.().width || 280,
          locked: null,
          armed: false,
          onDelete: triggerDelete
        };
      };

      contentEl.addEventListener(
        'touchstart',
        (e) => {
          lastHistorySwipeTouchAt = Date.now();
          if (!e.touches || e.touches.length !== 1) return;
          const touch = e.touches[0];
          startSwipe('touch', touch.clientX, touch.clientY);
        },
        { passive: true }
      );

      contentEl.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        if (Date.now() - lastHistorySwipeTouchAt < SWIPE_SYNTHETIC_MOUSE_GUARD_MS) return;
        startSwipe('mouse', e.clientX, e.clientY);
      });

      contentEl.onclick = () => {
        if (Date.now() < suppressHistoryClickUntil) return;
        if (openHistorySwipeRow?.row === li) {
          closeOpenHistorySwipeRow();
        }
      };

      li.append(actionBtn, contentEl);
    } else {
      li.appendChild(contentEl);
    }

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
    playSoftFade(list);
  };

  const isFirst = state.historyPage <= 1;
  const isLast = state.historyPage >= totalPages;
  const isMulti = totalPages > 2;

  const leftGroup = createEl('div', 'flex items-center justify-start gap-1');
  if (isMulti) {
    leftGroup.appendChild(
      createPagerButton({ iconName: 'chevronsLeft', ariaLabel: '第一頁', disabled: isFirst, onClick: () => goToPage(1), compact: true })
    );
  }
  leftGroup.appendChild(
    createPagerButton({
      label: isMulti ? '上頁' : '上一頁',
      iconName: 'chevronLeft',
      iconPosition: 'left',
      ariaLabel: '上一頁',
      disabled: isFirst,
      onClick: () => goToPage(state.historyPage - 1),
      compact: isMulti,
    })
  );

  const pageLabel = createEl(
    'span',
    'text-ink-500 font-medium tabular-nums whitespace-nowrap text-center',
    isMulti ? `${state.historyPage} / ${totalPages}` : `第 ${state.historyPage} / ${totalPages} 頁`
  );

  const rightGroup = createEl('div', 'flex items-center justify-end gap-1');
  rightGroup.appendChild(
    createPagerButton({
      label: isMulti ? '下頁' : '下一頁',
      iconName: 'chevronRight',
      iconPosition: 'right',
      ariaLabel: '下一頁',
      disabled: isLast,
      onClick: () => goToPage(state.historyPage + 1),
      compact: isMulti,
    })
  );
  if (isMulti) {
    rightGroup.appendChild(
      createPagerButton({ iconName: 'chevronsRight', ariaLabel: '最後一頁', disabled: isLast, onClick: () => goToPage(totalPages), compact: true })
    );
  }

  pagerEl.classList.remove('hidden');
  pagerEl.replaceChildren(leftGroup, pageLabel, rightGroup);
}

export function resizeChart() {
  chartInstance?.resize?.();
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
        playSoftFade(document.getElementById('chart-stats-summary'));
        playSoftFade(document.getElementById('history-list'));
      }
    };
    return btn;
  });
  pills.replaceChildren(...pillButtons);

  const member = state.appData.members.find((m) => m.id === state.selectedMemberId);
  const recs = state.appData.records.filter((r) => r.member_id === state.selectedMemberId);
  const memberHistory = (state.appData.targetHistory || []).filter((h) => h.member_id === state.selectedMemberId);
  const {
    labels,
    tagLabels,
    detailLabels,
    bucketCounts,
    values,
    pointDates,
    filteredRecords,
    rangeSummary
  } = aggregateRecords(recs, state.selectedRange);
  const isHidden = isMemberWeightHidden(member);
  const theme = getMemberTheme(member?.type);

  renderStatsSummary(member, recs, filteredRecords);

  const canvas = document.getElementById('weightChart');
  const canvasWrap = document.getElementById('chart-canvas-wrap');
  const emptyStateEl = document.getElementById('chart-empty-state');
  clearInspection(false);
  if (chartInstance) {
    chartInstance.destroy();
    chartInstance = null;
  }

  const targetSeries = resolveTargetWeightSeries(pointDates, memberHistory, member);
  inspectState.context = {
    labels,
    tagLabels,
    detailLabels,
    bucketCounts,
    values,
    pointDates,
    targetValues: targetSeries.values,
    isHidden,
    theme,
    range: state.selectedRange,
    rangeSummary
  };
  bindChartLongPressEvents(canvas);
  renderInspectBar();

  const historyRecords = resolveHistoryRecords(recs, filteredRecords);

  const hasData = values.length > 0;
  if (canvasWrap) canvasWrap.classList.toggle('hidden', !hasData);
  if (emptyStateEl) emptyStateEl.classList.toggle('hidden', hasData);

  if (!hasData) {
    renderHistoryList(member, memberHistory, historyRecords);
    return;
  }

  const ctx = canvas.getContext('2d');
  const baselineWeight = Number(values[0]);
  const isDaily = state.selectedRange === 'day';
  const pointRadius = values.length <= 12 ? 3 : 2;
  const datasets = [{
    label: isHidden
      ? (isDaily ? '體重趨勢' : '平均趨勢')
      : (isDaily ? '體重 (kg)' : '平均體重 (kg)'),
    data: values,
    borderColor: theme.lineColor,
    backgroundColor: theme.fillColor,
    borderWidth: 2.2,
    pointRadius,
    pointHoverRadius: 5,
    pointBackgroundColor: '#FCFBF8',
    pointBorderColor: theme.lineColor,
    pointBorderWidth: 1.8,
    fill: true,
    tension: 0.3
  }];

  if (targetSeries.hasAnyTarget && labels.length > 0) {
    const targetLabel = isHidden
      ? '目標線'
      : member?.target_weight
        ? `目標 ${member.target_weight} kg`
        : '歷史目標';
    datasets.push({
      label: targetLabel,
      data: targetSeries.values,
      borderColor: '#A8A295',
      backgroundColor: '#A8A295',
      borderWidth: 1.6,
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
    plugins: [inspectCrosshairPlugin],
    options: {
      responsive: true,
      interaction: {
        mode: 'index',
        intersect: false
      },
      animation: {
        duration: 320,
        easing: 'easeOutQuart'
      },
      plugins: {
        legend: {
          display: true,
          labels: {
            color: '#494C45',
            boxWidth: 10,
            boxHeight: 10,
            padding: 12,
            usePointStyle: true,
            font: { size: 12 }
          }
        },
        tooltip: {
          filter: () => !inspectState.isInspecting,
          backgroundColor: 'rgba(47, 52, 47, 0.92)',
          titleColor: '#FCFBF8',
          bodyColor: '#F6F4EE',
          cornerRadius: 10,
          padding: 10,
          displayColors: true,
          callbacks: {
            title: (items) => {
              const i = items?.[0]?.dataIndex;
              if (i === undefined || i === null) return '';
              const base = detailLabels?.[i] || labels[i] || '';
              const cnt = bucketCounts?.[i] || 1;
              return !isDaily && cnt > 1 ? `${base}（${cnt} 筆）` : base;
            },
            label: (ctxItem) => {
              if (!isHidden) {
                if (ctxItem.datasetIndex === 0) {
                  return `${isDaily ? '體重' : '平均體重'}：${ctxItem.parsed.y} kg`;
                }
                return `目標體重：${ctxItem.parsed.y} kg`;
              }
              if (ctxItem.datasetIndex === 0 && baselineWeight !== null && Number.isFinite(ctxItem.parsed.y)) {
                const delta = Number((ctxItem.parsed.y - baselineWeight).toFixed(2));
                const sign = delta > 0 ? '+' : '';
                return `較區間起點：${sign}${delta.toFixed(2)} kg`;
              }
              return `目標體重：${MASKED_WEIGHT} kg`;
            }
          }
        }
      },
      scales: {
        x: {
          border: { display: false },
          grid: { display: false },
          ticks: {
            color: '#727068',
            font: { size: 11.5 },
            maxRotation: 0,
            minRotation: 0,
            autoSkip: true,
            autoSkipPadding: 14,
            maxTicksLimit: 5,
            padding: 6
          }
        },
        y: {
          grace: isHidden ? '15%' : '12%',
          border: { display: false },
          ticks: {
            display: !isHidden,
            color: '#727068',
            font: { size: 11.5 },
            maxTicksLimit: 5,
            padding: 6,
            callback: (val) => {
              const num = Number(val);
              if (!Number.isFinite(num)) return val;
              return Number.isInteger(num) ? String(num) : String(Number(num.toFixed(1)));
            }
          },
          grid: { color: '#EFECE4' }
        }
      }
    }
  });

  renderHistoryList(member, memberHistory, historyRecords);
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
      playSoftFade(document.getElementById('chart-stats-summary'));
      playSoftFade(document.getElementById('history-list'));
    };
  });

  const toggleBtn = document.getElementById('btn-history-filter-toggle');
  const startInput = document.getElementById('history-start-date');
  const endInput = document.getElementById('history-end-date');
  const applyBtn = document.getElementById('btn-history-filter-apply');
  const resetBtn = document.getElementById('btn-history-filter-reset');

  const applyCustomRange = (startDate, endDate, { closePanel = true } = {}) => {
    const today = getLocalTodayDate();
    const checked = validateHistoryDateRange(startDate, endDate, today);
    if (checked.error) {
      showToast(checked.error, true);
      return false;
    }
    state.historyFilter = {
      active: true,
      startDate: checked.startDate,
      endDate: checked.endDate
    };
    state.historyPage = 1;
    if (startInput) startInput.value = checked.startDate;
    if (endInput) endInput.value = checked.endDate;
    syncHistoryDateInputBounds();
    if (closePanel) isHistoryFilterPanelOpen = false;
    syncHistoryFilterUI();
    refreshCurrentMemberHistoryOnly(true);
    return true;
  };

  if (toggleBtn) {
    toggleBtn.onclick = () => {
      isHistoryFilterPanelOpen = !isHistoryFilterPanelOpen;
      if (isHistoryFilterPanelOpen && startInput && endInput) {
        if (state.historyFilter.active) {
          startInput.value = state.historyFilter.startDate;
          endInput.value = state.historyFilter.endDate;
        } else if (!startInput.value || !endInput.value) {
          const def = getPresetHistoryRange('3m');
          startInput.value = def.startDate;
          endInput.value = def.endDate;
        }
        syncHistoryDateInputBounds();
      }
      syncHistoryFilterUI();
      if (isHistoryFilterPanelOpen) {
        playSoftFade(document.getElementById('history-filter-panel'));
      }
    };
  }

  if (startInput) {
    startInput.onchange = () => {
      syncHistoryDateInputBounds();
      if (endInput && startInput.value) {
        const today = getLocalTodayDate();
        const maxEnd = addCalendarYears(startInput.value, 1);
        const clampedMax = maxEnd && maxEnd < today ? maxEnd : today;
        if (!endInput.value || endInput.value < startInput.value) {
          endInput.value = clampedMax;
        } else if (endInput.value > clampedMax) {
          endInput.value = clampedMax;
          showToast('查詢區間最多一年，已自動調整結束日期');
        }
      }
    };
  }

  if (endInput) {
    endInput.onchange = () => {
      if (startInput && endInput.value && startInput.value) {
        const maxEnd = addCalendarYears(startInput.value, 1);
        if (endInput.value < startInput.value) {
          startInput.value = endInput.value;
        } else if (maxEnd && endInput.value > maxEnd) {
          const adjustedStart = addCalendarYears(endInput.value, -1);
          if (adjustedStart) {
            startInput.value = adjustedStart;
            syncHistoryDateInputBounds();
            showToast('查詢區間最多一年，已自動調整開始日期');
          }
        }
      }
    };
  }

  document.querySelectorAll('.history-preset-btn').forEach((btn) => {
    btn.onclick = () => {
      const preset = btn.dataset.historyPreset || '30d';
      const { startDate, endDate } = getPresetHistoryRange(preset);
      applyCustomRange(startDate, endDate, { closePanel: true });
    };
  });

  if (applyBtn) {
    applyBtn.onclick = () => {
      applyCustomRange(startInput?.value, endInput?.value, { closePanel: true });
    };
  }

  if (resetBtn) {
    resetBtn.onclick = () => {
      state.historyFilter = { active: false, startDate: '', endDate: '' };
      state.historyPage = 1;
      isHistoryFilterPanelOpen = false;
      syncHistoryFilterUI();
      refreshCurrentMemberHistoryOnly(true);
      showToast('已重設為跟隨圖表區間');
    };
  }
}
