import { Router } from 'express';
import { getSupabaseClient } from '../config/supabase.js';
import { resolveFamilyCode } from '../middleware/auth.js';
import {
  uuidSchema,
  createMemberSchema,
  updateMemberSchema,
  formatZodError
} from '../schemas/validation.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { getTodayDate } from '../utils/date.js';
import logger from '../utils/logger.js';

const router = Router();

function normalizeTargetWeight(value) {
  if (value === null || value === undefined) return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

async function appendTargetHistory(supabase, { familyCode, memberId, targetWeight, effectiveDate }) {
  const { error } = await supabase.from('target_weight_history').insert({
    family_code: familyCode,
    member_id: memberId,
    target_weight: targetWeight,
    effective_date: effectiveDate || getTodayDate()
  });
  if (error) {
    if (error.code === '42P01' || error.code === 'PGRST205') {
      logger.warn('尚未建立 target_weight_history 資料表，略過寫入目標體重歷史');
    } else {
      logger.warn('寫入目標體重歷史紀錄失敗', { memberId, error: error.message });
    }
  }
}

function isMissingAvatarColumnError(error) {
  const msg = String(error?.message || '');
  return (error?.code === '42703' || error?.code === 'PGRST204') && msg.toLowerCase().includes('avatar');
}

// 新增成員
router.post('/', asyncHandler(async (req, res) => {
  const parsed = createMemberSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: formatZodError(parsed.error) });
  }

  const { family_code, name, type, avatar, height_cm, target_weight, target_effective_date } = parsed.data;
  const resolved = resolveFamilyCode(req, family_code);
  if (resolved.errorStatus) {
    return res.status(resolved.errorStatus).json({ error: resolved.errorMessage });
  }
  const familyCode = resolved.familyCode;
  const supabase = getSupabaseClient();

  const insertPayload = {
    family_code: familyCode,
    name,
    type,
    height_cm: height_cm ?? null,
    target_weight: target_weight ?? null
  };
  if (avatar !== undefined) {
    insertPayload.avatar = avatar;
  }

  let { data, error } = await supabase
    .from('members')
    .insert(insertPayload)
    .select()
    .single();

  // 相容尚未執行 002_dog_and_avatar.sql 遷移的資料庫：略過 avatar 欄位重試
  if (error && isMissingAvatarColumnError(error)) {
    logger.warn('members 表尚未新增 avatar 欄位，請執行 backend/sql/002_dog_and_avatar.sql');
    delete insertPayload.avatar;
    const retry = await supabase
      .from('members')
      .insert(insertPayload)
      .select()
      .single();
    data = retry.data;
    error = retry.error;
  }

  if (error) {
    if (error.code === '23514' && type === 'dog') {
      logger.warn('新增狗狗成員遭資料庫 CHECK 條件拒絕，請執行 002_dog_and_avatar.sql');
      return res.status(400).json({
        error: '資料庫尚未啟用「狗狗」類別，請先於 Supabase 執行 backend/sql/002_dog_and_avatar.sql'
      });
    }
    logger.error('新增成員失敗', { error: error.message });
    return res.status(500).json({ error: '新增成員失敗，請稍後再試' });
  }

  // 若建立成員時已設定目標體重，同步記錄初始生效日期
  if (data.target_weight !== null && data.target_weight !== undefined) {
    await appendTargetHistory(supabase, {
      familyCode,
      memberId: data.id,
      targetWeight: normalizeTargetWeight(data.target_weight),
      effectiveDate: target_effective_date || getTodayDate()
    });
  }

  logger.info('新增成員成功', { id: data.id, type });
  res.status(201).json(data);
}));

