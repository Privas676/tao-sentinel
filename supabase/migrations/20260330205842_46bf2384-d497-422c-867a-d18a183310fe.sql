
-- Fix 1: push_subscriptions UPDATE policy (own rows only)
DROP POLICY IF EXISTS "Users can update own subscriptions" ON public.push_subscriptions;
CREATE POLICY "Users can update own subscriptions"
ON public.push_subscriptions
FOR UPDATE TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- Fix 2: portfolio_events DELETE + UPDATE policies (own rows only)
DROP POLICY IF EXISTS "Users can update own portfolio events" ON public.portfolio_events;
CREATE POLICY "Users can update own portfolio events"
ON public.portfolio_events
FOR UPDATE TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own portfolio events" ON public.portfolio_events;
CREATE POLICY "Users can delete own portfolio events"
ON public.portfolio_events
FOR DELETE TO authenticated
USING (auth.uid() = user_id);
