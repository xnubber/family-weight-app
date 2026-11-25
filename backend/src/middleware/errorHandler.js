import logger from '../utils/logger.js';
import { getBackendMessage } from '../utils/messages.js';

// 全域未捕捉錯誤處理（區分 CORS 403、JSON 解析錯誤 400 與請求過大 413，避免誤報 500）
export function errorHandler(err, req, res, next) {
  if (err?.isCorsError || err?.status === 403) {
    return res.status(403).json({ error: getBackendMessage(req, 'corsDenied') });
  }
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: getBackendMessage(req, 'invalidJson') });
  }
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ error: getBackendMessage(req, 'payloadTooLarge') });
  }
  logger.error('伺服器未預期錯誤', { stack: err?.stack || String(err) });
  res.status(500).json({ error: getBackendMessage(req, 'internalError') });
}
