import { state } from './js/state.js';
import { DataService } from './js/services/dataService.js';
import { getAppEdition, isCloudSyncActive, isStoreEdition, subscribeEntitlementChange } from './js/services/entitlement.js';
import { initSyncQueue, flushQueue, getPendingCount, optimisticReorderMembers } from './js/services/syncQueue.js';
import { updateSyncIndicator, showToast, initTapFeedback } from './js/utils/dom.js';
import { renderOverview, isOverviewReordering } from './js/ui/overview.js';
import { renderCharts, initChartRangeControls, resizeChart } from './js/ui/charts.js';
import {
  openProfileModal,
  openMemberModal,
  requestMemberUnlock,
  initModals,
  refreshOpenProfileModalIfAny,
  hasOpenModal,
  handleModalBackAction,
  syncModalDynamicLabels
} from './js/ui/modals.js';
import {
  initSettings,
  renderSettingsMembers,
  renderRegionSettings,
  renderEditionSettings,
  renderThemeSettings,
  renderNotificationSettings
} from './js/ui/settings.js';
import { initPrivacyLifecycle, isMemberWeightHidden, lockMember } from './js/utils/privacy.js';
import { loadFamilyCache, saveFamilyCache } from './js/utils/cache.js';
import { initSwipeBackGesture } from './js/utils/swipeBack.js';
import { initOverviewPullToRefresh } from './js/utils/pullToRefresh.js';
import { applyMemberOrder } from './js/utils/memberOrder.js';
import { createSplashController } from './js/utils/splash.js';
import { applyI18nToDOM, t } from './js/utils/i18n.js';
import { initTheme } from './js/utils/theme.js';
import { getLocalTodayDate } from './js/utils/metrics.js';
import { checkInAppInactiveReminder, syncNativeDailySchedule } from './js/services/notifications.js';

const TAB_ORDER = ['overview', 'charts', 'family', 'settings'];
const PAGE_ANIM_CLASSES = [
  'page-enter-from-right',
  'page-enter-from-left',
  'page-leave-to-left',
  'page-leave-to-right'
];

let isFetching = false;
let syncRequestSeq = 0;
let currentTab = 'overview';
let tabTransitionSeq = 0;
const tabHistory = ['overview'];
let lastRootBackPromptAt = 0;
let historyTrapDepth = 0;
let isCapacitorBackHandled = false;
const MAX_HISTORY_TRAP_DEPTH = 25;
const ROOT_EXIT_CONFIRM_MS = 2000;

function refreshSyncIndicator() {
  updateSyncIndicator({ pendingCount: getPendingCount(), isFetching });
}

function clearPageAnimClasses(section) {
  if (!section) return;
  section.classList.remove(...PAGE_ANIM_CLASSES);
}

function canGoBack() {
  return hasOpenModal() || tabHistory.length > 1 || currentTab !== 'overview';
}

// 同步推入瀏覽器歷史堆疊（須於使用者真實點擊手勢內呼叫，避免被 Android Chrome 歷史介入機制略過）
function pushHistoryNavEntry(kind = 'nav') {
  if (isCapacitorBackHandled) return;
  if (typeof window === 'undefined' || !window.history || typeof window.history.pushState !== 'function') {
    return;
  }
  if (historyTrapDepth >= MAX_HISTORY_TRAP_DEPTH) return;
  historyTrapDepth += 1;
  window.history.pushState({ appBackTrap: true, kind, depth: historyTrapDepth }, '');
}

function ensureHistoryBackTrap() {
  if (isCapacitorBackHandled) return;
  if (!canGoBack()) return;
  pushHistoryNavEntry('layer');
}

