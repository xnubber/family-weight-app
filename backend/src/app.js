import express from 'express';
import helmet from 'helmet';
import { config } from './config/env.js';
import { corsMiddleware } from './middleware/cors.js';
import { clientLocaleMiddleware } from './middleware/locale.js';
import { apiLimiter, authFailLimiter } from './middleware/rateLimit.js';
import { requestLogger } from './middleware/requestLogger.js';
import { apiKeyAuth } from './middleware/auth.js';
import { errorHandler } from './middleware/errorHandler.js';
import healthRoutes from './routes/health.routes.js';
import familiesRoutes from './routes/families.routes.js';
import membersRoutes from './routes/members.routes.js';
import recordsRoutes from './routes/records.routes.js';
import heightRecordsRoutes from './routes/heightRecords.routes.js';

export function createApp() {
  const app = express();

  // 1. Render 位於反向代理後方，開啟 trust proxy 才能正確取得真實 IP
  app.set('trust proxy', config.trustProxyHops);

  // 2. 基礎 HTTP 安全標頭
  app.use(helmet());

  // 3. 嚴格 CORS 與 OPTIONS 預檢處理
  app.use(corsMiddleware);
  app.options('*', corsMiddleware);

  // 3.5 解析客戶端語系（Accept-Language）與時區（X-Timezone）
  app.use(clientLocaleMiddleware);

  // 4. 限制單筆請求大小為 10kb
  app.use(express.json({ limit: '10kb' }));

  // 5. HTTP 請求日誌中介層
  app.use(requestLogger);

  // 6. 公開健康檢查端點（含獨立限流）
  app.use('/api', healthRoutes);

  // 7. 受保護 API 端點（限流 + API Key 驗證）
  app.use('/api', apiLimiter, authFailLimiter, apiKeyAuth);
  app.use('/api/families', familiesRoutes);
  app.use('/api/members', membersRoutes);
  app.use('/api/records', recordsRoutes);
  app.use('/api/height-records', heightRecordsRoutes);

  // 8. 全域錯誤處理中介層
  app.use(errorHandler);

  return app;
}
