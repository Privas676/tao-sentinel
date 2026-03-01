/* ═══════════════════════════════════════ */
/*   UNIFIED SUBNET SCORES HOOK             */
/*   Single source of truth for all pages   */
/*   Orchestrates 4 independent engines:    */
/*   - StrategicEngine (scoring)            */
/*   - ProtectionEngine (safety)            */
/*   - RegimeEngine (global regime)         */
/*   - DecisionStateLayer (stability)       */
/* ═══════════════════════════════════════ */

import { useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  clamp, type SmartCapitalState, type MomentumLabel,
} from "@/lib/gauge-engine";
import { computeMomentumScore } from "@/lib/gauge-momentum";
import { type SystemStatus } from "@/lib/risk-override";
import { type SourceMetrics } from "@/lib/data-fusion";
import type { FleetDistributionReport } from "@/lib/distribution-monitor";
import {
  extractHealthData, recalculate, computeAllHealthScores,
  type HealthScores, type RecalculatedMetrics,
} from "@/lib/subnet-health";
import { type DelistCategory } from "@/lib/delist-risk";
import { useDelistMode } from "@/hooks/use-delist-mode";
import {
  createSnapshot, checkTimeAlignment, logAlignmentDiag,
  type DataSnapshot, type AlignmentStatus,
} from "@/lib/data-snapshot";
import { type StrategicAction } from "@/lib/strategy-subnet";

// ── 3 Independent Engines ──
import { computeStrategicScores, type StrategicInput } from "@/lib/engine-strategic";
import { evaluateProtection, type ProtectionInput } from "@/lib/engine-protection";
import { evaluateRegime, type RegimeInput, type RegimeOutput } from "@/lib/engine-regime";
import { applyDecision, type DecisionInput, type AssetType } from "@/lib/engine-decision";
import {
  DecisionStateManager, DEFAULT_DECISION_SETTINGS, PERMISSIVE_SETTINGS,
  type DecisionStateOutput, type DecisionState,
} from "@/lib/engine-decision-state";
import { useOverrideMode } from "@/hooks/use-override-mode";

/* ─── Exported types ─── */

export type { AssetType } from "@/lib/engine-decision";

export type UnifiedSubnetScore = {
  netuid: number;
  name: string;
  assetType: AssetType;
  state: string | null;
  psi: number;
  conf: number;
  quality: number;
  opp: number;
  risk: number;
  asymmetry: number;
  momentum: number;
  momentumLabel: MomentumLabel;
  momentumScore: number;
  action: import("@/lib/strategy-engine").StrategicAction;
  sc: SmartCapitalState;
  confianceScore: number;
  dataUncertain: boolean;
  isOverridden: boolean;
  isWarning: boolean;
  systemStatus: SystemStatus;
  overrideReasons: string[];
  healthScores: HealthScores;
  recalc: RecalculatedMetrics;
  displayedCap: number;
  displayedLiq: number;
  stability: number;
  consensusPrice: number;
  alphaPrice: number;
  priceVar30d: number | null;
  delistCategory: DelistCategory;
  delistScore: number;
};

export type UnifiedScoresResult = {
  scores: Map<number, UnifiedSubnetScore>;
  scoresList: UnifiedSubnetScore[];
  scoreTimestamp: string;
  taoUsd: number;
  isLoading: boolean;
  sparklines: Map<number, number[]> | undefined;
  subnetList: { netuid: number; name: string }[] | undefined;
  /** TMC market context data — informational only, NOT used in scoring */
  marketContext: Map<number, SourceMetrics> | undefined;
  /** Time alignment status across data sources */
  dataAlignment: AlignmentStatus;
  /** Per-source age diagnostics (debug) */
  dataAgeDebug: { source: string; ageSeconds: number }[];
  /** Stable decision states from the Decision State Layer */
  decisionStates: Map<number, DecisionStateOutput>;
  /** Fleet distribution health report */
  fleetDistribution: FleetDistributionReport | null;
};

