import { Router } from 'express';
import { getSupabaseClient } from '../config/supabase.js';
import { resolveFamilyCode } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { getTwoYearsAgoDate } from '../utils/date.js';
import logger from '../utils/logger.js';

const router = Router();

// 取得家庭資料（成員與近兩年體重紀錄）
router.get('/:familyCode/data', asyncHandler(async (req, res) => {
  const { familyCode: paramCode } = req.params;
  const resolved = resolveFamilyCode(req, paramCode);
  if (resolved.errorStatus) {
    logger.warn('讀取家庭資料被拒（同步碼驗證失敗）', { ip: req.ip });
    return res.status(resolved.errorStatus).json({ error: resolved.errorMessage });
  }
  const { familyCode } = resolved;
  const cutoffDate = getTwoYearsAgoDate();
  const supabase = getSupabaseClient();

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

export default router;
