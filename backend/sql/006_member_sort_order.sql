-- 新增成員顯示順序欄位（sort_order），支援總覽卡片拖拉調整順序並跨裝置雲端同步
-- 請於 Supabase Dashboard -> SQL Editor 執行此腳本

ALTER TABLE public.members
  ADD COLUMN IF NOT EXISTS sort_order INTEGER;
