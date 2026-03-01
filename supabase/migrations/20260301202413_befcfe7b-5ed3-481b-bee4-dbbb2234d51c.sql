
-- Fix 1: Replace always-true INSERT on audit_log with service_role-only
DROP POLICY IF EXISTS "Anyone can insert audit_log" ON public.audit_log;
CREATE POLICY "Service role insert audit_log"
  ON public.audit_log FOR INSERT
  WITH CHECK (auth.role() = 'service_role');

-- Fix 2: Fix push_log SELECT that currently has USING(true) instead of auth check
DROP POLICY IF EXISTS "Authenticated read push_log" ON public.push_log;
CREATE POLICY "Authenticated read push_log"
  ON public.push_log FOR SELECT
  USING (auth.role() = 'authenticated');