/* ─── SPECIAL CASES / WHITELIST ───
 * Root (SN-0) is the primary TAO staking alpha.
 * It must NEVER trigger depeg/delist/exit rules.
 * Risk is hard-capped, status forced to OK, action forced to HOLD.
 * Extend this map for future system-level subnets.
 */
export const SPECIAL_SUBNETS: Record<number, {
  label: string;
  forceStatus: SystemStatus;
  forceAction: StrategicAction;
  forceRiskMax: number;
}> = {
  0: { label: "ROOT (system)", forceStatus: "OK", forceAction: "HOLD", forceRiskMax: 20 },
};

/* deriveSubnetSC moved to engine-strategic.ts */

type SignalRow = {
  netuid: number | null;
  subnet_name: string | null;
  state: string | null;
  mpi: number | null;
  score: number | null;
  confidence_pct: number | null;
  quality_score: number | null;
  ts: string | null;
};

/**
 * Unified hook: fetches all data and computes scores ONCE.
 * All pages consume this same result → identical scores everywhere.
 */
export function useSubnetScores(): UnifiedScoresResult {
  const { delistMode } = useDelistMode();
  const { mode: overrideMode } = useOverrideMode();
  const stateManagerRef = useRef<DecisionStateManager>(
    new DecisionStateManager(DEFAULT_DECISION_SETTINGS)
  );

  // Sync settings with override mode
  useMemo(() => {
    const settings = overrideMode === "permissive" ? PERMISSIVE_SETTINGS : DEFAULT_DECISION_SETTINGS;
    stateManagerRef.current.updateSettings(settings);
  }, [overrideMode]);
  // ── Data fetching (shared query keys → cached across pages) ──

  const { data: signalsSnapshot, isLoading: signalsLoading } = useQuery({
    queryKey: ["unified-signals"],
    queryFn: async () => {
      const { data, error } = await supabase.from("signals_latest").select("*");
      if (error) throw error;
      const rows = (data || []) as SignalRow[];
      const ts = rows[0]?.ts ?? null;
      return createSnapshot(rows, "supabase:signals", null, ts);
    },
    refetchInterval: 60_000,
  });
  const signals = signalsSnapshot?.payload;

  const { data: rawPayloadsSnapshot } = useQuery({
    queryKey: ["unified-raw-payloads"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("subnet_metrics_ts")
        .select("netuid, raw_payload, source, ts")
        .eq("source", "taostats")
        .order("ts", { ascending: false })
        .limit(300);
      if (error) throw error;
      const map = new Map<number, any>();
      let latestTs: string | null = null;
      for (const r of data || []) {
        if (!latestTs && r.ts) latestTs = r.ts;
        if (!map.has(r.netuid) && r.raw_payload) map.set(r.netuid, r.raw_payload);
      }
      return createSnapshot(map, "taostats:raw_payloads", null, latestTs);
    },
    refetchInterval: 120_000,
  });
  const rawPayloads = rawPayloadsSnapshot?.payload;

  const { data: taoUsdSnapshot } = useQuery({
    queryKey: ["unified-tao-usd"],
    queryFn: async () => {
      const { data } = await supabase.from("fx_latest").select("tao_usd").limit(1).maybeSingle();
      return createSnapshot(Number(data?.tao_usd) || 450, "supabase:fx_rates", null);
    },
    refetchInterval: 300_000,
  });
  const taoUsdRaw = taoUsdSnapshot?.payload;

  const { data: primaryMetricsSnapshot } = useQuery({
    queryKey: ["unified-metrics-primary"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("subnet_metrics_ts")
        .select("netuid, price, cap, vol_24h, liquidity, ts, source")
        .eq("source", "taostats")
        .order("ts", { ascending: false })
        .limit(200);
      if (error) throw error;
      const map = new Map<number, SourceMetrics>();
      let latestTs: string | null = null;
      for (const r of data || []) {
        if (!latestTs && r.ts) latestTs = r.ts;
        if (!map.has(r.netuid)) map.set(r.netuid, { netuid: r.netuid, price: Number(r.price) || null, cap: Number(r.cap) || null, vol24h: Number(r.vol_24h) || null, liquidity: Number(r.liquidity) || null, ts: r.ts, source: "taostats" });
      }
      return createSnapshot(map, "taostats:metrics", null, latestTs);
    },
    refetchInterval: 120_000,
  });
  const primaryMetrics = primaryMetricsSnapshot?.payload;

  // TMC secondary metrics: kept for Market Context UI only, NOT used in scoring
  const { data: secondaryMetrics } = useQuery({
    queryKey: ["unified-metrics-secondary"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("subnet_metrics_ts")
        .select("netuid, price, cap, vol_24h, liquidity, ts, source")
        .eq("source", "taomarketcap")
        .order("ts", { ascending: false })
        .limit(200);
      if (error) throw error;
      const map = new Map<number, SourceMetrics>();
      for (const r of data || []) {
        if (!map.has(r.netuid)) map.set(r.netuid, { netuid: r.netuid, price: Number(r.price) || null, cap: Number(r.cap) || null, vol24h: Number(r.vol_24h) || null, liquidity: Number(r.liquidity) || null, ts: r.ts, source: "taomarketcap" });
      }
      return map;
    },
    refetchInterval: 120_000,
  });

  const { data: subnetLatest } = useQuery({
    queryKey: ["unified-subnet-latest"],
    queryFn: async () => {
      const { data, error } = await supabase.from("subnet_latest").select("netuid, vol_cap, top_miners_share, liquidity, cap, miners_active, price");
      if (error) throw error;
      const map = new Map<number, { volCap: number; topMinersShare: number; liqRatio: number; cap: number; liq: number; minersActive: number; price: number }>();
      for (const r of data || []) {
        if (r.netuid == null) continue;
        const cap = Number(r.cap) || 0;
        const liq = Number(r.liquidity) || 0;
        map.set(r.netuid, { volCap: Number(r.vol_cap) || 0, topMinersShare: Number(r.top_miners_share) || 0, liqRatio: cap > 0 ? liq / cap : 0, cap, liq, minersActive: Number(r.miners_active) || 0, price: Number(r.price) || 0 });
      }
      return map;
    },
    refetchInterval: 120_000,
  });

  const { data: sparklines } = useQuery({
    queryKey: ["unified-sparklines-7d"],
    queryFn: async () => {
      const since = new Date(Date.now() - 8 * 86400_000).toISOString().slice(0, 10);
      const { data, error } = await supabase
        .from("subnet_price_daily")
        .select("netuid, date, price_close")
        .gte("date", since)
        .order("date", { ascending: true });
      if (error) throw error;
      const map = new Map<number, number[]>();
      for (const r of data || []) {
        if (r.price_close == null) continue;
        if (!map.has(r.netuid)) map.set(r.netuid, []);
        map.get(r.netuid)!.push(Number(r.price_close));
      }
      return map;
    },
    refetchInterval: 300_000,
  });

  // 30-day price data for Var 30j column
  const { data: price30dMap } = useQuery({
    queryKey: ["unified-price-30d"],
    queryFn: async () => {
      const since = new Date(Date.now() - 31 * 86400_000).toISOString().slice(0, 10);
      const { data, error } = await supabase
        .from("subnet_price_daily")
        .select("netuid, date, price_close")
        .gte("date", since)
        .order("date", { ascending: true });
      if (error) throw error;
      // For each netuid, store oldest and newest price
      const map = new Map<number, { oldest: number; newest: number }>();
      for (const r of data || []) {
        if (r.price_close == null) continue;
        const p = Number(r.price_close);
        const existing = map.get(r.netuid);
        if (!existing) {
          map.set(r.netuid, { oldest: p, newest: p });
        } else {
          existing.newest = p; // data is ordered asc, so last = newest
        }
      }
      return map;
    },
    refetchInterval: 300_000,
  });

  const { data: subnetList } = useQuery({
    queryKey: ["unified-subnet-names"],
    queryFn: async () => {
      const { data, error } = await supabase.from("subnets").select("netuid, name").order("netuid");
      if (error) throw error;
      return (data || []).map(s => ({ netuid: s.netuid, name: s.name || `SN-${s.netuid}` }));
    },
  });

  // ── Confidence data (Taostats-only: freshness + completeness, NO TMC divergence) ──
  const consensusMap = useMemo(() => {
    if (!primaryMetrics) return new Map<number, { confianceData: number; dataUncertain: boolean }>();
    const map = new Map<number, { confianceData: number; dataUncertain: boolean }>();
    for (const [netuid, m] of primaryMetrics) {
      // Freshness: how old is the data? Lose 2 points per minute
      const minutesOld = m.ts ? (Date.now() - new Date(m.ts).getTime()) / 60_000 : 999;
      const freshness = Math.max(0, 100 - minutesOld * 2);
      // Completeness: how many fields are non-null and > 0
      let fields = 0;
      if (m.price != null && m.price > 0) fields++;
      if (m.cap != null && m.cap > 0) fields++;
      if (m.vol24h != null && m.vol24h > 0) fields++;
      if (m.liquidity != null && m.liquidity > 0) fields++;
      const completeness = (fields / 4) * 100;
      const score = Math.round(freshness * 0.5 + completeness * 0.5);
      map.set(netuid, { confianceData: Math.max(0, Math.min(100, score)), dataUncertain: false });
    }
    return map;
  }, [primaryMetrics]);

  // ── Prices (Taostats only — single source of truth) ──
  const consensusPrices = useMemo(() => {
    if (!primaryMetrics) return new Map<number, number>();
    const map = new Map<number, number>();
    for (const [netuid, m] of primaryMetrics) {
      if (m.price) map.set(netuid, m.price);
    }
    return map;
  }, [primaryMetrics]);

  const taoUsd = taoUsdRaw || 450;

  // ── TIME ALIGNMENT GUARD ──
  const alignmentResult = useMemo(() => {
    const snapshots: DataSnapshot[] = [];
    if (signalsSnapshot) snapshots.push(signalsSnapshot);
    if (rawPayloadsSnapshot) snapshots.push(rawPayloadsSnapshot);
    if (primaryMetricsSnapshot) snapshots.push(primaryMetricsSnapshot);
    if (taoUsdSnapshot) snapshots.push(taoUsdSnapshot);
    const result = checkTimeAlignment(snapshots);
    logAlignmentDiag("UNIFIED-SCORES", result);
    return result;
  }, [signalsSnapshot, rawPayloadsSnapshot, primaryMetricsSnapshot, taoUsdSnapshot]);

  // ── MAIN SCORING PIPELINE (orchestrates 3 independent engines) ──
  const { scoresList, scoresMap, scoreTimestamp, fleetDistribution } = useMemo(() => {
    if (!signals) return { scoresList: [] as UnifiedSubnetScore[], scoresMap: new Map<number, UnifiedSubnetScore>(), scoreTimestamp: new Date().toISOString(), fleetDistribution: null as FleetDistributionReport | null };

    const rate = taoUsd;
    const ts = new Date().toISOString();

    // ── Phase 0: Extract health data + prepare inputs ──
    const subnetInputs = signals
      .filter(s => s.netuid != null)
      .map(s => {
        const netuid = s.netuid!;
        const psi = s.mpi ?? s.score ?? 0;
        const conf = s.confidence_pct ?? 0;
        const quality = s.quality_score ?? 0;
        const consensus = consensusMap.get(netuid);
        const confianceScore = consensus?.confianceData ?? 50;

        // Health engine (shared data, both strategic and protection use it)
        const payload = rawPayloads?.get(netuid);
        const chainData = payload?._chain || {};
        const healthData = extractHealthData(netuid, payload || {}, chainData, rate);
        const recalc = recalculate(healthData);
        const special = SPECIAL_SUBNETS[netuid];
        let healthScores = computeAllHealthScores(healthData, recalc);

        if (special) {
          healthScores = { ...healthScores, liquidityHealth: 80, volumeHealth: 60, emissionPressure: 10 };
        }

        // Price data
        const sparkline = sparklines?.get(netuid);
        const priceChange7d = sparkline && sparkline.length >= 2
          ? ((sparkline[sparkline.length - 1] - sparkline[0]) / sparkline[0]) * 100
          : null;
        const slMetrics = subnetLatest?.get(netuid);
        const volMcRatio = slMetrics?.volCap ?? null;

        return {
          netuid, name: s.subnet_name || `SN-${netuid}`,
          state: s.state, psi, conf, quality,
          confianceScore, dataUncertain: false,
          healthScores, recalc,
          displayedCap: (slMetrics?.cap || 0) * rate,
          displayedLiq: (slMetrics?.liq || 0) * rate,
          priceChange7d, volMcRatio,
          sparklineLen: sparkline?.length ?? 0,
          slMetrics,
        };
      });

    // ── Phase 1: STRATEGIC ENGINE (pure scoring, no protection deps) ──
    const strategicInputs: StrategicInput[] = subnetInputs.map(s => ({
      netuid: s.netuid, name: s.name, state: s.state,
      psi: s.psi, conf: s.conf, quality: s.quality,
      healthScores: s.healthScores, recalc: s.recalc,
      displayedCap: s.displayedCap, displayedLiq: s.displayedLiq,
      confianceScore: s.confianceScore, dataUncertain: s.dataUncertain,
      priceChange7d: s.priceChange7d, volMcRatio: s.volMcRatio,
      sparklineLen: s.sparklineLen,
    }));
    const strategicResults = computeStrategicScores(strategicInputs);

    // Extract fleet distribution report from first strategic result
    const fleetDist = strategicResults[0]?.fleetDistribution ?? null;

    // If fleet distribution is unstable, flag all subnets as dataUncertain
    if (fleetDist?.isFleetUnstable) {
      for (const s of subnetInputs) {
        s.dataUncertain = true;
      }
    }
    const protectionResults = new Map<number, ReturnType<typeof evaluateProtection>>();
    for (const s of subnetInputs) {
      const special = SPECIAL_SUBNETS[s.netuid];
      if (special) {
        // Whitelisted: bypass protection engine
        protectionResults.set(s.netuid, {
          netuid: s.netuid,
          isOverridden: false, isWarning: false,
          systemStatus: special.forceStatus as SystemStatus,
          overrideReasons: [], delistCategory: "NORMAL", delistScore: 0,
        });
        continue;
      }
      const liqTao = s.displayedLiq > 0 && rate > 0 ? s.displayedLiq / rate : 0;
      const protInput: ProtectionInput = {
        netuid: s.netuid, state: s.state, psi: s.psi, quality: s.quality,
        risk: s.healthScores.liquidityHealth < 25 ? 80 : 40, // raw health-based risk indicator
        liquidityUsd: s.displayedLiq > 0 ? s.displayedLiq : undefined,
        volumeMcRatio: s.volMcRatio ?? undefined,
        taoInPool: s.slMetrics?.liq,
        minersActive: s.slMetrics?.minersActive ?? 10,
        liqTao, liqUsd: s.displayedLiq,
        capTao: s.slMetrics?.cap ?? 0, alphaPrice: s.slMetrics?.price ?? 0,
        priceChange7d: s.priceChange7d, confianceData: s.confianceScore,
        liqHaircut: s.recalc?.liqHaircut ?? 0,
        delistMode,
      };
      protectionResults.set(s.netuid, evaluateProtection(protInput));
    }

    // ── Phase 3: DECISION LAYER (4th module: engine-decision.ts) ──
    const scored: UnifiedSubnetScore[] = strategicResults.map((strat, i) => {
      const input = subnetInputs[i];
      const prot = protectionResults.get(strat.netuid)!;
      const special = SPECIAL_SUBNETS[strat.netuid];

      const decisionInput: DecisionInput = {
        strategic: strat,
        protection: prot,
        context: {
          state: input.state,
          psi: input.psi,
          conf: input.conf,
          quality: input.quality,
          confianceScore: input.confianceScore,
          dataUncertain: input.dataUncertain,
          healthScores: input.healthScores,
          recalc: input.recalc,
          displayedCap: input.displayedCap,
          displayedLiq: input.displayedLiq,
          consensusPrice: consensusPrices.get(strat.netuid) ?? 0,
          alphaPrice: consensusPrices.get(strat.netuid) ?? 0,
          priceVar30d: (() => {
            const p30 = price30dMap?.get(strat.netuid);
            if (!p30 || p30.oldest <= 0) return null;
            return ((p30.newest - p30.oldest) / p30.oldest) * 100;
          })(),
        },
        special,
        alignmentStatus: alignmentResult.status,
      };

      return applyDecision(decisionInput) as UnifiedSubnetScore;
    });

    // Sort by asymmetry desc (default)
    scored.sort((a, b) => b.asymmetry - a.asymmetry);

    const map = new Map<number, UnifiedSubnetScore>();
    for (const s of scored) map.set(s.netuid, s);

    // Distribution audit
    if (scored.length >= 5) {
      const overrideCount = scored.filter(r => r.isOverridden).length;
      const warningCount = scored.filter(r => r.isWarning && !r.isOverridden).length;
      const pct = Math.round((overrideCount / scored.length) * 100);
      console.log(`[UNIFIED-SCORES] n=${scored.length} overrides=${overrideCount} (${pct}%) warnings=${warningCount} alignment=${alignmentResult.status} ts=${ts}`);
      if (alignmentResult.status === "STALE") {
        const blockedCount = scored.filter(r => !SPECIAL_SUBNETS[r.netuid] && r.action === "WATCH").length;
        console.warn(`[STALE-GUARD] Data alignment STALE — all ENTER actions downgraded to WATCH (${blockedCount} potential blocks)`);
      }

      // Whitelist invariant check
      for (const s of scored) {
        if (SPECIAL_SUBNETS[s.netuid] && s.action === "EXIT") {
          console.error(`[WHITELIST-VIOLATION] SN-${s.netuid} (${SPECIAL_SUBNETS[s.netuid].label}) has action EXIT!`);
        }
      }
    }

    return { scoresList: scored, scoresMap: map, scoreTimestamp: ts, fleetDistribution: fleetDist };
  }, [signals, rawPayloads, taoUsd, primaryMetrics, subnetLatest, consensusMap, consensusPrices, price30dMap, delistMode, sparklines, alignmentResult]);

  // ── Phase 4: DECISION STATE LAYER (stability: hysteresis, confirmation, cooldown) ──
  const decisionStates = useMemo(() => {
    const mgr = stateManagerRef.current;
    const nowMs = Date.now();
    const outputs = mgr.tickAll(scoresList as any[], alignmentResult.status, nowMs);
    const map = new Map<number, DecisionStateOutput>();
    for (const o of outputs) map.set(o.netuid, o);
    return map;
  }, [scoresList, alignmentResult.status]);

  return {
    scores: scoresMap,
    scoresList,
    scoreTimestamp,
    taoUsd,
    isLoading: signalsLoading,
    sparklines,
    subnetList,
    marketContext: secondaryMetrics,
    dataAlignment: alignmentResult.status,
    dataAgeDebug: alignmentResult.ages.map(a => ({ source: a.source, ageSeconds: Math.round(a.dataAgeSeconds) })),
    decisionStates,
    fleetDistribution,
  };
}

/** Helper: get score for a single subnet */
export function getSubnetScore(scores: Map<number, UnifiedSubnetScore>, netuid: number): UnifiedSubnetScore | undefined {
  return scores.get(netuid);
}
