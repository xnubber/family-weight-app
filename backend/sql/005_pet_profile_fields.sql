-- 新增毛孩／成員進階檔案欄位：
--   - breed：毛孩品種（例如：橘貓、米克斯、柴犬、貴賓）
--   - birth_date：生日（家人與毛孩皆適用，用於計算年齡與毛孩人類換算年齡）
--   - bcs_score：獸醫 WSAVA 9 分制體態評分（1–9）
--   - pet_activity_factor：雲端同步毛孩熱量活動係數（0.5–5.0）
-- 請於 Supabase Dashboard -> SQL Editor 執行此腳本

ALTER TABLE public.members
  ADD COLUMN IF NOT EXISTS breed TEXT,
  ADD COLUMN IF NOT EXISTS birth_date DATE,
  ADD COLUMN IF NOT EXISTS bcs_score SMALLINT,
  ADD COLUMN IF NOT EXISTS pet_activity_factor NUMERIC(3, 1);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'public'
      AND rel.relname = 'members'
      AND con.conname = 'members_bcs_score_check'
  ) THEN
    ALTER TABLE public.members
      ADD CONSTRAINT members_bcs_score_check
      CHECK (bcs_score IS NULL OR (bcs_score >= 1 AND bcs_score <= 9));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'public'
      AND rel.relname = 'members'
      AND con.conname = 'members_pet_activity_factor_check'
  ) THEN
    ALTER TABLE public.members
      ADD CONSTRAINT members_pet_activity_factor_check
      CHECK (pet_activity_factor IS NULL OR (pet_activity_factor >= 0.5 AND pet_activity_factor <= 5.0));
  END IF;
END $$;
