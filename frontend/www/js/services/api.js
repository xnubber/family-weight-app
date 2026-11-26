import { getActiveLocale, t } from '../utils/i18n.js';
import { getActiveTimeZone } from '../utils/timezone.js';

// 執行期設定由未納入版控的 config.js 注入至 window.__APP_CONFIG__（範本見 config.example.js）
function getApiBaseUrl() {
  const configured = window.__APP_CONFIG__?.API_BASE_URL;
  return (typeof configured === 'string' && configured.trim()) || 'http://localhost:3000/api';
}

function getApiKey() {
  const configured = window.__APP_CONFIG__?.APP_API_KEY;
  if (typeof configured === 'string' && configured.trim()) {
    return configured.trim();
  }
  return (localStorage.getItem('appApiKey') || '').trim();
}

function isLocalhostUrl(urlStr) {
  try {
    const parsed = new URL(urlStr);
    return parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

export function hasInjectedApiKey() {
  return Boolean(typeof window.__APP_CONFIG__?.APP_API_KEY === 'string' && window.__APP_CONFIG__.APP_API_KEY.trim());
}

async function request(endpoint, familyCode, options = {}) {
  const baseUrl = getApiBaseUrl();
  if (!baseUrl.startsWith('https://') && !isLocalhostUrl(baseUrl)) {
    throw new Error(t('api.httpsRequired'));
  }

  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error(t('api.missingKey'));
  }

  const headers = {
    'Content-Type': 'application/json',
    'X-API-Key': apiKey,
    'Accept-Language': getActiveLocale(),
    'X-Timezone': getActiveTimeZone(),
    ...(familyCode ? { 'X-Family-Code': familyCode } : {}),
    ...(options.headers || {})
  };

  const res = await fetch(`${baseUrl}${endpoint}`, {
    ...options,
    headers
  });

  if (res.status === 400) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error || t('api.badRequest'));
  }
  if (res.status === 401) throw new Error(t('api.unauthorized'));
  if (res.status === 403) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error || t('api.forbidden'));
  }
  if (res.status === 404) throw new Error(t('api.notFound'));
  if (res.status === 429) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error || t('api.rateLimit'));
  }
  if (!res.ok) throw new Error(t('api.serverError'));

  return res.status === 204 ? null : res.json();
}

export const FamilyAPI = {
  getAllData: (familyCode) =>
    request(`/families/${encodeURIComponent(familyCode)}/data`, familyCode),
  addMember: (familyCode, payload) =>
    request('/members', familyCode, { method: 'POST', body: JSON.stringify({ ...payload, family_code: familyCode }) }),
  updateMember: (familyCode, id, payload) =>
    request(`/members/${encodeURIComponent(id)}`, familyCode, { method: 'PUT', body: JSON.stringify(payload) }),
  reorderMembers: (familyCode, memberIds) =>
    request('/members/reorder', familyCode, { method: 'PUT', body: JSON.stringify({ member_ids: memberIds }) }),
  verifyMemberPin: (familyCode, id, pin) =>
    request(`/members/${encodeURIComponent(id)}/verify-pin`, familyCode, { method: 'POST', body: JSON.stringify({ pin }) }),
  deleteMember: (familyCode, id) =>
    request(`/members/${encodeURIComponent(id)}`, familyCode, { method: 'DELETE' }),
  addRecord: (familyCode, payload) =>
    request('/records', familyCode, { method: 'POST', body: JSON.stringify({ ...payload, family_code: familyCode }) }),
  deleteRecord: (familyCode, id) =>
    request(`/records/${encodeURIComponent(id)}`, familyCode, { method: 'DELETE' }),
  addHeightRecord: (familyCode, payload) =>
    request('/height-records', familyCode, { method: 'POST', body: JSON.stringify({ ...payload, family_code: familyCode }) }),
  deleteHeightRecord: (familyCode, id) =>
    request(`/height-records/${encodeURIComponent(id)}`, familyCode, { method: 'DELETE' })
};
