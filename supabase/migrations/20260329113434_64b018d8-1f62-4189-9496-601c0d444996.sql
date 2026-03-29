ALTER TABLE public.subnets
  ADD COLUMN IF NOT EXISTS canonical_name text,
  ADD COLUMN IF NOT EXISTS display_name text,
  ADD COLUMN IF NOT EXISTS source_name text DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS name_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS name_conflict_log jsonb DEFAULT '[]'::jsonb;

UPDATE public.subnets
SET canonical_name = name,
    display_name = name,
    source_name = CASE WHEN name IS NOT NULL THEN 'taostats' ELSE 'unknown' END,
    name_updated_at = last_seen_at
WHERE canonical_name IS NULL;