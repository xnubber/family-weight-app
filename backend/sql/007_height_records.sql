-- 新增小孩／家人身高成長追蹤欄位與身高歷史紀錄表
-- 具備冪等性（IF NOT EXISTS），請於 Supabase Dashboard -> SQL Editor 執行此腳本

-- 1. 於 members 表新增「追蹤身高成長」開關欄位（僅家人使用，預設關閉）
ALTER TABLE public.members
  ADD COLUMN IF NOT EXISTS track_height BOOLEAN NOT NULL DEFAULT FALSE;

-- 2. 建立身高歷史紀錄表（刪除成員時自動連帶清除其身高紀錄）
CREATE TABLE IF NOT EXISTS public.height_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_code TEXT NOT NULL,
  member_id UUID NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  height_cm NUMERIC(5, 1) NOT NULL
    CONSTRAINT height_records_height_cm_check CHECK (height_cm >= 20 AND height_cm <= 300),
  recorded_at DATE NOT NULL DEFAULT CURRENT_DATE,
  note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. 查詢效能複合索引
CREATE INDEX IF NOT EXISTS idx_height_records_family_recorded
  ON public.height_records (family_code, recorded_at);

CREATE INDEX IF NOT EXISTS idx_height_records_member_recorded
  ON public.height_records (member_id, recorded_at);

-- 4. 啟用 RLS 並鎖定僅允許後端 service_role 存取
ALTER TABLE public.height_records ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.height_records FROM anon, authenticated;
GRANT ALL ON TABLE public.height_records TO service_role;
