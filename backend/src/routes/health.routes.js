import { Router } from 'express';
import { healthLimiter } from '../middleware/rateLimit.js';

const router = Router();

router.get('/health', healthLimiter, (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

export default router;
