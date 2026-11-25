import { state } from '../state.js';
import { hasInjectedApiKey } from '../services/api.js';
import { optimisticDeleteMember } from '../services/syncQueue.js';
import { createEl, showToast } from '../utils/dom.js';
import { createAvatarNode, resolveMemberAvatar } from '../utils/avatars.js';
import { isMemberPrivacyEnabled, lockAllMembers, memberHasPrivacyPin } from '../utils/privacy.js';
import { clearFamilyCache } from '../utils/cache.js';
import { generateFamilyCode, isValidFamilyCode } from '../utils/validation.js';

function getMemberTypeLabel(type) {
  if (type === 'cat') return '貓咪';
  if (type === 'dog') return '狗狗';
  return '家人';
}

export function renderSettingsMembers({ onEditMember }) {
  const list = document.getElementById('settings-member-list');
  if (state.appData.members.length === 0) {
    list.replaceChildren(createEl('li', 'py-3 text-center text-ink-400', '尚無成員'));
    return;
  }

  const items = state.appData.members.map((m) => {
    const li = createEl('li', 'py-2.5 flex justify-between items-center gap-2');

    const identity = createEl('div', 'flex items-center gap-2.5 min-w-0 flex-1');
    const nameGroup = createEl('div', 'min-w-0');
    const privSuffix = isMemberPrivacyEnabled(m)
      ? (memberHasPrivacyPin(m) ? ' · 密碼隱私' : ' · 體重隱私')
      : '';
    nameGroup.append(
      createEl('div', 'font-medium text-ink leading-snug break-words', String(m.name ?? '')),
      createEl('div', 'text-fluid-label text-ink-400 mt-0.5', `${getMemberTypeLabel(m.type)}${privSuffix}`)
    );
    identity.append(createAvatarNode(resolveMemberAvatar(m), 'w-8 h-8'), nameGroup);

    const actions = createEl('div', 'flex items-center gap-1.5 shrink-0');

    const editBtn = createEl('button', 'whitespace-nowrap text-xs text-sage-700 hover:bg-sage-50 px-2.5 py-1 rounded-lg font-medium', '編輯');
    editBtn.type = 'button';
    editBtn.onclick = () => onEditMember(m);

    const delBtn = createEl('button', 'whitespace-nowrap text-xs text-rosewood-600 hover:bg-rosewood-50 px-2.5 py-1 rounded-lg font-medium', '刪除');
    delBtn.type = 'button';
    delBtn.onclick = () => {
      if (!confirm('刪除成員會連同所有體重紀錄一起刪除，確定嗎？')) return;
      optimisticDeleteMember(m.id);
      showToast('已刪除成員');
    };

    actions.append(editBtn, delBtn);
    li.append(identity, actions);
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

    const familyChanged = nextCode !== state.familyCode;
    lockAllMembers(false);
    if (familyChanged) {
      clearFamilyCache();
      state.appData = { members: [], records: [], targetHistory: [] };
    }
    state.familyCode = nextCode;
    state.selectedMemberId = null;
    state.historyPage = 1;
    localStorage.setItem('familySyncCode', state.familyCode);
    showToast('設定已儲存');
    onSync();
  };
}
