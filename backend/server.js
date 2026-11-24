import crypto from 'node:crypto';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';
import logger from './logger.js';

dotenv.config();

const isProduction = process.env.NODE_ENV === 'production';

// 啟動前檢查必要環境變數，並禁止使用曾外洩至版控的舊金鑰
const COMPROMISED_API_KEYS = new Set(['f8k29xL0pQ7mN4vR2wZ9aB1c']);
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

// 家庭同步碼驗證規則：12-64 字元英數字、- 或 _，禁止使用弱預設碼
const FAMILY_CODE_REGEX = /^[A-Za-z0-9_-]{12,64}$/;
const FORBIDDEN_FAMILY_CODES = new Set(['my-family-2026']);

function isValidFamilyCode(code) {
  return (
    typeof code === 'string' &&
    FAMILY_CODE_REGEX.test(code) &&
    !FORBIDDEN_FAMILY_CODES.has(code)
  );
}

// 檢核 YYYY-MM-DD 為真實日曆日期且落在合理範圍（2000-01-01 至今天 +2 天內）
function isValidRecordedDate(dateStr) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const [y, m, d] = dateStr.split('-').map(Number);
  const parsed = new Date(Date.UTC(y, m - 1, d));
  if (
    parsed.getUTCFullYear() !== y ||
    parsed.getUTCMonth() + 1 !== m ||
    parsed.getUTCDate() !== d
  ) {
    return false;
  }
  const minTime = Date.UTC(2000, 0, 1);
  const maxTime = Date.now() + 2 * 24 * 60 * 60 * 1000;
  return parsed.getTime() >= minTime && parsed.getTime() <= maxTime;
}

// Zod 嚴格輸入驗證 Schema（z.strictObject 拒絕任何未定義的額外欄位，防止 Mass Assignment）
const uuidSchema = z.uuid('無效的資源識別碼');

const createMemberSchema = z.strictObject({
  family_code: z.string().optional(),
  name: z.string().trim().min(1, '名稱不可為空').max(50, '名稱不可超過 50 字元'),
  type: z.enum(['human', 'cat'], { message: '成員類型必須為 human 或 cat' }),
  height_cm: z
    .number({ message: '身高必須為數字' })
    .finite('身高必須為有效數值')
    .min(20, '身高須介於 20–300 cm')
    .max(300, '身高須介於 20–300 cm')
    .nullable()
    .optional(),
  target_weight: z
    .number({ message: '目標體重必須為數字' })
    .finite('目標體重必須為有效數值')
    .min(0.1, '目標體重須介於 0.1–500 kg')
    .max(500, '目標體重須介於 0.1–500 kg')
    .nullable()
    .optional()
});

const updateMemberSchema = z
  .strictObject({
    height_cm: z
      .number({ message: '身高必須為數字' })
      .finite('身高必須為有效數值')
      .min(20, '身高須介於 20–300 cm')
      .max(300, '身高須介於 20–300 cm')
      .nullable()
      .optional(),
    target_weight: z
      .number({ message: '目標體重必須為數字' })
      .finite('目標體重必須為有效數值')
      .min(0.1, '目標體重須介於 0.1–500 kg')
      .max(500, '目標體重須介於 0.1–500 kg')
      .nullable()
      .optional()
  })
  .refine(
    (data) => data.height_cm !== undefined || data.target_weight !== undefined,
    { message: '至少需提供身高或目標體重其中一項欄位' }
  );

const createRecordSchema = z.strictObject({
  family_code: z.string().optional(),
  member_id: uuidSchema,
  weight_kg: z
    .number({ message: '體重必須為數字' })
    .finite('體重必須為有效數值')
    .min(0.1, '體重須介於 0.1–500 kg')
    .max(500, '體重須介於 0.1–500 kg'),
  recorded_at: z
    .string()
    .trim()
    .refine(isValidRecordedDate, '日期格式不正確或超出合理範圍')
    .optional(),
  note: z
    .string()
    .trim()
    .max(200, '備註不可超過 200 字元')
    .nullable()
    .optional()
    .transform((v) => v ?? '')
});

function formatZodError(error) {
  const first = error?.issues?.[0];
  if (!first) return '請求欄位格式不正確';
  if (first.code === 'unrecognized_keys') return '請求包含不允許的額外欄位';
  return first.message || '請求欄位格式不正確';
}

// 使用 SHA-256 + timingSafeEqual 進行常數時間金鑰比對，避免計時側通道與長度洩漏
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const hashA = crypto.createHash('sha256').update(a).digest();
  const hashB = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

