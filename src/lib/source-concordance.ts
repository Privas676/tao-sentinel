/* ═══════════════════════════════════════════════════════ */
/*   SOURCE CONCORDANCE — Internal Consistency Engine     */
/*   Validates that data fields tell a coherent story.    */
/*   Since TaoFlute is unavailable, we validate internal  */
/*   consistency of TaoStats data + computed metrics.     */
/*   Score: 0-100 (A/B/C/D grade)                        */
/* ═══════════════════════════════════════════════════════ */

import type { SubnetFacts } from "./subnet-facts";
import { val } from "./subnet-facts";

/* ─── Types ─── */

export type ConcordanceGrade = "A" | "B" | "C" | "D";

export type ConcordanceCheck = {
  code: string;
  label: string;
  passed: boolean;
  /** Severity: how much this check impacts the score (0-20) */
  severity: number;
  detail: string;
};

export type ConcordanceResult = {
  score: number;           // 0-100
  grade: ConcordanceGrade; // A >= 80, B >= 60, C >= 40, D < 40
  checks: ConcordanceCheck[];
  failedChecks: ConcordanceCheck[];
  /** Can we issue a strong verdict? */
  allowStrongVerdict: boolean;
  /** Force "DONNÉES INSTABLES" if true */
  forceUnstable: boolean;
};

/* ─── Grade thresholds ─── */

function gradeFromScore(score: number): ConcordanceGrade {
  if (score >= 80) return "A";
  if (score >= 60) return "B";
  if (score >= 40) return "C";
  return "D";
}

/* ─── Individual checks ─── */

function checkPriceExists(f: SubnetFacts): ConcordanceCheck {
  const price = val(f.price);
  return {
    code: "PRICE_EXISTS",
    label: "Prix disponible",
    passed: price > 0,
    severity: 20,
    detail: price > 0 ? `Prix: ${price.toFixed(6)} τ` : "Prix absent ou nul",
  };
}

function checkPoolConsistency(f: SubnetFacts): ConcordanceCheck {
  const tao = val(f.taoInPool);
  const alpha = val(f.alphaInPool);
  const price = val(f.price);
  const poolPrice = val(f.poolPrice);

  if (tao <= 0 || alpha <= 0) {
    return { code: "POOL_CONSISTENT", label: "Pool AMM cohérent", passed: false, severity: 15, detail: "Pool vide ou données manquantes" };
  }

  const haircut = Math.abs(val(f.liqHaircut));
  // Pool price and spot price should not diverge by > 30%
  const passed = haircut < 30;
  return {
    code: "POOL_CONSISTENT",
    label: "Pool AMM cohérent",
    passed,
    severity: 15,
    detail: passed
      ? `Haircut ${haircut.toFixed(1)}% — acceptable`
      : `Haircut ${haircut.toFixed(1)}% — divergence spot/pool critique`,
  };
}

function checkMomentumPriceAlignment(f: SubnetFacts): ConcordanceCheck {
  const ch24h = val(f.priceChange24h);
  const ch7d = val(f.priceChange7d);

  // Check that we have price change data
  if (ch24h === 0 && ch7d === 0 && val(f.vol24h) === 0) {
    return { code: "MOMENTUM_ALIGNED", label: "Momentum/prix alignés", passed: false, severity: 10, detail: "Aucune variation de prix ni volume — données possiblement stale" };
  }

  return { code: "MOMENTUM_ALIGNED", label: "Momentum/prix alignés", passed: true, severity: 0, detail: `Var 24h: ${ch24h.toFixed(1)}%, 7j: ${ch7d.toFixed(1)}%` };
}

function checkStructureMinimums(f: SubnetFacts): ConcordanceCheck {
  const validators = val(f.validators);
  const miners = val(f.miners);
  const activeUids = val(f.activeUids);

  const issues: string[] = [];
  if (validators < 2) issues.push(`Validators: ${validators}`);
  if (miners <= 1) issues.push(`Miners: ${miners}`);
  if (activeUids < 5) issues.push(`UIDs actifs: ${activeUids}`);

  return {
    code: "STRUCTURE_MINIMUM",
    label: "Structure minimale",
    passed: issues.length === 0,
    severity: 12,
    detail: issues.length === 0
      ? `Validators: ${validators}, Miners: ${miners}, UIDs: ${activeUids}`
      : `Structure fragile — ${issues.join(", ")}`,
  };
}

