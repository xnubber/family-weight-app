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
const SETTLE_DURATION_MS = 215;
const SYNTHETIC_MOUSE_GUARD_MS = 700;

let dragState = null;
let pendingSettle = null;
let suppressCardClickUntil = 0;
let lastTouchEventAt = 0;
let dragGlobalListenersBound = false;
let activeReorderCallback = null;

export function isOverviewReordering() {
  return Boolean((dragState && dragState.active) || pendingSettle);
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

function clearAllCardTransforms(items) {
  if (!Array.isArray(items)) return;
  for (const item of items) {
    if (item?.el?.style) {
      item.el.style.transform = '';
    }
    item?.el?.classList?.remove('is-dragging', 'is-settling');
  }
}

function cancelPendingSettle() {
  if (!pendingSettle) return;
  clearTimeout(pendingSettle.timer);
  pendingSettle = null;
}

function stopAutoScroll(stateObj) {
  if (stateObj?.autoScrollRaf && typeof cancelAnimationFrame === 'function') {
    cancelAnimationFrame(stateObj.autoScrollRaf);
    stateObj.autoScrollRaf = 0;
  }
}

// 計算拖拉中卡片應落於第幾個位置，並平滑平移受影響的相鄰卡片（全程不動 DOM，徹底消除瞬移）
function updateDragFrame() {
  if (!dragState || !dragState.active) return;

  const { card, items, fromIndex, startClientY, startScrollY, lastClientY, dragSpan } = dragState;
  const scrollDelta = getWindowScrollY() - startScrollY;
  const dy = (lastClientY - startClientY) + scrollDelta;
  dragState.currentDy = dy;

  // 1. 被拖曳卡片 1:1 緊貼手指移動（零過渡延遲、零瞬移）
  if (card?.style) {
    card.style.transform = `translate3d(0, ${dy.toFixed(1)}px, 0) scale(1.025)`;
  }

  // 2. 依被拖曳卡片視覺中心計算目標插槽索引
  const dragCenterDocY = items[fromIndex].mid + dy;
  let nextTargetIndex = fromIndex;
  if (dy > 0) {
    for (let i = fromIndex + 1; i < items.length; i++) {
      if (dragCenterDocY > items[i].mid) {
        nextTargetIndex = i;
      } else {
        break;
      }
    }
  } else if (dy < 0) {
    for (let i = fromIndex - 1; i >= 0; i--) {
      if (dragCenterDocY < items[i].mid) {
        nextTargetIndex = i;
      } else {
        break;
      }
    }
  }

  // 3. 僅在目標插槽變更時更新相鄰卡片偏移量，由 CSS compositor 絲滑讓位
  if (nextTargetIndex !== dragState.targetIndex) {
    dragState.targetIndex = nextTargetIndex;
    for (let i = 0; i < items.length; i++) {
      if (i === fromIndex) continue;
      let shiftY = 0;
      if (fromIndex < nextTargetIndex && i > fromIndex && i <= nextTargetIndex) {
        shiftY = -dragSpan;
      } else if (fromIndex > nextTargetIndex && i >= nextTargetIndex && i < fromIndex) {
        shiftY = dragSpan;
      }
      if (items[i].el?.style) {
        items[i].el.style.transform = shiftY === 0 ? 'translate3d(0, 0, 0)' : `translate3d(0, ${shiftY.toFixed(1)}px, 0)`;
      }
    }
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(8);
    }
  }
}

// 計算卡片落到目標插槽的精確位移（支援卡片高度不一致的情況）
function computeSettleOffsetY(items, fromIndex, targetIndex, gap) {
  if (targetIndex === fromIndex) return 0;
  let total = 0;
  if (targetIndex > fromIndex) {
    for (let i = fromIndex + 1; i <= targetIndex; i++) {
      total += items[i].height + gap;
    }
    return total;
  }
  for (let i = targetIndex; i < fromIndex; i++) {
    total += items[i].height + gap;
  }
  return -total;
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
      } else if (y > vh - 156) {
        delta = Math.max(3, Math.round(((y - (vh - 156)) / 156) * 14));
      }
    }

    if (delta !== 0 && typeof window.scrollBy === 'function') {
      window.scrollBy(0, delta);
      updateDragFrame();
    }

    dragState.autoScrollRaf = requestAnimationFrame(tick);
  };

  dragState.autoScrollRaf = requestAnimationFrame(tick);
}

