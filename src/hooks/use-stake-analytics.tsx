import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  computeRadarScores,
  checkAlerts,
  type StakeSnapshot,
  type StakeDeltas,
  type RadarScores,
  type RadarAlerts,
} from "@/lib/stake-analytics";

export type SubnetRadarData = {
  netuid: number;
  subnetName: string;
  snapshot: StakeSnapshot;
  deltas: StakeDeltas;
  scores: RadarScores;
  alerts: RadarAlerts;
  stakeChange24hPct: number;
  stakeChange7dPct: number;
  /** Daily stake_total values over last 7 days (oldest→newest) */
  sparklineCapital: number[];
  /** Daily adoption composite (holders+miners) over last 7 days (oldest→newest) */
  sparklineAdoption: number[];
};

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

      // Fetch 7d-ago analytics for growth computation
      const ts7dAgo = new Date(Date.now() - 7 * 86400_000).toISOString();
      const ts30dAgo = new Date(Date.now() - 30 * 86400_000).toISOString();

      const [hist7d, hist30d, histTimeSeries] = await Promise.all([
        (supabase as any)
          .from("subnet_stake_analytics")
          .select("netuid, holders_count, stake_total, miners_active")
          .lte("ts", ts7dAgo)
          .order("ts", { ascending: false })
          .limit(500),
        (supabase as any)
          .from("subnet_stake_analytics")
          .select("netuid, holders_count, stake_total, miners_active")
          .lte("ts", ts30dAgo)
          .order("ts", { ascending: false })
          .limit(500),
        // Fetch all snapshots from last 7 days for sparklines
        (supabase as any)
          .from("subnet_stake_analytics")
          .select("netuid, stake_total, holders_count, miners_active, ts")
          .gte("ts", ts7dAgo)
          .order("ts", { ascending: true })
          .limit(1000),
      ]);

      const dedup = (rows: any[]) => {
        const m = new Map<number, any>();
        for (const r of rows || []) {
          if (!m.has(r.netuid)) m.set(r.netuid, r);
        }
        return m;
      };

      const map7d = dedup(hist7d.data || []);
      const map30d = dedup(hist30d.data || []);

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

      // Compute scores for each subnet
      const results: SubnetRadarData[] = [];

      for (const [netuid, row] of latest) {
        const prev7d = map7d.get(netuid);
        const prev30d = map30d.get(netuid);

        const snapshot: StakeSnapshot = {
          netuid,
          holdersCount: row.holders_count || 0,
          stakeTotal: Number(row.stake_total) || 0,
          stakeConcentration: Number(row.stake_concentration) || 0,
          top10Stake: row.top10_stake || [],
          validatorsActive: row.validators_active || 0,
          minersTotal: row.miners_total || 0,
          minersActive: row.miners_active || 0,
          uidUsage: Number(row.uid_usage) || 0,
          largeWalletInflow: Number(row.large_wallet_inflow) || 0,
          largeWalletOutflow: Number(row.large_wallet_outflow) || 0,
        };

        const stakeNow = Number(row.stake_total) || 0;
        const stake7d = Number(prev7d?.stake_total) || stakeNow;
        const holdersNow = row.holders_count || 0;
        const holders7d = prev7d?.holders_count || holdersNow;
        const holders30d = prev30d?.holders_count || holdersNow;
        const minersNow = row.miners_active || 0;
        const miners7d = prev7d?.miners_active || minersNow;

        const deltas: StakeDeltas = {
          stakeChange24h: 0, // computed server-side from metrics_ts
          stakeChange7d: stake7d > 0 ? (stakeNow - stake7d) / stake7d : 0,
          holdersGrowth7d: holders7d > 0 ? (holdersNow - holders7d) / holders7d : 0,
          holdersGrowth30d: holders30d > 0 ? (holdersNow - holders30d) / holders30d : 0,
          minersGrowth7d: miners7d > 0 ? (minersNow - miners7d) / miners7d : 0,
        };

        const scores = computeRadarScores(snapshot, deltas);
        const alerts = checkAlerts(snapshot, deltas);

        results.push({
          netuid,
          subnetName: nameMap.get(netuid) || `SN-${netuid}`,
          snapshot,
          deltas,
          scores,
          alerts,
          stakeChange24hPct: deltas.stakeChange24h * 100,
          stakeChange7dPct: deltas.stakeChange7d * 100,
        });
      }

      return results;
    },
    refetchInterval: 5 * 60_000,
    staleTime: 2 * 60_000,
  });
}
