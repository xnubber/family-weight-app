import { createEl } from './dom.js';
import { createIcon } from './icons.js';

const LOCK_THRESHOLD_PX = 10;
const PULL_VISIBLE_PX = 16;
const TRIGGER_DISTANCE_PX = 68;
const MIN_SYNC_DISPLAY_MS = 380;

function isExcludedTarget(target) {
  if (!target || typeof target.closest !== 'function') return false;
  return Boolean(target.closest('input, textarea, select, [data-no-pull-refresh]'));
}

/**
 * 初始化總覽頁頂部下拉同步手勢（Pull-to-Refresh）：
 * - 僅在「總覽」分頁、無開啟彈窗、且頁面位於最頂端（scrollY <= 2）時啟用
 * - 純 CSS class 驅動平滑展開與旋轉動畫（零行內 style，完全符合嚴格 CSP）
 * - 放開觸發後執行雲端同步，完成後柔和收合
 */
export function initOverviewPullToRefresh({ canPull, isSyncing, onRefresh }) {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (typeof canPull !== 'function' || typeof onRefresh !== 'function') return;

  const slot = document.getElementById('overview-pull-refresh');
  if (!slot) return;

  let gesture = null;
  let refreshing = false;

  const setVisualPhase = (phase) => {
    slot.classList.remove('is-pulling', 'is-ready', 'is-syncing');
    if (!phase) {
      slot.replaceChildren();
      return;
    }

    slot.classList.add(
      phase === 'syncing' ? 'is-syncing' : phase === 'ready' ? 'is-ready' : 'is-pulling'
    );

    const pill = createEl('div', 'pull-refresh-pill');
    const iconClass =
      phase === 'syncing'
        ? 'pull-refresh-icon w-3.5 h-3.5 shrink-0 animate-spin'
        : 'pull-refresh-icon w-3.5 h-3.5 shrink-0';
    const label =
      phase === 'syncing'
        ? '同步最新資料中…'
        : phase === 'ready'
          ? '放開立即同步'
          : '下拉同步雲端資料';

    pill.append(createIcon('refresh', iconClass), createEl('span', '', label));
    slot.replaceChildren(pill);
  };

  const resetGesture = () => {
    gesture = null;
    if (!refreshing) {
      setVisualPhase(null);
    }
  };

  const handleTouchStart = (e) => {
    if (refreshing || (typeof isSyncing === 'function' && isSyncing())) return;
    if (!e.touches || e.touches.length !== 1) {
      resetGesture();
      return;
    }
    if (!canPull()) return;
    const scrollTop = window.scrollY || document.documentElement?.scrollTop || 0;
    if (scrollTop > 2) return;
    if (isExcludedTarget(e.target)) return;

    const touch = e.touches[0];
    gesture = {
      startX: touch.clientX,
      startY: touch.clientY,
      locked: null, // 'pull' | 'ignore' | null
      lastDy: 0,
      readyHapticFired: false
    };
  };

  const handleTouchMove = (e) => {
    if (!gesture || refreshing || !e.touches || e.touches.length !== 1) return;
    const touch = e.touches[0];
    const dx = touch.clientX - gesture.startX;
    const dy = touch.clientY - gesture.startY;
    gesture.lastDy = dy;

    if (gesture.locked === null) {
      const dist = Math.hypot(dx, dy);
      if (dist < LOCK_THRESHOLD_PX) return;
      // 僅接受向下主軸拉動；橫向或向上捲動立即放行
      if (dy <= 0 || Math.abs(dx) > dy * 0.85) {
        gesture.locked = 'ignore';
        setVisualPhase(null);
        return;
      }
      gesture.locked = 'pull';
    }

    if (gesture.locked !== 'pull') return;

    if (dy >= TRIGGER_DISTANCE_PX) {
      setVisualPhase('ready');
      if (!gesture.readyHapticFired) {
        gesture.readyHapticFired = true;
        if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
          navigator.vibrate(10);
        }
      }
    } else if (dy >= PULL_VISIBLE_PX) {
      gesture.readyHapticFired = false;
      setVisualPhase('pulling');
    } else {
      gesture.readyHapticFired = false;
      setVisualPhase(null);
    }
  };

  const handleTouchEnd = async () => {
    if (!gesture) return;
    const { locked, lastDy } = gesture;
    gesture = null;

    if (locked !== 'pull' || lastDy < TRIGGER_DISTANCE_PX) {
      if (!refreshing) setVisualPhase(null);
      return;
    }

    refreshing = true;
    const startedAt = Date.now();
    setVisualPhase('syncing');

    try {
      await onRefresh();
    } finally {
      const elapsed = Date.now() - startedAt;
      const remaining = Math.max(0, MIN_SYNC_DISPLAY_MS - elapsed);
      setTimeout(() => {
        refreshing = false;
        setVisualPhase(null);
      }, remaining);
    }
  };

  document.addEventListener('touchstart', handleTouchStart, { passive: true });
  document.addEventListener('touchmove', handleTouchMove, { passive: true });
  document.addEventListener('touchend', handleTouchEnd, { passive: true });
  document.addEventListener('touchcancel', resetGesture, { passive: true });
}