function checkLiquidityDepth(f: SubnetFacts): ConcordanceCheck {
  const taoInPool = val(f.taoInPool);
  const slippage10 = val(f.slippage10tau);

  if (taoInPool < 1) {
    return { code: "LIQUIDITY_DEPTH", label: "Profondeur liquidité", passed: false, severity: 15, detail: "Profondeur quasi nulle (< 1 TAO)" };
  }

  if (slippage10 > 20) {
    return { code: "LIQUIDITY_DEPTH", label: "Profondeur liquidité", passed: false, severity: 12, detail: `Slippage 10τ: ${slippage10.toFixed(1)}% — exécution dangereuse` };
  }

  if (slippage10 > 5) {
    return { code: "LIQUIDITY_DEPTH", label: "Profondeur liquidité", passed: true, severity: 5, detail: `Slippage 10τ: ${slippage10.toFixed(1)}% — acceptable mais élevé` };
  }

  return { code: "LIQUIDITY_DEPTH", label: "Profondeur liquidité", passed: true, severity: 0, detail: `Slippage 10τ: ${slippage10.toFixed(1)}% — bon` };
}

function checkVolumeReality(f: SubnetFacts): ConcordanceCheck {
  const vol = val(f.vol24h);
  const buys = val(f.buyCount);
  const sells = val(f.sellCount);
  const marketCap = val(f.marketCap);

  if (vol === 0 && buys === 0 && sells === 0) {
    return { code: "VOLUME_REALITY", label: "Volume réel", passed: false, severity: 8, detail: "Aucun volume ni transaction sur 24h" };
  }

  // Volume/MC ratio sanity
  if (marketCap > 0 && vol > 0) {
    const ratio = vol / marketCap;
    if (ratio > 1) {
      return { code: "VOLUME_REALITY", label: "Volume réel", passed: true, severity: 3, detail: `Volume/MC ratio ${(ratio * 100).toFixed(0)}% — potentiellement spéculatif` };
    }
  }

  return { code: "VOLUME_REALITY", label: "Volume réel", passed: true, severity: 0, detail: `Vol: ${vol.toFixed(2)}τ, Buys: ${buys}, Sells: ${sells}` };
}

function checkEmissionSanity(f: SubnetFacts): ConcordanceCheck {
  const emission = val(f.emissionPerDay);
  const marketCap = val(f.marketCap);

  if (emission === 0) {
    return { code: "EMISSION_SANITY", label: "Émissions cohérentes", passed: true, severity: 3, detail: "Émission nulle — subnet peut être inactif" };
  }

  if (marketCap > 0) {
    const ratio = emission / marketCap;
    if (ratio > 0.05) {
      return { code: "EMISSION_SANITY", label: "Émissions cohérentes", passed: false, severity: 8, detail: `Émission/MC ${(ratio * 100).toFixed(1)}% — pression vendeuse extrême` };
    }
  }

  return { code: "EMISSION_SANITY", label: "Émissions cohérentes", passed: true, severity: 0, detail: `Émission/jour: ${emission.toFixed(4)} τ` };
}

function checkRootProportion(f: SubnetFacts): ConcordanceCheck {
  const rootProp = val(f.rootProportion);

  if (rootProp > 0.99) {
    return { code: "ROOT_PROPORTION", label: "Root proportion", passed: false, severity: 10, detail: `Root prop: ${(rootProp * 100).toFixed(2)}% — quasi 100%, subnet possiblement non actif` };
  }

  if (rootProp > 0.90) {
    return { code: "ROOT_PROPORTION", label: "Root proportion", passed: true, severity: 3, detail: `Root prop: ${(rootProp * 100).toFixed(1)}% — élevé` };
  }

  return { code: "ROOT_PROPORTION", label: "Root proportion", passed: true, severity: 0, detail: `Root prop: ${(rootProp * 100).toFixed(1)}%` };
}

