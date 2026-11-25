import { state } from '../state.js';
import { createEl } from '../utils/dom.js';
import { createIcon } from '../utils/icons.js';
import {
  calculateBmi,
  calculateGoalProgress,
  calculateTargetGap,
  calculateWeeklyWeightChangePct,
  getBcsMeta
} from '../utils/metrics.js';
import { createAvatarNode, resolveMemberAvatar } from '../utils/avatars.js';
import {
  MASKED_WEIGHT,
  isMemberPrivacyEnabled,
  isMemberWeightHidden,
  memberHasPrivacyPin
} from '../utils/privacy.js';

function getMemberTypeMeta(type) {
  if (type === 'cat') {
    return {
      label: '貓咪',
      pillClass: 'bg-clay-50 text-clay-700 border border-clay-200',
      accentClass: 'text-clay-700'
    };
  }
  if (type === 'dog') {
    return {
      label: '狗狗',
      pillClass: 'bg-ochre-50 text-ochre-700 border border-ochre-200',
      accentClass: 'text-ochre-700'
    };
  }
  return {
    label: '家人',
    pillClass: 'bg-sage-50 text-sage-700 border border-sage-200',
    accentClass: 'text-sage-700'
  };
}

function createMetricCell(labelText, valueText, valueClass = 'text-ink-700') {
  const cell = createEl('div', 'px-1.5 min-w-0');
  cell.append(
    createEl('div', 'text-fluid-label text-ink-400 whitespace-nowrap', labelText),
    createEl('div', `text-fluid-metric font-semibold tabular-nums mt-0.5 whitespace-nowrap ${valueClass}`, valueText)
  );
  return cell;
}

const LONG_PRESS_REORDER_MS = 220;
const MOVE_CANCEL_THRESHOLD_PX = 10;
const SWAP_HYSTERESIS_PX = 8;
const FLIP_DURATION_MS = 240;
const SETTLE_DURATION_MS = 210;
const SPRING_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)';

let dragState = null;
let suppressCardClickUntil = 0;
let dragGlobalListenersBound = false;
let activeReorderCallback = null;
const siblingFlipAnims = new WeakMap();

export function isOverviewReordering() {
  return Boolean(dragState && dragState.active);
}

