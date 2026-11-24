-- 建立查詢效能複合索引（加速家庭資料載入、近兩年區間篩選與舊資料清理）
-- 請於 Supabase Dashboard -> SQL Editor 執行此腳本（具備冪等性，可安心重複執行）

-- 1. 加速讀取指定家庭成員清單並依建立時間排序
CREATE INDEX IF NOT EXISTS idx_members_family_created
  ON public.members (family_code, created_at);

-- 2. 加速讀取指定家庭近兩年體重紀錄與過期資料清理
CREATE INDEX IF NOT EXISTS idx_weight_records_family_recorded
  ON public.weight_records (family_code, recorded_at);

-- 3. 加速單一成員體重查詢與刪除成員時的關聯清理
CREATE INDEX IF NOT EXISTS idx_weight_records_member_recorded
  ON public.weight_records (member_id, recorded_at);