function activateCardDrag() {
  if (!dragState || dragState.active) return;
  if (dragState.timer) {
    clearTimeout(dragState.timer);
    dragState.timer = null;
  }

  const { card, container } = dragState;
  const scrollY = getWindowScrollY();
  const cardEls = Array.from(container.children).filter((el) => el.dataset?.memberId);
  const items = cardEls.map((el) => {
    const rect = el.getBoundingClientRect();
    const top = rect.top + scrollY;
    return {
      id: el.dataset.memberId,
      el,
      top,
      height: rect.height,
      mid: top + rect.height / 2
    };
  });

  const fromIndex = items.findIndex((item) => item.el === card);
  if (fromIndex === -1 || items.length <= 1) {
    cancelCardDrag();
    return;
  }

  const gap = items.length >= 2
    ? Math.max(0, items[1].top - (items[0].top + items[0].height))
    : 12;

  // 長按卡身啟動時以當前手指點為原點，避免按住期間 2-5px 微移導致抬起瞬間跳動
  if (!dragState.fromHandle) {
    dragState.startClientX = dragState.lastClientX;
    dragState.startClientY = dragState.lastClientY;
  }

  dragState.active = true;
  dragState.items = items;
  dragState.fromIndex = fromIndex;
  dragState.targetIndex = fromIndex;
  dragState.gap = gap;
  dragState.dragSpan = items[fromIndex].height + gap;
  dragState.startScrollY = scrollY;
  dragState.currentDy = 0;

  card.classList.remove('is-pressed');
  card.classList.add('is-dragging');
  container.classList.add('member-cards-reordering');

  updateDragFrame();
  startAutoScrollLoop();

  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    navigator.vibrate(14);
  }
}

function cancelCardDrag() {
  if (!dragState) return;
  if (dragState.timer) clearTimeout(dragState.timer);
  stopAutoScroll(dragState);
  if (dragState.container) {
    dragState.container.classList.add('member-cards-snap-reset');
    dragState.container.classList.remove('member-cards-reordering');
  }
  clearAllCardTransforms(dragState.items);
  if (dragState.card?.style) dragState.card.style.transform = '';
  if (dragState.card) dragState.card.classList.remove('is-dragging', 'is-settling');
  if (dragState.container) {
    void dragState.container.offsetHeight;
    dragState.container.classList.remove('member-cards-snap-reset');
  }
  dragState = null;
}

function finishCardDrag() {
  if (!dragState) return;
  const finished = dragState;
  if (finished.timer) clearTimeout(finished.timer);
  stopAutoScroll(finished);
  dragState = null;

  const { active, container, card, items, fromIndex, targetIndex, gap } = finished;
  if (!active || !Array.isArray(items)) {
    if (card?.style) card.style.transform = '';
    if (card) card.classList.remove('is-dragging', 'is-settling');
    if (container) container.classList.remove('member-cards-reordering');
    return;
  }

  suppressCardClickUntil = Date.now() + 300;
  const changed = targetIndex !== fromIndex;
  const nextOrderIds = items.map((item) => item.id);
  if (changed) {
    const [movedId] = nextOrderIds.splice(fromIndex, 1);
    nextOrderIds.splice(targetIndex, 0, movedId);
  }

  const commitAfterSettle = () => {
    pendingSettle = null;
    if (container) {
      // 暫時停用卡片 transition，確保「清除 transform + 搬移 DOM」在同一幀無縫銜接不回彈
      container.classList.add('member-cards-snap-reset');
      container.classList.remove('member-cards-reordering');
    }
    clearAllCardTransforms(items);

    if (changed && container) {
      const movedEl = items[fromIndex].el;
      const refEl = targetIndex > fromIndex
        ? items[targetIndex].el.nextSibling
        : items[targetIndex].el;
      container.insertBefore(movedEl, refEl);
    }

    if (container) {
      void container.offsetHeight;
      container.classList.remove('member-cards-snap-reset');
    }

    if (changed && typeof activeReorderCallback === 'function') {
      activeReorderCallback(nextOrderIds);
    }
  };

  if (prefersReducedMotion()) {
    commitAfterSettle();
    return;
  }

  // 放開手指後，卡片從手指所在位置平順落入最終插槽
  const settleY = computeSettleOffsetY(items, fromIndex, targetIndex, gap);
  card.classList.remove('is-dragging');
  card.classList.add('is-settling');
  if (card.style) {
    card.style.transform = `translate3d(0, ${settleY.toFixed(1)}px, 0) scale(1)`;
  }

  const timer = setTimeout(commitAfterSettle, SETTLE_DURATION_MS);
  pendingSettle = { timer, commit: commitAfterSettle };
}

function handleDragMovePoint(clientX, clientY) {
  if (!dragState) return;
  dragState.lastClientX = clientX;
  dragState.lastClientY = clientY;
  const dx = clientX - dragState.startClientX;
  const dy = clientY - dragState.startClientY;

  if (!dragState.active) {
    if (dragState.fromHandle && Math.hypot(dx, dy) >= 2) {
      activateCardDrag();
    } else if (!dragState.fromHandle && Math.hypot(dx, dy) > MOVE_CANCEL_THRESHOLD_PX) {
      cancelCardDrag();
      return;
    } else {
      return;
    }
  }

  updateDragFrame();
}

