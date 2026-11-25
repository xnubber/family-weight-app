import { state } from '../state.js';
import { hasInjectedApiKey } from '../services/api.js';
import { optimisticDeleteMember } from '../services/syncQueue.js';
import { createEl, playSoftFade, showToast } from '../utils/dom.js';
import { createAvatarNode, resolveMemberAvatar } from '../utils/avatars.js';
import { isMemberPrivacyEnabled, lockAllMembers, memberHasPrivacyPin } from '../utils/privacy.js';
import { clearFamilyCache } from '../utils/cache.js';
import { generateFamilyCode, isValidFamilyCode } from '../utils/validation.js';
import {
  LANGUAGE_DISPLAY_NAMES,
  detectDeviceLocale,
  getActiveLocale,
  getLanguageSetting,
  setLanguageSetting,
  t
} from '../utils/i18n.js';
import {
  COMMON_TIMEZONES,
  getActiveTimeZone,
  getDeviceTimeZone,
  getTimeZoneOffsetLabel,
  getTimezoneSetting,
  getTodayInTimeZone,
  setTimezoneSetting
} from '../utils/timezone.js';
import { getWeightUnit, setWeightUnit } from '../utils/units.js';

let isRegionSettingsExpanded = false;

function getMemberTypeLabel(type) {
  if (type === 'cat') return t('memberType.cat');
  if (type === 'dog') return t('memberType.dog');
  return t('memberType.human');
}

function formatCompactTimeZoneLabel(tzId, offsetLabel) {
  const matched = COMMON_TIMEZONES.find((item) => item.id === tzId);
  let shortPlace = '';
  if (matched) {
    const full = t(matched.labelKey);
    // 擷取括號前的精簡城市名稱（例：「台北 (Asia/Taipei)」→「台北」、「Tokyo (Asia/Tokyo)」→「Tokyo」）
    shortPlace = full.split(' (')[0].split(' · ')[0].trim();
  } else {
    const parts = String(tzId || '').split('/');
    shortPlace = (parts[parts.length - 1] || tzId).replace(/_/g, ' ');
  }
  return offsetLabel ? `${shortPlace} (${offsetLabel})` : shortPlace;
}

function syncRegionPanelVisibility({ animate = false } = {}) {
  const toggleBtn = document.getElementById('btn-toggle-region-settings');
  const toggleText = document.getElementById('region-settings-toggle-text');
  const chevron = document.getElementById('region-settings-chevron');
  const panel = document.getElementById('region-settings-panel');

  if (toggleBtn) {
    toggleBtn.setAttribute('aria-expanded', isRegionSettingsExpanded ? 'true' : 'false');
  }
  if (toggleText) {
    toggleText.textContent = t(isRegionSettingsExpanded ? 'settings.regionCollapse' : 'settings.regionEdit');
  }
  if (chevron) {
    chevron.classList.toggle('rotate-180', isRegionSettingsExpanded);
  }
  if (panel) {
    panel.classList.toggle('hidden', !isRegionSettingsExpanded);
    if (isRegionSettingsExpanded && animate) {
      playSoftFade(panel);
    }
  }
}

export function renderRegionSettings() {
  const activeLocale = getActiveLocale();
  const activeLangName = LANGUAGE_DISPLAY_NAMES[activeLocale] || activeLocale;
  const langSelect = document.getElementById('select-language');
  if (langSelect) {
    const detected = detectDeviceLocale();
    const detectedName = LANGUAGE_DISPLAY_NAMES[detected] || detected;
    const langOptions = [
      { value: 'auto', label: t('settings.languageAuto', { lang: detectedName }) },
      { value: 'zh-TW', label: LANGUAGE_DISPLAY_NAMES['zh-TW'] },
      { value: 'en', label: LANGUAGE_DISPLAY_NAMES.en },
      { value: 'ja', label: LANGUAGE_DISPLAY_NAMES.ja }
    ];
    langSelect.replaceChildren(
      ...langOptions.map((opt) => {
        const el = document.createElement('option');
        el.value = opt.value;
        el.textContent = opt.label;
        return el;
      })
    );
    langSelect.value = getLanguageSetting();
  }

  const unit = getWeightUnit();
  const kgBtn = document.getElementById('btn-unit-kg');
  const lbBtn = document.getElementById('btn-unit-lb');
  if (kgBtn && lbBtn) {
    const activeCls = 'flex-1 py-2 rounded-xl text-xs font-medium bg-linen text-sage-700 shadow-sm transition';
    const inactiveCls = 'flex-1 py-2 rounded-xl text-xs font-medium text-ink-500 transition';
    kgBtn.className = unit === 'kg' ? activeCls : inactiveCls;
    lbBtn.className = unit === 'lb' ? activeCls : inactiveCls;
    kgBtn.setAttribute('aria-pressed', unit === 'kg' ? 'true' : 'false');
    lbBtn.setAttribute('aria-pressed', unit === 'lb' ? 'true' : 'false');
  }

  const tzSelect = document.getElementById('select-timezone');
  const tzStatus = document.getElementById('settings-timezone-status');
  const deviceTz = getDeviceTimeZone();
  const deviceOffset = getTimeZoneOffsetLabel(deviceTz);
  const currentSetting = getTimezoneSetting();
  const activeTz = getActiveTimeZone();
  const activeOffset = getTimeZoneOffsetLabel(activeTz);

  if (tzSelect) {
    const options = [
      {
        value: 'auto',
        label: t('settings.timezoneAuto', { tz: deviceTz, offset: deviceOffset })
      },
      ...COMMON_TIMEZONES.map((item) => ({
        value: item.id,
        label: `${t(item.labelKey)} · ${getTimeZoneOffsetLabel(item.id)}`
      }))
    ];
    if (currentSetting !== 'auto' && !COMMON_TIMEZONES.some((item) => item.id === currentSetting)) {
      options.push({
        value: currentSetting,
        label: `${currentSetting} · ${activeOffset}`
      });
    }
    tzSelect.replaceChildren(
      ...options.map((opt) => {
        const el = document.createElement('option');
        el.value = opt.value;
        el.textContent = opt.label;
        return el;
      })
    );
    tzSelect.value = currentSetting;
  }

  if (tzStatus) {
    const today = getTodayInTimeZone(activeTz);
    tzStatus.textContent = t('settings.timezoneStatus', {
      today,
      tz: activeTz,
      offset: activeOffset
    });
  }

  // 收合／展開標題下方的精簡摘要膠囊（目前語言、單位、時區）
  const summaryEl = document.getElementById('region-settings-summary');
  if (summaryEl) {
    const chipCls = 'inline-flex items-center px-2 py-0.5 rounded-lg text-[11px] font-medium bg-oat-50 border border-oat-200/80 text-ink-600 leading-tight';
    const tzChipCls = `${chipCls} tabular-nums`;
    summaryEl.replaceChildren(
      createEl('span', chipCls, activeLangName),
      createEl('span', chipCls, unit),
      createEl('span', tzChipCls, formatCompactTimeZoneLabel(activeTz, activeOffset))
    );
  }

  syncRegionPanelVisibility();
}

