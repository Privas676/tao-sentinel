
CREATE TABLE public.subnet_stake_analytics (
  id bigint generated always as identity primary key,
  netuid integer not null references public.subnets(netuid),
  ts timestamptz not null default now(),
  holders_count integer default 0,
  stake_total numeric default 0,
  stake_concentration numeric default 0,
  top10_stake jsonb default '[]'::jsonb,
  validators_active integer default 0,
  miners_total integer default 0,
  miners_active integer default 0,
  uid_usage numeric default 0,
  large_wallet_inflow numeric default 0,
  large_wallet_outflow numeric default 0,
  raw_data jsonb
);

CREATE INDEX idx_stake_analytics_netuid_ts ON public.subnet_stake_analytics(netuid, ts DESC);

ALTER TABLE public.subnet_stake_analytics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read stake_analytics" ON public.subnet_stake_analytics
  FOR SELECT USING (true);
