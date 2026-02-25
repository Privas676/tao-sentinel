
-- Fix views to use SECURITY INVOKER
ALTER VIEW public.subnet_latest SET (security_invoker = on);
ALTER VIEW public.fx_latest SET (security_invoker = on);
ALTER VIEW public.subnet_latest_display SET (security_invoker = on);
ALTER VIEW public.signals_latest SET (security_invoker = on);

-- Drop overly permissive write policies and replace with service-role only
DROP POLICY "Service write subnets" ON public.subnets;
DROP POLICY "Service write metrics" ON public.subnet_metrics_ts;
DROP POLICY "Service write signals" ON public.signals;
DROP POLICY "Service write events" ON public.events;
DROP POLICY "Service write fx_rates" ON public.fx_rates;

-- Service role bypasses RLS automatically, so no write policies needed for edge functions
-- Edge functions use service_role key which bypasses RLS
