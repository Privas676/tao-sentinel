CREATE POLICY "Service role insert api_call_log" ON public.api_call_log
  FOR INSERT TO service_role WITH CHECK (true);

CREATE POLICY "Service role all api_cache_state" ON public.api_cache_state
  FOR ALL TO service_role USING (true) WITH CHECK (true);