// 清除控制字元，避免日誌注入（Log Injection）
function sanitizeLogValue(val) {
  return String(val ?? '').replace(/[\r\n\t]/g, ' ').slice(0, 200);
}

// 遮罩 URL 路徑中的家庭同步碼（/api/families/:familyCode/...）與查詢參數，避免同步碼明文寫入日誌
function maskSensitiveUrl(rawUrl) {
  const safe = sanitizeLogValue(rawUrl);
  const pathOnly = safe.split('?')[0];
  return pathOnly.replace(/(\/api\/families\/)([^/]+)/i, (_, prefix, code) => {
    const masked = code.length <= 4 ? '****' : `${code.slice(0, 2)}***${code.slice(-2)}`;
    return `${prefix}${masked}`;
  });
}

// Express 4 非同步路由包裝器，確保任何未捕捉例外都交給全域錯誤處理器
const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

// 取得並驗證請求的家庭同步碼（要求 Header X-Family-Code；若同時傳遞 bodyCode 必須一致）
function resolveFamilyCode(req, bodyCode) {
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

const app = express();

// 1. Render 位於反向代理後方，必須開啟此項才能正確取得真實 IP（可透過 TRUST_PROXY 調整）
const trustProxyHops = Number.isInteger(Number(process.env.TRUST_PROXY))
  ? Number(process.env.TRUST_PROXY)
  : 1;
app.set('trust proxy', trustProxyHops);

// 2. 基礎 HTTP 安全標頭
app.use(helmet());

// 3. 嚴格 CORS：正式環境僅允許設定的 Capacitor / 正式來源，本機開發網址僅於非 production 啟用
const configuredOrigins = (process.env.ALLOWED_ORIGINS || 'https://localhost,capacitor://localhost')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

const devOrigins = isProduction
  ? []
  : ['http://localhost:3000', 'http://localhost:5000', 'http://127.0.0.1:5500'];

const allowedOrigins = new Set([...configuredOrigins, ...devOrigins]);

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.has(origin)) {
      callback(null, true);
    } else {
      logger.warn('CORS 阻擋未授權來源', { origin: sanitizeLogValue(origin) });
      const corsErr = new Error('Not allowed by CORS');
      corsErr.status = 403;
      corsErr.isCorsError = true;
      callback(corsErr);
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'X-API-Key', 'X-Family-Code']
};

app.use(cors(corsOptions));
// 明確處理所有路徑的 OPTIONS 預檢請求
app.options('*', cors(corsOptions));

// 4. 限制單筆請求大小為 10kb，防止惡意塞入巨量垃圾文字耗盡資料庫空間
app.use(express.json({ limit: '10kb' }));

// 5. 速率限制（Rate Limiting）
// 5-1. 健康檢查專用限流：每分鐘最多 30 次，防止用來灌爆日誌
const healthLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logger.warn('健康檢查觸發速率限制 (429)', { ip: req.ip });
    res.status(429).json({ error: '請求過於頻繁，請稍後再試' });
  }
});