function bindGlobalDragListeners() {
  if (dragGlobalListenersBound || typeof window === 'undefined' || typeof document === 'undefined') {
    return;
  }
  dragGlobalListenersBound = true;

  // 手機觸控通道（使用原生 touch 事件避免 Android WebView 在長按後誤發 pointercancel）
  document.addEventListener(
    'touchmove',
    (e) => {
      if (!dragState || dragState.inputKind !== 'touch') return;
      if (!e.touches || e.touches.length !== 1) {
        finishCardDrag();
        return;
      }
      const touch = e.touches[0];
      handleDragMovePoint(touch.clientX, touch.clientY);
      if (dragState && (dragState.active || dragState.fromHandle) && e.cancelable) {
        e.preventDefault();
      }
    },
    { passive: false }
  );

  document.addEventListener(
    'touchend',
    () => {
      lastTouchEventAt = Date.now();
      if (dragState && dragState.inputKind === 'touch') {
        finishCardDrag();
      }
    },
    { passive: true }
  );

  document.addEventListener(
    'touchcancel',
    () => {
      lastTouchEventAt = Date.now();
      if (dragState && dragState.inputKind === 'touch') {
        cancelCardDrag();
      }
    },
    { passive: true }
  );

  // 桌面滑鼠通道
  window.addEventListener('mousemove', (e) => {
    if (!dragState || dragState.inputKind !== 'mouse') return;
    handleDragMovePoint(e.clientX, e.clientY);
  });

  window.addEventListener('mouseup', () => {
    if (dragState && dragState.inputKind === 'mouse') {
      finishCardDrag();
    }
  });

  window.addEventListener('blur', () => {
    cancelCardDrag();
  });
}

export function renderOverview({ onSelectMember, onReorderMembers = null, onTogglePrivacy = null }) {
  const container = document.getElementById('member-cards');
  activeReorderCallback = onReorderMembers;
  cancelPendingSettle();
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

      const beginDragSession = (inputKind, clientX, clientY, target) => {
        if (pendingSettle) return;
        if (target?.closest?.('button, [data-card-action]')) return;
        const fromHandle = Boolean(target?.closest?.('[data-drag-handle]'));
        cancelCardDrag();
        dragState = {
          inputKind,
          startClientX: clientX,
          startClientY: clientY,
          lastClientX: clientX,
          lastClientY: clientY,
          startScrollY: getWindowScrollY(),
          currentDy: 0,
          fromHandle,
          active: false,
          container,
          card,
          items: null,
          fromIndex: -1,
          targetIndex: -1,
          gap: 12,
          dragSpan: 0,
          autoScrollRaf: 0,
          timer: fromHandle
            ? null
            : setTimeout(() => activateCardDrag(), LONG_PRESS_REORDER_MS)
        };
      };

      card.addEventListener(
        'touchstart',
        (e) => {
          lastTouchEventAt = Date.now();
          if (!e.touches || e.touches.length !== 1) return;
          const touch = e.touches[0];
          beginDragSession('touch', touch.clientX, touch.clientY, e.target);
        },
        { passive: true }
      );

      card.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        // 避免手機瀏覽器在觸控結束後補發的相容 mousedown 重複啟動拖曳
        if (Date.now() - lastTouchEventAt < SYNTHETIC_MOUSE_GUARD_MS) return;
        beginDragSession('mouse', e.clientX, e.clientY, e.target);
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
      const canToggle = typeof onTogglePrivacy === 'function';
      const privToggle = createEl(
        canToggle ? 'button' : 'span',
        isHidden
          ? 'shrink-0 inline-flex items-center gap-1 text-[12px] px-2 py-0.5 rounded-full bg-oat-100 hover:bg-oat-200/80 text-ink-600 border border-oat-200 font-medium leading-none'
          : 'shrink-0 inline-flex items-center gap-1 text-[12px] px-2 py-0.5 rounded-full bg-sage-50 hover:bg-sage-100 text-sage-700 border border-sage-200 font-medium leading-none'
      );
      if (canToggle) {
        privToggle.type = 'button';
        privToggle.dataset.cardAction = 'privacy';
        const actionLabel = isHidden
          ? (hasPin ? '輸入密碼解鎖體重' : '點擊暫時解鎖顯示體重')
          : '點擊立即上鎖隱藏體重';
        privToggle.setAttribute('title', actionLabel);
        privToggle.setAttribute('aria-label', actionLabel);
        privToggle.onclick = (e) => {
          e.stopPropagation();
          if (Date.now() < suppressCardClickUntil) return;
          onTogglePrivacy(m);
        };
      } else {
        privToggle.setAttribute('title', hasPin ? '已開啟密碼隱私保護' : '已開啟體重隱私保護');
      }
      privToggle.append(
        createIcon(isHidden ? (hasPin ? 'lock' : 'eyeOff') : 'unlock', 'w-3 h-3 shrink-0'),
        createEl('span', '', isHidden ? '解鎖' : '上鎖')
      );
      nameLine.appendChild(privToggle);
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
