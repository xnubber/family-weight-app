import logger from '../utils/logger.js';
import { maskSensitiveUrl } from '../utils/security.js';

// HTTP 請求日誌中介層：記錄每個 API 的方法、遮罩後路徑、狀態碼與耗時
export function requestLogger(req, res, next) {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    const safeUrl = maskSensitiveUrl(req.originalUrl);
    const msg = `${req.method} ${safeUrl} ${res.statusCode} - ${duration}ms`;
    if (res.statusCode >= 500) {
      logger.error(msg, { ip: req.ip });
    } else if (res.statusCode >= 400) {
      logger.warn(msg, { ip: req.ip });
    } else if (safeUrl === '/api/health') {
      logger.debug(msg);
    } else {
      logger.info(msg);
    }
  });
  next();
}
