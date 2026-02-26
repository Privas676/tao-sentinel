
-- Add MPI and confidence columns to signals
ALTER TABLE public.signals ADD COLUMN IF NOT EXISTS mpi integer;
ALTER TABLE public.signals ADD COLUMN IF NOT EXISTS confidence_pct integer;
ALTER TABLE public.signals ADD COLUMN IF NOT EXISTS quality_score integer;

-- Update check constraint to include EARLY
ALTER TABLE public.signals DROP CONSTRAINT IF EXISTS signals_state_check;
ALTER TABLE public.signals ADD CONSTRAINT signals_state_check CHECK (state = ANY (ARRAY['GO', 'GO_SPECULATIVE', 'HOLD', 'WATCH', 'NO', 'EXIT_FAST', 'BREAK', 'EARLY']));

-- Create daily price history for sparklines
CREATE TABLE IF NOT EXISTS public.subnet_price_daily (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  netuid integer NOT NULL REFERENCES public.subnets(netuid),
  date date NOT NULL,
  price_close numeric,
  price_high numeric,
  price_low numeric,
  UNIQUE(netuid, date)
);

ALTER TABLE public.subnet_price_daily ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read subnet_price_daily" ON public.subnet_price_daily FOR SELECT USING (true);

-- Recreate signals_latest view to include new columns
DROP VIEW IF EXISTS public.signals_latest;
CREATE VIEW public.signals_latest AS
SELECT s.netuid, s.ts, s.state, s.score, s.mpi, s.confidence_pct, s.quality_score,
       s.reasons, s.miner_filter, s.last_state_change_at, s.last_notified_at,
       sub.name AS subnet_name, f.tao_usd
FROM signals s
LEFT JOIN subnets sub ON s.netuid = sub.netuid
CROSS JOIN fx_latest f;
