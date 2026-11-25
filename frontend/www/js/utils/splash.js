// 冷啟動「晨露扉頁」極速過場控制器（支援快取快退、首次同步等待上限、點擊即略過與減少動態偏好）

const DEFAULT_MIN_MS = 460;
const DEFAULT_MAX_WAIT_MS = 1200;
const EXIT_DURATION_MS = 260;
const REDUCED_EXIT_MS = 120;

export function createSplashController({
  element = typeof document !== 'undefined' ? document.getElementById('app-splash') : null,
  minDisplayMs = DEFAULT_MIN_MS,
  maxWaitMs = DEFAULT_MAX_WAIT_MS,
  prefersReducedMotion = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false,
  now = () => Date.now(),
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id)
} = {}) {
  const startedAt = now();
  let dismissed = false;
  let exitTimer = null;
  let pendingTimer = null;
  let failsafeTimer = null;

  const cleanupTimers = () => {
    if (pendingTimer !== null) {
      clearTimer(pendingTimer);
      pendingTimer = null;
    }
    if (failsafeTimer !== null) {
      clearTimer(failsafeTimer);
      failsafeTimer = null;
    }
  };

  const dismissNow = () => {
    if (dismissed) return;
    dismissed = true;
    cleanupTimers();

    if (!element) return;
    element.classList.add('is-leaving');
    element.setAttribute('aria-hidden', 'true');

    const fadeMs = prefersReducedMotion ? REDUCED_EXIT_MS : EXIT_DURATION_MS;
    exitTimer = setTimer(() => {
      exitTimer = null;
      element.classList.add('is-gone');
    }, fadeMs);
  };

  const scheduleDismiss = (delayMs) => {
    if (dismissed) return;
    const safeDelay = Math.max(0, Number(delayMs) || 0);
    if (pendingTimer !== null) clearTimer(pendingTimer);
    if (safeDelay === 0) {
      dismissNow();
      return;
    }
    pendingTimer = setTimer(() => {
      pendingTimer = null;
      dismissNow();
    }, safeDelay);
  };

  // 點擊過場任意處可立即略過，不阻擋急著記錄的使用者
  if (element && typeof element.addEventListener === 'function') {
    element.addEventListener('click', dismissNow, { once: true });
  }

  // 最長停留保底：無論網路或初始化狀態如何，絕不卡在過場畫面
  failsafeTimer = setTimer(dismissNow, prefersReducedMotion ? REDUCED_EXIT_MS : maxWaitMs);

  return {
    // 當首屏已就緒（有快取立即呼叫，或首次雲端同步完成後呼叫）
    markReady({ hasCache = true } = {}) {
      if (dismissed) return;
      if (prefersReducedMotion) {
        dismissNow();
        return;
      }
      const elapsed = Math.max(0, now() - startedAt);
      const targetMin = hasCache ? minDisplayMs : Math.min(minDisplayMs, maxWaitMs);
      const remaining = Math.max(0, targetMin - elapsed);
      scheduleDismiss(remaining);
    },
    dismissNow,
    isDismissed: () => dismissed,
    _clearExitTimerForTest: () => {
      if (exitTimer !== null) {
        clearTimer(exitTimer);
        exitTimer = null;
      }
      cleanupTimers();
    }
  };
}
