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

const RAO = 1e9;

/** Parse a RAO-scale number to TAO */
function raoToTao(v: any): number {
  const n = Number(v || 0);
  return n > 1e6 ? n / RAO : n;
}

/** Compute % change between first and last price in seven_day_prices array */
function computePriceChanges(sevenDayPrices: any[]): { change1d: number; change7d: number; change30d: number } {
  if (!Array.isArray(sevenDayPrices) || sevenDayPrices.length < 2) {
    return { change1d: 0, change7d: 0, change30d: 0 };
  }
  const latest = Number(sevenDayPrices[sevenDayPrices.length - 1]?.price || 0);
  if (latest <= 0) return { change1d: 0, change7d: 0, change30d: 0 };

  // 1d ago: ~6 data points back (4h intervals, 6 points = 24h)
  const idx1d = Math.max(0, sevenDayPrices.length - 7);
  const price1d = Number(sevenDayPrices[idx1d]?.price || latest);
  
  // 7d ago: first element
  const price7d = Number(sevenDayPrices[0]?.price || latest);

  return {
    change1d: price1d > 0 ? ((latest - price1d) / price1d) * 100 : 0,
    change7d: price7d > 0 ? ((latest - price7d) / price7d) * 100 : 0,
    change30d: 0, // Only 7d of data available
  };
}

