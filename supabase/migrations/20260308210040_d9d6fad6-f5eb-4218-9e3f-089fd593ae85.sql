-- Fix 1: push_log - scope authenticated reads to user's own subscriptions only
DROP POLICY IF EXISTS "Authenticated read push_log" ON public.push_log;
CREATE POLICY "Users read own push_log"
  ON public.push_log
  FOR SELECT
  TO authenticated
  USING (
    subscription_id IN (
      SELECT id FROM public.push_subscriptions WHERE user_id = auth.uid()
    )
  );

-- Fix 2: audit_log - restrict reads to service_role only (pipeline internals)
DROP POLICY IF EXISTS "Authenticated read audit_log" ON public.audit_log;
CREATE POLICY "Service role read audit_log"
  ON public.audit_log
  FOR SELECT
  TO service_role
  USING (true);