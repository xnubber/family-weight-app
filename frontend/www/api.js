// 開發時用本機；部署後端上線後，改成正式網址（例如 https://your-api.onrender.com/api）再打包
const API_BASE_URL = 'http://localhost:3000/api';
const APP_API_KEY = 'f8k29xL0pQ7mN4vR2wZ9aB1c';

async function request(endpoint, options = {}) {
  const res = await fetch(`${API_BASE_URL}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': APP_API_KEY,
      ...(options.headers || {})
    }
  });

  if (res.status === 401) throw new Error('驗證失敗，請確認 APP 版本是否正確');
  if (res.status === 429) throw new Error('操作過於頻繁，請稍候幾分鐘再試');
  if (!res.ok) throw new Error('伺服器連線異常，請稍後再試');

  return res.status === 204 ? null : res.json();
}

export const FamilyAPI = {
  getAllData: (familyCode) => request(`/families/${encodeURIComponent(familyCode)}/data`),
  addMember: (payload) => request('/members', { method: 'POST', body: JSON.stringify(payload) }),
  updateMember: (id, payload) => request(`/members/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  deleteMember: (id) => request(`/members/${id}`, { method: 'DELETE' }),
  addRecord: (payload) => request('/records', { method: 'POST', body: JSON.stringify(payload) }),
  deleteRecord: (id) => request(`/records/${id}`, { method: 'DELETE' })
};