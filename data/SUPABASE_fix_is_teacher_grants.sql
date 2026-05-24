/* public.is_teacher() 修復（42501 / セキュリティ修復後）
   Supabase SQL Editor にこのファイル全文を貼り付けて Run
   先頭行は必ず CREATE から始まること（Markdown の - 1行は貼らない） */

CREATE OR REPLACE FUNCTION public.is_teacher()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles AS p
    WHERE p.user_id = auth.uid()
      AND lower(trim(coalesce(p.role, ''))) = 'teacher'
  );
$$;

COMMENT ON FUNCTION public.is_teacher() IS
  'RLS: teacher role check for auth.uid() only. EXECUTE granted to authenticated for policy evaluation.';

REVOKE ALL ON FUNCTION public.is_teacher() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_teacher() FROM anon;
GRANT EXECUTE ON FUNCTION public.is_teacher() TO authenticated;
