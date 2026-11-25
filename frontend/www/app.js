import { state } from './js/state.js';
import { FamilyAPI } from './js/services/api.js';
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
  handleModalBackAction
} from './js/ui/modals.js';
import { initSettings, renderSettingsMembers } from './js/ui/settings.js';
import { initPrivacyLifecycle, isMemberWeightHidden, lockMember } from './js/utils/privacy.js';
import { loadFamilyCache, saveFamilyCache } from './js/utils/cache.js';
import { initSwipeBackGesture } from './js/utils/swipeBack.js';
import { initOverviewPullToRefresh } from './js/utils/pullToRefresh.js';
import { applyMemberOrder } from './js/utils/memberOrder.js';

const TAB_ORDER = ['overview', 'charts', 'settings'];
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

// 單一哨兵歷史狀態：讓 Android 系統邊緣返回手勢與瀏覽器返回鍵能優雅逐層返回，不直接跳出 App
function ensureHistoryBackTrap() {
  if (typeof window === 'undefined' || !window.history || typeof window.history.pushState !== 'function') {
    return;
  }
  if (!canGoBack()) return;
  if (!window.history.state || !window.history.state.appBackTrap) {
    window.history.pushState({ appBackTrap: true }, '');
  }
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

  ensureHistoryBackTrap();

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

function renderAll() {
  const headerCodeEl = document.getElementById('header-family-code');
  headerCodeEl.textContent = `同步碼：${formatCompactFamilyCode(state.familyCode)}`;
  headerCodeEl.title = `同步碼：${state.familyCode}`;
  document.getElementById('input-family-code').value = state.familyCode;

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
      showToast('已更新成員順序');
    },
    onTogglePrivacy: (member) => {
      if (isMemberWeightHidden(member)) {
        requestMemberUnlock(member);
      } else {
        lockMember(member.id);
        showToast('已重新隱藏真實體重');
      }
    }
  });
  renderCharts();
  renderSettingsMembers({
    onEditMember: (member) => openMemberModal(member)
  });
  refreshOpenProfileModalIfAny();
}

function hydrateFromCache() {
  const cached = loadFamilyCache(state.familyCode);
  if (!cached) return false;
  state.appData = {
    members: applyMemberOrder(cached.members, state.familyCode),
    records: cached.records,
    targetHistory: cached.targetHistory
  };
  if (!state.selectedMemberId && state.appData.members.length > 0) {
    state.selectedMemberId = state.appData.members[0].id;
    state.historyPage = 1;
  }
  return true;
}

async function syncData() {
  const reqId = ++syncRequestSeq;
  const targetFamilyCode = state.familyCode;
  isFetching = true;
  refreshSyncIndicator();

  try {
    // 若仍有背景寫入排隊中，先等待送出完成再拉取最新雲端資料，避免舊資料覆蓋樂觀更新
    await flushQueue();
    if (reqId !== syncRequestSeq || state.familyCode !== targetFamilyCode) return;

    const data = await FamilyAPI.getAllData(targetFamilyCode);
    if (reqId !== syncRequestSeq || state.familyCode !== targetFamilyCode) return;

    // 若拉取期間使用者又新增了新的背景寫入，避免直接覆蓋導致畫面閃回舊狀態
    if (getPendingCount() > 0) return;

    state.appData = {
      members: applyMemberOrder(data.members || [], targetFamilyCode),
      records: data.records || [],
      targetHistory: data.targetHistory || []
    };
    saveFamilyCache(targetFamilyCode, state.appData);

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
    renderAll();
    return true;
  } catch (err) {
    renderAll();
    const hasCachedData = state.appData.members.length > 0;
    showToast(hasCachedData ? `暫時無法連線雲端，目前顯示本機快取（${err.message}）` : err.message, true);
    return false;
  } finally {
    if (reqId === syncRequestSeq) {
      isFetching = false;
      refreshSyncIndicator();
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

// 監聽彈窗開啟事件，補上 History 返回哨兵，並攔截系統邊緣返回／瀏覽器返回鍵
window.addEventListener('app:nav-state-change', ensureHistoryBackTrap);

if (typeof window.history?.replaceState === 'function') {
  window.history.replaceState({ appRoot: true }, '');
}

window.addEventListener('popstate', () => {
  const handled = handleAppBack();
  if (handled && canGoBack()) {
    ensureHistoryBackTrap();
  }
});

// 若以 Capacitor Android APK 執行且載入 App 外掛，同步接管系統返回鍵／系統邊緣滑動返回
window.Capacitor?.Plugins?.App?.addListener?.('backButton', () => {
  if (handleAppBack()) return;
  const now = Date.now();
  if (now - lastRootBackPromptAt < 1800) {
    window.Capacitor?.Plugins?.App?.exitApp?.();
  } else {
    lastRootBackPromptAt = now;
    showToast('再返回一次即可離開 APP');
  }
});

// 初始化隱私自動上鎖生命週期（逾時 5 分鐘或切換畫面時自動重新遮蔽體重）
initPrivacyLifecycle({ onLockChange: renderAll });

// 初始化樂觀更新與背景序列寫入佇列（所有背景寫入完成後同步更新本機快取）
initSyncQueue({
  onRender: renderAll,
  onPendingChange: (pendingCount) => {
    refreshSyncIndicator();
    if (pendingCount === 0) {
      saveFamilyCache(state.familyCode, state.appData);
    }
  }
});

// 底部導覽列分頁切換
document.querySelectorAll('.nav-btn').forEach((btn) => {
  btn.onclick = () => switchTab(btn.dataset.tab);
});

document.getElementById('btn-refresh').onclick = syncData;

initTapFeedback();
initSwipeBackGesture({
  canGoBack: () => !isOverviewReordering() && canGoBack(),
  onBack: handleAppBack
});
initOverviewPullToRefresh({
  canPull: () => currentTab === 'overview' && !hasOpenModal() && !isOverviewReordering(),
  isSyncing: () => isFetching,
  onRefresh: async () => {
    const ok = await syncData();
    if (ok) showToast('已同步最新資料');
  }
});
initChartRangeControls({ onRangeChange: () => renderCharts() });
initModals();
initSettings({ onSync: syncData });

// Stale-While-Revalidate：先立即載入本機快取秒開畫面，同時背景向雲端拉取最新資料
hydrateFromCache();
renderAll();
syncData();