function checkBuySellCoherence(f: SubnetFacts): ConcordanceCheck {
  const buys = val(f.buyCount);
  const sells = val(f.sellCount);
  const ch24h = val(f.priceChange24h);

  // If heavy selling but price up significantly, or heavy buying but price down significantly — suspicious
  if (sells > buys * 3 && ch24h > 10) {
    return { code: "BUYSELL_COHERENCE", label: "Cohérence buy/sell", passed: false, severity: 8, detail: `Sells (${sells}) >> Buys (${buys}) mais prix +${ch24h.toFixed(1)}% — incohérent` };
  }
  if (buys > sells * 3 && ch24h < -10) {
    return { code: "BUYSELL_COHERENCE", label: "Cohérence buy/sell", passed: false, severity: 8, detail: `Buys (${buys}) >> Sells (${sells}) mais prix ${ch24h.toFixed(1)}% — incohérent` };
  }

  return { code: "BUYSELL_COHERENCE", label: "Cohérence buy/sell", passed: true, severity: 0, detail: `Buys: ${buys}, Sells: ${sells}, Var24h: ${ch24h.toFixed(1)}%` };
}

/* ─── External Taoflute haircut cross-validation ─── */

function checkExternalHaircut(
  f: SubnetFacts,
  externalHaircut: number | null,
): ConcordanceCheck {
  if (externalHaircut == null) {
    return { code: "EXTERNAL_HAIRCUT", label: "Haircut externe (Taoflute)", passed: true, severity: 0, detail: "Pas de données Taoflute" };
  }

  const localHaircut = Math.abs(val(f.liqHaircut));
  const extAbs = Math.abs(externalHaircut);
  const divergence = Math.abs(localHaircut - extAbs);

  // If both sources agree on severe haircut → high confidence degradation
  if (extAbs > 20 && localHaircut > 20) {
    return { code: "EXTERNAL_HAIRCUT", label: "Haircut externe (Taoflute)", passed: false, severity: 12, detail: `Haircut local: ${localHaircut.toFixed(1)}%, externe: ${extAbs.toFixed(1)}% — double confirmation dégradation` };
  }

  // If external is severe but local is not → data divergence
  if (extAbs > 20 && localHaircut < 10) {
    return { code: "EXTERNAL_HAIRCUT", label: "Haircut externe (Taoflute)", passed: false, severity: 10, detail: `Divergence: local ${localHaircut.toFixed(1)}% vs externe ${extAbs.toFixed(1)}% — risque masqué` };
  }

  // Large divergence between sources
  if (divergence > 15) {
    return { code: "EXTERNAL_HAIRCUT", label: "Haircut externe (Taoflute)", passed: false, severity: 8, detail: `Divergence sources: local ${localHaircut.toFixed(1)}% vs externe ${extAbs.toFixed(1)}%` };
  }

  return { code: "EXTERNAL_HAIRCUT", label: "Haircut externe (Taoflute)", passed: true, severity: 0, detail: `Local: ${localHaircut.toFixed(1)}%, Externe: ${extAbs.toFixed(1)}% — cohérent` };
}

/* ─── Main concordance engine ─── */

export function computeConcordance(facts: SubnetFacts, externalHaircut?: number | null): ConcordanceResult {
  const checks: ConcordanceCheck[] = [
    checkPriceExists(facts),
    checkPoolConsistency(facts),
    checkMomentumPriceAlignment(facts),
    checkStructureMinimums(facts),
    checkLiquidityDepth(facts),
    checkVolumeReality(facts),
    checkEmissionSanity(facts),
    checkRootProportion(facts),
    checkBuySellCoherence(facts),
    checkExternalHaircut(facts, externalHaircut ?? null),
  ];

  // Score: start at 100, deduct severity for each failed check
  let score = 100;
  for (const check of checks) {
    if (!check.passed) {
      score -= check.severity;
    }
  }
  score = Math.max(0, Math.min(100, score));

  const grade = gradeFromScore(score);
  const failedChecks = checks.filter(c => !c.passed);

  // Decision rules
  const allowStrongVerdict = grade === "A" || grade === "B";
  const forceUnstable = grade === "D";

  return { score, grade, checks, failedChecks, allowStrongVerdict, forceUnstable };
}

/* ─── Batch ─── */

export function computeAllConcordances(
  factsMap: Map<number, SubnetFacts>,
  externalHaircuts?: Map<number, number | null>,
): Map<number, ConcordanceResult> {
  const result = new Map<number, ConcordanceResult>();
  for (const [netuid, facts] of factsMap) {
    const extHaircut = externalHaircuts?.get(netuid) ?? null;
    result.set(netuid, computeConcordance(facts, extHaircut));
  }
  return result;
}
