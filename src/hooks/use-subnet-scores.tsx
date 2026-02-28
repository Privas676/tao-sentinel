/* ═══════════════════════════════════════ */
/*   UNIFIED SUBNET SCORES HOOK             */
/*   Single source of truth for all pages   */
/* ═══════════════════════════════════════ */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  clamp, normalizeWithVariance, normalizeOpportunity,
  computeMomentumScore, computeMomentumScoreV2, assignMomentumLabels,
  computeStabilitySetup, type SmartCapitalState, type MomentumLabel,
} from "@/lib/gauge-engine";
import { calibrateScores } from "@/lib/risk-calibration";
import { deriveSubnetAction, type StrategicAction } from "@/lib/strategy-engine";
import {
  evaluateRiskOverride, checkCoherence,
  type SystemStatus,
} from "@/lib/risk-override";
import {
  fuseMetrics, type SourceMetrics,
} from "@/lib/data-fusion";
import {
  extractHealthData, recalculate, computeAllHealthScores,
  computeHealthRisk, computeHealthOpportunity,
  type HealthScores, type RecalculatedMetrics,
} from "@/lib/subnet-health";

/* ─── Exported types ─── */

export type AssetType = "SPECULATIVE" | "CORE_NETWORK";

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
};

export type UnifiedScoresResult = {
  scores: Map<number, UnifiedSubnetScore>;
  scoresList: UnifiedSubnetScore[];
  scoreTimestamp: string;
  taoUsd: number;
  isLoading: boolean;
  sparklines: Map<number, number[]> | undefined;
  subnetList: { netuid: number; name: string }[] | undefined;
};

