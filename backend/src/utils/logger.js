import winston from 'winston';

const { combine, timestamp, printf, colorize, errors } = winston.format;

const SENSITIVE_KEY_PATTERN = /family[_-]?code|api[_-]?key|authorization|token|secret|password|name|weight/i;

function maskValue(value) {
  const str = String(value ?? '');
  if (str.length <= 4) return '****';
  return `${str.slice(0, 2)}***${str.slice(-2)}`;
}

// 遞迴遮罩敏感欄位並清理控制字元，避免敏感憑證與個資寫入日誌
function redactMeta(obj, depth = 0) {
  if (depth > 4 || obj === null || obj === undefined) return obj;
  if (typeof obj === 'string') return obj.replace(/[\r\n\t]/g, ' ');
  if (Array.isArray(obj)) return obj.map((item) => redactMeta(item, depth + 1));
  if (typeof obj !== 'object') return obj;

  const result = {};
  for (const [key, val] of Object.entries(obj)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      result[key] = maskValue(val);
    } else {
      result[key] = redactMeta(val, depth + 1);
    }
  }
  return result;
}

// 自訂輸出格式：[時間] [等級]: 訊息
const logFormat = printf(({ level, message, timestamp, stack, ...meta }) => {
  const safeMeta = redactMeta(meta);
  const metaStr = Object.keys(safeMeta).length ? ` ${JSON.stringify(safeMeta)}` : '';
  const body = stack || String(message ?? '').replace(/[\r\n]/g, ' ');
  return `[${timestamp}] [${level}]: ${body}${metaStr}`;
});

const transports = [
  // 1. 輸出到終端機（帶顏色，Render / Zeabur 雲端後台會直接讀取這裡）
  new winston.transports.Console({
    format: combine(colorize(), timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }), logFormat)
  })
];

// 預設啟用本機檔案日誌並限制單檔 5MB、最多保留 5 份；雲端無狀態環境可設 LOG_TO_FILE=false 關閉
if (process.env.LOG_TO_FILE !== 'false') {
  const fileOptions = {
    maxsize: 5 * 1024 * 1024, // 5 MB
    maxFiles: 5,
    tailable: true
  };
  transports.push(
    new winston.transports.File({ filename: 'logs/error.log', level: 'error', ...fileOptions }),
    new winston.transports.File({ filename: 'logs/combined.log', ...fileOptions })
  );
}

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: combine(
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    errors({ stack: true }),
    logFormat
  ),
  transports
});

export default logger;
