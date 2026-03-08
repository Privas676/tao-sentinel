-- Restrict pipeline_snapshots to authenticated users only
DROP POLICY IF EXISTS "Public read pipeline_snapshots" ON public.pipeline_snapshots;
CREATE POLICY "Authenticated read pipeline_snapshots"
  ON public.pipeline_snapshots
  FOR SELECT
  TO authenticated
  USING (true);