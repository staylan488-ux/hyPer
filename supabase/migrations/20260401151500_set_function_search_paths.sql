ALTER FUNCTION public.save_split_snapshot(UUID, TEXT, TEXT, INTEGER, JSONB)
  SET search_path = public, pg_temp;

ALTER FUNCTION public.handle_new_user()
  SET search_path = public, pg_temp;