export function renderSettingsMembers({ onEditMember }) {
  const list = document.getElementById('settings-member-list');
  if (state.appData.members.length === 0) {
    list.replaceChildren(createEl('li', 'py-3 text-center text-ink-400', t('settings.noMembers')));
    return;
  }

  const items = state.appData.members.map((m) => {
    const li = createEl('li', 'py-2.5 flex justify-between items-center gap-2');

    const identity = createEl('div', 'flex items-center gap-2.5 min-w-0 flex-1');
    const nameGroup = createEl('div', 'min-w-0');
    const breedSuffix = m.type !== 'human' && m.breed ? ` · ${String(m.breed).trim()}` : '';
    const privSuffix = isMemberPrivacyEnabled(m)
      ? ` · ${memberHasPrivacyPin(m) ? t('settings.privacyPinSuffix') : t('settings.privacyHideSuffix')}`
      : '';
    nameGroup.append(
      createEl('div', 'font-medium text-ink leading-snug break-words', String(m.name ?? '')),
      createEl('div', 'text-fluid-label text-ink-400 mt-0.5', `${getMemberTypeLabel(m.type)}${breedSuffix}${privSuffix}`)
    );
    identity.append(createAvatarNode(resolveMemberAvatar(m), 'w-8 h-8'), nameGroup);

    const actions = createEl('div', 'flex items-center gap-1.5 shrink-0');

    const editBtn = createEl('button', 'whitespace-nowrap text-xs text-sage-700 hover:bg-sage-50 px-2.5 py-1 rounded-lg font-medium', t('common.edit'));
    editBtn.type = 'button';
    editBtn.onclick = () => onEditMember(m);

    const delBtn = createEl('button', 'whitespace-nowrap text-xs text-rosewood-600 hover:bg-rosewood-50 px-2.5 py-1 rounded-lg font-medium', t('common.delete'));
    delBtn.type = 'button';
    delBtn.onclick = () => {
      if (!confirm(t('settings.deleteMemberConfirm'))) return;
      optimisticDeleteMember(m.id);
      showToast(t('settings.memberDeleted'));
    };

    actions.append(editBtn, delBtn);
    li.append(identity, actions);
    return li;
  });
  list.replaceChildren(...items);
}

export function initSettings({ onSync, onPreferencesChange = () => {} }) {
  renderRegionSettings();

  const toggleRegionBtn = document.getElementById('btn-toggle-region-settings');
  if (toggleRegionBtn) {
    toggleRegionBtn.onclick = () => {
      isRegionSettingsExpanded = !isRegionSettingsExpanded;
      syncRegionPanelVisibility({ animate: true });
    };
  }

  const langSelect = document.getElementById('select-language');
  if (langSelect) {
    langSelect.onchange = () => {
      setLanguageSetting(langSelect.value);
      onPreferencesChange({ type: 'language' });
      showToast(t('settings.languageUpdated'));
    };
  }

  const handleUnitPick = (nextUnit) => {
    if (getWeightUnit() === nextUnit) return;
    setWeightUnit(nextUnit);
    onPreferencesChange({ type: 'unit' });
    showToast(t('settings.unitUpdated', { unit: nextUnit }));
  };

  const kgBtn = document.getElementById('btn-unit-kg');
  const lbBtn = document.getElementById('btn-unit-lb');
  if (kgBtn) kgBtn.onclick = () => handleUnitPick('kg');
  if (lbBtn) lbBtn.onclick = () => handleUnitPick('lb');

  const tzSelect = document.getElementById('select-timezone');
  if (tzSelect) {
    tzSelect.onchange = () => {
      setTimezoneSetting(tzSelect.value);
      onPreferencesChange({ type: 'timezone' });
      showToast(t('settings.timezoneUpdated'));
      onSync();
    };
  }

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
    showToast(t('settings.codeGenerated'));
  };

  // 儲存家庭同步碼（與本機 API 金鑰設定）
  document.getElementById('btn-save-settings').onclick = () => {
    const nextCode = document.getElementById('input-family-code').value.trim();
    if (!isValidFamilyCode(nextCode)) {
      showToast(t('settings.invalidFamilyCode'), true);
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
    showToast(t('settings.saved'));
    onSync();
  };
}
