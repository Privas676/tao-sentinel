
-- Drop the existing public read policy
DROP POLICY IF EXISTS "Public read audit_log" ON public.audit_log;

-- Create a new policy restricting SELECT to authenticated users only
CREATE POLICY "Authenticated read audit_log"
  ON public.audit_log
  FOR SELECT
  USING (auth.role() = 'authenticated');
