import { resolveValidTimeZone } from '../utils/date.js';
import { resolveLocaleFromHeader } from '../utils/messages.js';

// 解析前端傳送的語系（Accept-Language）與時區（X-Timezone），掛載於 req 供所有路由共用
export function clientLocaleMiddleware(req, _res, next) {
  req.clientLocale = resolveLocaleFromHeader(req.headers['accept-language']);
  req.clientTimeZone = resolveValidTimeZone(req.headers['x-timezone']);
  next();
}
