import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  computeRadarScores,
  computeFundamentalsScore,
  checkAlerts,
  type StakeSnapshot,
  type StakeDeltas,
  type RadarScores,
  type RadarAlerts,
  type PriceContext,
} from "@/lib/stake-analytics";

export type SubnetRadarData = {
  netuid: number;
  subnetName: string;
  snapshot: StakeSnapshot;
  deltas: StakeDeltas;
  scores: RadarScores;
  alerts: RadarAlerts;
  priceContext: PriceContext;
  stakeChange24hPct: number;
  stakeChange7dPct: number;
  sparklineCapital: number[];
  sparklineAdoption: number[];
};

function median(arr: number[]): number {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function useStakeAnalytics() {
  return useQuery({
    queryKey: ["stake-analytics"],
    queryFn: async () => {
      // Fetch latest stake analytics per subnet
      const { data: analytics, error } = await (supabase as any)
        .from("subnet_stake_analytics")
        .select("*")
        .order("ts", { ascending: false })
        .limit(500);

      if (error) throw error;

      // Dedupe to latest per netuid
      const latest = new Map<number, any>();
      for (const row of analytics || []) {
        if (!latest.has(row.netuid)) latest.set(row.netuid, row);
      }

      const ts7dAgo = new Date(Date.now() - 7 * 86400_000).toISOString();

      const [hist7d, histTimeSeries, metricsLatest] = await Promise.all([
        (supabase as any)
          .from("subnet_stake_analytics")
          .select("netuid, holders_count, stake_total, miners_active, validators_active")
          .lte("ts", ts7dAgo)
          .order("ts", { ascending: false })
          .limit(500),
        (supabase as any)
          .from("subnet_stake_analytics")
          .select("netuid, stake_total, holders_count, miners_active, ts")
          .gte("ts", ts7dAgo)
          .order("ts", { ascending: true })
          .limit(1000),
        // Latest metrics for price, liquidity, cap, vol, raw_payload
        supabase
          .from("subnet_latest_display")
          .select("netuid, price, liquidity, cap, vol_24h, raw_payload"),
      ]);

      const dedup = (rows: any[]) => {
        const m = new Map<number, any>();
        for (const r of rows || []) {
          if (!m.has(r.netuid)) m.set(r.netuid, r);
        }
        return m;
      };

      const map7d = dedup(hist7d.data || []);
      const metricsMap = dedup(metricsLatest.data || []);

      // Build time-series per netuid for sparklines
      const timeSeriesMap = new Map<number, { stake: number; holders: number; miners: number; ts: string }[]>();
      for (const row of histTimeSeries.data || []) {
        const arr = timeSeriesMap.get(row.netuid) || [];
        arr.push({
          stake: Number(row.stake_total) || 0,
          holders: row.holders_count || 0,
          miners: row.miners_active || 0,
          ts: row.ts,
        });
        timeSeriesMap.set(row.netuid, arr);
      }

      // Fetch subnet names
      const { data: subnets } = await supabase
        .from("subnets")
        .select("netuid, name");
      const nameMap = new Map<number, string>();
      for (const s of subnets || []) {
        nameMap.set(s.netuid, s.name || `SN-${s.netuid}`);
      }

      // First pass: build snapshots, deltas, and price contexts
      type PreCompute = {
        netuid: number;
        snapshot: StakeSnapshot;
        deltas: StakeDeltas;
        priceContext: PriceContext;
        fundamentalsScore: number;
        sparklineCapital: number[];
        sparklineAdoption: number[];
      };

      const preComputed: PreCompute[] = [];

      for (const [netuid, row] of latest) {
        const prev7d = map7d.get(netuid);
        const rawData = row.raw_data || {};
        const metrics = metricsMap.get(netuid);
        const rawPayload = (metrics?.raw_payload as any) || {};

        // Use raw_data from stake_analytics (enriched by edge function)
        const stakeTotal = Number(rawData.alpha_staked || row.stake_total) || Number(rawPayload.alpha_staked || 0) / 1e9;

        const snapshot: StakeSnapshot = {
          netuid,
          holdersCount: row.holders_count || 0,
          stakeTotal,
          stakeConcentration: Number(row.stake_concentration) || 0,
          top10Stake: row.top10_stake || [],
          validatorsActive: row.validators_active || 0,
          minersTotal: row.miners_total || 0,
          minersActive: row.miners_active || 0,
          uidUsage: Number(row.uid_usage) || 0,
          largeWalletInflow: Number(row.large_wallet_inflow) || 0,
          largeWalletOutflow: Number(row.large_wallet_outflow) || 0,
        };

        const stakeNow = stakeTotal;
        const stake7d = Number(prev7d?.stake_total) || stakeNow;
        const holdersNow = row.holders_count || 0;
        const holders7d = prev7d?.holders_count || holdersNow;
        const minersNow = row.miners_active || 0;
        const miners7d = prev7d?.miners_active || minersNow;
        const validatorsNow = row.validators_active || 0;
        const validators7d = prev7d?.validators_active || validatorsNow;

        const deltas: StakeDeltas = {
          stakeChange24h: 0,
          stakeChange7d: stake7d > 0 ? (stakeNow - stake7d) / stake7d : 0,
          holdersGrowth7d: holders7d > 0 ? (holdersNow - holders7d) / holders7d : 0,
          holdersGrowth30d: 0,
          minersGrowth7d: miners7d > 0 ? (minersNow - miners7d) / miners7d : 0,
          validatorsGrowth7d: validators7d > 0 ? (validatorsNow - validators7d) / validators7d : 0,
        };

        // Build price context from raw_data (edge function enriched) + subnet_latest_display
        const emission = Number(rawData.emission || 0);
        const emissionShare = Number(rawData.emission_share || 0);
        const marketCap = Number(rawData.market_cap || metrics?.cap || 0);
        const vol24h = Number(rawData.vol_24h || metrics?.vol_24h || 0);
        const currentPrice = Number(rawData.price || metrics?.price || 0);
        const priceChange1d = Number(rawData.price_change_1d || rawPayload?.price_change_1_day || 0);
        const priceChange7d = Number(rawData.price_change_1w || rawPayload?.price_change_1_week || 0);
        const priceChange30d = Number(rawData.price_change_1m || rawPayload?.price_change_1_month || 0);
        const fearGreed = Number(rawData.fear_greed || rawPayload?.fear_and_greed_index || 50);

        const priceContext: PriceContext = {
          priceChange1d,
          priceChange7d,
          priceChange30d,
          currentPrice,
          liquidity: Number(metrics?.liquidity) || 0,
          emission,
          emissionShare,
          marketCap,
          vol24h,
          fearGreed,
        };

        const fundamentalsScore = computeFundamentalsScore(snapshot, priceContext);

        // Build sparkline data from time-series
        const series = timeSeriesMap.get(netuid) || [];
        const sparklineCapital = series.length >= 2 ? series.map((s) => s.stake) : [];
        const sparklineAdoption = series.length >= 2 ? series.map((s) => s.holders + s.miners) : [];

        preComputed.push({
          netuid,
          snapshot,
          deltas,
          priceContext,
          fundamentalsScore,
          sparklineCapital,
          sparklineAdoption,
        });
      }

      // Second pass: compute cross-subnet medians for fair alpha
      const prices = preComputed.filter((p) => p.priceContext.currentPrice > 0).map((p) => p.priceContext.currentPrice);
      const fundamentals = preComputed.filter((p) => p.fundamentalsScore > 0).map((p) => p.fundamentalsScore);
      const medianPrice = median(prices);
      const medianFundamentals = median(fundamentals);

      // Third pass: compute final scores with cross-subnet context
      const results: SubnetRadarData[] = preComputed.map((pc) => {
        const crossSubnet = { medianPrice, medianFundamentals };
        const scores = computeRadarScores(pc.snapshot, pc.deltas, pc.priceContext, crossSubnet);
        const alerts = checkAlerts(pc.snapshot, pc.deltas, scores, pc.priceContext);

        return {
          netuid: pc.netuid,
          subnetName: nameMap.get(pc.netuid) || `SN-${pc.netuid}`,
          snapshot: pc.snapshot,
          deltas: pc.deltas,
          scores,
          alerts,
          priceContext: pc.priceContext,
          stakeChange24hPct: pc.deltas.stakeChange24h * 100,
          stakeChange7dPct: pc.deltas.stakeChange7d * 100,
          sparklineCapital: pc.sparklineCapital,
          sparklineAdoption: pc.sparklineAdoption,
        };
      });

      return results;
    },
    refetchInterval: 5 * 60_000,
    staleTime: 2 * 60_000,
  });
}
