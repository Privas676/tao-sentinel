
-- Table: External delist priority list (top 10 deregistration candidates)
CREATE TABLE public.external_delist_priority (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  netuid integer NOT NULL,
  subnet_name text,
  delist_rank integer NOT NULL,
  source text NOT NULL DEFAULT 'manual_seed',
  detected_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  is_active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(netuid)
);

-- Table: External delist watch list (at-risk subnets)
CREATE TABLE public.external_delist_watch (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  netuid integer NOT NULL,
  subnet_name text,
  source text NOT NULL DEFAULT 'manual_seed',
  detected_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  is_active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(netuid)
);

-- Table: External delist events (history log)
CREATE TABLE public.external_delist_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  netuid integer NOT NULL,
  event_type text NOT NULL, -- 'added_priority', 'added_watch', 'rank_changed', 'promoted_to_priority', 'removed', 'source_unavailable'
  old_value text,
  new_value text,
  source text NOT NULL DEFAULT 'manual_seed',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Table: External Taoflute metrics (scraped data)
CREATE TABLE public.external_taoflute_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  netuid integer NOT NULL,
  liq_price numeric,
  liq_haircut numeric,
  flags jsonb DEFAULT '[]'::jsonb,
  raw_data jsonb DEFAULT '{}'::jsonb,
  source text NOT NULL DEFAULT 'taoflute_scrape',
  scraped_at timestamptz NOT NULL DEFAULT now(),
  is_stale boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(netuid)
);

-- RLS: public read for all tables
ALTER TABLE public.external_delist_priority ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.external_delist_watch ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.external_delist_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.external_taoflute_metrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read external_delist_priority" ON public.external_delist_priority FOR SELECT TO public USING (true);
CREATE POLICY "Public read external_delist_watch" ON public.external_delist_watch FOR SELECT TO public USING (true);
CREATE POLICY "Public read external_delist_events" ON public.external_delist_events FOR SELECT TO public USING (true);
CREATE POLICY "Public read external_taoflute_metrics" ON public.external_taoflute_metrics FOR SELECT TO public USING (true);
