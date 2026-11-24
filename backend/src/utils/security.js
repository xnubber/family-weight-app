import crypto from 'node:crypto';

// 使用 SHA-256 + timingSafeEqual 進行常數時間金鑰比對，避免計時側通道與長度洩漏
export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const hashA = crypto.createHash('sha256').update(a).digest();
  const hashB = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

// 清除控制字元，避免日誌注入（Log Injection）
export function sanitizeLogValue(val) {
  return String(val ?? '').replace(/[\r\n\t]/g, ' ').slice(0, 200);
}

// 遮罩 URL 路徑中的家庭同步碼（/api/families/:familyCode/...）與查詢參數，避免同步碼明文寫入日誌
export function maskSensitiveUrl(rawUrl) {
  const safe = sanitizeLogValue(rawUrl);
  const pathOnly = safe.split('?')[0];
  return pathOnly.replace(/(\/api\/families\/)([^/]+)/i, (_, prefix, code) => {
    const masked = code.length <= 4 ? '****' : `${code.slice(0, 2)}***${code.slice(-2)}`;
    return `${prefix}${masked}`;
  });
}
