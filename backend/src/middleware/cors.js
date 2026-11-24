import cors from 'cors';
import { config } from '../config/env.js';
import logger from '../utils/logger.js';
import { sanitizeLogValue } from '../utils/security.js';

export const corsOptions = {
  origin: (origin, callback) => {
    if (!origin || config.allowedOrigins.has(origin)) {
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

export const corsMiddleware = cors(corsOptions);
