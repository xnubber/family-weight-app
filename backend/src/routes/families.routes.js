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
  const cutoffDate = getTwoYearsAgoDate(req.clientTimeZone);
  const supabase = getSupabaseClient();

  const [membersRes, recordsRes, heightRecordsRes, historyRes] = await Promise.all([
    supabase.from('members').select('*').eq('family_code', familyCode).order('created_at'),
    supabase
      .from('weight_records')
      .select('*')
      .eq('family_code', familyCode)
      .gte('recorded_at', cutoffDate) // 只保留近兩年
      .order('recorded_at', { ascending: true }),
    supabase
      .from('height_records')
      .select('*')
      .eq('family_code', familyCode)
      .order('recorded_at', { ascending: true })
      .order('created_at', { ascending: true }),
    supabase
      .from('target_weight_history')
      .select('id, member_id, target_weight, effective_date, created_at')
      .eq('family_code', familyCode)
      .order('effective_date', { ascending: true })
      .order('created_at', { ascending: true })
  ]);

  if (membersRes.error) throw membersRes.error;
  if (recordsRes.error) throw recordsRes.error;

  let heightRecords = [];
  if (heightRecordsRes.error) {
    if (isMissingHistoryTableError(heightRecordsRes.error)) {
      logger.warn('尚未建立 height_records 資料表，請執行 backend/sql/007_height_records.sql');
    } else {
      throw heightRecordsRes.error;
    }
  } else {
    heightRecords = heightRecordsRes.data || [];
  }

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

  const sortedMembers = [...(membersRes.data || [])]
    .sort((a, b) => {
      const aOrder = Number.isInteger(a.sort_order) ? a.sort_order : Number.MAX_SAFE_INTEGER;
      const bOrder = Number.isInteger(b.sort_order) ? b.sort_order : Number.MAX_SAFE_INTEGER;
      if (aOrder !== bOrder) return aOrder - bOrder;
      return String(a.created_at || '').localeCompare(String(b.created_at || ''));
    })
    .map(sanitizeMember);

  logger.info('讀取家庭資料成功', {
    membersCount: sortedMembers.length,
    recordsCount: recordsRes.data.length,
    heightRecordsCount: heightRecords.length,
    targetHistoryCount: targetHistory.length
  });
  res.json({
    members: sortedMembers,
    records: recordsRes.data,
    heightRecords,
    targetHistory
  });
}));

export default router;
