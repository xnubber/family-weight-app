import { state } from '../state.js';
import { hasInjectedApiKey } from '../services/api.js';
import { DataService } from '../services/dataService.js';
import {
  getEntitlementState,
  isCloudSyncActive,
  isStoreEdition,
  requestProCloudUpgrade,
  restoreProPurchases
} from '../services/entitlement.js';
import { createEl, openModal, playSoftFade, showToast } from '../utils/dom.js';
import { createIcon } from '../utils/icons.js';
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
    const heightTrackSuffix = m.type === 'human' && m.track_height ? ` · ${t('settings.trackHeightSuffix')}` : '';
    const privSuffix = isMemberPrivacyEnabled(m)
      ? ` · ${memberHasPrivacyPin(m) ? t('settings.privacyPinSuffix') : t('settings.privacyHideSuffix')}`
      : '';
    nameGroup.append(
      createEl('div', 'font-medium text-ink leading-snug break-words', String(m.name ?? '')),
      createEl('div', 'text-fluid-label text-ink-400 mt-0.5', `${getMemberTypeLabel(m.type)}${breedSuffix}${heightTrackSuffix}${privSuffix}`)
    );
    identity.append(createAvatarNode(resolveMemberAvatar(m), 'w-8 h-8'), nameGroup);

    const editBtn = createEl(
      'button',
      'w-9 h-9 inline-flex items-center justify-center rounded-xl text-ink-500 hover:text-sage-700 hover:bg-sage-50 transition shrink-0'
    );
    editBtn.type = 'button';
    editBtn.setAttribute('aria-label', t('settings.editMemberAria', { name: String(m.name ?? '') }));
    editBtn.setAttribute('title', t('common.edit'));
    editBtn.appendChild(createIcon('edit', 'w-4 h-4'));
    editBtn.onclick = () => onEditMember(m);

    li.append(identity, editBtn);
    return li;
  });
  list.replaceChildren(...items);
}

