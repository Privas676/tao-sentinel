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
import { type SourceMetrics } from "@/lib/data-fusion";
import {
  extractHealthData, recalculate, computeAllHealthScores,
  computeHealthRisk, computeHealthOpportunity,
  type HealthScores, type RecalculatedMetrics,
} from "@/lib/subnet-health";
import {
  evaluateAllDelistRisks, computeDelistRiskScore,
  DEPEG_PRIORITY_MANUAL, HIGH_RISK_NEAR_DELIST_MANUAL,
  type DelistRiskResult, type SubnetMetricsForDelist, type DelistCategory,
} from "@/lib/delist-risk";
import { useDelistMode } from "@/hooks/use-delist-mode";

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
  const { delistMode } = useDelistMode();
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
        const dataUncertain = false; // No longer derived from TMC divergence
        const confianceScore = consensus?.confianceData ?? 50;
        const dataConsistencyRisk = 0; // TMC decoupled: no inter-source risk

        // Health engine
        const payload = rawPayloads?.get(s.netuid!);
        const chainData = payload?._chain || {};
        const healthData = extractHealthData(s.netuid!, payload || {}, chainData, rate);
        const recalc = recalculate(healthData);
        let healthScores = computeAllHealthScores(healthData, recalc);

        // Whitelisted subnets: disable speculative penalties (liquidity, volume/MC, emission)
        if (SPECIAL_SUBNETS[s.netuid!]) {
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
      const special = SPECIAL_SUBNETS[r.netuid];
      const isWhitelisted = !!special;
      const assetType: AssetType = isWhitelisted ? "CORE_NETWORK" : "SPECULATIVE";

      let oppBlend = clamp(Math.round(r.oppRaw * 0.6 + oppPercentile[i] * 0.4), 5, 98);
      let riskBlend = clamp(Math.round(r.riskRaw * 0.6 + riskPercentile[i] * 0.4), 0, 100);

      const isBreak = r.state === "BREAK" || r.state === "EXIT_FAST";
      if (!isWhitelisted && (isBreak || r.state === "DEPEG_WARNING" || r.state === "DEPEG_CRITICAL")) {
        oppBlend = 0;
      }

      // ── SPECIAL_SUBNETS whitelist: clamp risk, force status/action ──
      // Root (SN-0) is the primary TAO staking alpha. It must never
      // trigger depeg/delist/exit rules. Risk is hard-capped via forceRiskMax.
      if (isWhitelisted) {
        riskBlend = Math.min(riskBlend, special.forceRiskMax);
        oppBlend = clamp(oppBlend, 30, 60);
      }

      // Risk Override v2 — whitelisted subnets bypass override engine
      const slMetrics = subnetLatest?.get(r.netuid);
      const volMcRatio = (slMetrics?.volCap != null) ? slMetrics.volCap : undefined;
      const override = isWhitelisted
        ? { isOverridden: false, isWarning: false, systemStatus: special.forceStatus as SystemStatus, overrideReasons: [] }
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
        state: isWhitelisted ? null : r.state, // whitelist: skip critical state penalties
        isTopRank: false, isOverridden: override.isOverridden,
      });
      let opp = cal.opportunity;
      let risk = cal.risk;

      // Whitelist: enforce risk cap after calibration too
      if (isWhitelisted) {
        risk = Math.min(risk, special.forceRiskMax);
        opp = clamp(opp, 30, 60);
      }

      let asymmetry = cal.asymmetry;
      if (isWhitelisted) asymmetry = opp - risk; // recalc with capped risk
      // dataUncertain penalty removed — TMC decoupled

      const momentum = clamp(r.psi - 40, 0, 60) / 60 * 100;
      let action: StrategicAction = override.isOverridden ? "EXIT" : deriveSubnetAction(opp, risk, r.conf);
      if (override.systemStatus !== "OK" && action === "ENTER") action = "WATCH";

      // ── Delist risk: check manual lists for quick lookup ──
      let delistCategory: DelistCategory = "NORMAL";
      let delistScore = 0;

      if (!isWhitelisted) {
        if (delistMode === "manual") {
          if (DEPEG_PRIORITY_MANUAL.includes(r.netuid)) {
            delistCategory = "DEPEG_PRIORITY";
            delistScore = 90;
          } else if (HIGH_RISK_NEAR_DELIST_MANUAL.includes(r.netuid)) {
            delistCategory = "HIGH_RISK_NEAR_DELIST";
            delistScore = 70;
          }
        } else {
          // Auto mode: use scoring from allRows metrics
          const liqTao = r.displayedLiq > 0 && rate > 0 ? r.displayedLiq / rate : 0;
          const slm = subnetLatest?.get(r.netuid);
          const volMcRatioAuto = slm?.volCap ?? 0;
          const sparkline = sparklines?.get(r.netuid);
          const priceChange7d = sparkline && sparkline.length >= 2
            ? ((sparkline[sparkline.length - 1] - sparkline[0]) / sparkline[0]) * 100
            : null;
          const autoResult = computeDelistRiskScore({
            netuid: r.netuid,
            minersActive: slm?.minersActive ?? 10,
            liqTao,
            liqUsd: r.displayedLiq,
            capTao: slm?.cap ?? 0,
            alphaPrice: slm?.price ?? 0,
            volMcRatio: volMcRatioAuto,
            psi: r.psi, quality: r.quality, state: r.state,
            priceChange7d,
            confianceData: r.confianceScore,
            liqHaircut: r.recalc?.liqHaircut ?? 0,
          });
          delistCategory = autoResult.category;
          delistScore = autoResult.score;
        }

        // ── DEPEG/DELIST COHERENCE ──
        if (delistCategory === "DEPEG_PRIORITY") {
          opp = 0;
          risk = Math.max(risk, 80);
          asymmetry = -Math.abs(asymmetry) - 20;
          action = "EXIT";
        } else if (delistCategory === "HIGH_RISK_NEAR_DELIST") {
          opp = Math.min(opp, 25);
          risk = Math.max(risk, 60);
          asymmetry = Math.min(asymmetry, -5);
          if (action === "ENTER") action = "WATCH";
        }
      }

      // ── Whitelisted subnets: force action, NEVER EXIT ──
      if (isWhitelisted) {
        action = special.forceAction;
        console.assert(action !== "EXIT", `[WHITELIST] SN-${r.netuid} must never have EXIT action`);
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
        isOverridden: override.isOverridden || delistCategory === "DEPEG_PRIORITY",
        isWarning: override.isWarning || delistCategory === "HIGH_RISK_NEAR_DELIST",
        systemStatus: delistCategory === "DEPEG_PRIORITY" ? "DEPEG" as SystemStatus : override.systemStatus,
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
        delistCategory,
        delistScore,
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

      // Whitelist invariant check: whitelisted subnets must never be EXIT
      for (const s of scored) {
        if (SPECIAL_SUBNETS[s.netuid] && s.action === "EXIT") {
          console.error(`[WHITELIST-VIOLATION] SN-${s.netuid} (${SPECIAL_SUBNETS[s.netuid].label}) has action EXIT — this should never happen!`);
        }
      }
    }

    return { scoresList: scored, scoresMap: map, scoreTimestamp: ts };
  }, [signals, rawPayloads, taoUsd, primaryMetrics, subnetLatest, consensusMap, consensusPrices, price30dMap, delistMode, sparklines]);

  return {
    scores: scoresMap,
    scoresList,
    scoreTimestamp,
    taoUsd,
    isLoading: signalsLoading,
    sparklines,
    subnetList,
    marketContext: secondaryMetrics,
  };
}

/** Helper: get score for a single subnet */
export function getSubnetScore(scores: Map<number, UnifiedSubnetScore>, netuid: number): UnifiedSubnetScore | undefined {
  return scores.get(netuid);
}
