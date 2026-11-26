// 本機通知提醒服務（完全離線運作、免推播伺服器）
// 支援原生 Android Capacitor LocalNotifications（若已安裝 @capacitor/local-notifications）
// 以及瀏覽器／PWA Web Notification API 與站內溫馨提醒保底

import { t } from '../utils/i18n.js';

const NOTIFY_STORAGE_KEY = 'appNotificationsConfig:v1';
const LAST_INACTIVE_TOAST_KEY = 'appLastInactiveReminderDate';
const DAILY_NOTIFICATION_ID = 1001;

const DEFAULT_CONFIG = Object.freeze({
  dailyEnabled: false,
  dailyTime: '08:00',
  inactiveReminderEnabled: true
});

function isValidTimeStr(val) {
  return typeof val === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(val.trim());
}

export function getNotificationSettings() {
  try {
    const raw = localStorage.getItem(NOTIFY_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_CONFIG };
    const parsed = JSON.parse(raw);
    return {
      dailyEnabled: Boolean(parsed?.dailyEnabled),
      dailyTime: isValidTimeStr(parsed?.dailyTime) ? parsed.dailyTime.trim() : DEFAULT_CONFIG.dailyTime,
      inactiveReminderEnabled: parsed?.inactiveReminderEnabled !== false
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

function writeNotificationSettings(next) {
  try {
    localStorage.setItem(NOTIFY_STORAGE_KEY, JSON.stringify({
      dailyEnabled: Boolean(next.dailyEnabled),
      dailyTime: isValidTimeStr(next.dailyTime) ? next.dailyTime.trim() : DEFAULT_CONFIG.dailyTime,
      inactiveReminderEnabled: next.inactiveReminderEnabled !== false
    }));
  } catch {
    // 忽略儲存受限錯誤
  }
}

function getNativeLocalNotifications() {
  if (typeof window === 'undefined') return null;
  if (!window.Capacitor?.isNativePlatform?.()) return null;
  return window.Capacitor?.Plugins?.LocalNotifications || null;
}

export async function getNotificationPermissionStatus() {
  const nativePlugin = getNativeLocalNotifications();
  if (nativePlugin && typeof nativePlugin.checkPermissions === 'function') {
    try {
      const res = await nativePlugin.checkPermissions();
      return res?.display || 'prompt';
    } catch {
      return 'prompt';
    }
  }
  if (typeof Notification !== 'undefined' && typeof Notification.permission === 'string') {
    return Notification.permission; // 'granted' | 'denied' | 'default'
  }
  return 'unsupported';
}

export async function requestNotificationPermission() {
  const nativePlugin = getNativeLocalNotifications();
  if (nativePlugin && typeof nativePlugin.requestPermissions === 'function') {
    try {
      const res = await nativePlugin.requestPermissions();
      return res?.display === 'granted' ? 'granted' : (res?.display || 'denied');
    } catch {
      return 'denied';
    }
  }
  if (typeof Notification !== 'undefined' && typeof Notification.requestPermission === 'function') {
    try {
      return await Notification.requestPermission();
    } catch {
      return 'denied';
    }
  }
  return 'unsupported';
}

export async function syncNativeDailySchedule(cfg = getNotificationSettings()) {
  const nativePlugin = getNativeLocalNotifications();
  if (!nativePlugin) return { mode: 'web', scheduled: Boolean(cfg.dailyEnabled) };

  try {
    if (typeof nativePlugin.cancel === 'function') {
      await nativePlugin.cancel({ notifications: [{ id: DAILY_NOTIFICATION_ID }] });
    }
    if (!cfg.dailyEnabled) {
      return { mode: 'native', scheduled: false };
    }
    const [hourStr, minStr] = cfg.dailyTime.split(':');
    const hour = Number(hourStr);
    const minute = Number(minStr);
    if (typeof nativePlugin.schedule === 'function') {
      await nativePlugin.schedule({
        notifications: [
          {
            id: DAILY_NOTIFICATION_ID,
            title: t('notify.dailyPushTitle'),
            body: t('notify.dailyPushBody'),
            schedule: {
              on: { hour, minute },
              allowWhileIdle: true
            }
          }
        ]
      });
      return { mode: 'native', scheduled: true };
    }
  } catch {
    // 排程失敗不中斷設定儲存
  }
  return { mode: 'native', scheduled: false };
}

export async function updateNotificationSettings(partial) {
  const prev = getNotificationSettings();
  const next = {
    ...prev,
    ...partial
  };

  let permission = await getNotificationPermissionStatus();
  if (next.dailyEnabled && permission !== 'granted' && permission !== 'unsupported') {
    permission = await requestNotificationPermission();
  }

  writeNotificationSettings(next);
  await syncNativeDailySchedule(next);
  return { settings: next, permission };
}

export async function sendTestNotification() {
  const title = t('notify.testTitle');
  const body = t('notify.testBody');
  const nativePlugin = getNativeLocalNotifications();

  if (nativePlugin && typeof nativePlugin.schedule === 'function') {
    const perm = await requestNotificationPermission();
    if (perm !== 'granted') return { sent: false, reason: 'denied' };
    await nativePlugin.schedule({
      notifications: [
        {
          id: Math.floor(2000 + Math.random() * 7000),
          title,
          body,
          schedule: { at: new Date(Date.now() + 1200) }
        }
      ]
    });
    return { sent: true, mode: 'native' };
  }

  if (typeof Notification !== 'undefined') {
    let perm = Notification.permission;
    if (perm === 'default') {
      perm = await requestNotificationPermission();
    }
    if (perm === 'granted') {
      try {
        new Notification(title, { body, icon: './icons/icon-192.png' });
        return { sent: true, mode: 'web' };
      } catch {
        // 部分行動瀏覽器禁止直接 new Notification，降級為站內提示
      }
    } else if (perm === 'denied') {
      return { sent: false, reason: 'denied' };
    }
  }

  return { sent: true, mode: 'in-app', previewText: `${title}：${body}` };
}

// 供啟動時呼叫：若已開啟逾 7 天未記錄提醒且今日尚未提醒過，回傳可顯示之站內提醒訊息
export function checkInAppInactiveReminder({ members = [], records = [], todayYmd = '' } = {}) {
  const cfg = getNotificationSettings();
  if (!cfg.inactiveReminderEnabled || !todayYmd || members.length === 0) return null;

  try {
    if (localStorage.getItem(LAST_INACTIVE_TOAST_KEY) === todayYmd) return null;
  } catch {
    // 忽略儲存錯誤
  }

  const latestByMember = new Map();
  records.forEach((r) => {
    const prev = latestByMember.get(r.member_id);
    if (!prev || String(r.recorded_at || '') > prev) {
      latestByMember.set(r.member_id, String(r.recorded_at || ''));
    }
  });

  const todayMs = Date.parse(`${todayYmd}T00:00:00Z`);
  if (!Number.isFinite(todayMs)) return null;

  const overdueNames = [];
  members.forEach((m) => {
    const last = latestByMember.get(m.id);
    if (!last) return;
    const lastMs = Date.parse(`${last}T00:00:00Z`);
    if (Number.isFinite(lastMs) && Math.floor((todayMs - lastMs) / 86400000) >= 7) {
      overdueNames.push(m.name);
    }
  });

  if (overdueNames.length === 0) return null;

  try {
    localStorage.setItem(LAST_INACTIVE_TOAST_KEY, todayYmd);
  } catch {
    // 忽略儲存錯誤
  }
  return t('notify.inactiveBanner', { name: overdueNames[0] });
}
