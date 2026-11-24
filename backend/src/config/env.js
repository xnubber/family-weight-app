import dotenv from 'dotenv';
import logger from '../utils/logger.js';

dotenv.config();

const COMPROMISED_API_KEYS = new Set(['f8k29xL0pQ7mN4vR2wZ9aB1c']);

const isProduction = process.env.NODE_ENV === 'production';

// 啟動前檢查必要環境變數，並禁止使用曾外洩至版控的舊金鑰
export function validateEnv() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    logger.error('缺少必要環境變數 SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY，伺服器拒絕啟動');
    process.exit(1);
  }
  if (!process.env.APP_API_KEY || COMPROMISED_API_KEYS.has(process.env.APP_API_KEY)) {
    logger.error('APP_API_KEY 未設定或仍使用已外洩的舊金鑰，請重新產生高強度隨機金鑰後再啟動');
    process.exit(1);
  }
  if (process.env.APP_API_KEY.length < 16 && isProduction) {
    logger.error('正式環境 APP_API_KEY 長度過短（至少需 16 字元，建議 32 字元以上），伺服器拒絕啟動');
    process.exit(1);
  }
  if (process.env.APP_API_KEY.length < 24) {
    logger.warn('APP_API_KEY 長度建議至少 24 字元以上以提升安全性');
  }
}

const configuredOrigins = (process.env.ALLOWED_ORIGINS || 'https://localhost,capacitor://localhost')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

const devOrigins = isProduction
  ? []
  : ['http://localhost:3000', 'http://localhost:5000', 'http://127.0.0.1:5500'];

const trustProxyHops = Number.isInteger(Number(process.env.TRUST_PROXY))
  ? Number(process.env.TRUST_PROXY)
  : 1;

export const config = {
  port: process.env.PORT || 3000,
  isProduction,
  trustProxyHops,
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  appApiKey: process.env.APP_API_KEY,
  allowedOrigins: new Set([...configuredOrigins, ...devOrigins])
};
