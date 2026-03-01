
-- Audit log table for scoring and alert decisions
CREATE TABLE public.audit_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ts timestamp with time zone NOT NULL DEFAULT now(),
  engine_version text NOT NULL DEFAULT 'v4',
  event_type text NOT NULL CHECK (event_type IN ('SCORING_CYCLE', 'ALERT_FIRED', 'STATE_CHANGE', 'KILL_SWITCH')),
  snapshot_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  subnet_count integer,
  -- Per-subnet detail (for ALERT_FIRED / STATE_CHANGE)
  netuid integer,
  -- Inputs summary
  inputs jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Outputs summary  
  outputs jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Top factors that drove the decision
  top_factors jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Human-readable decision reason
  decision_reason text,
  -- Data confidence at time of decision
  data_confidence integer,
  -- Alignment status
  alignment_status text,
  -- Kill switch state
  kill_switch_active boolean DEFAULT false,
  kill_switch_triggers jsonb DEFAULT '[]'::jsonb
);

-- Index for time-range queries (replay mode)
CREATE INDEX idx_audit_log_ts ON public.audit_log (ts DESC);
CREATE INDEX idx_audit_log_netuid ON public.audit_log (netuid) WHERE netuid IS NOT NULL;
CREATE INDEX idx_audit_log_event_type ON public.audit_log (event_type);

-- RLS: public read, service-role write
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read audit_log" ON public.audit_log
  FOR SELECT USING (true);

-- Enable realtime for audit_log
ALTER PUBLICATION supabase_realtime ADD TABLE public.audit_log;
