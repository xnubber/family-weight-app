import rateLimit from 'express-rate-limit';
import logger from '../utils/logger.js';
import { maskSensitiveUrl } from '../utils/security.js';

// 健康檢查專用限流：每分鐘最多 30 次，防止用來灌爆日誌
export const healthLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logger.warn('健康檢查觸發速率限制 (429)', { ip: req.ip });
    res.status(429).json({ error: '請求過於頻繁，請稍後再試' });
  }
});

// 一般 API 限流：同一個 IP 每 15 分鐘最多 60 次請求（不含 OPTIONS 預檢）
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.method === 'OPTIONS',
  handler: (req, res) => {
    logger.warn('觸發速率限制 (429)', { ip: req.ip, path: maskSensitiveUrl(req.originalUrl) });
    res.status(429).json({ error: '請求過於頻繁，請稍後再試' });
  }
});

// 失敗請求嚴格限流：抑制金鑰與同步碼暴力猜測（僅計算 4xx/5xx，每 15 分鐘最多 15 次）
export const authFailLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  skip: (req) => req.method === 'OPTIONS',
  handler: (req, res) => {
    logger.warn('觸發異常失敗請求限流 (429)', { ip: req.ip, path: maskSensitiveUrl(req.originalUrl) });
    res.status(429).json({ error: '錯誤嘗試過於頻繁，請稍後再試' });
  }
});

// 個人隱私 PIN 驗證專用限流：防止 4 位數密碼暴力猜測（每 15 分鐘最多 10 次失敗嘗試）
export const pinVerifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  skip: (req) => req.method === 'OPTIONS',
  handler: (req, res) => {
    logger.warn('觸發個人 PIN 驗證限流 (429)', { ip: req.ip, path: maskSensitiveUrl(req.originalUrl) });
    res.status(429).json({ error: 'PIN 密碼嘗試次數過多，請 15 分鐘後再試' });
  }
});