function prefersReducedMotion() {
  return Boolean(
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

function getWindowScrollY() {
  if (typeof window === 'undefined') return 0;
  return window.scrollY || document.documentElement?.scrollTop || 0;
}

function getOrderedCardIds(container) {
  if (!container) return [];
  return Array.from(container.children)
    .map((el) => el.dataset?.memberId)
    .filter(Boolean);
}

// 透過 Web Animations API 在 GPU 合成層即時跟隨手指位置（零行內 style，完全符合嚴格 CSP）
function applyCardVisualOffset(stateObj, offsetY, scale = 1.025) {
  stateObj.currentOffsetY = offsetY;
  const card = stateObj.card;
  if (!card || typeof card.animate !== 'function') return;

  const prevAnim = stateObj.cardAnim;
  stateObj.cardAnim = card.animate(
    [{ transform: `translate3d(0, ${offsetY.toFixed(1)}px, 0) scale(${scale})` }],
    { duration: 1, fill: 'forwards' }
  );
  if (prevAnim) {
    try {
      prevAnim.cancel();
    } catch {
      // ignore
    }
  }
}

function clearCardVisualAnim(stateObj) {
  if (stateObj?.cardAnim) {
    try {
      stateObj.cardAnim.cancel();
    } catch {
      // ignore
    }
    stateObj.cardAnim = null;
  }
}

function stopAutoScroll(stateObj) {
  if (stateObj?.autoScrollRaf && typeof cancelAnimationFrame === 'function') {
    cancelAnimationFrame(stateObj.autoScrollRaf);
    stateObj.autoScrollRaf = 0;
  }
}

function performDragLayoutStep() {
  if (!dragState || !dragState.active) return;

  const { container, card, lastClientY } = dragState;
  if (!container || !card) return;

  // 以未縮放的文件座標基準計算偏移量，確保 1:1 緊貼手指且零縮放漂移
  const scrollY = getWindowScrollY();
  const baseTop = dragState.baseDocTop - scrollY;
  const targetOffsetY = lastClientY - dragState.grabOffsetY - baseTop;
  applyCardVisualOffset(dragState, targetOffsetY, 1.025);

  const siblings = Array.from(container.children).filter(
    (el) => el !== card && el.dataset?.memberId
  );

  // 檢查是否越過相鄰卡片中線（加入些微遲滯避免邊界抖動），並用可中斷 FLIP 讓其他卡片絲滑讓位
  const cardIdx = Array.from(container.children).indexOf(card);
  let swapTarget = null;
  let insertAfter = false;

  for (const sib of siblings) {
    const sibRect = sib.getBoundingClientRect();
    const sibMidY = sibRect.top + sibRect.height / 2;
    const sibIdx = Array.from(container.children).indexOf(sib);
    const isCardBefore = cardIdx < sibIdx;

    if (isCardBefore && lastClientY > sibMidY + SWAP_HYSTERESIS_PX) {
      swapTarget = sib;
      insertAfter = true;
      break;
    }
    if (!isCardBefore && lastClientY < sibMidY - SWAP_HYSTERESIS_PX) {
      swapTarget = sib;
      insertAfter = false;
      break;
    }
  }

  if (swapTarget) {
    // First：先記下所有相鄰卡片此刻的實際視覺位置（含動畫中途位置），並取消舊 FLIP
    const beforeRects = new Map();
    for (const sib of siblings) {
      beforeRects.set(sib, sib.getBoundingClientRect().top);
      const prevFlip = siblingFlipAnims.get(sib);
      if (prevFlip) {
        try {
          prevFlip.cancel();
        } catch {
          // ignore
        }
        siblingFlipAnims.delete(sib);
      }
    }
    const visualTopBeforeSwap = baseTop + targetOffsetY;

    // Last：執行 DOM 位置交換
    container.insertBefore(card, insertAfter ? swapTarget.nextSibling : swapTarget);

    // 立即於無縮放狀態重測基準文件座標並補償偏移，確保卡片完全不跳動
    clearCardVisualAnim(dragState);
    const newBaseTop = card.getBoundingClientRect().top;
    dragState.baseDocTop = newBaseTop + getWindowScrollY();
    const compensatedOffsetY = visualTopBeforeSwap - newBaseTop;
    applyCardVisualOffset(dragState, compensatedOffsetY, 1.025);

    // Invert & Play：讓所有移動位置的相鄰卡片從原視覺位置以彈簧曲線絲滑滑入新位
    if (!prefersReducedMotion()) {
      for (const sib of siblings) {
        const prevTop = beforeRects.get(sib);
        const nextTop = sib.getBoundingClientRect().top;
        const deltaY = prevTop - nextTop;
        if (Math.abs(deltaY) > 1 && typeof sib.animate === 'function') {
          const anim = sib.animate(
            [
              { transform: `translate3d(0, ${deltaY.toFixed(1)}px, 0)` },
              { transform: 'translate3d(0, 0, 0)' }
            ],
            { duration: FLIP_DURATION_MS, easing: SPRING_EASING }
          );
          siblingFlipAnims.set(sib, anim);
          anim.onfinish = () => {
            if (siblingFlipAnims.get(sib) === anim) siblingFlipAnims.delete(sib);
          };
        }
      }
    }

    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(8);
    }
  }
}

function startAutoScrollLoop() {
  if (!dragState || !dragState.active || dragState.autoScrollRaf) return;
  if (typeof requestAnimationFrame !== 'function') return;

  const tick = () => {
    if (!dragState || !dragState.active) return;
    const vh = window.innerHeight || 0;
    const y = dragState.lastClientY;
    let delta = 0;

    if (vh > 0) {
      if (y < 92) {
        delta = -Math.max(3, Math.round(((92 - y) / 92) * 14));
      } else if (y > vh - 104) {
        delta = Math.max(3, Math.round(((y - (vh - 104)) / 104) * 14));
      }
    }

    if (delta !== 0 && typeof window.scrollBy === 'function') {
      window.scrollBy(0, delta);
      performDragLayoutStep();
    }

    dragState.autoScrollRaf = requestAnimationFrame(tick);
  };

  dragState.autoScrollRaf = requestAnimationFrame(tick);
}

function bindGlobalDragListeners() {
  if (dragGlobalListenersBound || typeof window === 'undefined' || typeof document === 'undefined') {
    return;
  }
  dragGlobalListenersBound = true;

  // 拖拉進行中阻擋行動裝置預設頁面捲動（僅在真正進入拖拉狀態時介入）
  document.addEventListener(
    'touchmove',
    (e) => {
      if (dragState && dragState.active && e.cancelable) {
        e.preventDefault();
      }
    },
    { passive: false }
  );

  window.addEventListener('pointermove', (e) => {
    if (!dragState || e.pointerId !== dragState.pointerId) return;

    dragState.lastClientX = e.clientX;
    dragState.lastClientY = e.clientY;
    const dx = e.clientX - dragState.startX;
    const dy = e.clientY - dragState.startY;

    if (!dragState.active) {
      if (dragState.fromHandle && Math.hypot(dx, dy) >= 3) {
        activateCardDrag();
      } else if (!dragState.fromHandle && Math.hypot(dx, dy) > MOVE_CANCEL_THRESHOLD_PX) {
        cancelCardDrag();
        return;
      } else {
        return;
      }
    }

    performDragLayoutStep();
  });

  const finishDrag = (e) => {
    if (!dragState) return;
    if (e && e.pointerId !== undefined && e.pointerId !== dragState.pointerId) return;

    const finished = dragState;
    if (finished.timer) clearTimeout(finished.timer);
    stopAutoScroll(finished);
    dragState = null;

    const { active, container, card, initialOrder, currentOffsetY, pointerId } = finished;
    try {
      card?.releasePointerCapture?.(pointerId);
    } catch {
      // ignore
    }

    if (!active) {
      clearCardVisualAnim(finished);
      if (card) card.classList.remove('is-dragging');
      if (container) container.classList.remove('member-cards-reordering');
      return;
    }

    suppressCardClickUntil = Date.now() + 300;
    const nextOrder = getOrderedCardIds(container);
    const changed =
      nextOrder.length === initialOrder.length &&
      nextOrder.some((id, idx) => id !== initialOrder[idx]);

    if (container) container.classList.remove('member-cards-reordering');

    const finalizeCommit = () => {
      if (card) card.classList.remove('is-dragging', 'is-settling');
      if (changed && typeof activeReorderCallback === 'function') {
        activeReorderCallback(nextOrder);
      }
    };

    // 放開手指時以彈簧曲線輕柔落回定位，再提交狀態重繪，消除瞬間跳位感
    clearCardVisualAnim(finished);
    if (
      card &&
      typeof card.animate === 'function' &&
      !prefersReducedMotion() &&
      Math.abs(currentOffsetY) > 0.5
    ) {
      card.classList.remove('is-dragging');
      card.classList.add('is-settling');
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        finalizeCommit();
      };
      const settleAnim = card.animate(
        [
          { transform: `translate3d(0, ${currentOffsetY.toFixed(1)}px, 0) scale(1.025)` },
          { transform: 'translate3d(0, 0, 0) scale(1)' }
        ],
        { duration: SETTLE_DURATION_MS, easing: SPRING_EASING }
      );
      settleAnim.onfinish = done;
      settleAnim.oncancel = done;
      setTimeout(done, SETTLE_DURATION_MS + 40);
    } else {
      finalizeCommit();
    }
  };

  window.addEventListener('pointerup', finishDrag);
  window.addEventListener('pointercancel', finishDrag);
}

