import { Router } from 'express';
import { getSupabaseClient } from '../config/supabase.js';
import { resolveFamilyCode } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { getTwoYearsAgoDate } from '../utils/date.js';
import { sanitizeMember } from '../utils/security.js';
import logger from '../utils/logger.js';

const router = Router();

function isMissingHistoryTableError(error) {
  return error?.code === '42P01' || error?.code === 'PGRST205';
}

// 取得家庭資料（成員、近兩年體重紀錄與目標體重歷史）
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

  const [membersRes, recordsRes, historyRes] = await Promise.all([
    supabase.from('members').select('*').eq('family_code', familyCode).order('created_at'),
    supabase
      .from('weight_records')
      .select('*')
      .eq('family_code', familyCode)
      .gte('recorded_at', cutoffDate) // 只保留近兩年
      .order('recorded_at', { ascending: true }),
    supabase
      .from('target_weight_history')
      .select('id, member_id, target_weight, effective_date, created_at')
      .eq('family_code', familyCode)
      .order('effective_date', { ascending: true })
      .order('created_at', { ascending: true })
  ]);

  if (membersRes.error) throw membersRes.error;
  if (recordsRes.error) throw recordsRes.error;

  let targetHistory = [];
  if (historyRes.error) {
    if (isMissingHistoryTableError(historyRes.error)) {
      logger.warn('尚未建立 target_weight_history 資料表，請執行 backend/sql/001_target_weight_history.sql');
    } else {
      throw historyRes.error;
    }
  } else {
    targetHistory = historyRes.data || [];
  }

  logger.info('讀取家庭資料成功', {
    membersCount: membersRes.data.length,
    recordsCount: recordsRes.data.length,
    targetHistoryCount: targetHistory.length
  });
  res.json({
    members: membersRes.data.map(sanitizeMember),
    records: recordsRes.data,
    targetHistory
  });
}));

export default router;
