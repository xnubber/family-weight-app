-- 新增「狗狗 (dog)」成員類型支援與自訂頭像欄位 (avatar)
-- 請於 Supabase Dashboard -> SQL Editor 執行此腳本

-- 1. 新增頭像欄位（儲存前端內建文青頭像代碼，例如 human-short、cat-orange、dog-shiba）
ALTER TABLE public.members
  ADD COLUMN IF NOT EXISTS avatar TEXT;

-- 2. 更新 members.type 的 CHECK 條件以支援 human / cat / dog
DO $$
DECLARE
  constraint_rec RECORD;
BEGIN
  FOR constraint_rec IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'public'
      AND rel.relname = 'members'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%type%'
  LOOP
    EXECUTE format('ALTER TABLE public.members DROP CONSTRAINT %I', constraint_rec.conname);
  END LOOP;
END $$;

ALTER TABLE public.members
  ADD CONSTRAINT members_type_check CHECK (type IN ('human', 'cat', 'dog'));
