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

// 4 位數個人隱私 PIN 雜湊（scrypt + 隨機 16-byte 鹽值，嚴禁明碼儲存）
export function hashPrivacyPin(pin) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(String(pin), salt, 32).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

// 常數時間比對個人隱私 PIN
export function verifyPrivacyPin(pin, storedHash) {
  if (typeof pin !== 'string' || typeof storedHash !== 'string') return false;
  const parts = storedHash.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const [, salt, expectedHex] = parts;
  if (!salt || !expectedHex) return false;

  try {
    const derived = crypto.scryptSync(pin, salt, 32);
    const expected = Buffer.from(expectedHex, 'hex');
    if (derived.length !== expected.length) return false;
    return crypto.timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

// 清理回傳給前端的成員物件，絕不洩漏 privacy_pin_hash，改回傳布林值 has_privacy_pin
export function sanitizeMember(row) {
  if (!row || typeof row !== 'object') return row;
  const { privacy_pin_hash, ...rest } = row;
  return {
    ...rest,
    hide_weight: Boolean(row.hide_weight),
    has_privacy_pin: Boolean(privacy_pin_hash)
  };
}
