import { state } from './js/state.js';
import { FamilyAPI } from './js/services/api.js';
import { showLoading, showToast } from './js/utils/dom.js';
import { renderOverview } from './js/ui/overview.js';
import { renderCharts, initChartRangeControls } from './js/ui/charts.js';
import { openProfileModal, initModals } from './js/ui/modals.js';
import { initCalculators } from './js/ui/calculators.js';
import { initSettings, renderSettingsMembers } from './js/ui/settings.js';

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
          renderCharts({ onSync: syncData });
        }
      })
  });
  renderCharts({ onSync: syncData });
  renderSettingsMembers({ onSync: syncData });
}

async function syncData() {
  showLoading(true);
  try {
    state.appData = await FamilyAPI.getAllData(state.familyCode);
    if (!state.selectedMemberId && state.appData.members.length > 0) {
      state.selectedMemberId = state.appData.members[0].id;
    }
    renderAll();
  } catch (err) {
    renderAll();
    showToast(err.message, true);
  } finally {
    showLoading(false);
  }
}

// 底部導覽列分頁切換
document.querySelectorAll('.nav-btn').forEach((btn) => {
  btn.onclick = () => switchTab(btn.dataset.tab);
});

document.getElementById('btn-refresh').onclick = syncData;

initChartRangeControls({ onRangeChange: () => renderCharts({ onSync: syncData }) });
initModals({ onSync: syncData });
initCalculators();
initSettings({ onSync: syncData });

syncData();
