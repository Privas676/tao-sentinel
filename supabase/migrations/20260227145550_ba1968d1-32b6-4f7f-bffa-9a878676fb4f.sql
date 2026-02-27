
-- Positions table for portfolio tracking
CREATE TABLE public.positions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  netuid INTEGER NOT NULL REFERENCES public.subnets(netuid),
  capital NUMERIC NOT NULL,
  entry_price NUMERIC NOT NULL,
  quantity NUMERIC NOT NULL,
  stop_loss_pct NUMERIC NOT NULL DEFAULT -5,
  take_profit_pct NUMERIC NOT NULL DEFAULT 15,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  closed_at TIMESTAMP WITH TIME ZONE,
  closed_price NUMERIC,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE public.positions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own positions" ON public.positions
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own positions" ON public.positions
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own positions" ON public.positions
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own positions" ON public.positions
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- Index for fast lookup
CREATE INDEX idx_positions_user_status ON public.positions(user_id, status);
