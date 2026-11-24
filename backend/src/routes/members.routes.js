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
import logger from '../utils/logger.js';

const router = Router();

// 新增成員
router.post('/', asyncHandler(async (req, res) => {
  const parsed = createMemberSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: formatZodError(parsed.error) });
  }

  const { family_code, name, type, height_cm, target_weight } = parsed.data;
  const resolved = resolveFamilyCode(req, family_code);
  if (resolved.errorStatus) {
    return res.status(resolved.errorStatus).json({ error: resolved.errorMessage });
  }
  const familyCode = resolved.familyCode;
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from('members')
    .insert({
      family_code: familyCode,
      name,
      type,
      height_cm: height_cm ?? null,
      target_weight: target_weight ?? null
    })
    .select()
    .single();

  if (error) {
    logger.error('新增成員失敗', { error: error.message });
    return res.status(500).json({ error: '新增成員失敗，請稍後再試' });
  }

  logger.info('新增成員成功', { id: data.id, type });
  res.status(201).json(data);
}));

// 更新成員資料（名稱、身高、目標體重）— 強制驗證 UUID 與所屬家庭同步碼
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

  const updatePayload = {};
  if (bodyParsed.data.name !== undefined) updatePayload.name = bodyParsed.data.name;
  if (bodyParsed.data.height_cm !== undefined) updatePayload.height_cm = bodyParsed.data.height_cm;
  if (bodyParsed.data.target_weight !== undefined) updatePayload.target_weight = bodyParsed.data.target_weight;

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('members')
    .update(updatePayload)
    .eq('id', id)
    .eq('family_code', familyCode)
    .select()
    .maybeSingle();

  if (error) {
    logger.error('更新成員資料失敗', { id, error: error.message });
    return res.status(500).json({ error: '更新成員資料失敗，請稍後再試' });
  }
  if (!data) {
    logger.warn('更新成員遭拒（找不到成員或非所屬家庭）', { id, ip: req.ip });
    return res.status(404).json({ error: '找不到成員或無權限修改' });
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
