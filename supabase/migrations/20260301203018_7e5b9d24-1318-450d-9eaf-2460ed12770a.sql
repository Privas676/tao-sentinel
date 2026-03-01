
-- Fix push_subscriptions: restrict SELECT to own subscriptions only (not all authenticated users)
DROP POLICY IF EXISTS "Authenticated users can count subscriptions" ON public.push_subscriptions;
CREATE POLICY "Users can read own subscriptions"
  ON public.push_subscriptions FOR SELECT
  USING (auth.uid() = user_id);

-- Fix push_log: restrict to service_role only (dashboard metrics via edge functions)
DROP POLICY IF EXISTS "Authenticated read push_log" ON public.push_log;
CREATE POLICY "Service role read push_log"
  ON public.push_log FOR SELECT
  USING (auth.role() = 'service_role');
