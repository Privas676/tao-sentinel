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
 * Section 7: DEPEG coherence + existing rules.
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

  // DEPEG detection
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

  if (isOverridden && systemStatus === "OK") {
    systemStatus = "SURVEILLANCE";
  }

  return { isOverridden, systemStatus, overrideReasons: reasons };
}

/**
 * Cap opportunity score: enforce anti-100 rule
 */
export function capOpportunity(scores: number[]): number[] {
  // Find unique max
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
