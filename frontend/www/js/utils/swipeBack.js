import { createIcon } from './icons.js';

const EDGE_ZONE_PX = 56;
const LOCK_THRESHOLD_PX = 10;
const PULL_VISUAL_PX = 18;
const TRIGGER_DISTANCE_PX = 68;
const QUICK_FLICK_DISTANCE_PX = 42;
const QUICK_FLICK_MAX_MS = 260;

// 確認觸控起點是否位於不應干擾手勢的互動元素內（圖表畫布、輸入框或可橫向捲動區塊）
function isGestureExcludedTarget(target, edgeSide) {
  if (!target || typeof target.closest !== 'function') return false;
  if (target.closest('canvas, input, textarea, select, [data-no-swipe-back]')) {
    return true;
  }

  // 若父層為可橫向捲動容器（例如統計頁成員切換膠囊列），檢查是否朝該容器可捲動方向滑動
  let el = target;
  while (el && el !== document.body && el !== document.documentElement) {
    if (el.scrollWidth > el.clientWidth + 4) {
      const style = typeof window.getComputedStyle === 'function' ? window.getComputedStyle(el) : null;
      const overflowX = style?.overflowX || '';
      if (overflowX === 'auto' || overflowX === 'scroll') {
        // 從左邊往右滑（deltaX > 0）會讓 scrollLeft 減少；若容器尚未捲到最左則優先給容器捲動
        if (edgeSide === 'left' && el.scrollLeft > 2) return true;
        // 從右邊往左滑（deltaX < 0）會讓 scrollLeft 增加；若容器尚未捲到最右則優先給容器捲動
        if (edgeSide === 'right' && el.scrollLeft + el.clientWidth < el.scrollWidth - 2) return true;
      }
    }
    el = el.parentElement;
  }
  return false;
}

/**
 * 初始化手機螢幕左／右邊緣往內滑動返回手勢：
 * - 左邊緣（<= 56px）向右滑，或右邊緣（>= 螢幕寬 - 56px）向左滑皆可觸發返回
 * - 搭配純 CSS class 控制的文青邊緣返回膠囊指示器（零行內 style，完全符合嚴格 CSP）
 * - 自動避開圖表長按拖曳、輸入框與可橫向捲動容器
 */
export function initSwipeBackGesture({ canGoBack, onBack }) {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (typeof canGoBack !== 'function' || typeof onBack !== 'function') return;

  const indicator = document.getElementById('swipe-back-indicator');
  let gesture = null;

  const updateIndicator = (side, phase) => {
    if (!indicator) return;
    indicator.classList.remove('from-left', 'from-right', 'is-pulling', 'is-ready');
    if (!side || !phase) {
      indicator.replaceChildren();
      return;
    }
    indicator.classList.add(side === 'left' ? 'from-left' : 'from-right');
    indicator.classList.add(phase === 'ready' ? 'is-ready' : 'is-pulling');
    if (indicator.childElementCount === 0) {
      indicator.replaceChildren(
        createIcon(side === 'left' ? 'chevronRight' : 'chevronLeft', 'w-4 h-4 shrink-0')
      );
    }
  };

  const resetGesture = () => {
    gesture = null;
    updateIndicator(null, null);
  };

  const handleTouchStart = (e) => {
    if (!e.touches || e.touches.length !== 1) {
      resetGesture();
      return;
    }
    if (!canGoBack()) return;

    const touch = e.touches[0];
    const vw = window.innerWidth || document.documentElement.clientWidth || 375;
    let edgeSide = null;
    if (touch.clientX <= EDGE_ZONE_PX) {
      edgeSide = 'left';
    } else if (touch.clientX >= vw - EDGE_ZONE_PX) {
      edgeSide = 'right';
    }
    if (!edgeSide) return;
    if (isGestureExcludedTarget(e.target, edgeSide)) return;

    gesture = {
      side: edgeSide,
      startX: touch.clientX,
      startY: touch.clientY,
      startTime: Date.now(),
      locked: null, // 'horizontal' | 'vertical' | null
      readyHapticFired: false,
      lastInwardDx: 0,
      lastAbsDy: 0
    };
  };

  const handleTouchMove = (e) => {
    if (!gesture || !e.touches || e.touches.length !== 1) return;
    const touch = e.touches[0];
    const dx = touch.clientX - gesture.startX;
    const dy = touch.clientY - gesture.startY;
    const inwardDx = gesture.side === 'left' ? dx : -dx;
    const absDy = Math.abs(dy);

    gesture.lastInwardDx = inwardDx;
    gesture.lastAbsDy = absDy;

    if (gesture.locked === null) {
      const dist = Math.hypot(dx, dy);
      if (dist < LOCK_THRESHOLD_PX) return;
      // 垂直捲動優先，或滑動方向朝外而非朝內則放棄本次返回手勢
      if (absDy > Math.abs(dx) * 0.85 || inwardDx <= 0) {
        gesture.locked = 'vertical';
        updateIndicator(null, null);
        return;
      }
      gesture.locked = 'horizontal';
    }

    if (gesture.locked !== 'horizontal') return;

    if (inwardDx >= TRIGGER_DISTANCE_PX) {
      updateIndicator(gesture.side, 'ready');
      if (!gesture.readyHapticFired) {
        gesture.readyHapticFired = true;
        if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
          navigator.vibrate(10);
        }
      }
    } else if (inwardDx >= PULL_VISUAL_PX) {
      gesture.readyHapticFired = false;
      updateIndicator(gesture.side, 'pulling');
    } else {
      gesture.readyHapticFired = false;
      updateIndicator(null, null);
    }
  };

  const handleTouchEnd = () => {
    if (!gesture) return;
    const { locked, lastInwardDx, lastAbsDy, startTime } = gesture;
    const elapsed = Date.now() - startTime;
    resetGesture();

    if (locked !== 'horizontal') return;
    const isLongPull = lastInwardDx >= TRIGGER_DISTANCE_PX;
    const isQuickFlick =
      lastInwardDx >= QUICK_FLICK_DISTANCE_PX &&
      elapsed <= QUICK_FLICK_MAX_MS &&
      lastAbsDy < 45;

    if (isLongPull || isQuickFlick) {
      onBack();
    }
  };

  document.addEventListener('touchstart', handleTouchStart, { passive: true });
  document.addEventListener('touchmove', handleTouchMove, { passive: true });
  document.addEventListener('touchend', handleTouchEnd, { passive: true });
  document.addEventListener('touchcancel', resetGesture, { passive: true });
}
