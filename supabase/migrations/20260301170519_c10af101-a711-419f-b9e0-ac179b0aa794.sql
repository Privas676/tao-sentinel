
CREATE OR REPLACE FUNCTION public.cleanup_old_snapshots()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = 'public'
AS $$
BEGIN
  DELETE FROM public.pipeline_snapshots
  WHERE ts < now() - interval '60 days';
  RETURN NEW;
END;
$$;
