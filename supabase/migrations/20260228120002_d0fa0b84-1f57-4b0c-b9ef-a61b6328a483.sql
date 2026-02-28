CREATE TABLE public.whale_coldkeys (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  address text NOT NULL UNIQUE,
  label text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.whale_coldkeys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read whale_coldkeys" ON public.whale_coldkeys
  FOR SELECT USING (true);