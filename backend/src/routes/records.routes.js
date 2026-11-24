import { Router } from 'express';
import { getSupabaseClient } from '../config/supabase.js';
import { resolveFamilyCode } from '../middleware/auth.js';
import {
  uuidSchema,
  createRecordSchema,
  formatZodError
} from '../schemas/validation.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { getTodayDate, getTwoYearsAgoDate } from '../utils/date.js';
import logger from '../utils/logger.js';

const router = Router();

// 新增體重紀錄 — 驗證欄位格式並確認 member_id 確實隸屬於同一 family_code
router.post('/', asyncHandler(async (req, res) => {
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
  const supabase = getSupabaseClient();

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

// 刪除單筆體重紀錄 — 強制驗證 UUID 與所屬家庭同步碼
router.delete('/:id', asyncHandler(async (req, res) => {
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

  const supabase = getSupabaseClient();
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

export default router;
