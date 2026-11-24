import crypto from 'node:crypto';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import logger from './logger.js';

dotenv.config();

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

// 使用 SHA-256 + timingSafeEqual 進行常數時間金鑰比對，避免計時側通道與長度洩漏
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const hashA = crypto.createHash('sha256').update(a).digest();
  const hashB = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

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

// 1. Render 位於反向代理後方，必須開啟此項才能正確取得攻擊者的真實 IP
app.set('trust proxy', 1);

// 2. 基礎 HTTP 安全標頭
app.use(helmet());

// 3. 嚴格 CORS：只允許 Capacitor APP 與本機開發網址連線
const allowedOrigins = [
  'https://localhost',       // Android Capacitor 預設 Origin
  'capacitor://localhost',   // iOS Capacitor 預設 Origin
  'http://localhost:3000',
  'http://localhost:5000',
  'http://127.0.0.1:5500'
];
const corsOptions = {
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      logger.warn('CORS 阻擋未授權來源', { origin });
      callback(new Error('Not allowed by CORS'));
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

// 5. 速率限制（Rate Limiting）：同一個 IP 每 15 分鐘最多 60 次請求
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logger.warn('觸發速率限制 (429)', { ip: req.ip, path: req.originalUrl });
    res.status(429).json({ error: '請求過於頻繁，請稍後再試' });
  }
});

// HTTP 請求日誌中介層：記錄每個 API 的方法、路徑、狀態碼與耗時
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    const msg = `${req.method} ${req.originalUrl} ${res.statusCode} - ${duration}ms`;
    if (res.statusCode >= 500) {
      logger.error(msg, { ip: req.ip });
    } else if (res.statusCode >= 400) {
      logger.warn(msg, { ip: req.ip });
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

// 取得兩年前的日期字串 (YYYY-MM-DD)
function getTwoYearsAgoDate() {
  const date = new Date();
  date.setFullYear(date.getFullYear() - 2);
  return date.toISOString().split('T')[0];
}

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// 6. API 金鑰驗證中介層
app.use('/api', apiLimiter, (req, res, next) => {
  // 預檢請求不帶 API Key，直接放行
  if (req.method === 'OPTIONS') return next();

  const clientKey = req.headers['x-api-key'];
  if (!safeEqual(clientKey, process.env.APP_API_KEY)) {
    logger.warn('無效的 API Key 存取嘗試', { ip: req.ip, path: req.originalUrl });
    return res.status(401).json({ error: '未授權的存取' });
  }
  next();
});

// 1. 取得家庭資料
app.get('/api/families/:familyCode/data', async (req, res) => {
  const { familyCode: paramCode } = req.params;
  const resolved = resolveFamilyCode(req, paramCode);
  if (resolved.errorStatus) {
    logger.warn('讀取家庭資料被拒（同步碼驗證失敗）', { ip: req.ip });
    return res.status(resolved.errorStatus).json({ error: resolved.errorMessage });
  }
  const { familyCode } = resolved;
  const cutoffDate = getTwoYearsAgoDate();

  try {
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
  } catch (err) {
    logger.error('讀取家庭資料失敗', { error: err.message });
    res.status(500).json({ error: '讀取家庭資料失敗，請稍後再試' });
  }
});

// 2. 新增成員
app.post('/api/members', async (req, res) => {
  const { family_code, name, type, height_cm, target_weight } = req.body || {};
  const resolved = resolveFamilyCode(req, family_code);
  if (resolved.errorStatus) {
    return res.status(resolved.errorStatus).json({ error: resolved.errorMessage });
  }
  const familyCode = resolved.familyCode;

  if (!name || !type) {
    logger.warn('新增成員缺少必要欄位', { ip: req.ip });
    return res.status(400).json({ error: '缺少必要欄位' });
  }

  try {
    const { data, error } = await supabase
      .from('members')
      .insert({ family_code: familyCode, name, type, height_cm, target_weight })
      .select()
      .single();

    if (error) {
      logger.error('新增成員失敗', { error: error.message });
      return res.status(500).json({ error: '新增成員失敗，請稍後再試' });
    }

    logger.info('新增成員成功', { id: data.id, type });
    res.status(201).json(data);
  } catch (err) {
    logger.error('新增成員發生未預期錯誤', { error: err.message });
    res.status(500).json({ error: '伺服器內部錯誤' });
  }
});

// 2-1. 更新成員資料（身高、目標體重）— 強制驗證所屬家庭同步碼
app.put('/api/members/:id', async (req, res) => {
  const { id } = req.params;
  const { height_cm, target_weight } = req.body || {};
  const resolved = resolveFamilyCode(req);
  if (resolved.errorStatus) {
    return res.status(resolved.errorStatus).json({ error: resolved.errorMessage });
  }
  const { familyCode } = resolved;

  try {
    const { data, error } = await supabase
      .from('members')
      .update({ height_cm, target_weight })
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
  } catch (err) {
    logger.error('更新成員資料發生未預期錯誤', { id, error: err.message });
    res.status(500).json({ error: '伺服器內部錯誤' });
  }
});

// 3. 刪除成員 — 強制驗證所屬家庭同步碼
app.delete('/api/members/:id', async (req, res) => {
  const { id } = req.params;
  const resolved = resolveFamilyCode(req);
  if (resolved.errorStatus) {
    return res.status(resolved.errorStatus).json({ error: resolved.errorMessage });
  }
  const { familyCode } = resolved;

  try {
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
  } catch (err) {
    logger.error('刪除成員發生未預期錯誤', { id, error: err.message });
    res.status(500).json({ error: '伺服器內部錯誤' });
  }
});

// 4. 新增體重紀錄 — 驗證 member_id 確實隸屬於同一 family_code
app.post('/api/records', async (req, res) => {
  const { family_code, member_id, weight_kg, recorded_at, note } = req.body || {};
  const resolved = resolveFamilyCode(req, family_code);
  if (resolved.errorStatus) {
    return res.status(resolved.errorStatus).json({ error: resolved.errorMessage });
  }
  const familyCode = resolved.familyCode;

  if (!member_id || weight_kg === undefined || weight_kg === null) {
    return res.status(400).json({ error: '缺少必要欄位' });
  }

  try {
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
      .insert({ family_code: familyCode, member_id, weight_kg, recorded_at, note })
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
  } catch (err) {
    logger.error('新增體重紀錄發生未預期錯誤', { member_id, error: err.message });
    res.status(500).json({ error: '伺服器內部錯誤' });
  }
});

// 5. 刪除單筆體重紀錄 — 強制驗證所屬家庭同步碼
app.delete('/api/records/:id', async (req, res) => {
  const { id } = req.params;
  const resolved = resolveFamilyCode(req);
  if (resolved.errorStatus) {
    return res.status(resolved.errorStatus).json({ error: resolved.errorMessage });
  }
  const { familyCode } = resolved;

  try {
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
  } catch (err) {
    logger.error('刪除體重紀錄發生未預期錯誤', { id, error: err.message });
    res.status(500).json({ error: '伺服器內部錯誤' });
  }
});

// 全域未捕捉錯誤處理
app.use((err, req, res, next) => {
  logger.error('伺服器未預期錯誤', { stack: err.stack });
  res.status(500).json({ error: '伺服器內部錯誤' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => logger.info(`Backend API running on port ${PORT}`));