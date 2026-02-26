ALTER TABLE public.subnet_metrics_ts ADD COLUMN IF NOT EXISTS flow_6m numeric DEFAULT NULL;
ALTER TABLE public.subnet_metrics_ts ADD COLUMN IF NOT EXISTS flow_15m numeric DEFAULT NULL;