import { state } from '../state.js';
import { hasInjectedApiKey } from '../services/api.js';
import { optimisticDeleteMember } from '../services/syncQueue.js';
import { createEl, showToast } from '../utils/dom.js';
import { generateFamilyCode, isValidFamilyCode } from '../utils/validation.js';

export function renderSettingsMembers({ onEditMember }) {
  const list = document.getElementById('settings-member-list');
  if (state.appData.members.length === 0) {
    list.replaceChildren(createEl('li', 'py-3 text-center text-slate-400', '尚無成員'));
    return;
  }

  const items = state.appData.members.map((m) => {
    const li = createEl('li', 'py-2.5 flex justify-between items-center');
    li.appendChild(createEl('span', '', `${m.type === 'cat' ? '🐱' : '👤'} ${m.name ?? ''}`));

    const actions = createEl('div', 'flex items-center gap-1.5 shrink-0');

    const editBtn = createEl('button', 'text-xs text-teal-600 hover:bg-teal-50 px-2 py-1 rounded-lg', '編輯');
    editBtn.type = 'button';
    editBtn.onclick = () => onEditMember(m);

    const delBtn = createEl('button', 'text-xs text-rose-500 hover:bg-rose-50 px-2 py-1 rounded-lg', '刪除');
    delBtn.type = 'button';
    delBtn.onclick = () => {
      if (!confirm('刪除成員會連同所有體重紀錄一起刪除，確定嗎？')) return;
      optimisticDeleteMember(m.id);
      showToast('已刪除成員');
    };

    actions.append(editBtn, delBtn);
    li.appendChild(actions);
    return li;
  });
  list.replaceChildren(...items);
}

export function initSettings({ onSync }) {
  // 若未透過 config.js 注入 API Key，顯示設定頁的金鑰輸入欄位
  const wrap = document.getElementById('api-key-setting-wrap');
  const input = document.getElementById('input-api-key');
  if (!hasInjectedApiKey()) {
    wrap.classList.remove('hidden');
    input.value = localStorage.getItem('appApiKey') || '';
  }

  // 隨機產生新的高強度同步碼
  document.getElementById('btn-generate-code').onclick = () => {
    document.getElementById('input-family-code').value = generateFamilyCode();
    showToast('已產生新同步碼，請點擊儲存生效');
  };

  // 儲存家庭同步碼（與本機 API 金鑰設定）
  document.getElementById('btn-save-settings').onclick = () => {
    const nextCode = document.getElementById('input-family-code').value.trim();
    if (!isValidFamilyCode(nextCode)) {
      showToast('同步碼需為 12-64 字元英數字、- 或 _，且不可使用舊預設碼', true);
      return;
    }

    if (!hasInjectedApiKey()) {
      const apiKeyVal = document.getElementById('input-api-key').value.trim();
      if (apiKeyVal) {
        localStorage.setItem('appApiKey', apiKeyVal);
      }
    }

    state.familyCode = nextCode;
    state.selectedMemberId = null;
    state.historyPage = 1;
    localStorage.setItem('familySyncCode', state.familyCode);
    showToast('設定已儲存');
    onSync();
  };
}
