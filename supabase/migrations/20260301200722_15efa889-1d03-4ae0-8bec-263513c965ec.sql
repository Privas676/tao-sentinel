
-- 1. Fix push_config: remove public SELECT that exposes vapid_private_key
--    Edge functions use service_role key which bypasses RLS, so no public policy needed
DROP POLICY IF EXISTS "Anyone can read vapid public key" ON public.push_config;

-- 2. Fix push_subscriptions: remove overly permissive policies
--    All operations go through edge functions with service_role key
DROP POLICY IF EXISTS "Anyone can read own push subscription by endpoint" ON public.push_subscriptions;
DROP POLICY IF EXISTS "Anyone can insert push subscriptions" ON public.push_subscriptions;
DROP POLICY IF EXISTS "Anyone can delete own push subscription by endpoint" ON public.push_subscriptions;

-- 3. Add restricted SELECT for authenticated users (needed by PushLogDashboard count query)
CREATE POLICY "Authenticated users can count subscriptions"
  ON public.push_subscriptions
  FOR SELECT
  USING (auth.role() = 'authenticated');
