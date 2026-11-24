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

let toastTimer = null;

export function showToast(msg, isError = false) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `fixed top-16 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-full text-xs font-medium tracking-wide text-linen shadow-soft ${isError ? 'bg-rosewood-600' : 'bg-ink'}`;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 2600);
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
