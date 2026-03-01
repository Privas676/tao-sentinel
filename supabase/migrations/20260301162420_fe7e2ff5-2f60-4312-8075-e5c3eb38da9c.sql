
CREATE POLICY "Anyone can insert audit_log" ON public.audit_log
  FOR INSERT WITH CHECK (true);
