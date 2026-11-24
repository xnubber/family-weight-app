import { state } from './js/state.js';
import { FamilyAPI } from './js/services/api.js';
import { initSyncQueue, flushQueue, getPendingCount } from './js/services/syncQueue.js';
import { updateSyncIndicator, showToast, initTapFeedback } from './js/utils/dom.js';
import { renderOverview } from './js/ui/overview.js';
import { renderCharts, initChartRangeControls } from './js/ui/charts.js';
import { openProfileModal, openMemberModal, initModals, refreshOpenProfileModalIfAny } from './js/ui/modals.js';
import { initSettings, renderSettingsMembers } from './js/ui/settings.js';
import { initPrivacyLifecycle } from './js/utils/privacy.js';

let isFetching = false;
let syncRequestSeq = 0;

function refreshSyncIndicator() {
  updateSyncIndicator({ pendingCount: getPendingCount(), isFetching });
}

function switchTab(tabName) {
  document.querySelectorAll('main > section').forEach((s) => s.classList.add('hidden'));
  document.getElementById(`view-${tabName}`).classList.remove('hidden');
  document.querySelectorAll('.nav-btn').forEach((b) => b.classList.remove('tab-active'));
  document.querySelector(`.nav-btn[data-tab="${tabName}"]`)?.classList.add('tab-active');
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
    showToast(err.message, true);
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

// 初始化樂觀更新與背景序列寫入佇列
initSyncQueue({
  onRender: renderAll,
  onPendingChange: () => refreshSyncIndicator()
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

// 先渲染本地空畫面讓介面可立即操作，同時背景同步雲端資料
renderAll();
syncData();
