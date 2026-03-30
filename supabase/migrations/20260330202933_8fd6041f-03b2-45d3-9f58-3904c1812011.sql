
-- Fix 1: push_subscriptions - add INSERT and DELETE policies scoped to user
CREATE POLICY "Users can insert own subscriptions"
ON public.push_subscriptions
FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own subscriptions"
ON public.push_subscriptions
FOR DELETE TO authenticated
USING (auth.uid() = user_id);

-- Fix 2: api_call_log - restrict from public to authenticated
DROP POLICY IF EXISTS "Public read api_call_log" ON public.api_call_log;
CREATE POLICY "Authenticated read api_call_log"
ON public.api_call_log
FOR SELECT TO authenticated
USING (true);

-- Fix 3: social_accounts - tighten INSERT/UPDATE/DELETE to service_role only
DROP POLICY IF EXISTS "Auth insert social_accounts" ON public.social_accounts;
DROP POLICY IF EXISTS "Auth update social_accounts" ON public.social_accounts;
DROP POLICY IF EXISTS "Auth delete social_accounts" ON public.social_accounts;

CREATE POLICY "Service role insert social_accounts"
ON public.social_accounts
FOR INSERT TO service_role
WITH CHECK (true);

CREATE POLICY "Service role update social_accounts"
ON public.social_accounts
FOR UPDATE TO service_role
USING (true) WITH CHECK (true);

CREATE POLICY "Service role delete social_accounts"
ON public.social_accounts
FOR DELETE TO service_role
USING (true);