function switchTab(tabName, { pushHistory = true } = {}) {
  const nextSection = document.getElementById(`view-${tabName}`);
  if (!nextSection) return;

  // 重複點擊當前分頁時平順回到頁面頂部
  if (tabName === currentTab && !nextSection.classList.contains('hidden')) {
    if (typeof window !== 'undefined' && typeof window.scrollTo === 'function') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    return;
  }

  const prevTab = currentTab;
  const prevSection = document.getElementById(`view-${prevTab}`);
  const prevIndex = TAB_ORDER.indexOf(prevTab);
  const nextIndex = TAB_ORDER.indexOf(tabName);
  const goingForward = nextIndex >= prevIndex;
  const seq = ++tabTransitionSeq;

  currentTab = tabName;
  if (pushHistory && tabHistory[tabHistory.length - 1] !== tabName) {
    tabHistory.push(tabName);
    if (tabHistory.length > 20) tabHistory.shift();
  }

  // 先更新底部導覽列與總覽懸浮記錄按鈕狀態，給予即時視覺回饋
  document.querySelectorAll('.nav-btn').forEach((b) => b.classList.remove('tab-active'));
  document.querySelector(`.nav-btn[data-tab="${tabName}"]`)?.classList.add('tab-active');
  const recordDock = document.getElementById('overview-record-dock');
  if (recordDock) {
    const showDock = tabName === 'overview';
    recordDock.classList.toggle('is-hidden', !showDock);
    recordDock.setAttribute('aria-hidden', showDock ? 'false' : 'true');
    const dockBtn = document.getElementById('btn-open-record-modal');
    if (dockBtn) dockBtn.tabIndex = showDock ? 0 : -1;
  }

  // 清除其他非相關分頁的殘留動畫狀態（防止快速連點重疊）
  document.querySelectorAll('main > section').forEach((sec) => {
    if (sec !== nextSection && sec !== prevSection) {
      clearPageAnimClasses(sec);
      sec.classList.add('hidden');
    }
  });

  // 離場頁面：柔和淡出並順方向微移
  if (prevSection && prevSection !== nextSection && !prevSection.classList.contains('hidden')) {
    clearPageAnimClasses(prevSection);
    prevSection.classList.add(goingForward ? 'page-leave-to-left' : 'page-leave-to-right');
    setTimeout(() => {
      if (seq !== tabTransitionSeq && currentTab === prevTab) return;
      clearPageAnimClasses(prevSection);
      if (currentTab !== prevTab) {
        prevSection.classList.add('hidden');
      }
    }, 185);
  }

  // 進場頁面：從目標方向輕盈滑入淡顯
  clearPageAnimClasses(nextSection);
  nextSection.classList.remove('hidden');
  void nextSection.offsetWidth;
  nextSection.classList.add(goingForward ? 'page-enter-from-right' : 'page-enter-from-left');

  if (typeof window !== 'undefined' && typeof window.scrollTo === 'function' && window.scrollY > 12) {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  if (tabName === 'charts') {
    const nextFrame = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (fn) => fn();
    nextFrame(() => resizeChart());
  }

  if (pushHistory) {
    ensureHistoryBackTrap();
  }

  setTimeout(() => {
    if (seq === tabTransitionSeq) {
      clearPageAnimClasses(nextSection);
    }
  }, 300);
}

// 全站統一返回邏輯：優先逐層關閉彈窗／原地編輯，其次回到上一個分頁，最後回到總覽
function handleAppBack() {
  if (handleModalBackAction()) {
    return true;
  }
  if (tabHistory.length > 1) {
    tabHistory.pop();
    const targetTab = tabHistory[tabHistory.length - 1] || 'overview';
    switchTab(targetTab, { pushHistory: false });
    return true;
  }
  if (currentTab !== 'overview') {
    tabHistory.length = 0;
    tabHistory.push('overview');
    switchTab('overview', { pushHistory: false });
    return true;
  }
  return false;
}

function formatCompactFamilyCode(code) {
  const str = String(code || '').trim();
  if (str.length <= 14) return str;
  return `${str.slice(0, 7)}…${str.slice(-4)}`;
}

function syncHeaderModeUI() {
  const cloudActive = isCloudSyncActive();
  const headerCodeEl = document.getElementById('header-family-code');
  const refreshBtn = document.getElementById('btn-refresh');

  if (headerCodeEl) {
    if (cloudActive) {
      headerCodeEl.textContent = t('header.syncCode', { code: formatCompactFamilyCode(state.familyCode) });
      headerCodeEl.title = t('header.syncCode', { code: state.familyCode });
    } else {
      headerCodeEl.textContent = t('header.offlineMode');
      headerCodeEl.title = t('header.offlineMode');
    }
  }
  if (refreshBtn) {
    refreshBtn.classList.toggle('hidden', !cloudActive);
  }
}

function renderAll() {
  syncHeaderModeUI();
  const familyInput = document.getElementById('input-family-code');
  if (familyInput && isCloudSyncActive()) {
    familyInput.value = state.familyCode;
  }

  renderOverview({
    onSelectMember: (memberId) =>
      openProfileModal(memberId, {
        onNavigateToChart: () => {
          switchTab('charts');
          renderCharts();
        }
      }),
    onReorderMembers: (orderedIds) => {
      optimisticReorderMembers(orderedIds);
      showToast(t('overview.reorderSaved'));
    },
    onTogglePrivacy: (member) => {
      if (isMemberWeightHidden(member)) {
        requestMemberUnlock(member);
      } else {
        lockMember(member.id);
        showToast(t('privacy.relockedToast'));
      }
    }
  });
  renderCharts();
  renderThemeSettings();
  renderNotificationSettings();
  renderRegionSettings();
  renderEditionSettings();
  renderSettingsMembers({
    onEditMember: (member) => openMemberModal(member)
  });
  refreshOpenProfileModalIfAny();
}

function applyLoadedDataset(data, orderScopeKey) {
  state.appData = {
    members: applyMemberOrder(data.members || [], orderScopeKey),
    records: data.records || [],
    heightRecords: data.heightRecords || [],
    targetHistory: data.targetHistory || []
  };

  if (!state.selectedMemberId && state.appData.members.length > 0) {
    state.selectedMemberId = state.appData.members[0].id;
    state.historyPage = 1;
  } else if (
    state.selectedMemberId &&
    !state.appData.members.some((m) => m.id === state.selectedMemberId)
  ) {
    state.selectedMemberId = state.appData.members[0]?.id ?? null;
    state.historyPage = 1;
  }
}

function hydrateFromCache() {
  if (!isCloudSyncActive()) return false;
  const cached = loadFamilyCache(state.familyCode);
  if (!cached) return false;
  applyLoadedDataset(cached, state.familyCode);
  return true;
}

async function syncData() {
  const reqId = ++syncRequestSeq;
  const cloudActive = isCloudSyncActive();
  const targetFamilyCode = cloudActive ? state.familyCode : 'local';
  isFetching = true;
  if (cloudActive) refreshSyncIndicator();

  try {
    // 若仍有背景寫入排隊中，先等待送出完成再拉取最新資料，避免舊資料覆蓋樂觀更新
    await flushQueue();
    if (reqId !== syncRequestSeq || (cloudActive && state.familyCode !== targetFamilyCode)) return;

    const data = await DataService.getAllData(targetFamilyCode);
    if (reqId !== syncRequestSeq || (cloudActive && state.familyCode !== targetFamilyCode)) return;

    // 若拉取期間使用者又新增了新的背景寫入，避免直接覆蓋導致畫面閃回舊狀態
    if (getPendingCount() > 0) return;

    applyLoadedDataset(data, targetFamilyCode);
    if (cloudActive) {
      saveFamilyCache(targetFamilyCode, state.appData);
    }

    renderAll();
    return true;
  } catch (err) {
    renderAll();
    if (cloudActive) {
      const hasCachedData = state.appData.members.length > 0;
      showToast(hasCachedData ? t('api.offlineCache', { msg: err.message }) : err.message, true);
    } else {
      showToast(err.message || t('local.loadFailed'), true);
    }
    return false;
  } finally {
    if (reqId === syncRequestSeq) {
      isFetching = false;
      if (isCloudSyncActive()) refreshSyncIndicator();
    }
  }
}

// 若有尚未送出的背景寫入，關閉分頁前提醒使用者
window.addEventListener('beforeunload', (e) => {
  if (getPendingCount() > 0) {
    e.preventDefault();
    e.returnValue = '';
  }
});

// 若以 Capacitor Android APK 執行且已同步 @capacitor/app 外掛，由原生 OnBackPressedCallback 接管系統返回鍵與螢幕左右邊緣滑動返回
const capacitorAppPlugin = window.Capacitor?.Plugins?.App;
const isNativeCapacitor = Boolean(window.Capacitor?.isNativePlatform?.());
if (isNativeCapacitor && typeof capacitorAppPlugin?.addListener === 'function') {
  isCapacitorBackHandled = true;
  capacitorAppPlugin.addListener('backButton', () => {
    if (handleAppBack()) return;
    const now = Date.now();
    if (now - lastRootBackPromptAt < ROOT_EXIT_CONFIRM_MS) {
      capacitorAppPlugin.exitApp?.();
    } else {
      lastRootBackPromptAt = now;
      showToast(t('nav.exitPrompt'));
    }
  });
}

// 瀏覽器／PWA 環境（或未同步原生外掛時）：於使用者真實點擊手勢內同步推入歷史節點，攔截左右邊緣返回手勢不直接跳出 APP
if (!isCapacitorBackHandled) {
  window.addEventListener('app:nav-state-change', ensureHistoryBackTrap);

  if (typeof window.history?.replaceState === 'function') {
    window.history.replaceState({ appRoot: true, depth: 0 }, '');
  }

  // 在首頁（總覽）第一次有效點擊時同步補上一層根節點保護，避免手機誤滑邊緣直接退出 PWA
  const armRootBackGuard = () => {
    if (historyTrapDepth === 0) {
      pushHistoryNavEntry('root-guard');
    }
  };
  document.addEventListener('pointerdown', armRootBackGuard, { passive: true });
  document.addEventListener('click', armRootBackGuard, { passive: true });

  window.addEventListener('popstate', (e) => {
    const stateDepth = typeof e.state?.depth === 'number' ? e.state.depth : Math.max(0, historyTrapDepth - 1);
    historyTrapDepth = Math.max(0, stateDepth);

    if (handleAppBack()) {
      return;
    }

    const now = Date.now();
    if (now - lastRootBackPromptAt < ROOT_EXIT_CONFIRM_MS) {
      if (historyTrapDepth > 0 && typeof window.history?.go === 'function') {
        window.history.go(-(historyTrapDepth + 1));
      }
    } else {
      lastRootBackPromptAt = now;
      showToast(t('nav.exitPrompt'));
    }
  });
}

// 標記目前發行版本，並於自用版徹底移除所有廣告與商店專屬 DOM 節點（完全不載入廣告模組）
const currentEdition = getAppEdition();
if (document.documentElement) {
  document.documentElement.dataset.edition = currentEdition;
}
if (!isStoreEdition()) {
  document.getElementById('ad-banner-spacer')?.remove();
  document.getElementById('legal-ads-section')?.remove();
  document.getElementById('settings-pro-cloud-card')?.remove();
}

// 啟動時立即套用主題風格、多語系 DOM 與動態單位標籤（避免首屏閃爍）
initTheme({
  onChange: () => {
    renderThemeSettings();
    renderCharts();
  }
});
applyI18nToDOM();
syncModalDynamicLabels();

// 初始化隱私自動上鎖生命週期（逾時 5 分鐘或切換畫面時自動重新遮蔽體重）
initPrivacyLifecycle({ onLockChange: renderAll });

// 初始化樂觀更新與背景序列寫入佇列（雲端模式於寫入完成後更新本機快取）
initSyncQueue({
  onRender: renderAll,
  onPendingChange: (pendingCount) => {
    if (isCloudSyncActive()) {
      refreshSyncIndicator();
      if (pendingCount === 0) {
        saveFamilyCache(state.familyCode, state.appData);
      }
    }
  }
});

// 未來付費解鎖 Pro 雲端同步時即時切換介面與資料來源（僅商店版使用）
if (isStoreEdition()) {
  subscribeEntitlementChange(() => {
    renderAll();
    syncData();
  });
}

// 底部導覽列分頁切換
document.querySelectorAll('.nav-btn').forEach((btn) => {
  btn.onclick = () => switchTab(btn.dataset.tab);
});

const refreshBtnEl = document.getElementById('btn-refresh');
if (refreshBtnEl) {
  refreshBtnEl.onclick = () => {
    if (isCloudSyncActive()) syncData();
  };
}

initTapFeedback();
initSwipeBackGesture({
  canGoBack: () => !isOverviewReordering() && canGoBack(),
  onBack: handleAppBack
});
initOverviewPullToRefresh({
  canPull: () => isCloudSyncActive() && currentTab === 'overview' && !hasOpenModal() && !isOverviewReordering(),
  isSyncing: () => isFetching,
  onRefresh: async () => {
    const ok = await syncData();
    if (ok) showToast(t('pull.synced'));
  }
});
initChartRangeControls({ onRangeChange: () => renderCharts() });
initModals();
initSettings({
  onSync: syncData,
  onLocalDataReplaced: (nextData) => {
    state.selectedMemberId = null;
    state.historyPage = 1;
    applyLoadedDataset(nextData, 'local');
    renderAll();
  },
  onThemeChange: () => {
    renderCharts();
  },
  onPreferencesChange: () => {
    applyI18nToDOM();
    syncModalDynamicLabels();
    if (isCloudSyncActive()) refreshSyncIndicator();
    renderAll();
  }
});

// 僅於 Google Play 單機上架版動態載入固定式橫幅廣告模組（自用版完全不載入）
if (isStoreEdition()) {
  import('./js/services/adBanner.js')
    .then(({ initAdBanner }) => initAdBanner())
    .catch(() => {});
}
// 同步原生本機每日提醒排程（不依賴雲端伺服器）
syncNativeDailySchedule();

function maybeShowInactiveReminderToast() {
  const msg = checkInAppInactiveReminder({
    members: state.appData.members,
    records: state.appData.records,
    todayYmd: getLocalTodayDate()
  });
  if (msg) {
    setTimeout(() => showToast(msg), 700);
  }
}

const splash = createSplashController();

if (!isCloudSyncActive()) {
  // 純單機離線版：直接從本機 IndexedDB 秒速載入，不發起任何網路同步請求
  syncHeaderModeUI();
  syncData().finally(() => {
    splash.markReady({ hasCache: true });
    maybeShowInactiveReminderToast();
  });
} else {
  // 雲端同步版（Stale-While-Revalidate）：先載入本機快取秒開畫面，同時背景向雲端拉取最新資料
  const hasCache = hydrateFromCache();
  refreshSyncIndicator();
  renderAll();

  if (hasCache) {
    splash.markReady({ hasCache: true });
    syncData().finally(() => maybeShowInactiveReminderToast());
  } else {
    // 首次無快取時，等待首波雲端同步完成（最長 1.2 秒保底自動退場）再淡出扉頁
    syncData().finally(() => {
      splash.markReady({ hasCache: false });
      maybeShowInactiveReminderToast();
    });
  }
}
