// 統一資料服務層（Repository Facade）
// 依據目前版本與付費解鎖狀態（entitlement.js）自動路由至「雲端 FamilyAPI」或「本機 LocalRepository」
// 未來開放付費解鎖雲端同步時，UI 層完全無需修改即可無縫切換

import { FamilyAPI } from './api.js';
import { LocalRepository } from './storage/localRepository.js';
import { getEditionConfig, isCloudSyncActive } from './entitlement.js';

function getActiveRepository() {
  return isCloudSyncActive() ? FamilyAPI : LocalRepository;
}

export const DataService = {
  getAllData: (familyCode) => getActiveRepository().getAllData(familyCode),
  addMember: (familyCode, payload) => getActiveRepository().addMember(familyCode, payload),
  updateMember: (familyCode, id, payload) => getActiveRepository().updateMember(familyCode, id, payload),
  reorderMembers: (familyCode, memberIds) => getActiveRepository().reorderMembers(familyCode, memberIds),
  verifyMemberPin: (familyCode, id, pin) => getActiveRepository().verifyMemberPin(familyCode, id, pin),
  deleteMember: (familyCode, id) => getActiveRepository().deleteMember(familyCode, id),
  addRecord: (familyCode, payload) => getActiveRepository().addRecord(familyCode, payload),
  deleteRecord: (familyCode, id) => getActiveRepository().deleteRecord(familyCode, id),
  addHeightRecord: (familyCode, payload) => getActiveRepository().addHeightRecord(familyCode, payload),
  deleteHeightRecord: (familyCode, id) => getActiveRepository().deleteHeightRecord(familyCode, id),

  // 匯出完整 JSON 備份（單機版直接讀取 IndexedDB，雲端版也可將目前記憶體資料匯出留存）
  exportBackup: async (fallbackAppData = null) => {
    const cfg = getEditionConfig();
    if (!isCloudSyncActive()) {
      return LocalRepository.exportBackupSnapshot({
        appVersion: cfg.appVersion,
        edition: cfg.edition
      });
    }
    return {
      schema: 'kinpaws-backup',
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      appVersion: cfg.appVersion,
      sourceEdition: cfg.edition,
      data: {
        members: Array.isArray(fallbackAppData?.members) ? fallbackAppData.members : [],
        records: Array.isArray(fallbackAppData?.records) ? fallbackAppData.records : [],
        heightRecords: Array.isArray(fallbackAppData?.heightRecords) ? fallbackAppData.heightRecords : [],
        targetHistory: Array.isArray(fallbackAppData?.targetHistory) ? fallbackAppData.targetHistory : []
      }
    };
  },

  importBackup: (rawObject) => LocalRepository.importBackupSnapshot(rawObject),
  clearAllLocalData: () => LocalRepository.clearAllLocalData(),
  buildCloudMigrationBundle: () => LocalRepository.buildCloudMigrationBundle()
};
