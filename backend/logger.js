import winston from 'winston';

const { combine, timestamp, printf, colorize, errors } = winston.format;

// 自訂輸出格式：[時間] [等級]: 訊息
const logFormat = printf(({ level, message, timestamp, stack, ...meta }) => {
  const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
  return `[${timestamp}] [${level}]: ${stack || message}${metaStr}`;
});

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: combine(
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    errors({ stack: true }), // 錯誤時自動記錄 Stack Trace
    logFormat
  ),
  transports: [
    // 1. 輸出到終端機（帶顏色，Render / Zeabur 雲端後台會直接讀取這裡）
    new winston.transports.Console({
      format: combine(colorize(), timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }), logFormat)
    }),
    // 2. 僅將錯誤等級寫入 logs/error.log
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    // 3. 所有等級寫入 logs/combined.log
    new winston.transports.File({ filename: 'logs/combined.log' })
  ]
});

export default logger;