import { createIcon } from './icons.js';

// 建立純文字 DOM 元素的共用輔助函式，徹底避免使用 innerHTML 導致 XSS
export function createEl(tag, className = '', text = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== '') node.textContent = text;
  return node;
}

// 非阻塞式頂部同步狀態指示器（使用文青細線 SVG 圖示，不遮罩畫面）
export function updateSyncIndicator({ pendingCount = 0, isFetching = false } = {}) {
  const btn = document.getElementById('btn-refresh');
  if (!btn) return;

  if (pendingCount > 0) {
    btn.className = 'inline-flex items-center gap-1.5 text-xs bg-sage-50 text-sage-700 border border-sage-200 px-3 py-1.5 rounded-full font-medium transition';
    btn.replaceChildren(
      createIcon('cloud', 'w-3.5 h-3.5 shrink-0'),
      createEl('span', '', `同步中 (${pendingCount})`)
    );
  } else if (isFetching) {
    btn.className = 'inline-flex items-center gap-1.5 text-xs bg-oat-100 text-ink-500 border border-oat-200 px-3 py-1.5 rounded-full font-medium transition';
    btn.replaceChildren(
      createIcon('refresh', 'w-3.5 h-3.5 shrink-0 animate-spin'),
      createEl('span', '', '同步中')
    );
  } else {
    btn.className = 'inline-flex items-center gap-1.5 text-xs bg-linen hover:bg-oat-100 text-ink-700 border border-oat-200 px-3 py-1.5 rounded-full font-medium transition';
    btn.replaceChildren(
      createIcon('refresh', 'w-3.5 h-3.5 shrink-0'),
      createEl('span', '', '同步')
    );
  }
}

// 彈窗平滑進出場控制（使用 token 避免快速重複開關導致閃爍或誤藏）
const modalCloseTimers = new WeakMap();
const MODAL_EXIT_MS = 220;

function resolveModalEl(modalOrId) {
  return typeof modalOrId === 'string' ? document.getElementById(modalOrId) : modalOrId;
}

export function isModalOpen(modalOrId) {
  const modal = resolveModalEl(modalOrId);
  if (!modal) return false;
  return !modal.classList.contains('hidden') && modal.classList.contains('is-open');
}

export function openModal(modalOrId) {
  const modal = resolveModalEl(modalOrId);
  if (!modal) return;
  const prevTimer = modalCloseTimers.get(modal);
  if (prevTimer) {
    clearTimeout(prevTimer);
    modalCloseTimers.delete(modal);
  }
  const alreadyVisible = !modal.classList.contains('hidden') && modal.classList.contains('is-open');
  modal.classList.remove('hidden');
  if (alreadyVisible) return;

  modal.classList.remove('is-open');
  const nextFrame = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (fn) => fn();
  nextFrame(() => {
    nextFrame(() => {
      modal.classList.add('is-open');
    });
  });
}

export function closeModal(modalOrId) {
  const modal = resolveModalEl(modalOrId);
  if (!modal || modal.classList.contains('hidden')) return;
  const prevTimer = modalCloseTimers.get(modal);
  if (prevTimer) clearTimeout(prevTimer);

  modal.classList.remove('is-open');
  const timer = setTimeout(() => {
    modalCloseTimers.delete(modal);
    if (!modal.classList.contains('is-open')) {
      modal.classList.add('hidden');
    }
  }, MODAL_EXIT_MS);
  modalCloseTimers.set(modal, timer);
}

// 內容區塊柔和浮現（供分頁翻頁、表單模式切換使用）
export function playSoftFade(el) {
  if (!el || !el.classList) return;
  el.classList.remove('soft-fade-in');
  if (typeof el.offsetWidth === 'number') {
    // 觸發重排以重新播放 CSS 動畫
    void el.offsetWidth;
  }
  el.classList.add('soft-fade-in');
}

let toastHideTimer = null;
let toastCleanupTimer = null;

export function showToast(msg, isError = false) {
  const el = document.getElementById('toast');
  if (!el) return;
  if (toastHideTimer) clearTimeout(toastHideTimer);
  if (toastCleanupTimer) clearTimeout(toastCleanupTimer);

  el.textContent = msg;
  el.className = `toast-banner fixed top-16 left-1/2 z-50 px-4 py-2 rounded-full text-xs font-medium tracking-wide text-linen shadow-soft ${isError ? 'bg-rosewood-600' : 'bg-ink'}`;

  const nextFrame = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (fn) => fn();
  nextFrame(() => {
    el.classList.add('is-visible');
  });

  toastHideTimer = setTimeout(() => {
    el.classList.remove('is-visible');
    toastCleanupTimer = setTimeout(() => {
      if (!el.classList.contains('is-visible')) {
        el.classList.add('hidden');
      }
    }, 240);
  }, 2400);
}

// 統一點擊回饋：確保手機上快速輕點（<50ms）也能呈現完整的按壓縮放與回彈手感
export function initTapFeedback() {
  const MIN_PRESS_MS = 110;
  let activeEl = null;
  let pressedAt = 0;

  const release = () => {
    if (!activeEl) return;
    const el = activeEl;
    activeEl = null;
    const elapsed = Date.now() - pressedAt;
    const remaining = Math.max(0, MIN_PRESS_MS - elapsed);
    if (remaining === 0) {
      el.classList.remove('is-pressed');
    } else {
      setTimeout(() => el.classList.remove('is-pressed'), remaining);
    }
  };

  document.addEventListener('pointerdown', (e) => {
    const target = e.target?.closest?.('button:not(:disabled), .member-card');
    if (!target) return;
    if (activeEl && activeEl !== target) {
      activeEl.classList.remove('is-pressed');
    }
    activeEl = target;
    pressedAt = Date.now();
    target.classList.add('is-pressed');
  });

  ['pointerup', 'pointercancel', 'pointerleave'].forEach((evt) => {
    document.addEventListener(evt, release);
  });
}
