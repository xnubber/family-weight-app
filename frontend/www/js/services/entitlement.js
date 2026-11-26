// 雙版本執行環境與未來付費解鎖（Entitlement）管理模組
// 負責區分「自用雲端版 (selfhost)」與「Google Play 單機上架版 (store)」，並預留未來 Pro 雲端同步與去廣告解鎖介面

const ENTITLEMENT_STORAGE_KEY = 'kinpawsEntitlement:v1';

const DEFAULT_EDITION_CONFIG = Object.freeze({
  edition: 'selfhost',
  appId: 'com.familyweight.app',
  appName: '家與毛孩成長誌',
  appVersion: '2.18.0',
  defaultStorageMode: 'cloud',
  cloudSyncBuiltIn: true,
  cloudProPlanned: false,
  privacyPolicyUrl: ''
});

const listeners = new Set();
let billingProvider = null;

function readStoredEntitlement() {
  try {
    const raw = localStorage.getItem(ENTITLEMENT_STORAGE_KEY);
    if (!raw) return { cloudSyncUnlocked: false, adsRemoved: false, updatedAt: null };
    const parsed = JSON.parse(raw);
    return {
      cloudSyncUnlocked: Boolean(parsed?.cloudSyncUnlocked),
      adsRemoved: Boolean(parsed?.adsRemoved),
      updatedAt: typeof parsed?.updatedAt === 'string' ? parsed.updatedAt : null
    };
  } catch {
    return { cloudSyncUnlocked: false, adsRemoved: false, updatedAt: null };
  }
}

function writeStoredEntitlement(next) {
  try {
    localStorage.setItem(ENTITLEMENT_STORAGE_KEY, JSON.stringify({
      cloudSyncUnlocked: Boolean(next.cloudSyncUnlocked),
      adsRemoved: Boolean(next.adsRemoved),
      updatedAt: new Date().toISOString()
    }));
  } catch {
    // 忽略本機儲存空間受限錯誤
  }
}

export function getEditionConfig() {
  const injected = typeof window !== 'undefined' ? window.__APP_EDITION__ : null;
  if (!injected || typeof injected !== 'object') {
    return DEFAULT_EDITION_CONFIG;
  }
  const edition = injected.edition === 'store' ? 'store' : 'selfhost';
  const base = {
    edition,
    appId: typeof injected.appId === 'string' && injected.appId ? injected.appId : DEFAULT_EDITION_CONFIG.appId,
    appName: typeof injected.appName === 'string' && injected.appName ? injected.appName : DEFAULT_EDITION_CONFIG.appName,
    appVersion: typeof injected.appVersion === 'string' && injected.appVersion ? injected.appVersion : DEFAULT_EDITION_CONFIG.appVersion,
    defaultStorageMode: injected.defaultStorageMode === 'local' ? 'local' : 'cloud',
    cloudSyncBuiltIn: Boolean(injected.cloudSyncBuiltIn),
    cloudProPlanned: Boolean(injected.cloudProPlanned),
    privacyPolicyUrl: typeof injected.privacyPolicyUrl === 'string' ? injected.privacyPolicyUrl : ''
  };
  if (edition === 'store') {
    base.adsEnabled = Boolean(injected.adsEnabled);
    base.admob = {
      androidBannerId: typeof injected.admob?.androidBannerId === 'string' ? injected.admob.androidBannerId : '',
      testing: injected.admob?.testing !== false
    };
  }
  return base;
}

export function getAppEdition() {
  return getEditionConfig().edition;
}

export function isStoreEdition() {
  return getAppEdition() === 'store';
}

export function isSelfHostEdition() {
  return getAppEdition() === 'selfhost';
}

export function getEntitlementState() {
  const cfg = getEditionConfig();
  if (cfg.edition === 'selfhost') {
    return {
      edition: 'selfhost',
      plan: 'selfhost',
      storageMode: 'cloud',
      cloudSyncUnlocked: true,
      adsRemoved: true,
      cloudProPlanned: false,
      adsEnabled: false,
      appVersion: cfg.appVersion,
      privacyPolicyUrl: cfg.privacyPolicyUrl
    };
  }

  const stored = readStoredEntitlement();
  const cloudSyncUnlocked = Boolean(stored.cloudSyncUnlocked);
  const adsRemoved = Boolean(stored.adsRemoved || cloudSyncUnlocked);
  return {
    edition: 'store',
    plan: cloudSyncUnlocked ? 'pro' : 'free',
    storageMode: cloudSyncUnlocked ? 'cloud' : 'local',
    cloudSyncUnlocked,
    adsRemoved,
    cloudProPlanned: cfg.cloudProPlanned,
    adsEnabled: cfg.adsEnabled && !adsRemoved,
    appVersion: cfg.appVersion,
    privacyPolicyUrl: cfg.privacyPolicyUrl
  };
}

export function getActiveStorageMode() {
  return getEntitlementState().storageMode;
}

export function isCloudSyncActive() {
  return getActiveStorageMode() === 'cloud';
}

export function shouldShowAds() {
  return getEntitlementState().adsEnabled;
}

export function subscribeEntitlementChange(listener) {
  if (typeof listener !== 'function') return () => {};
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emitEntitlementChange() {
  const snapshot = getEntitlementState();
  listeners.forEach((fn) => {
    try {
      fn(snapshot);
    } catch {
      // 忽略個別訂閱者例外，避免中斷其他更新
    }
  });
}

// 未來接上 Google Play Billing / RevenueCat 時，透過此介面注入付費提供者
export function registerBillingProvider(provider) {
  billingProvider = provider && typeof provider === 'object' ? provider : null;
}

export function applyProEntitlement({ cloudSyncUnlocked = false, adsRemoved = false } = {}) {
  if (!isStoreEdition()) return getEntitlementState();
  writeStoredEntitlement({ cloudSyncUnlocked, adsRemoved });
  emitEntitlementChange();
  return getEntitlementState();
}

export async function requestProCloudUpgrade() {
  if (billingProvider && typeof billingProvider.purchaseProCloud === 'function') {
    const result = await billingProvider.purchaseProCloud();
    if (result?.unlocked) {
      applyProEntitlement({ cloudSyncUnlocked: true, adsRemoved: true });
    }
    return result;
  }
  return { status: 'coming_soon', unlocked: false };
}

export async function restoreProPurchases() {
  if (billingProvider && typeof billingProvider.restorePurchases === 'function') {
    const result = await billingProvider.restorePurchases();
    if (result?.unlocked) {
      applyProEntitlement({ cloudSyncUnlocked: true, adsRemoved: true });
    }
    return result;
  }
  return { status: 'coming_soon', unlocked: false };
}
