/* ═══════════════════════════════════════ */
/*   RISK OVERRIDE ENGINE v3                 */
/*   Weighted overrideScore approach         */
/*   Warning ≥ 0.70, Critical ≥ 0.85        */
/*   Cooldown 30min, re-alert if +0.15      */
/* ═══════════════════════════════════════ */

export type SystemStatus = "OK" | "SURVEILLANCE" | "ZONE_CRITIQUE" | "DEPEG" | "DEREGISTRATION";

export type OverrideFlag =
  | "POOL_FAIBLE"
  | "ZONE_CRITIQUE_STATE"
  | "LIQUIDITY_STRESS"
  | "UID_FAIBLE"
  | "VOL_MC_ANOMALIE"
  | "DEPEG"
  | "DEREGISTRATION"
  | "EMISSION_ZERO"
  | "SLIPPAGE_HIGH";

export type RiskOverrideResult = {
  isOverridden: boolean;       // Critical override (score >= 0.85)
  isWarning: boolean;          // Warning (score >= 0.70)
  systemStatus: SystemStatus;
  overrideReasons: string[];
  overrideScore: number;       // 0..1 weighted score
  flags: OverrideFlag[];
  /** @deprecated use flags instead */
  hardConditions: OverrideFlag[];
};

/* ── Flag weights ── */

const FLAG_WEIGHTS: Record<OverrideFlag, number> = {
  POOL_FAIBLE:         0.35,   // fort
  ZONE_CRITIQUE_STATE: 0.30,   // fort
  LIQUIDITY_STRESS:    0.30,   // fort
  DEPEG:               0.50,   // très fort
  DEREGISTRATION:      0.50,   // très fort
  EMISSION_ZERO:       0.25,   // moyen-fort
  UID_FAIBLE:          0.12,   // faible-moyen
  VOL_MC_ANOMALIE:     0.18,   // moyen
  SLIPPAGE_HIGH:       0.20,   // moyen
};

/* ── Thresholds ── */

const OVERRIDE_WARNING_THRESHOLD = 0.70;
const OVERRIDE_CRITICAL_THRESHOLD = 0.85;
const MIN_FLAGS_FOR_OVERRIDE = 2;

const THRESHOLDS = {
  TAO_POOL_CRITICAL: 5,        // TAO in pool < 5
  LIQUIDITY_USD_CRITICAL: 500,  // < $500
  VOL_MC_MIN: 0.005,           // < 0.5%
  SLIPPAGE_5K: 0.05,           // > 5%
  MINERS_MIN: 3,               // < 3 active miners
};

/* ── Cooldown cache ── */

type CooldownEntry = { ts: number; score: number };
const overrideCooldowns = new Map<number, CooldownEntry>();
const COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes
const RE_ALERT_DELTA = 0.15;        // re-alert if score jumps +0.15

function shouldSuppress(netuid: number, currentScore: number): boolean {
  const entry = overrideCooldowns.get(netuid);
  if (!entry) return false;
  const elapsed = Date.now() - entry.ts;
  if (elapsed >= COOLDOWN_MS) return false;
  // Re-alert if score increased significantly
  if (currentScore - entry.score >= RE_ALERT_DELTA) return false;
  return true;
}

function recordOverride(netuid: number, score: number): void {
  overrideCooldowns.set(netuid, { ts: Date.now(), score });
}

/** Clear cooldown (for testing) */
export function clearOverrideCooldowns(): void {
  overrideCooldowns.clear();
}

/* ── Main evaluation ── */

