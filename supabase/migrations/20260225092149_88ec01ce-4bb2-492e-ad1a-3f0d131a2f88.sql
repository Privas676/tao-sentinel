
-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- =============================================
-- TABLES
-- =============================================

CREATE TABLE public.subnets (
  netuid int PRIMARY KEY,
  name text,
  first_seen_at timestamptz DEFAULT now(),
  last_seen_at timestamptz DEFAULT now()
);

CREATE TABLE public.subnet_metrics_ts (
  id bigserial PRIMARY KEY,
  netuid int NOT NULL REFERENCES public.subnets(netuid),
  ts timestamptz NOT NULL,
  price numeric,
  cap numeric,
  liquidity numeric,
  vol_24h numeric,
  vol_cap numeric,
  flow_1m numeric,
  flow_3m numeric,
  flow_5m numeric,
  daily_chain_buys_1m numeric,
  daily_chain_buys_3m numeric,
  daily_chain_buys_5m numeric,
  miners_active numeric,
  top_miners_share numeric,
  source text,
  raw_payload jsonb
);

CREATE INDEX idx_subnet_metrics_ts_netuid_ts ON public.subnet_metrics_ts (netuid, ts DESC);

CREATE TABLE public.signals (
  netuid int PRIMARY KEY REFERENCES public.subnets(netuid),
  ts timestamptz NOT NULL,
  state text CHECK (state IN ('GO','GO_SPECULATIVE','HOLD','WATCH','NO','EXIT_FAST')),
  score int,
  reasons jsonb,
  miner_filter text CHECK (miner_filter IN ('PASS','WARN','FAIL')),
  last_state_change_at timestamptz,
  last_notified_at timestamptz
);

CREATE TABLE public.events (
  id bigserial PRIMARY KEY,
  netuid int,
  ts timestamptz DEFAULT now(),
  type text CHECK (type IN ('CREATED','GO','GO_SPECULATIVE','HOLD','EXIT_FAST','DEPEG_WARNING','DEPEG_CRITICAL')),
  severity int,
  evidence jsonb
);

CREATE INDEX idx_events_ts ON public.events (ts DESC);
CREATE INDEX idx_events_netuid_ts ON public.events (netuid, ts DESC);

CREATE TABLE public.fx_rates (
  ts timestamptz PRIMARY KEY,
  tao_usd numeric NOT NULL
);

CREATE INDEX idx_fx_rates_ts ON public.fx_rates (ts DESC);

-- =============================================
-- RLS - Public read access (no auth required for this app)
-- =============================================

ALTER TABLE public.subnets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read subnets" ON public.subnets FOR SELECT USING (true);

ALTER TABLE public.subnet_metrics_ts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read metrics" ON public.subnet_metrics_ts FOR SELECT USING (true);

ALTER TABLE public.signals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read signals" ON public.signals FOR SELECT USING (true);

ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read events" ON public.events FOR SELECT USING (true);

ALTER TABLE public.fx_rates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read fx_rates" ON public.fx_rates FOR SELECT USING (true);

-- Service role policies for edge functions to write
CREATE POLICY "Service write subnets" ON public.subnets FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service write metrics" ON public.subnet_metrics_ts FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service write signals" ON public.signals FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service write events" ON public.events FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service write fx_rates" ON public.fx_rates FOR ALL USING (true) WITH CHECK (true);

-- =============================================
-- VIEWS
-- =============================================

CREATE OR REPLACE VIEW public.subnet_latest AS
SELECT DISTINCT ON (netuid) *
FROM public.subnet_metrics_ts
ORDER BY netuid, ts DESC;

CREATE OR REPLACE VIEW public.fx_latest AS
SELECT * FROM public.fx_rates ORDER BY ts DESC LIMIT 1;

CREATE OR REPLACE VIEW public.subnet_latest_display AS
SELECT
  m.*,
  f.tao_usd,
  m.price * f.tao_usd AS price_usd,
  m.cap * f.tao_usd AS cap_usd,
  m.liquidity * f.tao_usd AS liquidity_usd,
  m.vol_24h * f.tao_usd AS vol_24h_usd
FROM public.subnet_latest m
CROSS JOIN public.fx_latest f;

CREATE OR REPLACE VIEW public.signals_latest AS
SELECT
  s.*,
  sub.name AS subnet_name,
  f.tao_usd
FROM public.signals s
LEFT JOIN public.subnets sub ON s.netuid = sub.netuid
CROSS JOIN public.fx_latest f;

-- Enable realtime for signals and events
ALTER PUBLICATION supabase_realtime ADD TABLE public.signals;
ALTER PUBLICATION supabase_realtime ADD TABLE public.events;