/* ─── Helper: derive Smart Capital state per subnet ─── */
function deriveSubnetSC(psi: number, quality: number, conf: number, state: string | null): SmartCapitalState {
  const accSignal = quality * 0.5 + conf * 0.3 + clamp(psi * 0.2, 0, 20);
  const distSignal = clamp((100 - quality) * 0.4, 0, 40) +
    (psi >= 80 && quality < 50 ? 30 : 0) +
    (state === "BREAK" || state === "EXIT_FAST" ? 25 : 0);
  const score = clamp(accSignal - distSignal * 0.5 + 30, 0, 100);
  if (score >= 65) return "ACCUMULATION";
  if (score <= 35) return "DISTRIBUTION";
  return "STABLE";
}

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
  // ── Data fetching (shared query keys → cached across pages) ──

  const { data: signals, isLoading: signalsLoading } = useQuery({
    queryKey: ["unified-signals"],
    queryFn: async () => {
      const { data, error } = await supabase.from("signals_latest").select("*");
      if (error) throw error;
      return (data || []) as SignalRow[];
    },
    refetchInterval: 60_000,
  });

  const { data: rawPayloads } = useQuery({
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
      for (const r of data || []) {
        if (!map.has(r.netuid) && r.raw_payload) map.set(r.netuid, r.raw_payload);
      }
      return map;
    },
    refetchInterval: 120_000,
  });

  const { data: taoUsdRaw } = useQuery({
    queryKey: ["unified-tao-usd"],
    queryFn: async () => {
      const { data } = await supabase.from("fx_latest").select("tao_usd").limit(1).maybeSingle();
      return Number(data?.tao_usd) || 450;
    },
    refetchInterval: 300_000,
  });

  const { data: primaryMetrics } = useQuery({
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
      for (const r of data || []) {
        if (!map.has(r.netuid)) map.set(r.netuid, { netuid: r.netuid, price: Number(r.price) || null, cap: Number(r.cap) || null, vol24h: Number(r.vol_24h) || null, liquidity: Number(r.liquidity) || null, ts: r.ts, source: "taostats" });
      }
      return map;
    },
    refetchInterval: 120_000,
  });

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
      const { data, error } = await supabase.from("subnet_latest").select("netuid, vol_cap, top_miners_share, liquidity, cap");
      if (error) throw error;
      const map = new Map<number, { volCap: number; topMinersShare: number; liqRatio: number; cap: number; liq: number }>();
      for (const r of data || []) {
        if (r.netuid == null) continue;
        const cap = Number(r.cap) || 0;
        const liq = Number(r.liquidity) || 0;
        map.set(r.netuid, { volCap: Number(r.vol_cap) || 0, topMinersShare: Number(r.top_miners_share) || 0, liqRatio: cap > 0 ? liq / cap : 0, cap, liq });
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

  // ── Consensus data ──
  const consensusMap = useMemo(() => {
    if (!primaryMetrics && !secondaryMetrics) return new Map<number, { confianceData: number; dataUncertain: boolean }>();
    const pa = primaryMetrics ? [...primaryMetrics.values()] : [];
    const sa = secondaryMetrics ? [...secondaryMetrics.values()] : [];
    const fused = fuseMetrics(pa, sa);
    const map = new Map<number, { confianceData: number; dataUncertain: boolean }>();
    for (const f of fused) {
      map.set(f.netuid, { confianceData: f.confianceData, dataUncertain: f.dataUncertain });
    }
    return map;
  }, [primaryMetrics, secondaryMetrics]);

  // ── Consensus prices ──
  const consensusPrices = useMemo(() => {
    if (!primaryMetrics) return new Map<number, number>();
    const pa = [...primaryMetrics.values()];
    const sa = secondaryMetrics ? [...secondaryMetrics.values()] : [];
    const fused = fuseMetrics(pa, sa);
    const map = new Map<number, number>();
    for (const f of fused) {
      if (f.price) map.set(f.netuid, f.price);
    }
    return map;
  }, [primaryMetrics, secondaryMetrics]);

  const taoUsd = taoUsdRaw || 450;

  // ── MAIN SCORING PIPELINE (single source of truth) ──
  const { scoresList, scoresMap, scoreTimestamp } = useMemo(() => {
    if (!signals) return { scoresList: [], scoresMap: new Map<number, UnifiedSubnetScore>(), scoreTimestamp: new Date().toISOString() };

    const rate = taoUsd;
    const ts = new Date().toISOString();

    // Step 1: Compute raw scores for all subnets
    const allRows = signals
      .filter(s => s.netuid != null)
      .map(s => {
        const psi = s.mpi ?? s.score ?? 0;
        const conf = s.confidence_pct ?? 0;
        const quality = s.quality_score ?? 0;
        const consensus = consensusMap.get(s.netuid!);
        const dataUncertain = consensus?.dataUncertain ?? false;
        const confianceScore = consensus?.confianceData ?? 50;
        const dataConsistencyRisk = clamp(100 - confianceScore, 0, 100);

        // Health engine
        const payload = rawPayloads?.get(s.netuid!);
        const chainData = payload?._chain || {};
        const healthData = extractHealthData(s.netuid!, payload || {}, chainData, rate);
        const recalc = recalculate(healthData);
        let healthScores = computeAllHealthScores(healthData, recalc);

        // SN-0 Root: disable speculative penalties (liquidity, volume/MC, emission)
        if (s.netuid === 0) {
          healthScores = {
            ...healthScores,
            liquidityHealth: 80,    // neutral — not penalized
            volumeHealth: 60,       // neutral
            emissionPressure: 10,   // minimal pressure
          };
        }

        // Smart Capital
        const sc = deriveSubnetSC(psi, quality, conf, s.state);
        const scScore = sc === "ACCUMULATION" ? 70 : sc === "DISTRIBUTION" ? 20 : 45;

        // Momentum V2: multi-factor (PSI + price 7d + vol/MC)
        const sparkline = sparklines?.get(s.netuid!);
        const priceChange7d = sparkline && sparkline.length >= 2
          ? ((sparkline[sparkline.length - 1] - sparkline[0]) / sparkline[0]) * 100
          : null;
        const volMcRatio = subnetLatest?.get(s.netuid!)?.volCap ?? null;
        const momentumScore = computeMomentumScore(psi);
        const momentumScoreV2 = computeMomentumScoreV2(psi, priceChange7d, volMcRatio);
        const isCritical = s.state === "BREAK" || s.state === "EXIT_FAST" || s.state === "DEPEG_WARNING" || s.state === "DEPEG_CRITICAL";

        // Pre-hype intensity
        const preHypeIntensity = (psi > 50 && quality > 40 && sc === "ACCUMULATION") ? clamp(psi - 30, 0, 70) : 0;

        // Health-based risk & opportunity
        const riskRaw = computeHealthRisk(healthScores, dataConsistencyRisk, recalc);
        const oppRaw = computeHealthOpportunity(momentumScore, healthScores, scScore, preHypeIntensity, recalc);

        return {
          netuid: s.netuid!, psi, conf, quality, state: s.state,
          name: s.subnet_name || `SN-${s.netuid}`,
          dataUncertain, confianceScore,
          oppRaw, riskRaw,
          momentumScore, momentumScoreV2, isCritical, sc, scScore,
          healthScores, recalc,
          displayedCap: (subnetLatest?.get(s.netuid!)?.cap || 0) * rate,
          displayedLiq: (subnetLatest?.get(s.netuid!)?.liq || 0) * rate,
        };
      });

    // Step 1b: Assign momentum labels via percentile ranking
    const momentumLabels = assignMomentumLabels(
      allRows.map(r => ({ momentumScoreV2: r.momentumScoreV2, isCritical: r.isCritical }))
    );

    // Step 2: Normalize
    const oppPercentile = normalizeOpportunity(allRows.map(r => r.oppRaw));
    const riskPercentile = normalizeWithVariance(allRows.map(r => r.riskRaw), 3);

    // Step 3: Build final scores
    const scored = allRows.map((r, i) => {
      const isRoot = r.netuid === 0;
      const assetType: AssetType = isRoot ? "CORE_NETWORK" : "SPECULATIVE";

      let oppBlend = clamp(Math.round(r.oppRaw * 0.6 + oppPercentile[i] * 0.4), 5, 98);
      let riskBlend = clamp(Math.round(r.riskRaw * 0.6 + riskPercentile[i] * 0.4), 0, 100);

      const isBreak = r.state === "BREAK" || r.state === "EXIT_FAST";
      if (!isRoot && (isBreak || r.state === "DEPEG_WARNING" || r.state === "DEPEG_CRITICAL")) {
        oppBlend = 0;
      }

      // ── SN-0 Root: CORE_NETWORK overrides ──
      if (isRoot) {
        riskBlend = Math.max(riskBlend, 35);
        // Fundamental value: opp floor 30, cap 60
        oppBlend = clamp(oppBlend, 30, 60);
      }

      // Risk Override v2
      const slMetrics = subnetLatest?.get(r.netuid);
      const volMcRatio = (slMetrics?.volCap != null) ? slMetrics.volCap : undefined;
      const override = isRoot
        ? { isOverridden: false, isWarning: false, systemStatus: "OK" as SystemStatus, overrideReasons: [] }
        : evaluateRiskOverride({
            netuid: r.netuid, state: r.state, psi: r.psi, risk: riskBlend, quality: r.quality,
            liquidityUsd: r.displayedLiq > 0 ? r.displayedLiq : undefined,
            volumeMcRatio: volMcRatio,
            taoInPool: slMetrics?.liq,
          });
      if (override.isOverridden) oppBlend = 0;

      // Calibration
      const cal = calibrateScores({
        risk: riskBlend, opportunity: oppBlend,
        state: r.state, isTopRank: false, isOverridden: override.isOverridden,
      });
      let opp = cal.opportunity;
      let risk = cal.risk;

      // Root: enforce floors/caps after calibration too
      if (isRoot) {
        risk = Math.max(risk, 35);
        opp = clamp(opp, 30, 60);
      }

      let asymmetry = cal.asymmetry;
      if (r.dataUncertain) asymmetry -= 15;

      const momentum = clamp(r.psi - 40, 0, 60) / 60 * 100;
      let action: StrategicAction = override.isOverridden ? "EXIT" : deriveSubnetAction(opp, risk, r.conf);
      if (override.systemStatus !== "OK" && action === "ENTER") action = "WATCH";

      // ── Root-specific action: STAKE or NEUTRAL, never EXIT ──
      if (isRoot) {
        action = risk < 60 ? "STAKE" : "NEUTRAL";
      } else {
        checkCoherence(override.isOverridden, action);
      }

      const stability = computeStabilitySetup(opp, risk, r.conf, momentum, r.quality, r.dataUncertain);

      return {
        netuid: r.netuid,
        name: r.name,
        assetType,
        state: r.state,
        psi: r.psi,
        conf: r.conf,
        quality: r.quality,
        opp,
        risk,
        asymmetry,
        momentum,
        momentumLabel: momentumLabels[i],
        momentumScore: r.momentumScore,
        action,
        sc: r.sc,
        confianceScore: r.confianceScore,
        dataUncertain: r.dataUncertain,
        isOverridden: override.isOverridden,
        isWarning: override.isWarning,
        systemStatus: override.systemStatus,
        overrideReasons: override.overrideReasons,
        healthScores: r.healthScores,
        recalc: r.recalc,
        displayedCap: r.displayedCap,
        displayedLiq: r.displayedLiq,
        stability,
        consensusPrice: consensusPrices.get(r.netuid) ?? 0,
        alphaPrice: consensusPrices.get(r.netuid) ?? 0,
        priceVar30d: (() => {
          const p30 = price30dMap?.get(r.netuid);
          if (!p30 || p30.oldest <= 0) return null;
          return ((p30.newest - p30.oldest) / p30.oldest) * 100;
        })(),
      } satisfies UnifiedSubnetScore;
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
      console.log(`[UNIFIED-SCORES] n=${scored.length} overrides=${overrideCount} (${pct}%) warnings=${warningCount} ts=${ts}`);
    }

    return { scoresList: scored, scoresMap: map, scoreTimestamp: ts };
  }, [signals, rawPayloads, taoUsd, primaryMetrics, secondaryMetrics, subnetLatest, consensusMap, consensusPrices, price30dMap]);

  return {
    scores: scoresMap,
    scoresList,
    scoreTimestamp,
    taoUsd,
    isLoading: signalsLoading,
    sparklines,
    subnetList,
  };
}

/** Helper: get score for a single subnet */
export function getSubnetScore(scores: Map<number, UnifiedSubnetScore>, netuid: number): UnifiedSubnetScore | undefined {
  return scores.get(netuid);
}
