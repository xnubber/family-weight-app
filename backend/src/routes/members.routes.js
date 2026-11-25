import { Router } from 'express';
import { getSupabaseClient } from '../config/supabase.js';
import { resolveFamilyCode } from '../middleware/auth.js';
import { pinVerifyLimiter } from '../middleware/rateLimit.js';
import {
  uuidSchema,
  createMemberSchema,
  updateMemberSchema,
  verifyPinSchema,
  reorderMembersSchema,
  formatZodError
} from '../schemas/validation.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { getTodayDate } from '../utils/date.js';
import { hashPrivacyPin, verifyPrivacyPin, sanitizeMember } from '../utils/security.js';
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

const OPTIONAL_MEMBER_COLUMNS = [
  'avatar',
  'hide_weight',
  'privacy_pin_hash',
  'breed',
  'birth_date',
  'bcs_score',
  'pet_activity_factor',
  'sort_order'
];

function detectMissingOptionalColumn(error) {
  if (error?.code !== '42703' && error?.code !== 'PGRST204') return null;
  const msg = String(error?.message || '').toLowerCase();
  return OPTIONAL_MEMBER_COLUMNS.find((col) => msg.includes(col)) || null;
}

// 驗證個別成員的 4 位數個人隱私 PIN 密碼（套用嚴格防暴力破解限流）
router.post('/:id/verify-pin', pinVerifyLimiter, asyncHandler(async (req, res) => {
  const idParsed = uuidSchema.safeParse(req.params.id);
  if (!idParsed.success) {
    return res.status(400).json({ error: '無效的成員識別碼' });
  }
  const id = idParsed.data;

  const bodyParsed = verifyPinSchema.safeParse(req.body);
  if (!bodyParsed.success) {
    return res.status(400).json({ error: formatZodError(bodyParsed.error) });
  }

  const resolved = resolveFamilyCode(req);
  if (resolved.errorStatus) {
    return res.status(resolved.errorStatus).json({ error: resolved.errorMessage });
  }
  const { familyCode } = resolved;

  const supabase = getSupabaseClient();
  const { data: member, error } = await supabase
    .from('members')
    .select('*')
    .eq('id', id)
    .eq('family_code', familyCode)
    .maybeSingle();

  if (error) {
    logger.error('讀取成員隱私密碼失敗', { id, error: error.message });
    return res.status(500).json({ error: '驗證失敗，請稍後再試' });
  }
  if (!member) {
    return res.status(404).json({ error: '找不到成員或無權限存取' });
  }

  if (!member.privacy_pin_hash) {
    return res.json({ verified: true, has_privacy_pin: false });
  }

  const ok = verifyPrivacyPin(bodyParsed.data.pin, member.privacy_pin_hash);
  if (!ok) {
    logger.warn('個人隱私 PIN 驗證失敗', { id, ip: req.ip });
    return res.status(403).json({ error: '個人密碼不正確' });
  }

  return res.json({ verified: true, has_privacy_pin: true });
}));

// 新增成員
router.post('/', asyncHandler(async (req, res) => {
  const parsed = createMemberSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: formatZodError(parsed.error) });
  }

  const {
    family_code,
    name,
    type,
    avatar,
    breed,
    birth_date,
    bcs_score,
    pet_activity_factor,
    hide_weight,
    privacy_pin,
    height_cm,
    target_weight,
    target_effective_date
  } = parsed.data;
  const resolved = resolveFamilyCode(req, family_code);
  if (resolved.errorStatus) {
    return res.status(resolved.errorStatus).json({ error: resolved.errorMessage });
  }
  const familyCode = resolved.familyCode;
  const supabase = getSupabaseClient();
  const isPet = type === 'cat' || type === 'dog';

  const insertPayload = {
    family_code: familyCode,
    name,
    type,
    height_cm: isPet ? null : (height_cm ?? null),
    target_weight: target_weight ?? null
  };
  if (avatar !== undefined) insertPayload.avatar = avatar;
  if (birth_date !== undefined) insertPayload.birth_date = birth_date;
  if (isPet) {
    if (breed !== undefined) insertPayload.breed = breed;
    if (bcs_score !== undefined) insertPayload.bcs_score = bcs_score;
    if (pet_activity_factor !== undefined) insertPayload.pet_activity_factor = pet_activity_factor;
  }
  if (hide_weight !== undefined) insertPayload.hide_weight = Boolean(hide_weight);
  if (hide_weight && privacy_pin) {
    insertPayload.privacy_pin_hash = hashPrivacyPin(privacy_pin);
  }

  let data = null;
  let error = null;
  for (let attempt = 0; attempt <= OPTIONAL_MEMBER_COLUMNS.length; attempt++) {
    const resInsert = await supabase
      .from('members')
      .insert(insertPayload)
      .select()
      .single();
    data = resInsert.data;
    error = resInsert.error;
    if (!error) break;

    const missingCol = detectMissingOptionalColumn(error);
    if (!missingCol || !(missingCol in insertPayload)) break;
    logger.warn(`members 表尚未新增 ${missingCol} 欄位，略過該欄位寫入（請執行對應 SQL 遷移）`);
    delete insertPayload[missingCol];
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
  res.status(201).json(sanitizeMember(data));
}));

