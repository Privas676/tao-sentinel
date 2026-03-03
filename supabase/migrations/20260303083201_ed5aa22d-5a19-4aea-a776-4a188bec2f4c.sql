-- Allow authenticated users to read push_log (they need to see their push history in the dashboard)
CREATE POLICY "Authenticated read push_log"
ON public.push_log
FOR SELECT
TO authenticated
USING (true);
