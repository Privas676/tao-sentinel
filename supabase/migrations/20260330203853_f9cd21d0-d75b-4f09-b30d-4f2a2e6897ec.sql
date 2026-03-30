
-- Fix 1: push_subscriptions - change SELECT policy from public to authenticated role
DROP POLICY IF EXISTS "Users can read own subscriptions" ON public.push_subscriptions;
CREATE POLICY "Users can read own subscriptions"
ON public.push_subscriptions
FOR SELECT TO authenticated
USING (auth.uid() = user_id);

-- Fix 2: Remove audit_log from Realtime publication
ALTER PUBLICATION supabase_realtime DROP TABLE public.audit_log;

-- Fix 3: api_call_log - restrict to service_role only
DROP POLICY IF EXISTS "Authenticated read api_call_log" ON public.api_call_log;
CREATE POLICY "Service role read api_call_log"
ON public.api_call_log
FOR SELECT TO service_role
USING (true);

-- Fix 4: Make vapid_private_key column default empty (migrated to env secret)
ALTER TABLE public.push_config ALTER COLUMN vapid_private_key SET DEFAULT '';
