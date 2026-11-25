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
  getDaysSinceLastRecord
} from '../utils/metrics.js';

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
    const tagLabel = String(ctxData.labels[idx] ?? '');
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
    bar.classList.add('hidden');
    bar.replaceChildren();
    return;
  }

  bar.classList.remove('hidden');
  const idx = inspectState.activeIndex;

  if (idx === null || idx < 0 || idx >= ctxData.values.length) {
    bar.className = 'min-h-[34px] rounded-xl px-3 py-1.5 flex items-center justify-between gap-2 text-fluid-label bg-oat-50 border border-oat-200/70 text-ink-400';
    const hintText = ctxData.isHidden
      ? '長按圖表檢視趨勢'
      : '長按圖表左右拖曳檢視';
    bar.replaceChildren(
      createEl('span', 'min-w-0 leading-snug', hintText),
      createEl('span', 'shrink-0 whitespace-nowrap tabular-nums text-ink-400', `共 ${ctxData.values.length} 點`)
    );
    return;
  }

  const { labels, values, pointDates, isHidden, theme, range } = ctxData;
  const val = Number(values[idx]);
  const dateDisplay = range === 'day'
    ? String(pointDates[idx] || labels[idx] || '')
    : `${labels[idx] || ''}（平均）`;

  bar.className = `min-h-[34px] rounded-xl px-3 py-1.5 flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-xs border transition-colors ${theme.inspectBarClass}`;

  const leftWrap = createEl('div', 'flex items-center gap-2 min-w-0');
  leftWrap.append(
    createEl('span', `w-2 h-2 rounded-full shrink-0 ${theme.dotBgClass}`),
    createEl('span', 'font-medium tabular-nums whitespace-nowrap', dateDisplay)
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
          ? '隱私模式：已遮蔽體重與刻度'
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
      createStatCell('區間平均', isHidden ? MASKED_WEIGHT : `${stats.avg} kg`, isHidden ? 'text-ink-400' : 'text-ink'),
      createStatCell('區間變化', deltaText === '--' ? '--' : `${deltaText} kg`, deltaColor),
      createStatCell('區間最低', isHidden ? MASKED_WEIGHT : `${stats.min} kg`, isHidden ? 'text-ink-400' : 'text-ink'),
      createStatCell('區間最高', isHidden ? MASKED_WEIGHT : `${stats.max} kg`, isHidden ? 'text-ink-400' : 'text-ink')
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
    const li = createEl('li', 'py-2.5 flex justify-between items-start gap-2.5');
    const info = createEl('div', 'min-w-0 flex-1');

    // 第 1 行：體重 + 精簡目標差距膠囊（取代固定寬度橫排，避免折行錯位）
    const topRow = createEl('div', 'flex items-center flex-wrap gap-x-2 gap-y-1');
    topRow.appendChild(
      createEl(
        'span',
        `font-semibold text-sm tabular-nums whitespace-nowrap ${isHidden ? 'text-ink-400' : 'text-ink'}`,
        isHidden ? `${MASKED_WEIGHT} kg` : `${r.weight_kg} kg`
      )
    );

    const activeTarget = recordTargetSeries.values[idx];
    const targetGap = calculateTargetGap(r.weight_kg, activeTarget);
    if (targetGap) {
      if (isHidden) {
        if (targetGap.isAchieved) {
          topRow.appendChild(
            createEl(
              'span',
              'rounded-full px-2 py-0.5 text-[12px] font-medium whitespace-nowrap bg-sage-50 text-sage-700 border border-sage-200/80',
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
        topRow.appendChild(
          createEl(
            'span',
            `rounded-full px-2 py-0.5 text-[12px] font-medium tabular-nums whitespace-nowrap ${pillStyle}`,
            targetGap.compactLabel
          )
        );
      }
    }

    // 第 2 行：量測日期（獨立成行保持左側整齊）
    const dateRow = createEl('div', 'text-fluid-label text-ink-400 tabular-nums mt-0.5', String(r.recorded_at ?? ''));

    info.append(topRow, dateRow);

    if (r.note) {
      info.appendChild(createEl('p', 'text-xs text-ink-500 mt-1 leading-relaxed break-words', String(r.note)));
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
    playSoftFade(list);
  };

  const isFirst = state.historyPage <= 1;
  const isLast = state.historyPage >= totalPages;
  const isMulti = totalPages > 2;

  const leftGroup = createEl('div', 'flex items-center gap-1');
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
    'text-ink-500 font-medium tabular-nums whitespace-nowrap',
    isMulti ? `${state.historyPage} / ${totalPages}` : `第 ${state.historyPage} / ${totalPages} 頁`
  );

  const rightGroup = createEl('div', 'flex items-center gap-1');
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
  const { labels, values, pointDates, filteredRecords } = aggregateRecords(recs, state.selectedRange);
  const isHidden = isMemberWeightHidden(member);
  const theme = getMemberTheme(member?.type);

  renderStatsSummary(member, recs, filteredRecords);

  const canvas = document.getElementById('weightChart');
  const ctx = canvas.getContext('2d');
  clearInspection(false);
  if (chartInstance) chartInstance.destroy();

  const targetSeries = resolveTargetWeightSeries(pointDates, memberHistory, member);
  inspectState.context = {
    labels,
    values,
    pointDates,
    targetValues: targetSeries.values,
    isHidden,
    theme,
    range: state.selectedRange
  };
  bindChartLongPressEvents(canvas);
  renderInspectBar();

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
    plugins: [inspectCrosshairPlugin],
    options: {
      responsive: true,
      animation: {
        duration: 340,
        easing: 'easeOutQuart'
      },
      plugins: {
        legend: {
          display: true,
          labels: { color: '#494C45', boxWidth: 12, usePointStyle: true, font: { size: 13 } }
        },
        tooltip: {
          filter: () => !inspectState.isInspecting,
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
          ticks: { color: '#727068', font: { size: 12 } },
          grid: { color: '#EFECE4' }
        },
        y: {
          ticks: {
            display: !isHidden,
            color: '#727068',
            font: { size: 12 }
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
      playSoftFade(document.getElementById('chart-stats-summary'));
      playSoftFade(document.getElementById('history-list'));
    };
  });
}
