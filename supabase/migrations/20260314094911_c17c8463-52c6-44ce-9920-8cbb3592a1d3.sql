
-- Social KOL tracker table
CREATE TABLE public.social_kols (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  handle text NOT NULL UNIQUE,
  display_name text,
  tier text NOT NULL DEFAULT 'C' CHECK (tier IN ('A', 'B', 'C')),
  influence_weight numeric NOT NULL DEFAULT 0.65 CHECK (influence_weight >= 0 AND influence_weight <= 1),
  category text NOT NULL DEFAULT 'influencer' CHECK (category IN ('official', 'influencer', 'builder', 'fund', 'media')),
  is_active boolean NOT NULL DEFAULT true,
  self_mention boolean NOT NULL DEFAULT false,
  credibility_score numeric DEFAULT NULL,
  accuracy_history jsonb DEFAULT '[]'::jsonb,
  false_positive_rate numeric DEFAULT NULL,
  last_seen_at timestamptz DEFAULT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- RLS: public read, authenticated manage
ALTER TABLE public.social_kols ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read social_kols" ON public.social_kols
  FOR SELECT TO public USING (true);

CREATE POLICY "Authenticated insert social_kols" ON public.social_kols
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated update social_kols" ON public.social_kols
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated delete social_kols" ON public.social_kols
  FOR DELETE TO authenticated USING (true);
