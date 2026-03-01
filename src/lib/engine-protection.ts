/* ═══════════════════════════════════════ */
/*   PROTECTION ENGINE                       */
/*   Safety signals: depeg, liquidity,       */
/*   volatility, override, delist            */
/*   NO dependency on StrategicEngine        */
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
};

export type ProtectionOutput = {
  netuid: number;
  isOverridden: boolean;
  isWarning: boolean;
  systemStatus: SystemStatus;
  overrideReasons: string[];
  delistCategory: DelistCategory;
  delistScore: number;
};

/**
 * Evaluate protection signals for a single subnet.
 * Pure function: no strategic scoring dependencies.
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

  // 2. Delist risk
  let delistCategory: DelistCategory = "NORMAL";
  let delistScore = 0;

  if (input.delistMode === "manual") {
    if (DEPEG_PRIORITY_MANUAL.includes(input.netuid)) {
      delistCategory = "DEPEG_PRIORITY";
      delistScore = 90;
    } else if (HIGH_RISK_NEAR_DELIST_MANUAL.includes(input.netuid)) {
      delistCategory = "HIGH_RISK_NEAR_DELIST";
      delistScore = 70;
    }
  } else {
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
    delistCategory = autoResult.category;
    delistScore = autoResult.score;
  }

  // Derive final system status
  let systemStatus = override.systemStatus;
  if (delistCategory === "DEPEG_PRIORITY") {
    systemStatus = "DEPEG";
  }

  return {
    netuid: input.netuid,
    isOverridden: override.isOverridden || delistCategory === "DEPEG_PRIORITY",
    isWarning: override.isWarning || delistCategory === "HIGH_RISK_NEAR_DELIST",
    systemStatus,
    overrideReasons: override.overrideReasons,
    delistCategory,
    delistScore,
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
