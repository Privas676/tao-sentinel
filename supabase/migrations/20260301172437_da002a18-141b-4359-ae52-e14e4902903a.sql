
-- Push log table for idempotent, deduplicated push notifications
CREATE TABLE public.push_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id text NOT NULL,
  priority smallint NOT NULL DEFAULT 3,
  event_type text NOT NULL,
  netuid integer,
  subscription_id uuid REFERENCES public.push_subscriptions(id) ON DELETE CASCADE,
  endpoint text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  http_status smallint,
  retry_count smallint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  last_retry_at timestamptz,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_message text
);

-- Unique constraint: one push per eventId per subscription endpoint
CREATE UNIQUE INDEX idx_push_log_dedup ON public.push_log (event_id, endpoint);

-- Index for retry queries
CREATE INDEX idx_push_log_pending ON public.push_log (status) WHERE status IN ('pending', 'retry');

-- Index for cleanup
CREATE INDEX idx_push_log_created ON public.push_log (created_at);

-- Auto-cleanup: keep 30 days
CREATE OR REPLACE FUNCTION public.cleanup_old_push_log()
RETURNS trigger LANGUAGE plpgsql
SECURITY INVOKER SET search_path = 'public' AS $$
BEGIN
  DELETE FROM public.push_log WHERE created_at < now() - interval '30 days';
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_cleanup_push_log
AFTER INSERT ON public.push_log
FOR EACH STATEMENT
EXECUTE FUNCTION public.cleanup_old_push_log();

-- RLS: service role only (edge functions use service role key)
ALTER TABLE public.push_log ENABLE ROW LEVEL SECURITY;

-- Allow service role insert/select/update (via service key, bypasses RLS)
-- No public policies needed - only edge functions access this table
