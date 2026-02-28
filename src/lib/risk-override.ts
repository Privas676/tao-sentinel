/* ═══════════════════════════════════════ */
/*   RISK OVERRIDE ENGINE v2                 */
/*   Hiérarchisé: ≥2 hard conditions         */
/*   Cooldown 6h, raréfaction, explicable    */
/* ═══════════════════════════════════════ */

export type SystemStatus = "OK" | "SURVEILLANCE" | "ZONE_CRITIQUE" | "DEPEG" | "DEREGISTRATION";

export type HardCondition =
  | "EMISSION_ZERO"
  | "TAO_POOL_CRITICAL"
  | "LIQUIDITY_USD_CRITICAL"
  | "VOL_MC_LOW"
  | "SLIPPAGE_HIGH"
  | "DEPEG"
  | "DEREGISTRATION"
  | "BREAK_STATE";

export type RiskOverrideResult = {
  isOverridden: boolean;
  isWarning: boolean;           // 1 hard condition → warning badge only
  systemStatus: SystemStatus;
  overrideReasons: string[];
  hardConditions: HardCondition[];
};

// ── Cooldown cache (in-memory, per session) ──
const overrideCooldowns = new Map<number, number>(); // netuid → timestamp
const COOLDOWN_MS = 6 * 60 * 60 * 1000; // 6 hours

/** Check cooldown: returns true if the override should be suppressed */
function isCoolingDown(netuid: number): boolean {
  const lastTs = overrideCooldowns.get(netuid);
  if (!lastTs) return false;
  return Date.now() - lastTs < COOLDOWN_MS;
}

/** Record an override emission */
function recordOverride(netuid: number): void {
  overrideCooldowns.set(netuid, Date.now());
}

/** Clear cooldown (for testing) */
export function clearOverrideCooldowns(): void {
  overrideCooldowns.clear();
}

// ── Thresholds ──
const THRESHOLDS = {
  TAO_POOL_CRITICAL: 5,       // TAO in pool < 5 TAO
  LIQUIDITY_USD_CRITICAL: 500, // liquidity < $500
  VOL_MC_MIN: 0.005,          // volume/MC < 0.5%
  SLIPPAGE_5K: 0.05,          // simulated slippage > 5% on $5k
};

/**
 * Evaluate hard conditions for a subnet.
 * Override triggers ONLY if ≥2 hard conditions are met.
 * Single condition → warning only (badge, no action override).
 */
