-- 建立目標體重歷史紀錄表（支援追蹤每次設定／變更目標體重的生效日期）
-- 請於 Supabase Dashboard -> SQL Editor 執行此腳本

CREATE TABLE IF NOT EXISTS target_weight_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_code TEXT NOT NULL,
  member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  target_weight NUMERIC(6, 2),
  effective_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_target_weight_history_family_member_date
  ON target_weight_history (family_code, member_id, effective_date, created_at);

-- 啟用 RLS 並明確授權後端 service_role 讀寫權限（同時避免未授權角色直接存取）
ALTER TABLE public.target_weight_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.target_weight_history FROM anon, authenticated;
GRANT ALL ON TABLE public.target_weight_history TO service_role;

-- 將既有已設定目標體重的成員回填一筆初始歷史紀錄（避免重複回填）
INSERT INTO target_weight_history (family_code, member_id, target_weight, effective_date)
SELECT
  m.family_code,
  m.id,
  m.target_weight,
  COALESCE(m.created_at::date, CURRENT_DATE)
FROM members m
WHERE m.target_weight IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM target_weight_history h
    WHERE h.member_id = m.id
  );
