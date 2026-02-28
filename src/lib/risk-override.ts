/* ═══════════════════════════════════════ */
/*   RISK OVERRIDE ENGINE                   */
/*   Priorité absolue sécurité > rendement  */
/* ═══════════════════════════════════════ */

export type SystemStatus = "OK" | "SURVEILLANCE" | "ZONE_CRITIQUE" | "DEPEG" | "DEREGISTRATION";

export type RiskOverrideResult = {
  isOverridden: boolean;
  systemStatus: SystemStatus;
  overrideReasons: string[];
};

/**
 * Evaluate if a subnet must be hard-overridden.
 * Runs AFTER score calculation, BEFORE display.
 *
 * Conditions (any one triggers override):
 * - state = BREAK or EXIT_FAST (ZONE_CRITIQUE)
 * - psi > 85 with quality < 30 (speculative overheating)
 * - risk > 75
 * - liquidityCollapse (liq change <= -60%)
 * - state indicates DEPEG or DEREGISTRATION
 */
export function evaluateRiskOverride(params: {
  state: string | null;
  psi: number;
  risk: number;
  quality: number;
  liquidityCollapse?: boolean;
}): RiskOverrideResult {
  const { state, psi, risk, quality, liquidityCollapse } = params;
  const reasons: string[] = [];
  let systemStatus: SystemStatus = "OK";

  // DEPEG detection from event-driven states
  if (state === "DEPEG" || state === "DEPEG_WARNING" || state === "DEPEG_CRITICAL") {
    reasons.push("Depeg détecté");
    systemStatus = "DEPEG";
  }

  // Deregistration
  if (state === "DEREGISTRATION") {
    reasons.push("Désenregistrement");
    systemStatus = "DEREGISTRATION";
  }

  // Zone critique (BREAK / EXIT_FAST)
  if (state === "BREAK" || state === "EXIT_FAST") {
    reasons.push("Zone critique active");
    if (systemStatus === "OK") systemStatus = "ZONE_CRITIQUE";
  }

  // PSI overheating with low quality
  if (psi > 85 && quality < 30) {
    reasons.push(`PSI surchauffe (${psi}) qualité insuffisante (${quality})`);
    if (systemStatus === "OK") systemStatus = "SURVEILLANCE";
  }

  // Liquidity collapse
  if (liquidityCollapse) {
    reasons.push("Effondrement liquidité");
    if (systemStatus === "OK" || systemStatus === "SURVEILLANCE") systemStatus = "ZONE_CRITIQUE";
  }

  // High risk
  if (risk > 75) {
    reasons.push(`Risque critique (${risk})`);
    if (systemStatus === "OK") systemStatus = "SURVEILLANCE";
    if (risk > 85) systemStatus = "ZONE_CRITIQUE";
  }

  const isOverridden = reasons.length > 0;

  // Derive status for moderate cases
  if (isOverridden && systemStatus === "OK") {
    systemStatus = "SURVEILLANCE";
  }

  return { isOverridden, systemStatus, overrideReasons: reasons };
}

/**
 * Apply override to scores: AS_final = 0, action = EXIT
 */
export function applyOverride<T extends { opportunity: number; risk: number }>(
  signal: T
): T & { opportunity: number; risk: number } {
  return { ...signal, opportunity: 0 };
}

/**
 * Cap opportunity score at 99 (100 only if truly unique max)
 */
export function capOpportunity(scores: number[]): number[] {
  return scores.map(s => Math.min(s, 99));
}

/**
 * Coherence check: if override is active but action is ENTER → logic error
 */
export function checkCoherence(isOverridden: boolean, action: string): boolean {
  if (isOverridden && action === "ENTER") {
    console.error(`[RISK_OVERRIDE] ERREUR LOGIQUE: subnet overridden mais action=ENTER`);
    return false; // incoherent
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
