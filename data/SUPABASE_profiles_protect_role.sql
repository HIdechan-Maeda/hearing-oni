/*
 * profiles.role の自己昇格を防ぐ（Supabase SQL Editor で実行）
 * 前提: public.profiles テーブルが存在すること
 *
 * 一般ユーザー: role の新規指定・変更不可
 * service_role（Dashboard / サーバー API）: teacher 付与可
 */

CREATE OR REPLACE FUNCTION public.profiles_guard_role()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  jwt_role text;
  new_role text;
  old_role text;
BEGIN
  jwt_role := coalesce(current_setting('request.jwt.claim.role', true), '');

  IF jwt_role = 'service_role' THEN
    RETURN NEW;
  END IF;

  new_role := lower(trim(coalesce(NEW.role, '')));

  IF TG_OP = 'INSERT' THEN
    IF new_role = 'teacher' THEN
      RAISE EXCEPTION 'profiles.role cannot be set to teacher by users'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    old_role := lower(trim(coalesce(OLD.role, '')));
    IF new_role IS DISTINCT FROM old_role THEN
      RAISE EXCEPTION 'profiles.role cannot be changed by users'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.profiles_guard_role() IS
  'profiles.role の自己昇格防止。service_role のみ teacher 付与・変更可。';

DROP TRIGGER IF EXISTS profiles_guard_role_trigger ON public.profiles;

CREATE TRIGGER profiles_guard_role_trigger
  BEFORE INSERT OR UPDATE OF role ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.profiles_guard_role();