export function evaluateRiskOverride(params: {
  netuid: number;
  state: string | null;
  psi: number;
  risk: number;
  quality: number;
  liquidityCollapse?: boolean;
  emissionTao?: number;
  taoInPool?: number;
  liquidityUsd?: number;
  volumeMcRatio?: number;
  slippagePct?: number;
  minersActive?: number;
  /** When true, market-data-dependent flags are suppressed (Taostats 429) */
  marketDataDegraded?: boolean;
}): RiskOverrideResult {
  const {
    netuid, state, psi, risk, quality, liquidityCollapse,
    emissionTao, taoInPool, liquidityUsd, volumeMcRatio, slippagePct, minersActive,
  } = params;
    marketDataDegraded = false,

  const flags: OverrideFlag[] = [];
  const reasons: string[] = [];
  let systemStatus: SystemStatus = "OK";

  // ── Flag detection ──

  // 1. DEPEG (très fort)
  if (state === "DEPEG" || state === "DEPEG_WARNING" || state === "DEPEG_CRITICAL") {
    flags.push("DEPEG");
    reasons.push("Depeg détecté");
    systemStatus = "DEPEG";
  }

  // 2. Deregistration (très fort)
  if (state === "DEREGISTRATION") {
    flags.push("DEREGISTRATION");
    reasons.push("Désenregistrement");
    systemStatus = "DEREGISTRATION";
  }

  // 3. Zone critique (fort)
  if (state === "BREAK" || state === "EXIT_FAST") {
    flags.push("ZONE_CRITIQUE_STATE");
    reasons.push("Zone critique active");
  }

  // 4. Pool faible (fort)
  if (taoInPool !== undefined && taoInPool < THRESHOLDS.TAO_POOL_CRITICAL) {
    flags.push("POOL_FAIBLE");
    reasons.push(`TAO en pool critique (${taoInPool.toFixed(1)})`);
  }

  // 5. Liquidity stress (fort)
  if (liquidityUsd !== undefined && liquidityUsd < THRESHOLDS.LIQUIDITY_USD_CRITICAL) {
    flags.push("LIQUIDITY_STRESS");
    reasons.push(`Liquidité critique ($${Math.round(liquidityUsd)})`);
  }
  if (liquidityCollapse && !flags.includes("LIQUIDITY_STRESS")) {
    flags.push("LIQUIDITY_STRESS");
    reasons.push("Effondrement liquidité");
  }

  // 6. Emission zero (moyen-fort)
  if (emissionTao !== undefined && emissionTao <= 0.001) {
    flags.push("EMISSION_ZERO");
    reasons.push("Émission nulle/critique");
  }

  // 7. Vol/MC anomalie (moyen)
  if (volumeMcRatio !== undefined && volumeMcRatio < THRESHOLDS.VOL_MC_MIN) {
    flags.push("VOL_MC_ANOMALIE");
    reasons.push(`Vol/MC trop faible (${(volumeMcRatio * 100).toFixed(2)}%)`);
  }

  // 8. Slippage high (moyen)
  if (slippagePct !== undefined && slippagePct > THRESHOLDS.SLIPPAGE_5K) {
    flags.push("SLIPPAGE_HIGH");
    reasons.push(`Slippage élevé (${(slippagePct * 100).toFixed(1)}%)`);
  }

  // 9. UID faible (faible-moyen)
  if (minersActive !== undefined && minersActive < THRESHOLDS.MINERS_MIN) {
    flags.push("UID_FAIBLE");
    reasons.push(`UIDs actifs faibles (${minersActive})`);
  }

  // ── Compute weighted overrideScore ──
  let overrideScore = 0;
  for (const f of flags) {
    overrideScore += FLAG_WEIGHTS[f] || 0;
  }
  overrideScore = Math.min(overrideScore, 1.0);

  // ── Decision: requires nb_flags >= 2 AND score threshold ──
  const flagCount = flags.length;
  let isOverridden = false;
  let isWarning = false;

  if (flagCount >= MIN_FLAGS_FOR_OVERRIDE) {
    if (overrideScore >= OVERRIDE_CRITICAL_THRESHOLD) {
      // Critical override
      if (shouldSuppress(netuid, overrideScore)) {
        isWarning = true; // cooldown → downgrade to warning
      } else {
        isOverridden = true;
        recordOverride(netuid, overrideScore);
      }
    } else if (overrideScore >= OVERRIDE_WARNING_THRESHOLD) {
      isWarning = true;
    }
  } else if (flagCount === 1 && overrideScore >= 0.30) {
    // Single strong flag → surveillance only
    isWarning = true;
  }

  // Determine system status
  if (isOverridden) {
    if (systemStatus === "OK") {
      systemStatus = flags.includes("DEPEG") || flags.includes("DEREGISTRATION")
        ? systemStatus
        : "ZONE_CRITIQUE";
    }
  } else if (isWarning) {
    if (systemStatus === "OK") systemStatus = "SURVEILLANCE";
  }

  // Audit log (only for non-OK)
  if (isOverridden || isWarning) {
    console.log(`[OVERRIDE-v3] SN-${netuid}: ${isOverridden ? 'CRITICAL' : 'WARNING'} | score=${overrideScore.toFixed(2)} | flags=${flagCount} [${flags.join(',')}] | ${reasons.join('; ')}`);
  }

  return {
    isOverridden,
    isWarning,
    systemStatus,
    overrideReasons: reasons,
    overrideScore: Math.round(overrideScore * 100) / 100,
    flags,
    hardConditions: flags, // backward compat
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
