// 建立純文字 DOM 元素的共用輔助函式，徹底避免使用 innerHTML 導致 XSS
export function createEl(tag, className = '', text = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== '') node.textContent = text;
  return node;
}

// 非阻塞式頂部同步狀態指示器（不遮罩畫面，讓使用者在背景同步期間可持續操作）
export function updateSyncIndicator({ pendingCount = 0, isFetching = false } = {}) {
  const btn = document.getElementById('btn-refresh');
  if (!btn) return;

  if (pendingCount > 0) {
    btn.textContent = `☁️ 同步中 (${pendingCount})`;
    btn.className = 'text-xs sm:text-sm bg-teal-50 text-teal-700 border border-teal-200 px-3 py-1.5 rounded-lg font-medium transition';
  } else if (isFetching) {
    btn.textContent = '🔄 同步中...';
    btn.className = 'text-xs sm:text-sm bg-slate-100 text-slate-500 px-3 py-1.5 rounded-lg transition';
  } else {
    btn.textContent = '🔄 同步';
    btn.className = 'text-sm bg-slate-100 hover:bg-slate-200 px-3 py-1.5 rounded-lg text-slate-700 transition';
  }
}

let toastTimer = null;

export function showToast(msg, isError = false) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `fixed top-16 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-full text-sm text-white shadow-lg ${isError ? 'bg-rose-600' : 'bg-slate-800'}`;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 2500);
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
