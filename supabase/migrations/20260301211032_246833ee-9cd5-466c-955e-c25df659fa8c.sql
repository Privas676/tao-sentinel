-- Restrict whale_coldkeys to authenticated users only (was public read)
DROP POLICY IF EXISTS "Public read whale_coldkeys" ON public.whale_coldkeys;
CREATE POLICY "Authenticated read whale_coldkeys" ON public.whale_coldkeys
  FOR SELECT USING (auth.role() = 'authenticated');

-- Restrict whale_movements to authenticated users only (was public read)
DROP POLICY IF EXISTS "Public read whale_movements" ON public.whale_movements;
CREATE POLICY "Authenticated read whale_movements" ON public.whale_movements
  FOR SELECT USING (auth.role() = 'authenticated');