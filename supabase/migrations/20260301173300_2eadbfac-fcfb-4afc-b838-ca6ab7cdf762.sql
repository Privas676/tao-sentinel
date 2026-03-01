ALTER TABLE public.push_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read push_log" ON public.push_log
  FOR SELECT
  TO authenticated
  USING (true);
