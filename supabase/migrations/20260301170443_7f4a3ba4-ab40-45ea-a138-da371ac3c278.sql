
-- Pipeline snapshots: stores full pipeline outputs + raw metrics per tick
CREATE TABLE public.pipeline_snapshots (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ts timestamptz NOT NULL DEFAULT now(),
  snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  subnet_count integer,
  engine_version text NOT NULL DEFAULT 'v4'
);

-- Index for range queries
CREATE INDEX idx_pipeline_snapshots_ts ON public.pipeline_snapshots (ts DESC);

-- RLS: public read, service-role insert only
ALTER TABLE public.pipeline_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read pipeline_snapshots"
  ON public.pipeline_snapshots FOR SELECT
  USING (true);

-- Auto-cleanup: delete snapshots older than 60 days
CREATE OR REPLACE FUNCTION public.cleanup_old_snapshots()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM public.pipeline_snapshots
  WHERE ts < now() - interval '60 days';
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_cleanup_snapshots
  AFTER INSERT ON public.pipeline_snapshots
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.cleanup_old_snapshots();
