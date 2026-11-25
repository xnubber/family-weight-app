import { config } from '../config/env.js';
import logger from '../utils/logger.js';
import { safeEqual, maskSensitiveUrl } from '../utils/security.js';
import { getBackendMessage } from '../utils/messages.js';
import { isValidFamilyCode } from '../schemas/validation.js';

// API 金鑰驗證中介層
export function apiKeyAuth(req, res, next) {
  // 預檢請求不帶 API Key，直接放行
  if (req.method === 'OPTIONS') return next();

  const clientKey = req.headers['x-api-key'];
  if (!safeEqual(clientKey, config.appApiKey)) {
    logger.warn('無效的 API Key 存取嘗試', { ip: req.ip, path: maskSensitiveUrl(req.originalUrl) });
    return res.status(401).json({ error: getBackendMessage(req, 'unauthorized') });
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
    return { errorStatus: 403, errorMessage: getBackendMessage(req, 'familyCodeMismatch') };
  }
  if (!isValidFamilyCode(candidate)) {
    return {
      errorStatus: 400,
      errorMessage: getBackendMessage(req, 'invalidFamilyCode')
    };
  }
  return { familyCode: candidate };
}