function activateCardDrag() {
  if (!dragState || dragState.active) return;
  if (dragState.timer) {
    clearTimeout(dragState.timer);
    dragState.timer = null;
  }

  const { card, container, pointerId, startY } = dragState;
  const rect = card.getBoundingClientRect();
  dragState.active = true;
  dragState.baseDocTop = rect.top + getWindowScrollY();
  dragState.grabOffsetY = startY - rect.top;
  dragState.currentOffsetY = 0;

  card.classList.add('is-dragging');
  container.classList.add('member-cards-reordering');
  try {
    card.setPointerCapture?.(pointerId);
  } catch {
    // ignore
  }

  // 柔和浮起微縮放，接著 1:1 跟隨手指移動
  applyCardVisualOffset(dragState, 0, 1.025);
  startAutoScrollLoop();

  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    navigator.vibrate(14);
  }
}

function cancelCardDrag() {
  if (!dragState) return;
  if (dragState.timer) clearTimeout(dragState.timer);
  stopAutoScroll(dragState);
  clearCardVisualAnim(dragState);
  if (dragState.card) dragState.card.classList.remove('is-dragging', 'is-settling');
  if (dragState.container) dragState.container.classList.remove('member-cards-reordering');
  dragState = null;
}

export function renderOverview({ onSelectMember, onReorderMembers = null }) {
  const container = document.getElementById('member-cards');
  activeReorderCallback = onReorderMembers;
  cancelCardDrag();
  bindGlobalDragListeners();

  if (state.appData.members.length === 0) {
    const emptyBox = createEl(
      'div',
      'journal-card p-6 rounded-2xl text-center text-ink-400 text-sm',
      '尚無成員，請先到「設定」新增家人、貓咪或狗狗。'
    );
    container.replaceChildren(emptyBox);
    return;
  }

  const canReorder = state.appData.members.length > 1 && typeof onReorderMembers === 'function';

  const cards = state.appData.members.map((m) => {
    const recs = state.appData.records.filter((r) => r.member_id === m.id);
    const latest = recs[recs.length - 1];
    const prev = recs[recs.length - 2];
    const diffNum = latest && prev ? Number((latest.weight_kg - prev.weight_kg).toFixed(2)) : null;
    const diffStr = diffNum !== null ? `${diffNum > 0 ? '+' : ''}${diffNum.toFixed(2)} kg` : '--';
    const targetGap = latest ? calculateTargetGap(latest.weight_kg, m.target_weight) : null;
    const goalProgress = calculateGoalProgress(recs, m.target_weight);
    const isHuman = m.type === 'human';
    const typeMeta = getMemberTypeMeta(m.type);
    const badgeLabel = !isHuman && m.breed ? String(m.breed).trim() : typeMeta.label;
    const bmiRes = isHuman && latest && m.height_cm ? calculateBmi(latest.weight_kg, m.height_cm) : null;
    const bcsMeta = !isHuman ? getBcsMeta(m.bcs_score) : null;
    const weeklyPct = !isHuman && !bcsMeta ? calculateWeeklyWeightChangePct(recs) : null;
    const isPrivacyOn = isMemberPrivacyEnabled(m);
    const isHidden = isMemberWeightHidden(m);
    const hasPin = memberHasPrivacyPin(m);

    const card = createEl(
      'div',
      'member-card journal-card cursor-pointer p-4 rounded-2xl'
    );
    card.dataset.memberId = String(m.id);
    card.onclick = () => {
      if (Date.now() < suppressCardClickUntil) return;
      onSelectMember(m.id);
    };

    if (canReorder) {
      const handle = createEl('div', 'card-drag-handle');
      handle.dataset.dragHandle = 'true';
      handle.setAttribute('title', '拖拉調整順序');
      handle.setAttribute('aria-label', '拖拉調整順序');
      handle.appendChild(createEl('span', 'card-drag-bar'));
      handle.onclick = (e) => e.stopPropagation();
      card.appendChild(handle);

      card.addEventListener('pointerdown', (e) => {
        if (e.button !== undefined && e.button !== 0) return;
        const fromHandle = Boolean(e.target?.closest?.('[data-drag-handle]'));
        cancelCardDrag();
        dragState = {
          pointerId: e.pointerId,
          startX: e.clientX,
          startY: e.clientY,
          lastClientX: e.clientX,
          lastClientY: e.clientY,
          grabOffsetY: 0,
          currentOffsetY: 0,
          cardAnim: null,
          autoScrollRaf: 0,
          fromHandle,
          active: false,
          container,
          card,
          initialOrder: getOrderedCardIds(container),
          timer: fromHandle
            ? null
            : setTimeout(() => activateCardDrag(), LONG_PRESS_REORDER_MS)
        };
      });
    }

    // 上排：左為頭像與名稱／更新日（長名稱優雅折行），右為當前體重（不換行不被擠壓）
    const topRow = createEl('div', 'flex justify-between items-center gap-3');
    const identityWrap = createEl('div', 'flex items-center gap-3 min-w-0 flex-1');
    const avatarNode = createAvatarNode(resolveMemberAvatar(m), 'w-11 h-11');

    const textWrap = createEl('div', 'min-w-0 flex-1');
    const nameLine = createEl('div', 'flex items-center flex-wrap gap-1.5 min-w-0');
    nameLine.append(
      createEl('span', 'font-semibold text-base text-ink leading-snug break-words', String(m.name ?? '')),
      createEl('span', `shrink-0 max-w-[9rem] truncate text-[12px] px-2 py-0.5 rounded-full font-medium leading-none ${typeMeta.pillClass}`, badgeLabel)
    );
    if (isPrivacyOn) {
      const privBadge = createEl(
        'span',
        'shrink-0 inline-flex items-center gap-0.5 text-[12px] px-1.5 py-0.5 rounded-full bg-oat-100 text-ink-500 border border-oat-200 leading-none'
      );
      privBadge.setAttribute('title', hasPin ? '已開啟密碼隱私保護' : '已開啟體重隱私保護');
      privBadge.appendChild(createIcon(isHidden ? (hasPin ? 'lock' : 'eyeOff') : 'unlock', 'w-3 h-3'));
      nameLine.appendChild(privBadge);
    }

    textWrap.append(
      nameLine,
      createEl(
        'p',
        'text-fluid-label text-ink-400 mt-1 tabular-nums whitespace-nowrap',
        latest ? `${latest.recorded_at} 更新` : '尚未有紀錄'
      )
    );
    identityWrap.append(avatarNode, textWrap);

    const weightRow = createEl('div', 'text-fluid-weight font-semibold text-ink tabular-nums shrink-0 text-right whitespace-nowrap');
    if (isHidden) {
      weightRow.append(
        createEl('span', 'text-ink-400 tracking-wider', latest ? MASKED_WEIGHT : '--'),
        createEl('span', 'text-xs font-normal text-ink-400 ml-1', 'kg')
      );
    } else {
      weightRow.append(
        document.createTextNode(`${latest ? latest.weight_kg : '--'} `),
        createEl('span', 'text-xs font-normal text-ink-400', 'kg')
      );
    }

    topRow.append(identityWrap, weightRow);

    // 下排：三欄等寬精簡指標列（較前次 / 距目標或進度 / 家人 BMI 或毛孩 BCS・一週變化）
    const diffColor = diffNum === null
      ? 'text-ink-400'
      : diffNum > 0
        ? 'text-rosewood-600'
        : 'text-sage-600';

    let targetLabel;
    let targetValue;
    let targetColor;
    if (isHidden) {
      targetLabel = '目標進度';
      if (goalProgress) {
        targetValue = goalProgress.isAchieved ? '已達標' : `${goalProgress.percent}%`;
        targetColor = goalProgress.isAchieved ? 'text-sage-600' : 'text-sage-700';
      } else {
        targetValue = '--';
        targetColor = 'text-ink-400';
      }
    } else {
      targetLabel = '距目標';
      targetValue = targetGap
        ? (targetGap.isAchieved ? '已達標' : `${targetGap.signedText} kg`)
        : '--';
      targetColor = !targetGap
        ? 'text-ink-400'
        : targetGap.isAchieved
          ? 'text-sage-600'
          : targetGap.gap > 0
            ? 'text-ochre-600'
            : 'text-sage-700';
    }

    // 第 3 欄：家人顯示 BMI（隱私模式僅顯體位狀態）；毛孩優先顯示 BCS 體態評分，未填則顯示一週體重變化幅度（%）
    let thirdLabel;
    let thirdValue;
    let thirdColor;
    if (isHuman) {
      thirdLabel = isHidden ? '體位狀態' : 'BMI';
      thirdValue = bmiRes ? (isHidden ? bmiRes.status : bmiRes.bmi.toFixed(1)) : '--';
      thirdColor = bmiRes
        ? (bmiRes.status === '正常範圍' ? 'text-sage-700' : 'text-ochre-600')
        : 'text-ink-400';
    } else if (bcsMeta) {
      thirdLabel = '體態 BCS';
      thirdValue = bcsMeta.compact;
      thirdColor = bcsMeta.colorClass;
    } else {
      thirdLabel = '一週變化';
      thirdValue = weeklyPct ? weeklyPct.signedText : '--';
      thirdColor = !weeklyPct
        ? 'text-ink-400'
        : weeklyPct.isAlert
          ? 'text-rosewood-600'
          : weeklyPct.pct > 0
            ? 'text-ochre-600'
            : weeklyPct.pct < 0
              ? 'text-sage-700'
              : 'text-ink-700';
    }

    const metricsGrid = createEl(
      'div',
      'mt-3.5 bg-oat-50 border border-oat-200/70 rounded-xl py-2.5 px-1 grid grid-cols-3 divide-x divide-oat-200 text-center'
    );
    metricsGrid.append(
      createMetricCell('較前次', diffStr, diffColor),
      createMetricCell(targetLabel, targetValue, targetColor),
      createMetricCell(thirdLabel, thirdValue, thirdColor)
    );

    card.append(topRow, metricsGrid);
    return card;
  });

  container.replaceChildren(...cards);
}
