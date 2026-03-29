-- API call tracking for rate-limit observability
CREATE TABLE IF NOT EXISTS public.api_call_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ts timestamptz NOT NULL DEFAULT now(),
  function_name text NOT NULL,
  endpoint text NOT NULL,
  status_code smallint,
  cached boolean NOT NULL DEFAULT false,
  deduplicated boolean NOT NULL DEFAULT false,
  rate_limited boolean NOT NULL DEFAULT false,
  response_ms integer,
  error_message text,
  metadata jsonb DEFAULT '{}'::jsonb
);

-- Index for analytics queries
CREATE INDEX idx_api_call_log_ts ON public.api_call_log (ts DESC);
CREATE INDEX idx_api_call_log_fn ON public.api_call_log (function_name, ts DESC);

-- Auto-cleanup older than 7 days
CREATE OR REPLACE FUNCTION public.cleanup_old_api_logs()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  DELETE FROM public.api_call_log WHERE ts < now() - interval '7 days';
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_cleanup_api_logs
  AFTER INSERT ON public.api_call_log
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.cleanup_old_api_logs();

-- RLS: service_role write, public read for diagnostics
ALTER TABLE public.api_call_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read api_call_log" ON public.api_call_log
  FOR SELECT TO public USING (true);

-- Cache tracking table for TTL-based deduplication
CREATE TABLE IF NOT EXISTS public.api_cache_state (
  cache_key text PRIMARY KEY,
  last_fetched_at timestamptz NOT NULL DEFAULT now(),
  ttl_minutes integer NOT NULL DEFAULT 5,
  function_name text NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb
);

ALTER TABLE public.api_cache_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read api_cache_state" ON public.api_cache_state
  FOR SELECT TO public USING (true);