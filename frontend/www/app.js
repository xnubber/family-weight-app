import { state } from './js/state.js';
import { FamilyAPI } from './js/services/api.js';
import { initSyncQueue, flushQueue, getPendingCount } from './js/services/syncQueue.js';
import { updateSyncIndicator, showToast, initTapFeedback } from './js/utils/dom.js';
import { renderOverview } from './js/ui/overview.js';
import { renderCharts, initChartRangeControls, resizeChart } from './js/ui/charts.js';
import { openProfileModal, openMemberModal, initModals, refreshOpenProfileModalIfAny } from './js/ui/modals.js';
import { initSettings, renderSettingsMembers } from './js/ui/settings.js';
import { initPrivacyLifecycle } from './js/utils/privacy.js';
import { loadFamilyCache, saveFamilyCache } from './js/utils/cache.js';

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

function refreshSyncIndicator() {
  updateSyncIndicator({ pendingCount: getPendingCount(), isFetching });
}

function clearPageAnimClasses(section) {
  if (!section) return;
  section.classList.remove(...PAGE_ANIM_CLASSES);
}

function switchTab(tabName) {
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

  // 先更新底部導覽列狀態，給予即時視覺回饋
  document.querySelectorAll('.nav-btn').forEach((b) => b.classList.remove('tab-active'));
  document.querySelector(`.nav-btn[data-tab="${tabName}"]`)?.classList.add('tab-active');

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

  setTimeout(() => {
    if (seq === tabTransitionSeq) {
      clearPageAnimClasses(nextSection);
    }
  }, 300);
}

function renderAll() {
  document.getElementById('header-family-code').textContent = `同步碼：${state.familyCode}`;
  document.getElementById('input-family-code').value = state.familyCode;

  renderOverview({
    onSelectMember: (memberId) =>
      openProfileModal(memberId, {
        onNavigateToChart: () => {
          switchTab('charts');
          renderCharts();
        }
      })
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
    members: cached.members,
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
      members: data.members || [],
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
  } catch (err) {
    renderAll();
    const hasCachedData = state.appData.members.length > 0;
    showToast(hasCachedData ? `暫時無法連線雲端，目前顯示本機快取（${err.message}）` : err.message, true);
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
initChartRangeControls({ onRangeChange: () => renderCharts() });
initModals();
initSettings({ onSync: syncData });

// Stale-While-Revalidate：先立即載入本機快取秒開畫面，同時背景向雲端拉取最新資料
hydrateFromCache();
renderAll();
syncData();
