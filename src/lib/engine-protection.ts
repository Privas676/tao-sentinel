/* ═══════════════════════════════════════ */
/*   PROTECTION ENGINE                       */
/*   Safety signals: depeg, liquidity,       */
/*   volatility, override, delist            */
/*   NO dependency on StrategicEngine        */
/*   NO hardcoded scores                     */
/* ═══════════════════════════════════════ */

import {
  evaluateRiskOverride,
  type RiskOverrideResult,
  type SystemStatus,
} from "./risk-override";
import {
  computeDelistRiskScore,
  DEPEG_PRIORITY_MANUAL,
  HIGH_RISK_NEAR_DELIST_MANUAL,
  type DelistCategory,
  type DelistRiskResult,
} from "./delist-risk";
import {
  evaluateDepegState,
  type DepegInput,
  type DepegResult,
  type DepegState,
} from "./depeg-probability";

/* ── Types ── */

export type ProtectionInput = {
  netuid: number;
  state: string | null;
  psi: number;
  quality: number;
  risk: number; // raw risk from health engine (NOT strategic blended)
  // Metrics for override engine
  liquidityUsd?: number;
  volumeMcRatio?: number;
  taoInPool?: number;
  // Metrics for delist scoring
  minersActive: number;
  liqTao: number;
  liqUsd: number;
  capTao: number;
  alphaPrice: number;
  priceChange7d: number | null;
  confianceData: number;
  liqHaircut: number;
  // Delist mode
  delistMode: string;
  // Depeg probability inputs (v2: price-drop based)
  price24hAgo?: number | null;
  price7dAgo?: number | null;
  historyDays?: number;
};

export type ProtectionOutput = {
  netuid: number;
  isOverridden: boolean;
  isWarning: boolean;
  systemStatus: SystemStatus;
  overrideReasons: string[];
  delistCategory: DelistCategory;
  delistScore: number;
  // Depeg probability
  depegProbability: number;
  depegState: DepegState;
  depegSignals: string[];
};

/**
 * Evaluate protection signals for a single subnet.
 * Pure function: no strategic scoring dependencies.
 * Delist scores are ALWAYS computed from metrics, never hardcoded.
 */
export function evaluateProtection(input: ProtectionInput): ProtectionOutput {
  // 1. Risk Override (structural dangers)
  const override: RiskOverrideResult = evaluateRiskOverride({
    netuid: input.netuid,
    state: input.state,
    psi: input.psi,
    risk: input.risk,
    quality: input.quality,
    liquidityUsd: input.liquidityUsd,
    volumeMcRatio: input.volumeMcRatio,
    taoInPool: input.taoInPool,
  });

  // 2. Delist risk — always computed from metrics
  const autoResult = computeDelistRiskScore({
    netuid: input.netuid,
    minersActive: input.minersActive,
    liqTao: input.liqTao,
    liqUsd: input.liqUsd,
    capTao: input.capTao,
    alphaPrice: input.alphaPrice,
    volMcRatio: input.volumeMcRatio ?? 0,
    psi: input.psi,
    quality: input.quality,
    state: input.state,
    priceChange7d: input.priceChange7d,
    confianceData: input.confianceData,
    liqHaircut: input.liqHaircut,
  });

  let delistCategory = autoResult.category;
  let delistScore = autoResult.score;

  // In manual mode, manual lists can PROMOTE category (never demote)
  // but the score is always the computed one (with a small manual bonus)
  if (input.delistMode === "manual") {
    const MANUAL_DEPEG_BONUS = 15;
    const MANUAL_HIGH_RISK_BONUS = 8;
    if (DEPEG_PRIORITY_MANUAL.includes(input.netuid)) {
      delistScore = Math.min(100, delistScore + MANUAL_DEPEG_BONUS);
      if (delistCategory !== "DEPEG_PRIORITY") delistCategory = "DEPEG_PRIORITY";
    } else if (HIGH_RISK_NEAR_DELIST_MANUAL.includes(input.netuid)) {
      delistScore = Math.min(100, delistScore + MANUAL_HIGH_RISK_BONUS);
      if (delistCategory === "NORMAL") delistCategory = "HIGH_RISK_NEAR_DELIST";
    }
  }

  // 3. Depeg Probability — tick-based state machine (v2: price-drop based)
  const depegInput: DepegInput = {
    netuid: input.netuid,
    alphaPrice: input.alphaPrice,
    price24hAgo: input.price24hAgo ?? null,
    price7dAgo: input.price7dAgo ?? null,
    dataConfidence: input.confianceData,
    historyDays: input.historyDays,
  };
  const depeg: DepegResult = evaluateDepegState(depegInput);

  // Derive final system status
  let systemStatus = override.systemStatus;
  if (depeg.state === "DEPEG_CONFIRMED") {
    systemStatus = "DEPEG";
  } else if (delistCategory === "DEPEG_PRIORITY") {
    systemStatus = "DEPEG";
  } else if (depeg.state === "DEPEG_HIGH_RISK" && systemStatus === "OK") {
    systemStatus = "SURVEILLANCE";
  }

  return {
    netuid: input.netuid,
    isOverridden: override.isOverridden || delistCategory === "DEPEG_PRIORITY" || depeg.state === "DEPEG_CONFIRMED",
    isWarning: override.isWarning || delistCategory === "HIGH_RISK_NEAR_DELIST" || depeg.state === "DEPEG_HIGH_RISK",
    systemStatus,
    overrideReasons: override.overrideReasons,
    delistCategory,
    delistScore,
    depegProbability: depeg.drop24 != null || depeg.drop7 != null ? (depeg.state === "DEPEG_CONFIRMED" ? 90 : depeg.state === "DEPEG_HIGH_RISK" ? 60 : 0) : 0,
    depegState: depeg.state,
    depegSignals: depeg.signals.map(s => s.label),
  };
}

/**
 * Batch evaluate protection for all subnets.
 */
export function evaluateAllProtections(inputs: ProtectionInput[]): Map<number, ProtectionOutput> {
  const map = new Map<number, ProtectionOutput>();
  for (const input of inputs) {
    map.set(input.netuid, evaluateProtection(input));
  }
  return map;
}
