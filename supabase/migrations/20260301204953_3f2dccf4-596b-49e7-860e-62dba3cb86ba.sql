-- Add explicit service_role-only policy to push_config so linter no longer flags it
CREATE POLICY "Service role only" ON public.push_config FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');