// 5-2. 一般 API 限流：同一個 IP 每 15 分鐘最多 60 次請求（不含 OPTIONS 預檢）
const apiLimiter = rateLimit({
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

// 5-3. 失敗請求嚴格限流：抑制金鑰與同步碼暴力猜測（僅計算 4xx/5xx，每 15 分鐘最多 15 次）
const authFailLimiter = rateLimit({
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

// HTTP 請求日誌中介層：記錄每個 API 的方法、遮罩後路徑、狀態碼與耗時
app.use((req, res, next) => {
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
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// 取得今天日期字串 (YYYY-MM-DD)
function getTodayDate() {
  return new Date().toISOString().split('T')[0];
}

// 取得兩年前的日期字串 (YYYY-MM-DD)
function getTwoYearsAgoDate() {
  const date = new Date();
  date.setFullYear(date.getFullYear() - 2);
  return date.toISOString().split('T')[0];
}

app.get('/api/health', healthLimiter, (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// 6. API 金鑰驗證與限流中介層
app.use('/api', apiLimiter, authFailLimiter, (req, res, next) => {
  // 預檢請求不帶 API Key，直接放行
  if (req.method === 'OPTIONS') return next();

  const clientKey = req.headers['x-api-key'];
  if (!safeEqual(clientKey, process.env.APP_API_KEY)) {
    logger.warn('無效的 API Key 存取嘗試', { ip: req.ip, path: maskSensitiveUrl(req.originalUrl) });
    return res.status(401).json({ error: '未授權的存取' });
  }
  next();
});

// 1. 取得家庭資料
app.get('/api/families/:familyCode/data', asyncHandler(async (req, res) => {
  const { familyCode: paramCode } = req.params;
  const resolved = resolveFamilyCode(req, paramCode);
  if (resolved.errorStatus) {
    logger.warn('讀取家庭資料被拒（同步碼驗證失敗）', { ip: req.ip });
    return res.status(resolved.errorStatus).json({ error: resolved.errorMessage });
  }
  const { familyCode } = resolved;
  const cutoffDate = getTwoYearsAgoDate();

  const [membersRes, recordsRes] = await Promise.all([
    supabase.from('members').select('*').eq('family_code', familyCode).order('created_at'),
    supabase
      .from('weight_records')
      .select('*')
      .eq('family_code', familyCode)
      .gte('recorded_at', cutoffDate) // 只保留近兩年
      .order('recorded_at', { ascending: true })
  ]);

  if (membersRes.error) throw membersRes.error;
  if (recordsRes.error) throw recordsRes.error;

  logger.info('讀取家庭資料成功', {
    membersCount: membersRes.data.length,
    recordsCount: recordsRes.data.length
  });
  res.json({ members: membersRes.data, records: recordsRes.data });
}));

// 2. 新增成員
app.post('/api/members', asyncHandler(async (req, res) => {
  const parsed = createMemberSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: formatZodError(parsed.error) });
  }

  const { family_code, name, type, height_cm, target_weight } = parsed.data;
  const resolved = resolveFamilyCode(req, family_code);
  if (resolved.errorStatus) {
    return res.status(resolved.errorStatus).json({ error: resolved.errorMessage });
  }
  const familyCode = resolved.familyCode;

  const { data, error } = await supabase
    .from('members')
    .insert({
      family_code: familyCode,
      name,
      type,
      height_cm: height_cm ?? null,
      target_weight: target_weight ?? null
    })
    .select()
    .single();

  if (error) {
    logger.error('新增成員失敗', { error: error.message });
    return res.status(500).json({ error: '新增成員失敗，請稍後再試' });
  }

  logger.info('新增成員成功', { id: data.id, type });
  res.status(201).json(data);
}));

// 2-1. 更新成員資料（身高、目標體重）— 強制驗證 UUID 與所屬家庭同步碼
app.put('/api/members/:id', asyncHandler(async (req, res) => {
  const idParsed = uuidSchema.safeParse(req.params.id);
  if (!idParsed.success) {
    return res.status(400).json({ error: '無效的成員識別碼' });
  }
  const id = idParsed.data;

  const bodyParsed = updateMemberSchema.safeParse(req.body);
  if (!bodyParsed.success) {
    return res.status(400).json({ error: formatZodError(bodyParsed.error) });
  }

  const resolved = resolveFamilyCode(req);
  if (resolved.errorStatus) {
    return res.status(resolved.errorStatus).json({ error: resolved.errorMessage });
  }
  const { familyCode } = resolved;

  const updatePayload = {};
  if (bodyParsed.data.height_cm !== undefined) updatePayload.height_cm = bodyParsed.data.height_cm;
  if (bodyParsed.data.target_weight !== undefined) updatePayload.target_weight = bodyParsed.data.target_weight;

  const { data, error } = await supabase
    .from('members')
    .update(updatePayload)
    .eq('id', id)
    .eq('family_code', familyCode)
    .select()
    .maybeSingle();

  if (error) {
    logger.error('更新成員資料失敗', { id, error: error.message });
    return res.status(500).json({ error: '更新成員資料失敗，請稍後再試' });
  }
  if (!data) {
    logger.warn('更新成員遭拒（找不到成員或非所屬家庭）', { id, ip: req.ip });
    return res.status(404).json({ error: '找不到成員或無權限修改' });
  }

  logger.info('更新成員資料成功', { id });
  res.json(data);
}));

// 3. 刪除成員 — 強制驗證 UUID 與所屬家庭同步碼
app.delete('/api/members/:id', asyncHandler(async (req, res) => {
  const idParsed = uuidSchema.safeParse(req.params.id);
  if (!idParsed.success) {
    return res.status(400).json({ error: '無效的成員識別碼' });
  }
  const id = idParsed.data;

  const resolved = resolveFamilyCode(req);
  if (resolved.errorStatus) {
    return res.status(resolved.errorStatus).json({ error: resolved.errorMessage });
  }
  const { familyCode } = resolved;

  const { data, error } = await supabase
    .from('members')
    .delete()
    .eq('id', id)
    .eq('family_code', familyCode)
    .select('id');

  if (error) {
    logger.error('刪除成員失敗', { id, error: error.message });
    return res.status(500).json({ error: '刪除成員失敗，請稍後再試' });
  }
  if (!data || data.length === 0) {
    logger.warn('刪除成員遭拒（找不到成員或非所屬家庭）', { id, ip: req.ip });
    return res.status(404).json({ error: '找不到成員或無權限刪除' });
  }

  logger.info('刪除成員成功', { id });
  res.status(204).send();
}));

// 4. 新增體重紀錄 — 驗證欄位格式並確認 member_id 確實隸屬於同一 family_code
app.post('/api/records', asyncHandler(async (req, res) => {
  const parsed = createRecordSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: formatZodError(parsed.error) });
  }

  const { family_code, member_id, weight_kg, recorded_at, note } = parsed.data;
  const resolved = resolveFamilyCode(req, family_code);
  if (resolved.errorStatus) {
    return res.status(resolved.errorStatus).json({ error: resolved.errorMessage });
  }
  const familyCode = resolved.familyCode;

  // 先確認目標成員確實屬於該家庭，防止跨家庭紀錄注入與誤觸清理
  const { data: ownerMember, error: ownerErr } = await supabase
    .from('members')
    .select('id')
    .eq('id', member_id)
    .eq('family_code', familyCode)
    .maybeSingle();

  if (ownerErr) {
    logger.error('驗證成員所屬家庭失敗', { member_id, error: ownerErr.message });
    return res.status(500).json({ error: '驗證成員資料失敗，請稍後再試' });
  }
  if (!ownerMember) {
    logger.warn('跨家庭新增體重紀錄遭拒', { member_id, ip: req.ip });
    return res.status(403).json({ error: '無權限對此成員新增體重紀錄' });
  }

  const { data, error } = await supabase
    .from('weight_records')
    .insert({
      family_code: familyCode,
      member_id,
      weight_kg,
      recorded_at: recorded_at || getTodayDate(),
      note
    })
    .select()
    .single();

  if (error) {
    logger.error('新增體重紀錄失敗', { member_id, error: error.message });
    return res.status(500).json({ error: '新增體重紀錄失敗，請稍後再試' });
  }

  // 非同步清理超過兩年的舊紀錄（不阻塞前端回應，並捕捉潛在例外）
  const cutoffDate = getTwoYearsAgoDate();
  supabase
    .from('weight_records')
    .delete()
    .eq('family_code', familyCode)
    .lt('recorded_at', cutoffDate)
    .then(({ error: delErr }) => {
      if (delErr) logger.warn('清理過期體重紀錄失敗', { error: delErr.message });
    })
    .catch((delEx) => {
      logger.warn('清理過期體重紀錄發生例外', { error: delEx.message });
    });

  logger.info('新增體重紀錄成功', { id: data.id, member_id });
  res.status(201).json(data);
}));

// 5. 刪除單筆體重紀錄 — 強制驗證 UUID 與所屬家庭同步碼
app.delete('/api/records/:id', asyncHandler(async (req, res) => {
  const idParsed = uuidSchema.safeParse(req.params.id);
  if (!idParsed.success) {
    return res.status(400).json({ error: '無效的紀錄識別碼' });
  }
  const id = idParsed.data;

  const resolved = resolveFamilyCode(req);
  if (resolved.errorStatus) {
    return res.status(resolved.errorStatus).json({ error: resolved.errorMessage });
  }
  const { familyCode } = resolved;

  const { data, error } = await supabase
    .from('weight_records')
    .delete()
    .eq('id', id)
    .eq('family_code', familyCode)
    .select('id');

  if (error) {
    logger.error('刪除體重紀錄失敗', { id, error: error.message });
    return res.status(500).json({ error: '刪除體重紀錄失敗，請稍後再試' });
  }
  if (!data || data.length === 0) {
    logger.warn('刪除體重紀錄遭拒（找不到紀錄或非所屬家庭）', { id, ip: req.ip });
    return res.status(404).json({ error: '找不到紀錄或無權限刪除' });
  }

  logger.info('刪除體重紀錄成功', { id });
  res.status(204).send();
}));

// 全域未捕捉錯誤處理（區分 CORS 403、JSON 解析錯誤 400 與請求過大 413，避免誤報 500）
app.use((err, req, res, next) => {
  if (err?.isCorsError || err?.status === 403) {
    return res.status(403).json({ error: '未授權的存取來源' });
  }
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: '請求 JSON 格式不正確' });
  }
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ error: '請求內容超過大小限制' });
  }
  logger.error('伺服器未預期錯誤', { stack: err?.stack || String(err) });
  res.status(500).json({ error: '伺服器內部錯誤' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => logger.info(`Backend API running on port ${PORT}`));