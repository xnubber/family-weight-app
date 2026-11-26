// 廣告橫幅（AdMob）與底部安全區動態避讓服務
// 預留 @capacitor-community/admob 與 Google UMP 隱私同意流程串接介面：
// - 當安裝原生 AdMob 外掛且處於免費上架版時，自動初始化、取得同意並依實際 Banner 高度動態推高底部導覽列與按鈕
// - 未來使用者付費解鎖 Pro（adsRemoved: true）時自動即時隱藏廣告並復原底部留白

import { getEditionConfig, shouldShowAds, subscribeEntitlementChange } from './entitlement.js';

let isBannerShown = false;
let isInitialized = false;
let unsubscribeEntitlement = null;

export function setAdBannerInsetHeight(heightPx = 0) {
  const safePx = Number.isFinite(Number(heightPx)) && Number(heightPx) > 0
    ? Math.round(Number(heightPx))
    : 0;
  if (typeof document !== 'undefined' && document.documentElement?.style) {
    document.documentElement.style.setProperty('--ad-banner-height', `${safePx}px`);
  }
  const spacer = typeof document !== 'undefined' ? document.getElementById('ad-banner-spacer') : null;
  if (spacer) {
    spacer.classList.toggle('hidden', safePx <= 0);
  }
}

function getNativeAdMobPlugin() {
  if (typeof window === 'undefined') return null;
  if (!window.Capacitor?.isNativePlatform?.()) return null;
  return window.Capacitor?.Plugins?.AdMob || null;
}

export async function hideAdBanner() {
  setAdBannerInsetHeight(0);
  const plugin = getNativeAdMobPlugin();
  if (!plugin || !isBannerShown) {
    isBannerShown = false;
    return;
  }
  try {
    if (typeof plugin.removeBanner === 'function') {
      await plugin.removeBanner();
    } else if (typeof plugin.hideBanner === 'function') {
      await plugin.hideBanner();
    }
  } catch {
    // 忽略原生外掛移除例外
  } finally {
    isBannerShown = false;
  }
}

async function ensureAdConsent(plugin) {
  if (typeof plugin.requestConsentInfo !== 'function') return;
  try {
    const info = await plugin.requestConsentInfo();
    if (info?.isConsentFormAvailable && info?.status === 'REQUIRED' && typeof plugin.showConsentForm === 'function') {
      await plugin.showConsentForm();
    }
  } catch {
    // 非歐盟區域或離線時忽略 UMP 例外，依 AdMob 預設規則處理
  }
}

export async function initAdBanner() {
  if (!unsubscribeEntitlement) {
    unsubscribeEntitlement = subscribeEntitlementChange((ent) => {
      if (!ent.adsEnabled) {
        hideAdBanner();
      } else {
        initAdBanner();
      }
    });
  }

  if (!shouldShowAds()) {
    await hideAdBanner();
    return;
  }

  const plugin = getNativeAdMobPlugin();
  if (!plugin) {
    // 瀏覽器預覽或尚未安裝 @capacitor-community/admob 時維持零佔位，不影響介面
    setAdBannerInsetHeight(0);
    return;
  }

  const cfg = getEditionConfig();
  const adId = cfg.admob?.androidBannerId;
  if (!adId) {
    setAdBannerInsetHeight(0);
    return;
  }

  try {
    if (!isInitialized) {
      await ensureAdConsent(plugin);
      if (typeof plugin.initialize === 'function') {
        await plugin.initialize({
          initializeForTesting: Boolean(cfg.admob?.testing)
        });
      }
      if (typeof plugin.addListener === 'function') {
        plugin.addListener('bannerAdSizeChanged', (info) => {
          const nextHeight = Number(info?.height || 0);
          setAdBannerInsetHeight(nextHeight > 0 ? nextHeight : 0);
        });
        plugin.addListener('bannerAdFailedToLoad', () => {
          setAdBannerInsetHeight(0);
        });
      }
      isInitialized = true;
    }

    if (typeof plugin.showBanner === 'function') {
      await plugin.showBanner({
        adId,
        adSize: 'ADAPTIVE_BANNER',
        position: 'BOTTOM_CENTER',
        margin: 0,
        isTesting: Boolean(cfg.admob?.testing)
      });
      isBannerShown = true;
      // 在原生回報精確尺寸前先預留標準 Adaptive Banner 安全高度，避免短暫遮擋底部導覽列
      setAdBannerInsetHeight(60);
    }
  } catch {
    setAdBannerInsetHeight(0);
    isBannerShown = false;
  }
}
