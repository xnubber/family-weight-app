-- 新增個別成員體重隱私保護欄位（hide_weight）與選配個人 PIN 密碼雜湊（privacy_pin_hash）
-- 請於 Supabase Dashboard -> SQL Editor 執行此腳本

ALTER TABLE public.members
  ADD COLUMN IF NOT EXISTS hide_weight BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS privacy_pin_hash TEXT;