// 更新成員資料（名稱、頭像、身高、目標體重）— 強制驗證 UUID 與所屬家庭同步碼
router.put('/:id', asyncHandler(async (req, res) => {
  const idParsed = uuidSchema.safeParse(req.params.id);
  if (!idParsed.success) {
    return res.status(400).json({ error: '無效的成員識別碼' });
  }
  const id = idParsed.data;

  const bodyParsed = updateMemberSchema.safeParse(req.body);
  if (!bodyParsed.success) {
    return res.status(400).json({ error: formatZodError(bodyParsed.error) });
  }

  const resolved = resolveFamilyCode(req);
  if (resolved.errorStatus) {
    return res.status(resolved.errorStatus).json({ error: resolved.errorMessage });
  }
  const { familyCode } = resolved;

  const supabase = getSupabaseClient();
  // 先讀取原成員資料，僅在目標體重實際變更時才新增歷史紀錄
  const { data: existing, error: fetchErr } = await supabase
    .from('members')
    .select('*')
    .eq('id', id)
    .eq('family_code', familyCode)
    .maybeSingle();

  if (fetchErr) {
    logger.error('讀取原成員資料失敗', { id, error: fetchErr.message });
    return res.status(500).json({ error: '更新成員資料失敗，請稍後再試' });
  }
  if (!existing) {
    logger.warn('更新成員遭拒（找不到成員或非所屬家庭）', { id, ip: req.ip });
    return res.status(404).json({ error: '找不到成員或無權限修改' });
  }

  const updatePayload = {};
  if (bodyParsed.data.name !== undefined) updatePayload.name = bodyParsed.data.name;
  if (bodyParsed.data.avatar !== undefined) updatePayload.avatar = bodyParsed.data.avatar;
  if (bodyParsed.data.height_cm !== undefined) updatePayload.height_cm = bodyParsed.data.height_cm;
  if (bodyParsed.data.target_weight !== undefined) updatePayload.target_weight = bodyParsed.data.target_weight;

  let { data, error } = await supabase
    .from('members')
    .update(updatePayload)
    .eq('id', id)
    .eq('family_code', familyCode)
    .select()
    .maybeSingle();

  // 相容尚未執行 002_dog_and_avatar.sql 遷移的資料庫：略過 avatar 欄位重試
  if (error && isMissingAvatarColumnError(error)) {
    logger.warn('members 表尚未新增 avatar 欄位，請執行 backend/sql/002_dog_and_avatar.sql');
    delete updatePayload.avatar;
    if (Object.keys(updatePayload).length === 0) {
      data = existing;
      error = null;
    } else {
      const retry = await supabase
        .from('members')
        .update(updatePayload)
        .eq('id', id)
        .eq('family_code', familyCode)
        .select()
        .maybeSingle();
      data = retry.data;
      error = retry.error;
    }
  }

  if (error) {
    logger.error('更新成員資料失敗', { id, error: error.message });
    return res.status(500).json({ error: '更新成員資料失敗，請稍後再試' });
  }
  if (!data) {
    logger.warn('更新成員遭拒（找不到成員或非所屬家庭）', { id, ip: req.ip });
    return res.status(404).json({ error: '找不到成員或無權限修改' });
  }

  if (bodyParsed.data.target_weight !== undefined) {
    const prevTarget = normalizeTargetWeight(existing.target_weight);
    const nextTarget = normalizeTargetWeight(bodyParsed.data.target_weight);
    if (prevTarget !== nextTarget) {
      await appendTargetHistory(supabase, {
        familyCode,
        memberId: id,
        targetWeight: nextTarget,
        effectiveDate: bodyParsed.data.target_effective_date || getTodayDate()
      });
    }
  }

  logger.info('更新成員資料成功', { id });
  res.json(data);
}));

// 刪除成員 — 強制驗證 UUID 與所屬家庭同步碼
router.delete('/:id', asyncHandler(async (req, res) => {
  const idParsed = uuidSchema.safeParse(req.params.id);
  if (!idParsed.success) {
    return res.status(400).json({ error: '無效的成員識別碼' });
  }
  const id = idParsed.data;

  const resolved = resolveFamilyCode(req);
  if (resolved.errorStatus) {
    return res.status(resolved.errorStatus).json({ error: resolved.errorMessage });
  }
  const { familyCode } = resolved;

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('members')
    .delete()
    .eq('id', id)
    .eq('family_code', familyCode)
    .select('id');

  if (error) {
    logger.error('刪除成員失敗', { id, error: error.message });
    return res.status(500).json({ error: '刪除成員失敗，請稍後再試' });
  }
  if (!data || data.length === 0) {
    logger.warn('刪除成員遭拒（找不到成員或非所屬家庭）', { id, ip: req.ip });
    return res.status(404).json({ error: '找不到成員或無權限刪除' });
  }

  logger.info('刪除成員成功', { id });
  res.status(204).send();
}));

export default router;
