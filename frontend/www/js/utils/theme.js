// APP 主題風格管理模組：支援 4 款文青主題（晨露鼠尾草／暖陶微光／霧海松青／靜夜墨林）與跟隨系統深淺色

const THEME_STORAGE_KEY = 'appThemeConfig:v1';

export const THEME_PRESETS = ['sage', 'clay', 'mist', 'night'];
const LIGHT_PRESETS = new Set(['sage', 'clay', 'mist']);

const THEME_META_COLORS = {
  sage: '#F6F4EE',
  clay: '#F9F3EC',
  mist: '#F1F5F5',
  night: '#171B19'
};

let mediaQueryList = null;
let systemListenerBound = false;
const themeChangeListeners = new Set();

function readThemeConfig() {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    if (!raw) {
      return { preset: 'sage', lastLightPreset: 'sage', followSystem: false };
    }
    const parsed = JSON.parse(raw);
    const preset = THEME_PRESETS.includes(parsed?.preset) ? parsed.preset : 'sage';
    const lastLightPreset = LIGHT_PRESETS.has(parsed?.lastLightPreset)
      ? parsed.lastLightPreset
      : (LIGHT_PRESETS.has(preset) ? preset : 'sage');
    return {
      preset,
      lastLightPreset,
      followSystem: Boolean(parsed?.followSystem)
    };
  } catch {
    return { preset: 'sage', lastLightPreset: 'sage', followSystem: false };
  }
}

function writeThemeConfig(cfg) {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify({
      preset: THEME_PRESETS.includes(cfg.preset) ? cfg.preset : 'sage',
      lastLightPreset: LIGHT_PRESETS.has(cfg.lastLightPreset) ? cfg.lastLightPreset : 'sage',
      followSystem: Boolean(cfg.followSystem)
    }));
  } catch {
    // 忽略儲存受限錯誤
  }
}

export function getThemeConfig() {
  return readThemeConfig();
}

export function isSystemDarkPreferred() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function resolveActiveTheme(cfg = readThemeConfig()) {
  if (cfg.followSystem) {
    return isSystemDarkPreferred() ? 'night' : (LIGHT_PRESETS.has(cfg.lastLightPreset) ? cfg.lastLightPreset : 'sage');
  }
  return THEME_PRESETS.includes(cfg.preset) ? cfg.preset : 'sage';
}

export function applyThemeToDOM(cfg = readThemeConfig()) {
  const active = resolveActiveTheme(cfg);
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.theme = active;
    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) {
      metaTheme.setAttribute('content', THEME_META_COLORS[active] || THEME_META_COLORS.sage);
    }
  }
  return active;
}

function emitThemeChange(activeTheme) {
  themeChangeListeners.forEach((fn) => {
    try {
      fn(activeTheme);
    } catch {
      // 忽略單一訂閱者錯誤
    }
  });
}

export function setThemePreset(preset) {
  if (!THEME_PRESETS.includes(preset)) return resolveActiveTheme();
  const prev = readThemeConfig();
  const next = {
    preset,
    lastLightPreset: LIGHT_PRESETS.has(preset) ? preset : prev.lastLightPreset,
    // 手動挑選深色時自動關閉跟隨系統；挑選淺色時若跟隨系統開啟且系統為淺色則即時反映
    followSystem: preset === 'night' ? false : prev.followSystem
  };
  writeThemeConfig(next);
  const active = applyThemeToDOM(next);
  emitThemeChange(active);
  return active;
}

export function setThemeFollowSystem(enabled) {
  const prev = readThemeConfig();
  const next = {
    ...prev,
    followSystem: Boolean(enabled)
  };
  writeThemeConfig(next);
  const active = applyThemeToDOM(next);
  emitThemeChange(active);
  return active;
}

