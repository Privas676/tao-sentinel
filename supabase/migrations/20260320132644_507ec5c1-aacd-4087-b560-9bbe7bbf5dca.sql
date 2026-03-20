
-- Portfolio positions table (replaces localStorage)
CREATE TABLE public.portfolio_positions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  subnet_id integer NOT NULL,
  quantity_tao numeric NOT NULL DEFAULT 0,
  entry_price numeric,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, subnet_id)
);

ALTER TABLE public.portfolio_positions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own portfolio" ON public.portfolio_positions
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Users insert own portfolio" ON public.portfolio_positions
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own portfolio" ON public.portfolio_positions
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users delete own portfolio" ON public.portfolio_positions
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- Portfolio events / trade history
CREATE TABLE public.portfolio_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  subnet_id integer NOT NULL,
  action text NOT NULL,
  quantity_tao numeric,
  price numeric,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.portfolio_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own events" ON public.portfolio_events
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Users insert own events" ON public.portfolio_events
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

-- Auto-update updated_at on portfolio_positions
CREATE OR REPLACE FUNCTION public.update_portfolio_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_portfolio_updated_at
  BEFORE UPDATE ON public.portfolio_positions
  FOR EACH ROW EXECUTE FUNCTION public.update_portfolio_updated_at();
