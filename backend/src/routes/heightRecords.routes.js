import { Router } from 'express';
import { getSupabaseClient } from '../config/supabase.js';
import { resolveFamilyCode } from '../middleware/auth.js';
import {
  uuidSchema,
  createHeightRecordSchema,
  formatZodError
} from '../schemas/validation.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { getTodayDate } from '../utils/date.js';
import { getBackendMessage } from '../utils/messages.js';
import logger from '../utils/logger.js';

const router = Router();

function isMissingHeightTableError(error) {
  return error?.code === '42P01' || error?.code === 'PGRST205';
}

// 依據成員目前最新的身高紀錄自動同步回 members.height_cm（確保 BMI 與個人資訊同步）
async function syncMemberLatestHeight(supabase, familyCode, memberId) {
  const { data: latestList, error: latestErr } = await supabase
    .from('height_records')
    .select('height_cm')
    .eq('family_code', familyCode)
    .eq('member_id', memberId)
    .order('recorded_at', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1);

  if (latestErr || !latestList || latestList.length === 0) return;

  const latestHeight = Number(latestList[0].height_cm);
  if (!Number.isFinite(latestHeight)) return;

  const { error: updErr } = await supabase
    .from('members')
    .update({ height_cm: latestHeight })
    .eq('id', memberId)
    .eq('family_code', familyCode);

  if (updErr) {
    logger.warn('同步成員最新身高至 members.height_cm 失敗', { memberId, error: updErr.message });
  }
}

// 新增身高成長紀錄 — 驗證欄位格式、家庭歸屬並限家人使用，寫入後自動同步成員最新身高
router.post('/', asyncHandler(async (req, res) => {
  const parsed = createHeightRecordSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: formatZodError(parsed.error, req) });
  }

  const { family_code, member_id, height_cm, recorded_at, note } = parsed.data;
  const resolved = resolveFamilyCode(req, family_code);
  if (resolved.errorStatus) {
    return res.status(resolved.errorStatus).json({ error: resolved.errorMessage });
  }
  const familyCode = resolved.familyCode;
  const supabase = getSupabaseClient();

  const { data: ownerMember, error: ownerErr } = await supabase
    .from('members')
    .select('id, type')
    .eq('id', member_id)
    .eq('family_code', familyCode)
    .maybeSingle();

  if (ownerErr) {
    logger.error('驗證成員所屬家庭失敗（身高紀錄）', { member_id, error: ownerErr.message });
    return res.status(500).json({ error: getBackendMessage(req, 'verifyMemberOwnerFailed') });
  }
  if (!ownerMember) {
    logger.warn('跨家庭新增身高紀錄遭拒', { member_id, ip: req.ip });
    return res.status(403).json({ error: getBackendMessage(req, 'addHeightRecordForbidden') });
  }
  if (ownerMember.type !== 'human') {
    return res.status(400).json({ error: getBackendMessage(req, 'addHeightRecordPetForbidden') });
  }

  const roundedHeight = Math.round(Number(height_cm) * 10) / 10;
  const { data, error } = await supabase
    .from('height_records')
    .insert({
      family_code: familyCode,
      member_id,
      height_cm: roundedHeight,
      recorded_at: recorded_at || getTodayDate(req.clientTimeZone),
      note
    })
    .select()
    .single();

  if (error) {
    if (isMissingHeightTableError(error)) {
      logger.warn('尚未建立 height_records 資料表，請執行 backend/sql/007_height_records.sql');
      return res.status(400).json({ error: getBackendMessage(req, 'heightMigrationRequired') });
    }
    logger.error('新增身高紀錄失敗', { member_id, error: error.message });
    return res.status(500).json({ error: getBackendMessage(req, 'addHeightRecordFailed') });
  }

  await syncMemberLatestHeight(supabase, familyCode, member_id);

  logger.info('新增身高紀錄成功', { id: data.id, member_id });
  res.status(201).json(data);
}));

// 刪除單筆身高紀錄 — 強制驗證 UUID 與所屬家庭同步碼，刪除後重新同步成員最新身高
router.delete('/:id', asyncHandler(async (req, res) => {
  const idParsed = uuidSchema.safeParse(req.params.id);
  if (!idParsed.success) {
    return res.status(400).json({ error: getBackendMessage(req, 'invalidRecordId') });
  }
  const id = idParsed.data;

  const resolved = resolveFamilyCode(req);
  if (resolved.errorStatus) {
    return res.status(resolved.errorStatus).json({ error: resolved.errorMessage });
  }
  const { familyCode } = resolved;

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('height_records')
    .delete()
    .eq('id', id)
    .eq('family_code', familyCode)
    .select('id, member_id');

  if (error) {
    if (isMissingHeightTableError(error)) {
      return res.status(400).json({ error: getBackendMessage(req, 'heightMigrationRequired') });
    }
    logger.error('刪除身高紀錄失敗', { id, error: error.message });
    return res.status(500).json({ error: getBackendMessage(req, 'deleteHeightRecordFailed') });
  }
  if (!data || data.length === 0) {
    logger.warn('刪除身高紀錄遭拒（找不到紀錄或非所屬家庭）', { id, ip: req.ip });
    return res.status(404).json({ error: getBackendMessage(req, 'recordNotFoundDelete') });
  }

  const memberId = data[0].member_id;
  if (memberId) {
    await syncMemberLatestHeight(supabase, familyCode, memberId);
  }

  logger.info('刪除身高紀錄成功', { id });
  res.status(204).send();
}));

export default router;