export function initTheme({ onChange } = {}) {
  if (typeof onChange === 'function') {
    themeChangeListeners.add(onChange);
  }
  const active = applyThemeToDOM();

  if (!systemListenerBound && typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    mediaQueryList = window.matchMedia('(prefers-color-scheme: dark)');
    const handleMediaChange = () => {
      const cfg = readThemeConfig();
      if (!cfg.followSystem) return;
      const nextActive = applyThemeToDOM(cfg);
      emitThemeChange(nextActive);
    };
    if (typeof mediaQueryList.addEventListener === 'function') {
      mediaQueryList.addEventListener('change', handleMediaChange);
    } else if (typeof mediaQueryList.addListener === 'function') {
      mediaQueryList.addListener(handleMediaChange);
    }
    systemListenerBound = true;
  }

  return active;
}

// 供 Chart.js 依目前主題動態取得高對比度座標軸、格線、圖例與折線配色
export function getChartThemePalette() {
  const active = resolveActiveTheme();
  if (active === 'night') {
    return {
      isDark: true,
      legendColor: '#CCD3CB',
      tickColor: '#9EA8A0',
      gridColor: '#2B332F',
      pointBg: '#202623',
      tooltipBg: 'rgba(18, 22, 20, 0.96)',
      tooltipTitle: '#ECF0EB',
      tooltipBody: '#D5DDD6',
      humanLine: '#7BB592',
      humanFill: 'rgba(123, 181, 146, 0.2)',
      heightLine: '#6FB8AE',
      heightFill: 'rgba(111, 184, 174, 0.2)',
      catLine: '#DF9B78',
      catFill: 'rgba(223, 155, 120, 0.2)',
      dogLine: '#DCB370',
      dogFill: 'rgba(220, 179, 112, 0.2)',
      targetLine: '#8F9B93'
    };
  }
  if (active === 'clay') {
    return {
      isDark: false,
      legendColor: '#54443B',
      tickColor: '#7D6C61',
      gridColor: '#EFE4D9',
      pointBg: '#FFFBF6',
      tooltipBg: 'rgba(56, 44, 38, 0.92)',
      tooltipTitle: '#FFFBF6',
      tooltipBody: '#F9F3EC',
      humanLine: '#B06E4C',
      humanFill: 'rgba(176, 110, 76, 0.16)',
      heightLine: '#5D847B',
      heightFill: 'rgba(93, 132, 123, 0.16)',
      catLine: '#C07A57',
      catFill: 'rgba(192, 122, 87, 0.16)',
      dogLine: '#B68A4C',
      dogFill: 'rgba(182, 138, 76, 0.16)',
      targetLine: '#A9998C'
    };
  }
  if (active === 'mist') {
    return {
      isDark: false,
      legendColor: '#3E4F54',
      tickColor: '#63767C',
      gridColor: '#E1EAEB',
      pointBg: '#FAFCFC',
      tooltipBg: 'rgba(38, 51, 54, 0.92)',
      tooltipTitle: '#FAFCFC',
      tooltipBody: '#F1F5F5',
      humanLine: '#44767C',
      humanFill: 'rgba(68, 118, 124, 0.16)',
      heightLine: '#3B828A',
      heightFill: 'rgba(59, 130, 138, 0.16)',
      catLine: '#C07A57',
      catFill: 'rgba(192, 122, 87, 0.16)',
      dogLine: '#B68A4C',
      dogFill: 'rgba(182, 138, 76, 0.16)',
      targetLine: '#92A5AA'
    };
  }
  return {
    isDark: false,
    legendColor: '#494C45',
    tickColor: '#727068',
    gridColor: '#EFECE4',
    pointBg: '#FCFBF8',
    tooltipBg: 'rgba(47, 52, 47, 0.92)',
    tooltipTitle: '#FCFBF8',
    tooltipBody: '#F6F4EE',
    humanLine: '#587864',
    humanFill: 'rgba(88, 120, 100, 0.16)',
    heightLine: '#4B7A72',
    heightFill: 'rgba(75, 122, 114, 0.16)',
    catLine: '#C07A57',
    catFill: 'rgba(192, 122, 87, 0.16)',
    dogLine: '#B68A4C',
    dogFill: 'rgba(182, 138, 76, 0.16)',
    targetLine: '#A8A295'
  };
}
