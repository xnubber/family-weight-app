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
    throw new Error('正式環境 API 必須使用 HTTPS 安全連線');
  }

  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('尚未設定 API 金鑰，請至「設定」輸入或於 config.js 中設定');
  }

  const headers = {
    'Content-Type': 'application/json',
    'X-API-Key': apiKey,
    ...(familyCode ? { 'X-Family-Code': familyCode } : {}),
    ...(options.headers || {})
  };

  const res = await fetch(`${baseUrl}${endpoint}`, {
    ...options,
    headers
  });

  if (res.status === 400) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error || '請求資料格式不正確');
  }
  if (res.status === 401) throw new Error('驗證失敗，請確認 API 金鑰或 APP 版本是否正確');
  if (res.status === 403) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error || '無權限存取或修改此家庭資料');
  }
  if (res.status === 404) throw new Error('找不到目標資料或無權限操作');
  if (res.status === 429) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error || '操作過於頻繁，請稍候幾分鐘再試');
  }
  if (!res.ok) throw new Error('伺服器連線異常，請稍後再試');

  return res.status === 204 ? null : res.json();
}

export const FamilyAPI = {
  getAllData: (familyCode) =>
    request(`/families/${encodeURIComponent(familyCode)}/data`, familyCode),
  addMember: (familyCode, payload) =>
    request('/members', familyCode, { method: 'POST', body: JSON.stringify({ ...payload, family_code: familyCode }) }),
  updateMember: (familyCode, id, payload) =>
    request(`/members/${encodeURIComponent(id)}`, familyCode, { method: 'PUT', body: JSON.stringify(payload) }),
  verifyMemberPin: (familyCode, id, pin) =>
    request(`/members/${encodeURIComponent(id)}/verify-pin`, familyCode, { method: 'POST', body: JSON.stringify({ pin }) }),
  deleteMember: (familyCode, id) =>
    request(`/members/${encodeURIComponent(id)}`, familyCode, { method: 'DELETE' }),
  addRecord: (familyCode, payload) =>
    request('/records', familyCode, { method: 'POST', body: JSON.stringify({ ...payload, family_code: familyCode }) }),
  deleteRecord: (familyCode, id) =>
    request(`/records/${encodeURIComponent(id)}`, familyCode, { method: 'DELETE' })
};