function downloadJsonBlob(filename, jsonString) {
  const blob = new Blob([jsonString], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

async function triggerBackupExport() {
  const snapshot = await DataService.exportBackup(state.appData);
  const todayStr = getTodayInTimeZone(getActiveTimeZone()).replace(/-/g, '');
  const filename = `kin-paws-backup-${todayStr}.json`;
  const jsonText = JSON.stringify(snapshot, null, 2);

  // 優先嘗試行動裝置系統分享（可存至檔案管理員／Google Drive／雲端），不支援時自動降級為瀏覽器下載
  try {
    if (typeof File === 'function' && typeof navigator?.share === 'function' && typeof navigator?.canShare === 'function') {
      const file = new File([jsonText], filename, { type: 'application/json' });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({
          title: t('backup.shareTitle'),
          files: [file]
        });
        showToast(t('backup.exportSuccess'));
        return;
      }
    }
  } catch (err) {
    if (err?.name === 'AbortError') return;
    // 分享失敗時改以檔案下載保底
  }

  downloadJsonBlob(filename, jsonText);
  showToast(t('backup.exportSuccess'));
}

export function renderEditionSettings() {
  const ent = getEntitlementState();
  const cloudActive = isCloudSyncActive();
  const storeMode = isStoreEdition();

  const cloudCard = document.getElementById('settings-cloud-sync-card');
  const backupCard = document.getElementById('settings-backup-card');
  const proCard = document.getElementById('settings-pro-cloud-card');
  const versionBadge = document.getElementById('settings-version-badge');
  const storageBadge = document.getElementById('settings-storage-badge');
  const legalDataDesc = document.getElementById('legal-data-desc');
  const legalExternalLink = document.getElementById('link-legal-external');

  if (cloudCard) cloudCard.classList.toggle('hidden', !cloudActive);
  // 單機模式顯示完整本機備份與還原卡片（含匯入與清除）
  if (backupCard) backupCard.classList.toggle('hidden', cloudActive);
  // 僅於 Google Play 單機上架版且尚未解鎖 Pro 時顯示未來雲端同步預告
  if (proCard) proCard.classList.toggle('hidden', !(storeMode && !ent.cloudSyncUnlocked && ent.cloudProPlanned));

  if (versionBadge) {
    versionBadge.textContent = `v${ent.appVersion}`;
  }
  if (storageBadge) {
    storageBadge.textContent = cloudActive
      ? t('about.storageCloud')
      : t('about.storageLocal');
  }
  if (legalDataDesc) {
    legalDataDesc.textContent = cloudActive
      ? t('legal.dataCloudDesc')
      : t('legal.dataLocalDesc');
  }
  if (legalExternalLink) {
    if (ent.privacyPolicyUrl && ent.privacyPolicyUrl.startsWith('https://')) {
      legalExternalLink.href = ent.privacyPolicyUrl;
      legalExternalLink.classList.remove('hidden');
    } else {
      legalExternalLink.classList.add('hidden');
    }
  }
}

export function initSettings({ onSync, onLocalDataReplaced = () => {}, onPreferencesChange = () => {} }) {
  renderRegionSettings();
  renderEditionSettings();

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
      if (isCloudSyncActive()) {
        onSync();
      }
    };
  }

  // 若未透過 config.js 注入 API Key，於雲端模式顯示設定頁的金鑰輸入欄位
  const wrap = document.getElementById('api-key-setting-wrap');
  const input = document.getElementById('input-api-key');
  if (wrap && input && isCloudSyncActive() && !hasInjectedApiKey()) {
    wrap.classList.remove('hidden');
    input.value = localStorage.getItem('appApiKey') || '';
  }

  // 隨機產生新的高強度同步碼
  const genBtn = document.getElementById('btn-generate-code');
  if (genBtn) {
    genBtn.onclick = () => {
      document.getElementById('input-family-code').value = generateFamilyCode();
      showToast(t('settings.codeGenerated'));
    };
  }

  // 儲存家庭同步碼（與本機 API 金鑰設定）
  const saveBtn = document.getElementById('btn-save-settings');
  if (saveBtn) {
    saveBtn.onclick = () => {
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
        state.appData = { members: [], records: [], heightRecords: [], targetHistory: [] };
      }
      state.familyCode = nextCode;
      state.selectedMemberId = null;
      state.historyPage = 1;
      localStorage.setItem('familySyncCode', state.familyCode);
      showToast(t('settings.saved'));
      onSync();
    };
  }

  // 本機 JSON 備份匯出
  const exportBtn = document.getElementById('btn-backup-export');
  if (exportBtn) {
    exportBtn.onclick = async () => {
      try {
        await triggerBackupExport();
      } catch (err) {
        showToast(err?.message || t('backup.exportFailed'), true);
      }
    };
  }

  // 本機 JSON 備份匯入
  const importBtn = document.getElementById('btn-backup-import');
  const fileInput = document.getElementById('input-backup-file');
  if (importBtn && fileInput) {
    importBtn.onclick = () => {
      fileInput.value = '';
      fileInput.click();
    };
    fileInput.onchange = async () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      if (!window.confirm(t('backup.importConfirm'))) {
        fileInput.value = '';
        return;
      }
      try {
        const text = await file.text();
        const parsed = JSON.parse(text);
        const result = await DataService.importBackup(parsed);
        lockAllMembers(false);
        onLocalDataReplaced(result.data);
        showToast(t('backup.importSuccess', {
          members: result.summary.members,
          records: result.summary.records + result.summary.heightRecords
        }));
      } catch (err) {
        showToast(err?.message || t('backup.invalidFile'), true);
      } finally {
        fileInput.value = '';
      }
    };
  }

  // 清除全部本機資料（二次確認）
  const clearAllBtn = document.getElementById('btn-local-clear-all');
  if (clearAllBtn) {
    clearAllBtn.onclick = async () => {
      if (!window.confirm(t('backup.clearAllConfirm'))) return;
      try {
        await DataService.clearAllLocalData();
        clearFamilyCache();
        lockAllMembers(false);
        onLocalDataReplaced({ members: [], records: [], heightRecords: [], targetHistory: [] });
        showToast(t('backup.clearAllSuccess'));
      } catch (err) {
        showToast(err?.message || t('backup.clearAllFailed'), true);
      }
    };
  }

  // 未來 Pro 雲端家庭同步按鈕（預留付費串接入口）
  const proInfoBtn = document.getElementById('btn-pro-cloud-info');
  if (proInfoBtn) {
    proInfoBtn.onclick = async () => {
      try {
        const res = await requestProCloudUpgrade();
        if (res?.status === 'coming_soon') {
          showToast(t('pro.comingSoonToast'));
        }
      } catch (err) {
        showToast(err?.message || t('pro.comingSoonToast'), true);
      }
    };
  }

  const proRestoreBtn = document.getElementById('btn-pro-restore');
  if (proRestoreBtn) {
    proRestoreBtn.onclick = async () => {
      try {
        const res = await restoreProPurchases();
        if (res?.status === 'coming_soon') {
          showToast(t('pro.restoreComingSoonToast'));
        }
      } catch (err) {
        showToast(err?.message || t('pro.restoreComingSoonToast'), true);
      }
    };
  }

  // 開啟隱私權與健康免責聲明彈窗
  const legalBtn = document.getElementById('btn-open-legal-modal');
  if (legalBtn) {
    legalBtn.onclick = () => {
      renderEditionSettings();
      openModal('modal-legal');
    };
  }
}