// 批量更新成員顯示順序（必須定義於 PUT /:id 之前）
router.put('/reorder', asyncHandler(async (req, res) => {
  const bodyParsed = reorderMembersSchema.safeParse(req.body);
  if (!bodyParsed.success) {
    return res.status(400).json({ error: formatZodError(bodyParsed.error) });
  }

  const resolved = resolveFamilyCode(req);
  if (resolved.errorStatus) {
    return res.status(resolved.errorStatus).json({ error: resolved.errorMessage });
  }
  const { familyCode } = resolved;
  const { member_ids } = bodyParsed.data;
  const supabase = getSupabaseClient();

  const results = await Promise.all(
    member_ids.map((memberId, index) =>
      supabase
        .from('members')
        .update({ sort_order: index })
        .eq('id', memberId)
        .eq('family_code', familyCode)
    )
  );

  const firstErr = results.find((r) => r.error)?.error || null;
  if (firstErr) {
    if (detectMissingOptionalColumn(firstErr) === 'sort_order') {
      logger.warn('members 表尚未新增 sort_order 欄位，已略過雲端排序寫入（請執行 backend/sql/006_member_sort_order.sql）');
      return res.json({ synced: false, migration_required: true });
    }
    logger.error('更新成員排序失敗', { error: firstErr.message });
    return res.status(500).json({ error: '更新成員排序失敗，請稍後再試' });
  }

  logger.info('更新成員排序成功', { count: member_ids.length });
  return res.json({ synced: true, count: member_ids.length });
}));

// 更新成員資料（名稱、頭像、品種、生日、BCS、活動係數、隱私設定、身高、目標體重）— 強制驗證 UUID 與所屬家庭同步碼
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
  // 先讀取原成員資料，供 PIN 保護驗證與目標體重變更比對
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

  // 若此成員已設定個人隱私 PIN，修改隱私設定、變更/清除 PIN 或修改目標體重前必須驗證原 PIN
  if (existing.privacy_pin_hash) {
    const wantsDisableHide = bodyParsed.data.hide_weight === false && Boolean(existing.hide_weight);
    const wantsChangePin = bodyParsed.data.privacy_pin !== undefined;
    const prevTarget = normalizeTargetWeight(existing.target_weight);
    const nextTarget = bodyParsed.data.target_weight === undefined
      ? prevTarget
      : normalizeTargetWeight(bodyParsed.data.target_weight);
    const wantsChangeTarget = bodyParsed.data.target_weight !== undefined && prevTarget !== nextTarget;

    if (wantsDisableHide || wantsChangePin || wantsChangeTarget) {
      if (!bodyParsed.data.current_pin || !verifyPrivacyPin(bodyParsed.data.current_pin, existing.privacy_pin_hash)) {
        logger.warn('修改受 PIN 保護的成員設定遭拒', { id, ip: req.ip });
        return res.status(403).json({ error: '請先驗證個人 4 位數密碼後再修改隱私設定或目標體重' });
      }
    }
  }

  const isExistingPet = existing.type === 'cat' || existing.type === 'dog';
  const updatePayload = {};
  if (bodyParsed.data.name !== undefined) updatePayload.name = bodyParsed.data.name;
  if (bodyParsed.data.avatar !== undefined) updatePayload.avatar = bodyParsed.data.avatar;
  if (bodyParsed.data.birth_date !== undefined) updatePayload.birth_date = bodyParsed.data.birth_date;
  if (isExistingPet) {
    if (bodyParsed.data.breed !== undefined) updatePayload.breed = bodyParsed.data.breed;
    if (bodyParsed.data.bcs_score !== undefined) updatePayload.bcs_score = bodyParsed.data.bcs_score;
    if (bodyParsed.data.pet_activity_factor !== undefined) {
      updatePayload.pet_activity_factor = bodyParsed.data.pet_activity_factor;
    }
  } else if (bodyParsed.data.height_cm !== undefined) {
    updatePayload.height_cm = bodyParsed.data.height_cm;
  }
  if (bodyParsed.data.target_weight !== undefined) updatePayload.target_weight = bodyParsed.data.target_weight;
  if (bodyParsed.data.hide_weight !== undefined) {
    updatePayload.hide_weight = Boolean(bodyParsed.data.hide_weight);
    // 關閉隱私模式時一併清除舊 PIN，避免下次開啟產生困惑
    if (!bodyParsed.data.hide_weight && bodyParsed.data.privacy_pin === undefined) {
      updatePayload.privacy_pin_hash = null;
    }
  }
  if (bodyParsed.data.privacy_pin !== undefined) {
    const effectiveHide = bodyParsed.data.hide_weight !== undefined
      ? Boolean(bodyParsed.data.hide_weight)
      : Boolean(existing.hide_weight);
    updatePayload.privacy_pin_hash = effectiveHide && bodyParsed.data.privacy_pin
      ? hashPrivacyPin(bodyParsed.data.privacy_pin)
      : null;
  }

  let data = null;
  let error = null;
  for (let attempt = 0; attempt <= OPTIONAL_MEMBER_COLUMNS.length; attempt++) {
    if (Object.keys(updatePayload).length === 0) {
      data = existing;
      error = null;
      break;
    }
    const resUpdate = await supabase
      .from('members')
      .update(updatePayload)
      .eq('id', id)
      .eq('family_code', familyCode)
      .select()
      .maybeSingle();
    data = resUpdate.data;
    error = resUpdate.error;
    if (!error) break;

    const missingCol = detectMissingOptionalColumn(error);
    if (!missingCol || !(missingCol in updatePayload)) break;
    logger.warn(`members 表尚未新增 ${missingCol} 欄位，略過該欄位更新（請執行對應 SQL 遷移）`);
    delete updatePayload[missingCol];
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
  res.json(sanitizeMember(data));
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
