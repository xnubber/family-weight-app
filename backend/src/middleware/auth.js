import { config } from '../config/env.js';
import logger from '../utils/logger.js';
import { safeEqual, maskSensitiveUrl } from '../utils/security.js';
import { isValidFamilyCode } from '../schemas/validation.js';

// API 金鑰驗證中介層
export function apiKeyAuth(req, res, next) {
  // 預檢請求不帶 API Key，直接放行
  if (req.method === 'OPTIONS') return next();

  const clientKey = req.headers['x-api-key'];
  if (!safeEqual(clientKey, config.appApiKey)) {
    logger.warn('無效的 API Key 存取嘗試', { ip: req.ip, path: maskSensitiveUrl(req.originalUrl) });
    return res.status(401).json({ error: '未授權的存取' });
  }
  next();
}

// 取得並驗證請求的家庭同步碼（要求 Header X-Family-Code；若同時傳遞 bodyCode 必須一致）
export function resolveFamilyCode(req, bodyCode) {
  const headerCode = typeof req.headers['x-family-code'] === 'string'
    ? req.headers['x-family-code'].trim()
    : '';
  const candidate = headerCode || (typeof bodyCode === 'string' ? bodyCode.trim() : '');

  if (headerCode && typeof bodyCode === 'string' && bodyCode.trim() && headerCode !== bodyCode.trim()) {
    return { errorStatus: 403, errorMessage: '家庭同步碼不一致，拒絕存取' };
  }
  if (!isValidFamilyCode(candidate)) {
    return {
      errorStatus: 400,
      errorMessage: '無效的家庭同步碼（需為 12-64 字元英數字、- 或 _，且不可使用舊預設碼）'
    };
  }
  return { familyCode: candidate };
}