export function useStakeAnalytics() {
  return useQuery({
    queryKey: ["stake-analytics"],
    queryFn: async () => {
      // Fetch latest stake analytics per subnet (has validators, miners, holders, uid_usage)
      const { data: analytics, error } = await (supabase as any)
        .from("subnet_stake_analytics")
        .select("netuid, holders_count, miners_active, miners_total, validators_active, uid_usage, stake_concentration, large_wallet_inflow, large_wallet_outflow, ts, raw_data")
        .order("ts", { ascending: false })
        .limit(500);

      if (error) throw error;

      // Dedupe to latest per netuid
      const latest = new Map<number, any>();
      for (const row of analytics || []) {
        if (!latest.has(row.netuid)) latest.set(row.netuid, row);
      }

      // Fetch 7d-ago stake analytics for deltas
      const ts7dAgo = new Date(Date.now() - 7 * 86400_000).toISOString();
      // Fetch lightweight fields + raw_payload separately to avoid DB timeout
      const [hist7dRes, lightweightRes] = await Promise.all([
        (supabase as any)
          .from("subnet_stake_analytics")
          .select("netuid, holders_count, miners_active, validators_active")
          .lte("ts", ts7dAgo)
          .order("ts", { ascending: false })
          .limit(500),
        (supabase as any)
          .from("subnet_latest")
          .select("netuid, price, cap, vol_24h, miners_active"),
      ]);

      // Fetch raw_payload in batches of 30 to avoid statement timeout
      const netuidBatches: number[][] = [];
      const allNetuids = [...latest.keys()];
      for (let i = 0; i < allNetuids.length; i += 30) {
        netuidBatches.push(allNetuids.slice(i, i + 30));
      }
      const rawPayloadResults = await Promise.all(
        netuidBatches.map((batch) =>
          (supabase as any)
            .from("subnet_latest")
            .select("netuid, raw_payload")
            .in("netuid", batch)
        )
      );

      const dedup = (rows: any[]) => {
        const m = new Map<number, any>();
        for (const r of rows || []) {
          if (!m.has(r.netuid)) m.set(r.netuid, r);
        }
        return m;
      };

      const map7d = dedup(hist7dRes.data || []);
      // Merge lightweight + raw_payload
      const lightMap = dedup(lightweightRes.data || []);
      const rawMap = new Map<number, any>();
      for (const res of rawPayloadResults) {
        for (const row of res.data || []) {
          rawMap.set(row.netuid, row.raw_payload);
        }
      }
      // Combine into unified map
      const rawPayloadMap = new Map<number, any>();
      for (const [nid, light] of lightMap) {
        rawPayloadMap.set(nid, { ...light, raw_payload: rawMap.get(nid) || null });
      }

      // Fetch subnet names
      const { data: subnets } = await supabase.from("subnets").select("netuid, name");
      const nameMap = new Map<number, string>();
      for (const s of subnets || []) {
        nameMap.set(s.netuid, s.name || `SN-${s.netuid}`);
      }

      // First pass: extract real data from raw_payload
      type PreCompute = {
        netuid: number;
        snapshot: StakeSnapshot;
        deltas: StakeDeltas;
        priceContext: PriceContext;
        fundamentalsScore: number;
        sparklineCapital: number[];
        sparklineAdoption: number[];
      };

      // Compute total emission across all subnets for emission share
      let totalEmission = 0;
      const emissionMap = new Map<number, number>();
      for (const [netuid] of latest) {
        const rp = rawPayloadMap.get(netuid)?.raw_payload;
        const emission = Number(rp?._chain?.emission || 0);
        emissionMap.set(netuid, emission);
        totalEmission += emission;
      }

      const preComputed: PreCompute[] = [];

      for (const [netuid, row] of latest) {
        const prev7d = map7d.get(netuid);
        const rpEntry = rawPayloadMap.get(netuid);
        const rp = rpEntry?.raw_payload || {};

        // === REAL DATA FROM raw_payload ===
        const alphaStaked = raoToTao(rp.alpha_staked);
        const marketCap = raoToTao(rp.market_cap);
        const vol24h = raoToTao(rp.tao_volume_24_hr);
        const currentPrice = Number(rp.price || rpEntry?.price || 0);
        const emission = emissionMap.get(netuid) || 0;
        const emissionShare = totalEmission > 0 ? (emission / totalEmission) * 100 : 0;

        // Price changes from seven_day_prices array
        const priceChanges = computePriceChanges(rp.seven_day_prices);

        // Active UIDs from chain data (more accurate than subnet_stake_analytics for some subnets)
        const chainActiveUids = Number(rp._chain?.active_uids || 0);
        const minersActive = Math.max(row.miners_active || 0, chainActiveUids);
        const validatorsActive = row.validators_active || 0;

        // Liquidity from raw_payload
        const liquidity = raoToTao(rp.liquidity_raw || rp.liquidity);

        // Whale flows: use per-subnet whale_movements if available, otherwise use stake analytics
        // Note: subnet_stake_analytics currently has global flows (74/40), so we'll zero them out
        // unless they differ per subnet
        const inflow = Number(row.large_wallet_inflow || 0);
        const outflow = Number(row.large_wallet_outflow || 0);
        // Detect if flows are global (all identical) - if so, scale by emission share
        const adjustedInflow = inflow === 74 ? inflow * (emissionShare / 100) : inflow;
        const adjustedOutflow = outflow === 40 ? outflow * (emissionShare / 100) : outflow;

        const snapshot: StakeSnapshot = {
          netuid,
          holdersCount: row.holders_count || 0,
          stakeTotal: alphaStaked, // Real data from raw_payload
          stakeConcentration: Number(row.stake_concentration) || 0,
          top10Stake: [],
          validatorsActive,
          minersTotal: row.miners_total || 0,
          minersActive,
          uidUsage: Number(row.uid_usage) || 0,
          largeWalletInflow: adjustedInflow,
          largeWalletOutflow: adjustedOutflow,
        };

        // Compute deltas
        const miners7d = prev7d?.miners_active || minersActive;
        const holders7d = prev7d?.holders_count || row.holders_count || 0;
        const validators7d = prev7d?.validators_active || validatorsActive;

        // For stake 7d change, use the first price in seven_day_prices as proxy
        // (price change ≈ stake value change in absence of historical stake data)
        const sevenDayPrices = rp.seven_day_prices || [];
        const firstPrice = Number(sevenDayPrices[0]?.price || currentPrice);
        const stakeChange7d = firstPrice > 0 && currentPrice > 0
          ? (currentPrice - firstPrice) / firstPrice
          : 0;

        const deltas: StakeDeltas = {
          stakeChange24h: priceChanges.change1d / 100, // Convert % to fraction
          stakeChange7d,
          holdersGrowth7d: holders7d > 0 ? ((row.holders_count || 0) - holders7d) / holders7d : 0,
          holdersGrowth30d: 0,
          minersGrowth7d: miners7d > 0 ? (minersActive - miners7d) / miners7d : 0,
          validatorsGrowth7d: validators7d > 0 ? (validatorsActive - validators7d) / validators7d : 0,
        };

        const priceContext: PriceContext = {
          priceChange1d: priceChanges.change1d,
          priceChange7d: priceChanges.change7d,
          priceChange30d: priceChanges.change30d,
          currentPrice,
          liquidity,
          emission,
          emissionShare,
          marketCap,
          vol24h,
          fearGreed: 50,
        };

        const fundamentalsScore = computeFundamentalsScore(snapshot, priceContext);

        // Sparkline from seven_day_prices
        const sparklineCapital = sevenDayPrices.length >= 2
          ? sevenDayPrices.map((p: any) => Number(p.price || 0))
          : [];

        preComputed.push({
          netuid,
          snapshot,
          deltas,
          priceContext,
          fundamentalsScore,
          sparklineCapital,
          sparklineAdoption: [],
        });
      }

      // Second pass: cross-subnet medians for fair alpha
      const prices = preComputed.filter((p) => p.priceContext.currentPrice > 0).map((p) => p.priceContext.currentPrice);
      const fundamentals = preComputed.filter((p) => p.fundamentalsScore > 0).map((p) => p.fundamentalsScore);
      const medianPrice = median(prices);
      const medianFundamentals = median(fundamentals);

      // Third pass: final scores
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
