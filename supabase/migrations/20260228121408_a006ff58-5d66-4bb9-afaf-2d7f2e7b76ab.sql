CREATE TABLE public.whale_movements (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  coldkey_address text NOT NULL REFERENCES public.whale_coldkeys(address),
  direction text NOT NULL CHECK (direction IN ('IN', 'OUT')),
  amount_tao numeric NOT NULL,
  counterparty text,
  netuid integer,
  tx_hash text UNIQUE,
  block_number bigint,
  detected_at timestamp with time zone NOT NULL DEFAULT now(),
  raw_payload jsonb
);

ALTER TABLE public.whale_movements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read whale_movements" ON public.whale_movements
  FOR SELECT USING (true);

CREATE INDEX idx_whale_movements_detected ON public.whale_movements(detected_at DESC);
CREATE INDEX idx_whale_movements_coldkey ON public.whale_movements(coldkey_address);