
-- Drop old table
DROP TABLE IF EXISTS public.social_kols CASCADE;

-- A. social_accounts
CREATE TABLE public.social_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  handle text UNIQUE NOT NULL,
  display_name text,
  platform text NOT NULL DEFAULT 'x',
  category text NOT NULL DEFAULT 'influencer' CHECK (category IN ('official','influencer','builder','fund','media')),
  tier text NOT NULL DEFAULT 'C' CHECK (tier IN ('A','B','C')),
  influence_weight numeric NOT NULL DEFAULT 0.70,
  credibility_score numeric NOT NULL DEFAULT 0.70,
  accuracy_history numeric NOT NULL DEFAULT 0.50,
  false_positive_rate numeric NOT NULL DEFAULT 0.00,
  is_active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.social_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read social_accounts" ON public.social_accounts FOR SELECT TO public USING (true);
CREATE POLICY "Auth insert social_accounts" ON public.social_accounts FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Auth update social_accounts" ON public.social_accounts FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Auth delete social_accounts" ON public.social_accounts FOR DELETE TO authenticated USING (true);

-- B. social_posts
CREATE TABLE public.social_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.social_accounts(id) ON DELETE CASCADE,
  external_post_id text UNIQUE,
  posted_at timestamptz NOT NULL DEFAULT now(),
  raw_text text,
  clean_text text,
  language text DEFAULT 'en',
  post_type text NOT NULL DEFAULT 'original' CHECK (post_type IN ('original','reply','quote','repost')),
  url text,
  like_count integer NOT NULL DEFAULT 0,
  reply_count integer NOT NULL DEFAULT 0,
  repost_count integer NOT NULL DEFAULT 0,
  view_count integer NOT NULL DEFAULT 0,
  engagement_score numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.social_posts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read social_posts" ON public.social_posts FOR SELECT TO public USING (true);

-- C. social_post_mentions
CREATE TABLE public.social_post_mentions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES public.social_posts(id) ON DELETE CASCADE,
  subnet_uid integer NOT NULL,
  subnet_name text,
  mention_type text NOT NULL DEFAULT 'direct_uid' CHECK (mention_type IN ('direct_uid','direct_name','implicit','ticker_like')),
  sentiment text NOT NULL DEFAULT 'neutral' CHECK (sentiment IN ('bullish','neutral','bearish')),
  conviction_level numeric NOT NULL DEFAULT 0,
  self_mention boolean NOT NULL DEFAULT false,
  confidence_extraction numeric NOT NULL DEFAULT 0.50,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.social_post_mentions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read social_post_mentions" ON public.social_post_mentions FOR SELECT TO public USING (true);

-- D. social_subnet_scores
CREATE TABLE public.social_subnet_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subnet_uid integer NOT NULL,
  score_date date NOT NULL DEFAULT CURRENT_DATE,
  raw_mention_count integer NOT NULL DEFAULT 0,
  unique_account_count integer NOT NULL DEFAULT 0,
  weighted_bullish_score numeric NOT NULL DEFAULT 0,
  weighted_bearish_score numeric NOT NULL DEFAULT 0,
  social_conviction_score numeric NOT NULL DEFAULT 0,
  social_heat_score numeric NOT NULL DEFAULT 0,
  pump_risk_score numeric NOT NULL DEFAULT 0,
  smart_kol_score numeric NOT NULL DEFAULT 0,
  narrative_strength numeric NOT NULL DEFAULT 0,
  final_social_signal text NOT NULL DEFAULT 'none' CHECK (final_social_signal IN ('none','watch','bullish','bearish','pump_risk')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (subnet_uid, score_date)
);
ALTER TABLE public.social_subnet_scores ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read social_subnet_scores" ON public.social_subnet_scores FOR SELECT TO public USING (true);

-- E. social_alerts
CREATE TABLE public.social_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subnet_uid integer NOT NULL,
  alert_type text NOT NULL CHECK (alert_type IN ('kol_call','multi_account_buzz','pump_risk','bearish_warning','official_mention','fund_signal','builder_update')),
  title text NOT NULL,
  description text,
  severity text NOT NULL DEFAULT 'info' CHECK (severity IN ('info','watch','high')),
  source_count integer NOT NULL DEFAULT 1,
  weighted_score numeric NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.social_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read social_alerts" ON public.social_alerts FOR SELECT TO public USING (true);
