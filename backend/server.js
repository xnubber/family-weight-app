import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import logger from './logger.js';

dotenv.config();

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
  allowedHeaders: ['Content-Type', 'X-API-Key']
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
  if (!process.env.APP_API_KEY || clientKey !== process.env.APP_API_KEY) {
    logger.warn('無效的 API Key 存取嘗試', { ip: req.ip, path: req.originalUrl });
    return res.status(401).json({ error: '未授權的存取' });
  }
  next();
});

// 1. 取得家庭資料
app.get('/api/families/:familyCode/data', async (req, res) => {
  const { familyCode } = req.params;
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
      familyCode,
      membersCount: membersRes.data.length,
      recordsCount: recordsRes.data.length
    });
    res.json({ members: membersRes.data, records: recordsRes.data });
  } catch (err) {
    logger.error('讀取家庭資料失敗', { familyCode, error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// 2. 新增成員
app.post('/api/members', async (req, res) => {
  const { family_code, name, type, height_cm, target_weight } = req.body;
  if (!family_code || !name || !type) {
    logger.warn('新增成員缺少必要欄位', { body: req.body });
    return res.status(400).json({ error: '缺少必要欄位' });
  }

  const { data, error } = await supabase
    .from('members')
    .insert({ family_code, name, type, height_cm, target_weight })
    .select()
    .single();

  if (error) {
    logger.error('新增成員失敗', { family_code, name, error: error.message });
    return res.status(500).json({ error: error.message });
  }

  logger.info('新增成員成功', { id: data.id, family_code, name, type });
  res.status(201).json(data);
});

// 2-1. 更新成員資料（身高、目標體重）
app.put('/api/members/:id', async (req, res) => {
  const { id } = req.params;
  const { height_cm, target_weight } = req.body;

  const { data, error } = await supabase
    .from('members')
    .update({ height_cm, target_weight })
    .eq('id', id)
    .select()
    .single();

  if (error) {
    logger.error('更新成員資料失敗', { id, error: error.message });
    return res.status(500).json({ error: error.message });
  }

  logger.info('更新成員資料成功', { id, height_cm, target_weight });
  res.json(data);
});

// 3. 刪除成員
app.delete('/api/members/:id', async (req, res) => {
  const { id } = req.params;
  const { error } = await supabase.from('members').delete().eq('id', id);
  if (error) {
    logger.error('刪除成員失敗', { id, error: error.message });
    return res.status(500).json({ error: error.message });
  }

  logger.info('刪除成員成功', { id });
  res.status(204).send();
});

// 4. 新增體重紀錄
app.post('/api/records', async (req, res) => {
  const { family_code, member_id, weight_kg, recorded_at, note } = req.body;
  if (!family_code || !member_id || !weight_kg) {
    return res.status(400).json({ error: '缺少必要欄位' });
  }

  const { data, error } = await supabase
    .from('weight_records')
    .insert({ family_code, member_id, weight_kg, recorded_at, note })
    .select()
    .single();

  if (error) {
    logger.error('新增體重紀錄失敗', { family_code, member_id, error: error.message });
    return res.status(500).json({ error: error.message });
  }

  // 非同步清理超過兩年的舊紀錄（不阻塞前端回應）
  const cutoffDate = getTwoYearsAgoDate();
  supabase
    .from('weight_records')
    .delete()
    .eq('family_code', family_code)
    .lt('recorded_at', cutoffDate)
    .then(({ error: delErr }) => {
      if (delErr) logger.warn('清理過期體重紀錄失敗', { error: delErr.message });
    });

  logger.info('新增體重紀錄成功', { id: data.id, member_id, weight_kg });
  res.status(201).json(data);
});

// 5. 刪除單筆體重紀錄
app.delete('/api/records/:id', async (req, res) => {
  const { id } = req.params;
  const { error } = await supabase.from('weight_records').delete().eq('id', id);
  if (error) {
    logger.error('刪除體重紀錄失敗', { id, error: error.message });
    return res.status(500).json({ error: error.message });
  }

  logger.info('刪除體重紀錄成功', { id });
  res.status(204).send();
});

// 全域未捕捉錯誤處理
app.use((err, req, res, next) => {
  logger.error('伺服器未預期錯誤', { stack: err.stack });
  res.status(500).json({ error: '伺服器內部錯誤' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => logger.info(`Backend API running on port ${PORT}`));