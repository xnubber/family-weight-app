import { state } from '../state.js';
import { optimisticDeleteRecord, optimisticDeleteHeightRecord } from '../services/syncQueue.js';
import { createEl, playSoftFade, showToast } from '../utils/dom.js';
import { createIcon } from '../utils/icons.js';
import { createAvatarNode, resolveMemberAvatar } from '../utils/avatars.js';
import { requestMemberUnlock, openRecordModal } from './modals.js';
import {
  MASKED_WEIGHT,
  isMemberPrivacyEnabled,
  isMemberWeightHidden,
  lockMember,
  memberHasPrivacyPin
} from '../utils/privacy.js';
import {
  aggregateRecords,
  aggregateHeightRecords,
  resolveTargetWeightSeries,
  calculateTargetGap,
  calculatePeriodStats,
  calculateHeightPeriodStats,
  calculateGoalProgress,
  formatHeightCm,
  formatHeightDeltaCm,
  getDaysSinceLastRecord,
  getLocalTodayDate,
  getPresetHistoryRange,
  filterRecordsByDateRange
} from '../utils/metrics.js';
import { addCalendarYears, validateHistoryDateRange } from '../utils/validation.js';
import { formatLocalizedHistoryDate, t } from '../utils/i18n.js';
import { getCurrentYearInTimeZone, getWeekdayFromYmd } from '../utils/timezone.js';
import {
  formatWeight,
  formatWeightDelta,
  getWeightUnit,
  getWeightUnitLabel,
  kgToDisplay
} from '../utils/units.js';
import { getChartThemePalette } from '../utils/theme.js';

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
  const palette = getChartThemePalette();
  if (type === 'cat') {
    return {
      lineColor: palette.catLine,
      fillColor: palette.catFill,
      progressClass: 'goal-progress-cat',
      accentText: 'text-clay-700',
      inspectBarClass: 'bg-clay-50 border-clay-200 text-clay-700',
      dotBgClass: 'bg-clay-500'
    };
  }
  if (type === 'dog') {
    return {
      lineColor: palette.dogLine,
      fillColor: palette.dogFill,
      progressClass: 'goal-progress-dog',
      accentText: 'text-ochre-700',
      inspectBarClass: 'bg-ochre-50 border-ochre-200 text-ochre-700',
      dotBgClass: 'bg-ochre-500'
    };
  }
  return {
    lineColor: palette.humanLine,
    fillColor: palette.humanFill,
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
  const isHeightMetric = ctxData?.metric === 'height';
  const fallbackTitle = isHeightMetric ? t('charts.heightTrendTitle') : t('charts.trendTitle');

  if (!ctxData || ctxData.values.length === 0) {
    bar.className = 'min-h-[34px] rounded-xl px-3 py-1.5 flex items-center justify-between gap-2 text-fluid-label bg-oat-50 border border-oat-200/70 text-ink-400';
    bar.classList.remove('hidden');
    bar.replaceChildren(
      createEl('span', 'font-medium text-ink-500 min-w-0 leading-snug', ctxData?.rangeSummary || fallbackTitle),
      createEl('span', 'shrink-0 whitespace-nowrap text-ink-400', t('common.noData'))
    );
    return;
  }

  bar.classList.remove('hidden');
  const idx = inspectState.activeIndex;

  if (idx === null || idx < 0 || idx >= ctxData.values.length) {
    bar.className = 'min-h-[34px] rounded-xl px-3 py-1.5 flex items-center justify-between gap-2 text-fluid-label bg-oat-50 border border-oat-200/70 text-ink-400';
    const hintText = !isHeightMetric && ctxData.isHidden ? t('charts.hintHidden') : t('charts.hintVisible');
    bar.replaceChildren(
      createEl('span', 'font-medium text-ink-600 min-w-0 leading-snug', ctxData.rangeSummary || fallbackTitle),
      createEl('span', 'shrink-0 whitespace-nowrap text-ink-400', hintText)
    );
    return;
  }

  const { labels, detailLabels, bucketCounts, values, pointDates, isHidden, theme, range } = ctxData;
  const val = Number(values[idx]);
  const count = bucketCounts?.[idx] || 1;
  const unitLabel = getWeightUnitLabel();
  const baseDateLabel = detailLabels?.[idx] || String(pointDates[idx] || labels[idx] || '');
  const dateDisplay = range !== 'day' && count > 1
    ? `${baseDateLabel} · ${t('charts.bucketCountCompact', { count })}`
    : baseDateLabel;

  bar.className = `min-h-[34px] rounded-xl px-3 py-1.5 flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-xs border transition-colors ${theme.inspectBarClass}`;

  const leftWrap = createEl('div', 'flex items-center gap-2 min-w-0');
  leftWrap.append(
    createEl('span', `w-2 h-2 rounded-full shrink-0 ${theme.dotBgClass}`),
    createEl('span', 'font-medium tabular-nums truncate', dateDisplay)
  );

  const rightWrap = createEl('div', 'flex items-center gap-2 shrink-0 tabular-nums whitespace-nowrap');

  if (isHeightMetric) {
    if (idx > 0 && Number.isFinite(val) && Number.isFinite(Number(values[idx - 1]))) {
      const stepDeltaCm = Number((val - Number(values[idx - 1])).toFixed(1));
      const deltaClass = stepDeltaCm > 0 ? 'text-sage-700' : 'text-ink-500';
      rightWrap.appendChild(
        createEl('span', `text-fluid-label font-medium ${deltaClass}`, formatHeightDeltaCm(stepDeltaCm, { withUnit: false }))
      );
    }
    rightWrap.appendChild(
      createEl('span', 'font-semibold text-sm text-ink', formatHeightCm(val))
    );
  } else if (isHidden) {
    const baseline = Number(values[0]);
    let relText = t('charts.periodStart');
    if (idx > 0 && Number.isFinite(val) && Number.isFinite(baseline)) {
      const deltaKg = Number((val - baseline).toFixed(2));
      relText = t('charts.deltaFromStart', { delta: formatWeightDelta(deltaKg) });
    }
    rightWrap.append(
      createEl('span', 'text-fluid-label opacity-80', relText),
      createEl('span', 'font-semibold text-sm text-ink-400 inline-flex items-center gap-1', `${MASKED_WEIGHT} ${unitLabel}`)
    );
  } else {
    if (idx > 0 && Number.isFinite(val) && Number.isFinite(Number(values[idx - 1]))) {
      const stepDeltaKg = Number((val - Number(values[idx - 1])).toFixed(2));
      const deltaClass = stepDeltaKg > 0 ? 'text-rosewood-600' : 'text-sage-700';
      rightWrap.appendChild(
        createEl('span', `text-fluid-label font-medium ${deltaClass}`, formatWeightDelta(stepDeltaKg, { withUnit: false }))
      );
    }
    rightWrap.appendChild(
      createEl('span', 'font-semibold text-sm text-ink', formatWeight(val, { trimTrailingZeros: true }))
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

function renderHeightStatsSummary(member, allHeightRecs, filteredRecords) {
  const container = document.getElementById('chart-stats-summary');
  if (!container) return;

  if (!member) {
    container.replaceChildren();
    return;
  }

  const blocks = [];

  if (!allHeightRecs || allHeightRecs.length === 0) {
    const notice = createEl(
      'div',
      'bg-sage-50 border border-sage-200/90 text-sage-700 rounded-2xl px-3.5 py-2.5 text-xs flex items-start gap-2'
    );
    notice.append(
      createIcon('clock', 'w-4 h-4 shrink-0 mt-0.5 text-sage-600'),
      createEl('span', 'leading-relaxed', t('charts.remindNoHeightRecord', { name: member.name }))
    );
    blocks.push(notice);
  }

  const stats = calculateHeightPeriodStats(filteredRecords);
  const statsCard = createEl('div', 'journal-card p-3 rounded-2xl space-y-2.5');
  const grid = createEl('div', 'grid grid-cols-2 gap-2');

  if (stats) {
    const growthText = stats.delta === null
      ? '--'
      : stats.delta === 0
        ? t('history.flat')
        : formatHeightDeltaCm(stats.delta);
    const growthColor = stats.delta === null || stats.delta === 0
      ? 'text-ink-400'
      : stats.delta > 0
        ? 'text-sage-600'
        : 'text-ink-600';
    const rangeText = stats.min === stats.max
      ? formatHeightCm(stats.max)
      : `${Number(stats.max.toFixed(1))} / ${Number(stats.min.toFixed(1))} cm`;

    grid.append(
      createStatCell(t('charts.heightStatLatest'), formatHeightCm(stats.latest), 'text-ink'),
      createStatCell(t('charts.heightStatGrowth'), growthText, growthColor),
      createStatCell(t('charts.heightStatRange'), rangeText, 'text-ink'),
      createStatCell(t('charts.heightStatCount'), t('charts.heightCountVal', { count: stats.count }), 'text-ink')
    );
  } else {
    const fallbackHeight = member.height_cm ? formatHeightCm(member.height_cm) : '--';
    grid.append(
      createStatCell(t('charts.heightStatLatest'), fallbackHeight, member.height_cm ? 'text-ink' : 'text-ink-400'),
      createStatCell(t('charts.heightStatGrowth'), '--', 'text-ink-400'),
      createStatCell(t('charts.heightStatRange'), '--', 'text-ink-400'),
      createStatCell(t('charts.heightStatCount'), t('charts.heightCountVal', { count: 0 }), 'text-ink-400')
    );
  }

  const addHeightBtn = createEl(
    'button',
    'w-full py-2 rounded-xl bg-sage-50 hover:bg-sage-100/80 border border-sage-200/80 text-sage-700 text-xs font-medium inline-flex items-center justify-center gap-1.5 transition'
  );
  addHeightBtn.type = 'button';
  addHeightBtn.append(
    createIcon('plus', 'w-3.5 h-3.5 shrink-0'),
    createEl('span', '', t('charts.addHeightBtn'))
  );
  addHeightBtn.onclick = () => {
    openRecordModal(member.id, 'single');
  };

  statsCard.append(grid, addHeightBtn);
  blocks.push(statsCard);
  container.replaceChildren(...blocks);
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
          ? t('charts.privacyLockedBanner')
          : t('charts.privacyUnlockedBanner')
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
      createEl('span', '', isHidden ? (hasPin ? t('charts.btnPinUnlock') : t('charts.btnTempShow')) : t('charts.btnHideNow'))
    );
    toggleBtn.onclick = () => {
      if (isHidden) {
        requestMemberUnlock(member, () => renderCharts());
      } else {
        lockMember(member.id);
        showToast(t('privacy.relockedToast'));
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
          ? t('charts.remindNoRecord', { name: member.name })
          : t('charts.remindDays', { name: member.name, days: daysSince })
      )
    );
    blocks.push(notice);
  }

  // 2. 區間統計摘要（2 × 2 格狀，避免窄螢幕擠壓裁切；隱私模式保留區間變化）
  const unitLabel = getWeightUnitLabel();
  const maskedDisplay = `${MASKED_WEIGHT} ${unitLabel}`;
  const stats = calculatePeriodStats(filteredRecords);
  const statsCard = createEl(
    'div',
    'journal-card p-3 rounded-2xl grid grid-cols-2 gap-2'
  );
  if (stats) {
    const deltaText = stats.delta === null ? '--' : formatWeightDelta(stats.delta);
    const deltaColor = stats.delta === null
      ? 'text-ink-400'
      : stats.delta > 0
        ? 'text-rosewood-600'
        : 'text-sage-600';

    statsCard.append(
      createStatCell(t('charts.statAvg'), isHidden ? maskedDisplay : formatWeight(stats.avg, { trimTrailingZeros: true }), isHidden ? 'text-ink-400' : 'text-ink'),
      createStatCell(t('charts.statDelta'), deltaText, deltaColor),
      createStatCell(t('charts.statMin'), isHidden ? maskedDisplay : formatWeight(stats.min, { trimTrailingZeros: true }), isHidden ? 'text-ink-400' : 'text-ink'),
      createStatCell(t('charts.statMax'), isHidden ? maskedDisplay : formatWeight(stats.max, { trimTrailingZeros: true }), isHidden ? 'text-ink-400' : 'text-ink')
    );
  } else {
    statsCard.append(
      createStatCell(t('charts.statAvg'), '--', 'text-ink-400'),
      createStatCell(t('charts.statDelta'), '--', 'text-ink-400'),
      createStatCell(t('charts.statMin'), '--', 'text-ink-400'),
      createStatCell(t('charts.statMax'), '--', 'text-ink-400')
    );
  }
  blocks.push(statsCard);

  // 3. 目標體重達成進度條（隱私模式保留百分比，隱藏絕對數值）
  const progress = calculateGoalProgress(allMemberRecs, member.target_weight);
  if (progress) {
    const progCard = createEl('div', 'journal-card p-3.5 rounded-2xl space-y-2');
    const headRow = createEl('div', 'flex flex-wrap justify-between items-center gap-x-2 gap-y-0.5 text-xs');

    const titleWrap = createEl('span', 'font-medium text-ink-700 inline-flex items-center gap-1.5');
    titleWrap.append(
      createIcon('target', `w-3.5 h-3.5 shrink-0 ${theme.accentText}`),
      createEl('span', '', t('charts.goalProgressTitle'))
    );

    const statusWrap = createEl(
      'span',
      `font-semibold tabular-nums whitespace-nowrap inline-flex items-center gap-1 ${progress.isAchieved ? 'text-sage-600' : theme.accentText}`
    );
    if (progress.isAchieved) {
      statusWrap.append(
        createIcon('check', 'w-3.5 h-3.5 shrink-0'),
        createEl('span', '', t('charts.achieved100'))
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
        createEl('span', 'whitespace-nowrap', t('charts.goalStart', { value: maskedDisplay })),
        createEl('span', 'text-ink-500 font-medium whitespace-nowrap', t('charts.goalCurrent', { value: maskedDisplay })),
        createEl('span', 'whitespace-nowrap', t('charts.goalTarget', { value: maskedDisplay }))
      );
    } else {
      footRow.append(
        createEl('span', 'whitespace-nowrap', t('charts.goalStart', { value: formatWeight(progress.startWeight, { trimTrailingZeros: true }) })),
        createEl('span', 'text-ink-700 font-medium whitespace-nowrap', t('charts.goalCurrent', { value: formatWeight(progress.currentWeight, { trimTrailingZeros: true }) })),
        createEl('span', 'whitespace-nowrap', t('charts.goalTarget', { value: formatWeight(progress.targetWeight, { trimTrailingZeros: true }) }))
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

function formatCompactHistoryRange(startYmd, endYmd, currentYear = getCurrentYearInTimeZone()) {
  const start = String(startYmd || '').slice(0, 10);
  const end = String(endYmd || '').slice(0, 10);
  const ymdRe = /^(\d{4})-(\d{2})-(\d{2})$/;
  const sm = start.match(ymdRe);
  const em = end.match(ymdRe);
  if (!sm || !em) return `${start}~${end}`;

  const sy = Number(sm[1]);
  const ey = Number(em[1]);
  const startMd = `${sm[2]}/${sm[3]}`;
  const endMd = `${em[2]}/${em[3]}`;

  if (sy === ey) {
    if (sy === currentYear) return `${startMd}~${endMd}`;
    return `${sm[1].slice(-2)}/${startMd}~${endMd}`;
  }
  return `${sm[1].slice(-2)}/${startMd}~${em[1].slice(-2)}/${endMd}`;
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
        'inline-flex items-center gap-1 max-w-full pl-2 pr-1 py-0.5 rounded-lg bg-sage-50 border border-sage-200 text-sage-700 text-[11px] leading-tight'
      );
      const compactRange = formatCompactHistoryRange(filter.startDate, filter.endDate);
      const rangeBtn = createEl(
        'button',
        'tabular-nums truncate font-medium text-left hover:underline',
        compactRange
      );
      rangeBtn.type = 'button';
      rangeBtn.setAttribute('title', `${filter.startDate} ~ ${filter.endDate}`);
      rangeBtn.onclick = () => {
        if (toggleBtn) toggleBtn.click();
      };

      const clearBtn = createEl(
        'button',
        'p-0.5 rounded-md hover:bg-sage-100 text-sage-600 hover:text-sage-800 shrink-0'
      );
      clearBtn.type = 'button';
      clearBtn.setAttribute('aria-label', t('history.clearFilterAria'));
      clearBtn.setAttribute('title', t('history.clearFilterAria'));
      clearBtn.appendChild(createIcon('close', 'w-3 h-3'));
      clearBtn.onclick = () => {
        state.historyFilter = { active: false, startDate: '', endDate: '' };
        state.historyPage = 1;
        isHistoryFilterPanelOpen = false;
        syncHistoryFilterUI();
        refreshCurrentMemberHistoryOnly(true);
      };
      pill.append(rangeBtn, clearBtn);
      activeBar.replaceChildren(pill);
    }
  }
}

function formatHistoryDateWithWeekday(ymd, currentYear) {
  return formatLocalizedHistoryDate(ymd, currentYear, getWeekdayFromYmd(ymd));
}

function isHeightMetricForMember(member) {
  return Boolean(member && member.type === 'human' && member.track_height && state.chartMetric === 'height');
}

function buildPreviousValueMap(allMemberRecs, valueField = 'weight_kg') {
  const sorted = (allMemberRecs || [])
    .slice()
    .sort((a, b) => {
      const dCmp = String(a.recorded_at || '').localeCompare(String(b.recorded_at || ''));
      if (dCmp !== 0) return dCmp;
      return String(a.created_at || '').localeCompare(String(b.created_at || ''));
    });
  const map = new Map();
  let prevVal = null;
  for (const rec of sorted) {
    map.set(rec.id, prevVal);
    const v = Number(rec[valueField]);
    if (Number.isFinite(v)) prevVal = v;
  }
  return map;
}

function refreshCurrentMemberHistoryOnly(animate = false) {
  const member = state.appData.members.find((m) => m.id === state.selectedMemberId);
  const useHeight = isHeightMetricForMember(member);
  if (useHeight) {
    const heightRecs = (state.appData.heightRecords || []).filter((r) => r.member_id === state.selectedMemberId);
    const { filteredRecords } = aggregateHeightRecords(heightRecs, state.selectedRange);
    const historyRecords = resolveHistoryRecords(heightRecs, filteredRecords);
    renderHistoryList(member, [], historyRecords, heightRecs, 'height');
  } else {
    const recs = state.appData.records.filter((r) => r.member_id === state.selectedMemberId);
    const memberHistory = (state.appData.targetHistory || []).filter((h) => h.member_id === state.selectedMemberId);
    const { filteredRecords } = aggregateRecords(recs, state.selectedRange);
    const historyRecords = resolveHistoryRecords(recs, filteredRecords);
    renderHistoryList(member, memberHistory, historyRecords, recs, 'weight');
  }
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

function renderHistoryList(member, memberHistory, filteredRecords, allMemberRecs = filteredRecords, metric = 'weight') {
  const list = document.getElementById('history-list');
  const countEl = document.getElementById('history-count');
  const pagerEl = document.getElementById('history-pagination');
  const isHeightMetric = metric === 'height';

  activeHistorySwipe = null;
  openHistorySwipeRow = null;
  bindGlobalHistorySwipeListeners();
  syncHistoryFilterUI();

  const reversed = filteredRecords.slice().reverse();
  const total = reversed.length;

  if (total === 0) {
    state.historyPage = 1;
    if (countEl) countEl.textContent = t('history.countTotal', { total: 0 });
    const emptyText = state.historyFilter?.active
      ? t('history.emptyFiltered')
      : t('history.emptyPeriod');
    list.replaceChildren(createEl('li', 'py-3 text-center text-ink-400', emptyText));
    if (pagerEl) {
      pagerEl.classList.add('hidden');
      pagerEl.replaceChildren();
    }
    return;
  }

  const isHidden = !isHeightMetric && isMemberWeightHidden(member);
  const currentYear = getCurrentYearInTimeZone();
  const unitLabel = getWeightUnitLabel();
  const prevValueMap = buildPreviousValueMap(allMemberRecs, isHeightMetric ? 'height_cm' : 'weight_kg');
  const totalPages = Math.max(1, Math.ceil(total / HISTORY_PAGE_SIZE));
  state.historyPage = Math.min(Math.max(1, Number(state.historyPage) || 1), totalPages);

  const startIdx = (state.historyPage - 1) * HISTORY_PAGE_SIZE;
  const endIdx = Math.min(startIdx + HISTORY_PAGE_SIZE, total);
  const pageRecords = reversed.slice(startIdx, endIdx);

  if (countEl) {
    countEl.textContent = totalPages > 1
      ? t('history.countRange', { start: startIdx + 1, end: endIdx, total })
      : t('history.countTotal', { total });
  }

  // 僅針對體重模式計算目前分頁每筆紀錄「當下生效的目標體重」
  const recordTargetSeries = isHeightMetric
    ? { values: pageRecords.map(() => null) }
    : resolveTargetWeightSeries(
        pageRecords.map((r) => r.recorded_at),
        memberHistory,
        member
      );

  const items = pageRecords.map((r, idx) => {
    const li = createEl('li', 'history-swipe-row');
    const contentEl = createEl('div', 'history-swipe-content py-2.5 flex items-center gap-2');

    let primaryDisplay;
    let deltaText = t('history.firstRecord');
    let deltaColor = 'text-ink-400';

    if (isHeightMetric) {
      const numericHeight = Number(r.height_cm);
      primaryDisplay = Number.isFinite(numericHeight)
        ? formatHeightCm(numericHeight)
        : `${r.height_cm} cm`;
      const prevHeight = prevValueMap.has(r.id) ? prevValueMap.get(r.id) : null;
      if (prevHeight !== null && Number.isFinite(numericHeight)) {
        const diff = Number((numericHeight - prevHeight).toFixed(1));
        if (diff === 0) {
          deltaText = t('history.flat');
          deltaColor = 'text-ink-400';
        } else if (diff > 0) {
          deltaText = `↗ ${formatHeightDeltaCm(diff)}`;
          deltaColor = 'text-sage-600';
        } else {
          deltaText = `↘ ${formatHeightDeltaCm(diff)}`;
          deltaColor = 'text-ink-500';
        }
      }
    } else {
      const numericWeight = Number(r.weight_kg);
      primaryDisplay = isHidden
        ? `${MASKED_WEIGHT} ${unitLabel}`
        : Number.isFinite(numericWeight)
          ? formatWeight(numericWeight)
          : `${r.weight_kg} ${unitLabel}`;

      // 較前次紀錄變化（依完整時間序列計算，跨分頁也精準；隱私模式僅顯相對漲跌、不洩露真實體重）
      const prevWeight = prevValueMap.has(r.id) ? prevValueMap.get(r.id) : null;
      if (prevWeight !== null && Number.isFinite(numericWeight)) {
        const diff = Number((numericWeight - prevWeight).toFixed(2));
        if (diff === 0) {
          deltaText = t('history.flat');
          deltaColor = 'text-ink-400';
        } else if (diff > 0) {
          deltaText = `↗ ${formatWeightDelta(diff)}`;
          deltaColor = 'text-rosewood-600';
        } else {
          deltaText = `↘ ${formatWeightDelta(diff)}`;
          deltaColor = 'text-sage-600';
        }
      }
    }

    // 左欄：體重／身高 ＋ 量測日期（含星期幾），固定欄寬與雙行結構確保各筆列高一致
    const leftCol = createEl('div', 'w-[5.25rem] shrink-0 flex flex-col justify-center gap-1');
    const primaryEl = createEl(
      'span',
      `font-semibold text-sm leading-5 tabular-nums whitespace-nowrap ${isHidden ? 'text-ink-400' : 'text-ink'}`,
      primaryDisplay
    );
    const dateCell = createEl(
      'span',
      'text-[12px] text-ink-400 tabular-nums leading-4 whitespace-nowrap',
      formatHistoryDateWithWeekday(r.recorded_at, currentYear)
    );
    dateCell.setAttribute('title', String(r.recorded_at ?? ''));
    leftCol.append(primaryEl, dateCell);

    // 中欄：目標差距膠囊與備註（僅在實際存在時渲染，無備註時不留空白並自然上下置中）
    const midCol = createEl('div', 'min-w-0 flex-1 flex flex-col justify-center items-start gap-1');
    if (!isHeightMetric) {
      const activeTarget = recordTargetSeries.values[idx];
      const targetGap = calculateTargetGap(r.weight_kg, activeTarget);
      if (targetGap) {
        if (isHidden) {
          if (targetGap.isAchieved) {
            midCol.appendChild(
              createEl(
                'span',
                'inline-block max-w-full truncate rounded-full px-1.5 py-0.5 text-[11px] leading-4 font-medium whitespace-nowrap bg-sage-50 text-sage-700 border border-sage-200/80',
                t('overview.achieved')
              )
            );
          }
        } else {
          const pillStyle = targetGap.isAchieved
            ? 'bg-sage-50 text-sage-700 border border-sage-200/80'
            : targetGap.gap > 0
              ? 'bg-ochre-50 text-ochre-700 border border-ochre-200/80'
              : 'bg-sage-50 text-sage-700 border border-sage-200/80';
          midCol.appendChild(
            createEl(
              'span',
              `inline-block max-w-full truncate rounded-full px-1.5 py-0.5 text-[11px] leading-4 font-medium tabular-nums whitespace-nowrap ${pillStyle}`,
              targetGap.compactLabel
            )
          );
        }
      }
    }

    const noteText = String(r.note ?? '').trim();
    if (noteText) {
      const noteBtn = createEl(
        'button',
        'block w-full text-left text-xs leading-4 text-ink-500 hover:text-ink truncate',
        noteText
      );
      noteBtn.type = 'button';
      noteBtn.setAttribute('title', noteText);
      noteBtn.setAttribute('aria-label', t('history.viewNoteAria', { note: noteText }));
      noteBtn.onclick = (e) => {
        if (Date.now() < suppressHistoryClickUntil) return;
        if (openHistorySwipeRow?.row === li) {
          e.stopPropagation();
          closeOpenHistorySwipeRow();
          return;
        }
        showToast(t('history.noteToast', { date: r.recorded_at, note: noteText }), false, 4000);
      };
      midCol.appendChild(noteBtn);
    }

    // 最右側獨立區塊：較前次變化（獨立欄位搭配淡分隔線並上下置中對齊）
    const rightCol = createEl(
      'div',
      'min-w-[4.75rem] shrink-0 self-stretch flex items-center justify-end pl-2 border-l border-oat-100'
    );
    const deltaEl = createEl(
      'span',
      `text-xs font-medium leading-4 tabular-nums whitespace-nowrap ${deltaColor}`,
      deltaText
    );
    rightCol.appendChild(deltaEl);

    contentEl.append(leftCol, midCol, rightCol);

    if (!isHidden) {
      li.dataset.swipeDeleteRow = 'true';

      // 極右緣淡色左滑提示細線（低調提示可左滑刪除，隱藏體重時不顯示）
      const swipeCue = createEl('span', 'history-swipe-cue');
      swipeCue.setAttribute('aria-hidden', 'true');
      contentEl.appendChild(swipeCue);

      const triggerDelete = () => {
        if (isHeightMetric) {
          if (!confirm(t('history.deleteHeightConfirm'))) return false;
          if (optimisticDeleteHeightRecord(r.id)) {
            showToast(t('history.deleted'));
            return true;
          }
          return false;
        }
        if (isMemberWeightHidden(member)) {
          showToast(t('history.deleteHiddenBlocked'), true);
          renderCharts();
          return false;
        }
        if (!confirm(t('history.deleteConfirm'))) return false;
        if (optimisticDeleteRecord(r.id)) {
          showToast(t('history.deleted'));
          return true;
        }
        return false;
      };

      const actionBtn = createEl('button', 'history-swipe-action');
      actionBtn.type = 'button';
      const delAria = isHeightMetric ? t('history.deleteHeightAria') : t('history.deleteAria');
      actionBtn.setAttribute('aria-label', delAria);
      actionBtn.setAttribute('title', delAria);
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
    renderHistoryList(member, memberHistory, filteredRecords, allMemberRecs, metric);
    playSoftFade(list);
  };

  const isFirst = state.historyPage <= 1;
  const isLast = state.historyPage >= totalPages;
  const isMulti = totalPages > 2;

  const leftGroup = createEl('div', 'flex items-center justify-start gap-1');
  if (isMulti) {
    leftGroup.appendChild(
      createPagerButton({ iconName: 'chevronsLeft', ariaLabel: t('history.firstPage'), disabled: isFirst, onClick: () => goToPage(1), compact: true })
    );
  }
  leftGroup.appendChild(
    createPagerButton({
      label: isMulti ? t('history.prevShort') : t('history.prevPage'),
      iconName: 'chevronLeft',
      iconPosition: 'left',
      ariaLabel: t('history.prevPage'),
      disabled: isFirst,
      onClick: () => goToPage(state.historyPage - 1),
      compact: isMulti,
    })
  );

  const pageLabel = createEl(
    'span',
    'text-ink-500 font-medium tabular-nums whitespace-nowrap text-center',
    isMulti ? `${state.historyPage} / ${totalPages}` : t('history.pageOf', { page: state.historyPage, total: totalPages })
  );

  const rightGroup = createEl('div', 'flex items-center justify-end gap-1');
  rightGroup.appendChild(
    createPagerButton({
      label: isMulti ? t('history.nextShort') : t('history.nextPage'),
      iconName: 'chevronRight',
      iconPosition: 'right',
      ariaLabel: t('history.nextPage'),
      disabled: isLast,
      onClick: () => goToPage(state.historyPage + 1),
      compact: isMulti,
    })
  );
  if (isMulti) {
    rightGroup.appendChild(
      createPagerButton({ iconName: 'chevronsRight', ariaLabel: t('history.lastPage'), disabled: isLast, onClick: () => goToPage(totalPages), compact: true })
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
  const canTrackHeight = Boolean(member && member.type === 'human' && member.track_height);
  if (!canTrackHeight && state.chartMetric !== 'weight') {
    state.chartMetric = 'weight';
  }

  const metricPills = document.getElementById('chart-metric-pills');
  if (metricPills) {
    metricPills.classList.toggle('hidden', !canTrackHeight);
    metricPills.querySelectorAll('.metric-btn').forEach((b) => {
      const active = b.dataset.metric === state.chartMetric;
      b.className = active
        ? 'metric-btn flex-1 py-1.5 rounded-xl bg-linen text-sage-700 shadow-sm'
        : 'metric-btn flex-1 py-1.5 rounded-xl text-ink-500';
    });
  }

  const useHeight = isHeightMetricForMember(member);
  const recs = state.appData.records.filter((r) => r.member_id === state.selectedMemberId);
  const heightRecs = (state.appData.heightRecords || []).filter((r) => r.member_id === state.selectedMemberId);
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
  } = useHeight
    ? aggregateHeightRecords(heightRecs, state.selectedRange)
    : aggregateRecords(recs, state.selectedRange);
  const isHidden = useHeight ? false : isMemberWeightHidden(member);
  const chartPalette = getChartThemePalette();
  const baseTheme = getMemberTheme(member?.type);
  const theme = useHeight
    ? { ...baseTheme, lineColor: chartPalette.heightLine, fillColor: chartPalette.heightFill }
    : baseTheme;

  if (useHeight) {
    renderHeightStatsSummary(member, heightRecs, filteredRecords);
  } else {
    renderStatsSummary(member, recs, filteredRecords);
  }

  const canvas = document.getElementById('weightChart');
  const canvasWrap = document.getElementById('chart-canvas-wrap');
  const emptyStateEl = document.getElementById('chart-empty-state');
  clearInspection(false);
  if (chartInstance) {
    chartInstance.destroy();
    chartInstance = null;
  }

  const targetSeries = useHeight
    ? { values: [], hasAnyTarget: false, pointRadii: [] }
    : resolveTargetWeightSeries(pointDates, memberHistory, member);
  inspectState.context = {
    metric: useHeight ? 'height' : 'weight',
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

  const historyRecords = useHeight
    ? resolveHistoryRecords(heightRecs, filteredRecords)
    : resolveHistoryRecords(recs, filteredRecords);

  const hasData = values.length > 0;
  if (canvasWrap) canvasWrap.classList.toggle('hidden', !hasData);
  if (emptyStateEl) {
    emptyStateEl.textContent = t(useHeight ? 'charts.emptyHeightPeriod' : 'charts.emptyPeriod');
    emptyStateEl.classList.toggle('hidden', hasData);
  }

  if (!hasData) {
    renderHistoryList(
      member,
      useHeight ? [] : memberHistory,
      historyRecords,
      useHeight ? heightRecs : recs,
      useHeight ? 'height' : 'weight'
    );
    return;
  }

  const ctx = canvas.getContext('2d');
  const unit = getWeightUnit();
  const unitLabel = getWeightUnitLabel(unit);
  const displayValues = useHeight ? values : values.map((v) => kgToDisplay(v, unit, 2));
  const displayTargetValues = useHeight
    ? []
    : targetSeries.values.map((v) => (v === null ? null : kgToDisplay(v, unit, 2)));
  const baselineDisplayWeight = Number(displayValues[0]);
  const isDaily = state.selectedRange === 'day';
  const pointRadius = values.length <= 12 ? 3 : 2;
  const datasets = [{
    label: useHeight
      ? t('charts.legendHeight')
      : isHidden
        ? (isDaily ? t('charts.legendTrendDaily') : t('charts.legendTrendAvg'))
        : (isDaily ? t('charts.legendWeightDaily', { unit: unitLabel }) : t('charts.legendWeightAvg', { unit: unitLabel })),
    data: displayValues,
    borderColor: theme.lineColor,
    backgroundColor: theme.fillColor,
    borderWidth: 2.2,
    pointRadius,
    pointHoverRadius: 5,
    pointBackgroundColor: chartPalette.pointBg,
    pointBorderColor: theme.lineColor,
    pointBorderWidth: 1.8,
    fill: true,
    tension: 0.3
  }];

  if (!useHeight && targetSeries.hasAnyTarget && labels.length > 0) {
    const targetLabel = isHidden
      ? t('charts.legendTargetHidden')
      : member?.target_weight
        ? t('charts.legendTarget', { value: formatWeight(member.target_weight, { unit, trimTrailingZeros: true }) })
        : t('charts.legendTargetHistory');
    datasets.push({
      label: targetLabel,
      data: displayTargetValues,
      borderColor: chartPalette.targetLine,
      backgroundColor: chartPalette.targetLine,
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
            color: chartPalette.legendColor,
            boxWidth: 10,
            boxHeight: 10,
            padding: 12,
            usePointStyle: true,
            font: { size: 12 }
          }
        },
        tooltip: {
          filter: () => !inspectState.isInspecting,
          backgroundColor: chartPalette.tooltipBg,
          titleColor: chartPalette.tooltipTitle,
          bodyColor: chartPalette.tooltipBody,
          cornerRadius: 10,
          padding: 10,
          displayColors: true,
          callbacks: {
            title: (items) => {
              const i = items?.[0]?.dataIndex;
              if (i === undefined || i === null) return '';
              const base = detailLabels?.[i] || labels[i] || '';
              const cnt = bucketCounts?.[i] || 1;
              return !isDaily && cnt > 1 ? `${base} (${t('charts.bucketCount', { count: cnt })})` : base;
            },
            label: (ctxItem) => {
              if (useHeight) {
                return t('charts.tooltipHeight', { value: formatHeightCm(ctxItem.parsed.y) });
              }
              if (!isHidden) {
                const valStr = `${ctxItem.parsed.y} ${unitLabel}`;
                if (ctxItem.datasetIndex === 0) {
                  return isDaily
                    ? t('charts.tooltipWeight', { value: valStr })
                    : t('charts.tooltipAvgWeight', { value: valStr });
                }
                return t('charts.tooltipTarget', { value: valStr });
              }
              if (ctxItem.datasetIndex === 0 && Number.isFinite(baselineDisplayWeight) && Number.isFinite(ctxItem.parsed.y)) {
                const delta = Number((ctxItem.parsed.y - baselineDisplayWeight).toFixed(2));
                const sign = delta > 0 ? '+' : '';
                return t('charts.tooltipFromStart', { delta: `${sign}${delta.toFixed(2)} ${unitLabel}` });
              }
              return t('charts.tooltipTarget', { value: `${MASKED_WEIGHT} ${unitLabel}` });
            }
          }
        }
      },
      scales: {
        x: {
          border: { display: false },
          grid: { display: false },
          ticks: {
            color: chartPalette.tickColor,
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
            color: chartPalette.tickColor,
            font: { size: 11.5 },
            maxTicksLimit: 5,
            padding: 6,
            callback: (val) => {
              const num = Number(val);
              if (!Number.isFinite(num)) return val;
              return Number.isInteger(num) ? String(num) : String(Number(num.toFixed(1)));
            }
          },
          grid: { color: chartPalette.gridColor }
        }
      }
    }
  });

  renderHistoryList(
    member,
    useHeight ? [] : memberHistory,
    historyRecords,
    useHeight ? heightRecs : recs,
    useHeight ? 'height' : 'weight'
  );
}

export function initChartRangeControls({ onRangeChange }) {
  document.querySelectorAll('.metric-btn').forEach((btn) => {
    btn.onclick = () => {
      const nextMetric = btn.dataset.metric === 'height' ? 'height' : 'weight';
      if (state.chartMetric === nextMetric) return;
      state.chartMetric = nextMetric;
      state.historyPage = 1;
      onRangeChange();
      playSoftFade(document.getElementById('chart-stats-summary'));
      playSoftFade(document.getElementById('history-list'));
    };
  });

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
          showToast(t('history.autoAdjustEnd'));
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
            showToast(t('history.autoAdjustStart'));
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
      showToast(t('history.filterReset'));
    };
  }
}
