import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  computeRadarScores,
  computeFundamentalsScore,
  computeDerivedMetrics,
  computeAMMMetrics,
  checkAlerts,
  type StakeSnapshot,
  type StakeDeltas,
  type RadarScores,
  type RadarAlerts,
  type PriceContext,
  type EconomicContext,
  type DerivedMetrics,
  type AMMMetrics,
} from "@/lib/stake-analytics";

export type SubnetRadarData = {
  netuid: number;
  subnetName: string;
  snapshot: StakeSnapshot;
  deltas: StakeDeltas;
  scores: RadarScores;
  alerts: RadarAlerts;
  priceContext: PriceContext;
  economicContext: EconomicContext;
  derivedMetrics: DerivedMetrics;
  ammMetrics: AMMMetrics;
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
const BLOCKS_PER_DAY = 19_393; // Calibrated to match Taostats emissions (86400/4.456s block time)
const OWNER_TAKE = 0.18; // Bittensor default delegate/owner take (18%)

function raoToTao(v: any): number {
  const n = Number(v || 0);
  return n > 1e6 ? n / RAO : n;
}

function computePriceChanges(sevenDayPrices: any[]): { change1d: number; change7d: number; change30d: number } {
  if (!Array.isArray(sevenDayPrices) || sevenDayPrices.length < 2) {
    return { change1d: 0, change7d: 0, change30d: 0 };
  }
  const latest = Number(sevenDayPrices[sevenDayPrices.length - 1]?.price || 0);
  if (latest <= 0) return { change1d: 0, change7d: 0, change30d: 0 };
  const idx1d = Math.max(0, sevenDayPrices.length - 7);
  const price1d = Number(sevenDayPrices[idx1d]?.price || latest);
  const price7d = Number(sevenDayPrices[0]?.price || latest);
  return {
    change1d: price1d > 0 ? ((latest - price1d) / price1d) * 100 : 0,
    change7d: price7d > 0 ? ((latest - price7d) / price7d) * 100 : 0,
    change30d: 0,
  };
}

/** Extract full economic context from Taostats raw_payload */
function extractEconomicContext(rp: any, rpEntry: any, totalNetworkEmission: number): EconomicContext {
  const chain = rp?._chain || {};
  // Taostats field names (all in RAO):
  const totalAlpha = raoToTao(rp.total_alpha ?? 0);
  const alphaStaked = raoToTao(rp.alpha_staked ?? 0);
  const alphaInPool = raoToTao(rp.alpha_in_pool ?? 0);
  const totalTao = raoToTao(rp.total_tao ?? rp.protocol_provided_tao ?? 0);
  const totalAlphaPool = alphaInPool + totalTao;
  const marketCap = raoToTao(rp.market_cap ?? 0);
  const vol24h = raoToTao(rp.tao_volume_24_hr ?? 0);

  const buyVolume = raoToTao(rp.tao_buy_volume_24_hr ?? 0);
  const sellVolume = raoToTao(rp.tao_sell_volume_24_hr ?? 0);
  const totalVol = buyVolume + sellVolume;

  // Circulating Supply = staked + in pool (all tokens that exist and are accounted for)
  // Total Burned = total_alpha - alpha_staked - alpha_in_pool (tokens removed from circulation)
  const totalBurnedCalc = Math.max(0, totalAlpha - alphaStaked - alphaInPool);
  const circulatingSupply = alphaStaked + alphaInPool;

  // Emission: _chain.emission is rao per step (~4.456s), ~19,393 steps/day
  const emissionPerBlock = Number(chain.emission ?? 0);
  const emissionsPerDay = raoToTao(emissionPerBlock * BLOCKS_PER_DAY);

  // Emissions % = subnet share of total network emission
  const emissionsPercent = totalNetworkEmission > 0
    ? (emissionPerBlock / totalNetworkEmission) * 100
    : 0;

  // Root proportion (for reference, not owner cut)
  const rootProportion = Number(rp.root_prop ?? 0);

  // Rewards distribution: owner gets 18% (Bittensor protocol default), rest split 50/50
  const ownerPerDay = emissionsPerDay * OWNER_TAKE;
  const remainingPerDay = emissionsPerDay - ownerPerDay;
  const minerPerDay = remainingPerDay * 0.5;
  const validatorPerDay = remainingPerDay * 0.5;

  // Max supply: Bittensor subnets have 21M max supply
  const maxSupply = 21_000_000;

  // Total burned = total_alpha - alpha_staked - alpha_in_pool (matches Taostats definition)
  const totalBurned = totalBurnedCalc;

  return {
    emissionsPercent,
    emissionsPerDay,
    minerPerDay,
    validatorPerDay,
    ownerPerDay,
    rootProportion,
    totalIssued: totalAlpha,
    totalBurned,
    circulatingSupply,
    maxSupply,
    alphaStaked,
    alphaInPool,
    taoInPool: totalTao,
    alphaPoolPercent: totalAlphaPool > 0 ? (alphaInPool / totalAlphaPool) * 100 : 0,
    taoPoolPercent: totalAlphaPool > 0 ? (totalTao / totalAlphaPool) * 100 : 0,
    fdv: totalAlpha > 0 && Number(rp.price ?? 0) > 0 ? totalAlpha * Number(rp.price) : 0,
    volumeMarketcapRatio: marketCap > 0 ? vol24h / marketCap : 0,
    buyVolume,
    sellVolume,
    buyersCount: Number(rp.buyers_24_hr ?? 0),
    sellersCount: Number(rp.sellers_24_hr ?? 0),
    buyTxCount: Number(rp.buys_24_hr ?? 0),
    sellTxCount: Number(rp.sells_24_hr ?? 0),
    sentiment: totalVol > 0 ? buyVolume / totalVol : 0.5,
  };
}

export function useStakeAnalytics() {
  return useQuery({
    queryKey: ["stake-analytics"],
    queryFn: async () => {
      const { data: analytics, error } = await (supabase as any)
        .from("subnet_stake_analytics")
        .select("netuid, holders_count, miners_active, miners_total, validators_active, uid_usage, stake_concentration, large_wallet_inflow, large_wallet_outflow, ts, raw_data")
        .order("ts", { ascending: false })
        .limit(500);

      if (error) throw error;

      const latest = new Map<number, any>();
      for (const row of analytics || []) {
        if (!latest.has(row.netuid)) latest.set(row.netuid, row);
      }

      const ts7dAgo = new Date(Date.now() - 7 * 86400_000).toISOString();

      // Fetch 7d history + raw_payload from subnet_latest (NOT subnet_latest_display which times out)
      const netuidBatches: number[][] = [];
      const allNetuids = [...latest.keys()];
      for (let i = 0; i < allNetuids.length; i += 10) {
        netuidBatches.push(allNetuids.slice(i, i + 10));
      }

      const [hist7dRes, ...rawPayloadResults] = await Promise.all([
        (supabase as any)
          .from("subnet_stake_analytics")
          .select("netuid, holders_count, miners_active, validators_active")
          .lte("ts", ts7dAgo)
          .order("ts", { ascending: false })
          .limit(500),
        ...netuidBatches.map((batch) =>
          (supabase as any)
            .from("subnet_latest")
            .select("netuid, price, cap, vol_24h, miners_active, raw_payload")
            .in("netuid", batch)
        ),
      ]);

      const dedup = (rows: any[]) => {
        const m = new Map<number, any>();
        for (const r of rows || []) { if (!m.has(r.netuid)) m.set(r.netuid, r); }
        return m;
      };

      const map7d = dedup(hist7dRes.data || []);
      const rawPayloadMap = new Map<number, any>();
      for (const res of rawPayloadResults) {
        for (const row of res.data || []) {
          if (!rawPayloadMap.has(row.netuid)) {
            rawPayloadMap.set(row.netuid, row);
          }
        }
      }

      const { data: subnets } = await supabase.from("subnets").select("netuid, name");
      const nameMap = new Map<number, string>();
      for (const s of subnets || []) nameMap.set(s.netuid, s.name || `SN-${s.netuid}`);

      // Compute total emission for emission share
      let totalEmission = 0;
      const emissionMap = new Map<number, number>();
      for (const [netuid] of latest) {
        const rp = rawPayloadMap.get(netuid)?.raw_payload;
        const emission = Number(rp?._chain?.emission || 0);
        emissionMap.set(netuid, emission);
        totalEmission += emission;
      }

      type PreCompute = {
        netuid: number;
        snapshot: StakeSnapshot;
        deltas: StakeDeltas;
        priceContext: PriceContext;
        economicContext: EconomicContext;
        fundamentalsScore: number;
        sparklineCapital: number[];
        sparklineAdoption: number[];
      };

      const preComputed: PreCompute[] = [];

      for (const [netuid, row] of latest) {
        const prev7d = map7d.get(netuid);
        const rpEntry = rawPayloadMap.get(netuid);
        const rp = rpEntry?.raw_payload || {};
        const chain = rp._chain || {};

        const alphaStaked = raoToTao(rp.alpha_staked);
        const marketCap = raoToTao(rp.market_cap);
        const vol24h = raoToTao(rp.tao_volume_24_hr);
        const currentPrice = Number(rp.price || rpEntry?.price || 0);
        const emission = emissionMap.get(netuid) || 0;
        const emissionShare = totalEmission > 0 ? (emission / totalEmission) * 100 : 0;
        const priceChanges = computePriceChanges(rp.seven_day_prices);

        // Chain data: use correct Taostats field names
        const chainActiveMiners = Number(chain.active_miners ?? chain.active_uids ?? 0);
        const minersActive = Math.max(row.miners_active || 0, chainActiveMiners);
        const validatorsActive = Math.max(row.validators_active || 0, Number(chain.active_validators ?? 0));
        const liquidity = raoToTao(rp.liquidity_raw || rp.liquidity);

        // UID data: active_keys = total registered UIDs (matches Taostats "Number of Active UIDs")
        // total_neurons as fallback, then active_keys, then active_uids
        const uidUsed = Number(chain.total_neurons ?? chain.active_keys ?? chain.active_uids ?? rp.active_uids ?? 0);
        const uidMax = Number(chain.max_neurons ?? chain.max_n ?? rp.max_n ?? 0);

        const inflow = Number(row.large_wallet_inflow || 0);
        const outflow = Number(row.large_wallet_outflow || 0);
        const adjustedInflow = inflow === 74 ? inflow * (emissionShare / 100) : inflow;
        const adjustedOutflow = outflow === 40 ? outflow * (emissionShare / 100) : outflow;

        const snapshot: StakeSnapshot = {
          netuid,
          holdersCount: (row.holders_count != null && row.holders_count > 0) ? row.holders_count : -1, // -1 = unknown, display as N/A
          stakeTotal: alphaStaked,
          stakeConcentration: Number(row.stake_concentration) || 0,
          top10Stake: [],
          validatorsActive,
          minersTotal: row.miners_total || 0,
          minersActive,
          uidUsage: uidMax > 0 ? uidUsed / uidMax : Number(row.uid_usage) || 0,
          largeWalletInflow: adjustedInflow,
          largeWalletOutflow: adjustedOutflow,
          uidUsed,
          uidMax,
          registrationCost: raoToTao(chain.registration_cost ?? rp.registration_cost ?? 0),
          incentiveBurn: Number(chain.incentive_burn ?? rp.incentive_burn ?? 0),
          // recycled_24_hours from Taostats is in rao; some subnets report aberrant values
          // (possibly cumulative or mis-reported). Cap to 50x daily emissions as sanity check.
          recyclePerDay: (() => {
            const rawRecycle = raoToTao(chain.recycled_24_hours ?? rp.recycle_per_day ?? 0);
            const emissionRao = Number(chain.emission ?? 0);
            const dailyEmissionTao = raoToTao(emissionRao * BLOCKS_PER_DAY);
            const maxSane = dailyEmissionTao > 0 ? dailyEmissionTao * 50 : rawRecycle;
            return Math.min(rawRecycle, maxSane);
          })(),
        };

        const miners7d = prev7d?.miners_active || minersActive;
        const holders7d = (prev7d?.holders_count != null && prev7d.holders_count > 0) ? prev7d.holders_count : (row.holders_count > 0 ? row.holders_count : 0);
        const validators7d = prev7d?.validators_active || validatorsActive;
        const sevenDayPrices = rp.seven_day_prices || [];
        const firstPrice = Number(sevenDayPrices[0]?.price || currentPrice);
        const stakeChange7d = firstPrice > 0 && currentPrice > 0
          ? (currentPrice - firstPrice) / firstPrice : 0;

        const deltas: StakeDeltas = {
          stakeChange24h: priceChanges.change1d / 100,
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

        const economicContext = extractEconomicContext(rp, rpEntry, totalEmission);
        const fundamentalsScore = computeFundamentalsScore(snapshot, priceContext);

        const sparklineCapital = sevenDayPrices.length >= 2
          ? sevenDayPrices.map((p: any) => Number(p.price || 0))
          : [];

        preComputed.push({
          netuid,
          snapshot,
          deltas,
          priceContext,
          economicContext,
          fundamentalsScore,
          sparklineCapital,
          sparklineAdoption: [],
        });
      }

      // Cross-subnet medians
      const prices = preComputed.filter((p) => p.priceContext.currentPrice > 0).map((p) => p.priceContext.currentPrice);
      const fundamentals = preComputed.filter((p) => p.fundamentalsScore > 0).map((p) => p.fundamentalsScore);
      const medianPrice = median(prices);
      const medianFundamentals = median(fundamentals);

      // Final scores
      const results: SubnetRadarData[] = preComputed.map((pc) => {
        const crossSubnet = { medianPrice, medianFundamentals };
        const dm = computeDerivedMetrics(pc.economicContext, pc.priceContext, pc.snapshot);
        const scores = computeRadarScores(pc.snapshot, pc.deltas, pc.priceContext, crossSubnet, pc.economicContext, dm);
        const alerts = checkAlerts(pc.snapshot, pc.deltas, scores, pc.priceContext);
        const ammMetrics = computeAMMMetrics(pc.economicContext);

        return {
          netuid: pc.netuid,
          subnetName: nameMap.get(pc.netuid) || `SN-${pc.netuid}`,
          snapshot: pc.snapshot,
          deltas: pc.deltas,
          scores,
          alerts,
          priceContext: pc.priceContext,
          economicContext: pc.economicContext,
          derivedMetrics: dm,
          ammMetrics,
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
