// 建立純文字 DOM 元素的共用輔助函式，徹底避免使用 innerHTML 導致 XSS
export function createEl(tag, className = '', text = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== '') node.textContent = text;
  return node;
}

export function showLoading(show) {
  document.getElementById('loading').classList.toggle('hidden', !show);
}

export function showToast(msg, isError = false) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `fixed top-16 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-full text-sm text-white shadow-lg ${isError ? 'bg-rose-600' : 'bg-slate-800'}`;
  setTimeout(() => el.classList.add('hidden'), 2500);
}
