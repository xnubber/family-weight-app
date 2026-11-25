-- 初始化核心資料表：members（家庭與毛孩成員）與 weight_records（體重紀錄）
-- 適用於全新 Supabase 專案首次建表；具備冪等性（IF NOT EXISTS），與後續 001–005 遷移腳本完全相容
-- 請於 Supabase Dashboard -> SQL Editor 執行此腳本

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. 家庭與毛孩成員表
CREATE TABLE IF NOT EXISTS public.members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_code TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL
    CONSTRAINT members_type_check CHECK (type IN ('human', 'cat', 'dog')),
  avatar TEXT,
  breed TEXT,
  birth_date DATE,
  bcs_score SMALLINT
    CONSTRAINT members_bcs_score_check CHECK (bcs_score IS NULL OR (bcs_score >= 1 AND bcs_score <= 9)),
  pet_activity_factor NUMERIC(3, 1)
    CONSTRAINT members_pet_activity_factor_check CHECK (pet_activity_factor IS NULL OR (pet_activity_factor >= 0.5 AND pet_activity_factor <= 5.0)),
  height_cm NUMERIC(5, 1)
    CONSTRAINT members_height_cm_check CHECK (height_cm IS NULL OR (height_cm >= 20 AND height_cm <= 300)),
  target_weight NUMERIC(6, 2)
    CONSTRAINT members_target_weight_check CHECK (target_weight IS NULL OR (target_weight >= 0.1 AND target_weight <= 500)),
  hide_weight BOOLEAN NOT NULL DEFAULT FALSE,
  privacy_pin_hash TEXT,
  sort_order INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. 體重紀錄表（刪除成員時自動連帶清除其體重紀錄）
CREATE TABLE IF NOT EXISTS public.weight_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_code TEXT NOT NULL,
  member_id UUID NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  weight_kg NUMERIC(6, 2) NOT NULL
    CONSTRAINT weight_records_weight_kg_check CHECK (weight_kg >= 0.1 AND weight_kg <= 500),
  recorded_at DATE NOT NULL DEFAULT CURRENT_DATE,
  note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. 查詢效能複合索引
CREATE INDEX IF NOT EXISTS idx_members_family_created
  ON public.members (family_code, created_at);

CREATE INDEX IF NOT EXISTS idx_weight_records_family_recorded
  ON public.weight_records (family_code, recorded_at);

CREATE INDEX IF NOT EXISTS idx_weight_records_member_recorded
  ON public.weight_records (member_id, recorded_at);

-- 4. 啟用 RLS 並鎖定僅允許後端 service_role 存取（防止未授權 anon / authenticated 直接讀寫）
ALTER TABLE public.members ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.members FROM anon, authenticated;
GRANT ALL ON TABLE public.members TO service_role;

ALTER TABLE public.weight_records ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.weight_records FROM anon, authenticated;
GRANT ALL ON TABLE public.weight_records TO service_role;