export function evaluateRiskOverride(params: {
  netuid: number;
  state: string | null;
  psi: number;
  risk: number;
  quality: number;
  liquidityCollapse?: boolean;
  // New v2 params (optional, from metrics)
  emissionTao?: number;
  taoInPool?: number;
  liquidityUsd?: number;
  volumeMcRatio?: number;
  slippagePct?: number;
}): RiskOverrideResult {
  const {
    netuid, state, psi, risk, quality, liquidityCollapse,
    emissionTao, taoInPool, liquidityUsd, volumeMcRatio, slippagePct,
  } = params;

  const hardConditions: HardCondition[] = [];
  const reasons: string[] = [];
  let systemStatus: SystemStatus = "OK";

  // ── Hard condition checks ──

  // 1. DEPEG
  if (state === "DEPEG" || state === "DEPEG_WARNING" || state === "DEPEG_CRITICAL") {
    hardConditions.push("DEPEG");
    reasons.push("Depeg détecté");
    systemStatus = "DEPEG";
  }

  // 2. Deregistration
  if (state === "DEREGISTRATION") {
    hardConditions.push("DEREGISTRATION");
    reasons.push("Désenregistrement");
    systemStatus = "DEREGISTRATION";
  }

  // 3. BREAK/EXIT_FAST (zone critique)
  if (state === "BREAK" || state === "EXIT_FAST") {
    hardConditions.push("BREAK_STATE");
    reasons.push("Zone critique active");
  }

  // 4. Emission zero or near-zero
  if (emissionTao !== undefined && emissionTao <= 0.001) {
    hardConditions.push("EMISSION_ZERO");
    reasons.push("Émission nulle/critique");
  }

  // 5. TAO in pool critical
  if (taoInPool !== undefined && taoInPool < THRESHOLDS.TAO_POOL_CRITICAL) {
    hardConditions.push("TAO_POOL_CRITICAL");
    reasons.push(`TAO en pool critique (${taoInPool.toFixed(1)})`);
  }

  // 6. Liquidity USD critical
  if (liquidityUsd !== undefined && liquidityUsd < THRESHOLDS.LIQUIDITY_USD_CRITICAL) {
    hardConditions.push("LIQUIDITY_USD_CRITICAL");
    reasons.push(`Liquidité critique ($${Math.round(liquidityUsd)})`);
  }

  // 7. Volume/MC ratio too low
  if (volumeMcRatio !== undefined && volumeMcRatio < THRESHOLDS.VOL_MC_MIN) {
    hardConditions.push("VOL_MC_LOW");
    reasons.push(`Vol/MC trop faible (${(volumeMcRatio * 100).toFixed(2)}%)`);
  }

  // 8. Slippage high (simulated)
  if (slippagePct !== undefined && slippagePct > THRESHOLDS.SLIPPAGE_5K) {
    hardConditions.push("SLIPPAGE_HIGH");
    reasons.push(`Slippage élevé (${(slippagePct * 100).toFixed(1)}%)`);
  }

  // 9. Liquidity collapse (legacy compat)
  if (liquidityCollapse && !hardConditions.includes("LIQUIDITY_USD_CRITICAL")) {
    hardConditions.push("LIQUIDITY_USD_CRITICAL");
    reasons.push("Effondrement liquidité");
  }

  // 10. PSI overheating + low quality → counts as hard condition
  if (psi > 85 && quality < 30) {
    // Not a hard condition by itself, but contributes to warning
    reasons.push(`PSI surchauffe (${psi}) qualité insuffisante (${quality})`);
  }

  // 11. High risk → contributes to warning only
  if (risk > 85) {
    reasons.push(`Risque critique (${risk})`);
  }

  // ── Decision: Override vs Warning vs OK ──
  const hardCount = hardConditions.length;
  const isOverrideCandidate = hardCount >= 2;
  const isWarningCandidate = hardCount === 1;

  // Apply cooldown: suppress repeated overrides for same subnet within 6h
  let isOverridden = false;
  let isWarning = false;

  if (isOverrideCandidate) {
    if (isCoolingDown(netuid)) {
      // Cooldown active: downgrade to warning
      isWarning = true;
    } else {
      isOverridden = true;
      recordOverride(netuid);
    }
  } else if (isWarningCandidate) {
    isWarning = true;
  }

  // Determine system status
  if (isOverridden) {
    if (systemStatus === "OK") {
      systemStatus = hardConditions.some(c => c === "DEPEG" || c === "DEREGISTRATION")
        ? systemStatus // already set above
        : "ZONE_CRITIQUE";
    }
  } else if (isWarning) {
    if (systemStatus === "OK") systemStatus = "SURVEILLANCE";
  }

  // Audit log
  if (isOverridden || isWarning) {
    console.log(`[OVERRIDE] SN-${netuid}: ${isOverridden ? 'OVERRIDE' : 'WARNING'} | hard=${hardCount} | ${hardConditions.join(',')} | reasons=${reasons.join('; ')}`);
  }

  return {
    isOverridden,
    isWarning,
    systemStatus,
    overrideReasons: reasons,
    hardConditions,
  };
}

/**
 * Cap opportunity score: enforce anti-100 rule
 */
export function capOpportunity(scores: number[]): number[] {
  const maxScore = Math.max(...scores);
  const maxCount = scores.filter(s => s === maxScore).length;
  const uniqueMax = maxCount === 1;

  return scores.map(s => {
    if (s >= 100) {
      return uniqueMax && s === maxScore ? 100 : 99;
    }
    return Math.min(s, 99);
  });
}

/**
 * Coherence check: override active but action is ENTER → error
 */
export function checkCoherence(isOverridden: boolean, action: string): boolean {
  if (isOverridden && action === "ENTER") {
    console.error(`[RISK_OVERRIDE] ERREUR LOGIQUE: subnet overridden mais action=ENTER`);
    return false;
  }
  return true;
}

/** System status color */
export function systemStatusColor(status: SystemStatus): string {
  switch (status) {
    case "OK": return "rgba(76,175,80,0.7)";
    case "SURVEILLANCE": return "rgba(255,193,7,0.8)";
    case "ZONE_CRITIQUE": return "rgba(229,57,53,0.85)";
    case "DEPEG": return "rgba(229,57,53,0.95)";
    case "DEREGISTRATION": return "rgba(229,57,53,0.95)";
  }
}

/** System status label */
export function systemStatusLabel(status: SystemStatus): string {
  switch (status) {
    case "OK": return "OK";
    case "SURVEILLANCE": return "Surveillance";
    case "ZONE_CRITIQUE": return "Zone Critique";
    case "DEPEG": return "Depeg";
    case "DEREGISTRATION": return "Deregistration";
  }
}
