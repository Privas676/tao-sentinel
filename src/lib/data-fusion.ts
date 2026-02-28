/* ═══════════════════════════════════════ */
/*   DATA CONSENSUS ENGINE                  */
/*   Cross-source fusion & validation       */
/* ═══════════════════════════════════════ */

export type SourceMetrics = {
  netuid: number;
  price: number | null;
  cap: number | null;
  vol24h: number | null;
  liquidity: number | null;
  ts: string | null;
  source: string;
};

export type ConsensusMetrics = {
  netuid: number;
  price: number | null;
  cap: number | null;
  vol24h: number | null;
  liquidity: number | null;
  primarySource: string;
  confianceData: number;     // 0-100
  dataUncertain: boolean;    // divergence > 0.35 on major field
  divergences: DivergenceInfo[];
  fieldDivergences: Record<string, number>;  // field → divergence ratio
};

// Legacy alias
export type FusedMetrics = ConsensusMetrics;

export type DivergenceInfo = {
  netuid: number;
  field: string;
  primaryValue: number;
  secondaryValue: number;
  pctDiff: number;
};

export type GlobalConfianceData = {
  score: number;
  concordance: number;
  freshness: number;
  completeness: number;
  availability: number;
  divergentSubnets: DivergenceInfo[];
};

/* ─── Helpers ─── */
const EPS = 1e-9;

function divergenceRatio(a: number, b: number): number {
  const mean = (Math.abs(a) + Math.abs(b)) / 2;
  if (mean < EPS) return 0;
  return Math.abs(a - b) / mean;
}

function pctDiff(a: number, b: number): number {
  return divergenceRatio(a, b) * 100;
}

function median2(a: number, b: number): number {
  return (a + b) / 2;
}

function minutesAgo(ts: string | null): number {
  if (!ts) return 999;
  return (Date.now() - new Date(ts).getTime()) / 60_000;
}

function countFields(m: SourceMetrics): number {
  let count = 0;
  if (m.price != null && m.price > 0) count++;
  if (m.cap != null && m.cap > 0) count++;
  if (m.vol24h != null && m.vol24h > 0) count++;
  if (m.liquidity != null && m.liquidity > 0) count++;
  return (count / 4) * 100;
}

/* ─── Consensus-based confidence (Section 1.2) ─── */
function computeConsensusConfidence(
  primary: SourceMetrics | undefined,
  secondary: SourceMetrics | undefined
): { score: number; divergences: DivergenceInfo[]; dataUncertain: boolean; fieldDivergences: Record<string, number> } {
  const divergences: DivergenceInfo[] = [];
  const fieldDivergences: Record<string, number> = {};
  let dataUncertain = false;

  if (!primary && !secondary) return { score: 0, divergences, dataUncertain: true, fieldDivergences };
  if (!secondary) {
    const freshness = primary ? Math.max(0, 100 - minutesAgo(primary.ts) * 2) : 0;
    const completeness = primary ? countFields(primary) : 0;
    return { score: Math.round(freshness * 0.4 + completeness * 0.4 + 20), divergences, dataUncertain: false, fieldDivergences };
  }
  if (!primary) {
    const freshness = Math.max(0, 100 - minutesAgo(secondary.ts) * 2);
    const completeness = countFields(secondary);
    return { score: Math.round(freshness * 0.4 + completeness * 0.4 + 10), divergences, dataUncertain: false, fieldDivergences };
  }

  // Both sources: compute per-field divergence with tiered tolerances (Section 3)
  const fieldTolerances: Record<string, { ok: number; warn: number; critical: number }> = {
    price:  { ok: 0.005, warn: 0.01, critical: 0.01 },   // <0.5% OK, 0.5-1% Warn, >1% Critical
    cap:    { ok: 0.02, warn: 0.05, critical: 0.05 },     // <2% OK, 2-5% Warn, >5% Critical
    vol24h: { ok: 0.05, warn: 0.15, critical: 0.15 },     // Volume more volatile
  };

  const majorFields: (keyof SourceMetrics)[] = ["price", "cap", "vol24h"];
  const divergenceValues: number[] = [];
  let warningCount = 0;
  let criticalCount = 0;

  for (const field of majorFields) {
    const pVal = primary[field] as number | null;
    const sVal = secondary[field] as number | null;
    if (pVal != null && pVal > 0 && sVal != null && sVal > 0) {
      const div = divergenceRatio(pVal, sVal);
      fieldDivergences[field] = div;
      divergenceValues.push(div);

      const tol = fieldTolerances[field] || { ok: 0.05, warn: 0.10, critical: 0.10 };

      // Track divergent fields with severity
      if (div > tol.critical) {
        criticalCount++;
        divergences.push({
          netuid: primary.netuid, field,
          primaryValue: pVal, secondaryValue: sVal,
          pctDiff: Math.round(div * 1000) / 10,
        });
      } else if (div > tol.ok) {
        warningCount++;
        if (div > 0.03) { // Only show in details if > 3%
          divergences.push({
            netuid: primary.netuid, field,
            primaryValue: pVal, secondaryValue: sVal,
            pctDiff: Math.round(div * 1000) / 10,
          });
        }
      }

      // DATA_UNCERTAIN: critical divergence on price or cap
      if ((field === "price" || field === "cap") && div > tol.critical) {
        dataUncertain = true;
      }
    }
  }

  // Confidence = weighted by severity
  const meanDiv = divergenceValues.length > 0
    ? divergenceValues.reduce((a, b) => a + b, 0) / divergenceValues.length
    : 0;
  const severityPenalty = criticalCount * 15 + warningCount * 5;
  const divPenalty = Math.min(meanDiv * 150, 50);
  const baseConfidence = 100 - divPenalty - severityPenalty;

  // Freshness bonus
  const freshP = Math.max(0, 100 - minutesAgo(primary.ts) * 2);
  const freshS = Math.max(0, 100 - minutesAgo(secondary.ts) * 2);
  const freshness = freshP * 0.6 + freshS * 0.4;

  // Final score
  const score = Math.round(baseConfidence * 0.75 + (freshness / 100) * 25);

  return {
    score: Math.max(0, Math.min(100, score)),
    divergences,
    dataUncertain,
    fieldDivergences,
  };
}

/* ─── Fuse metrics using median consensus (Section 1.1) ─── */
export function fuseMetrics(
  primaryMetrics: SourceMetrics[],
  secondaryMetrics: SourceMetrics[]
): ConsensusMetrics[] {
  const secondaryMap = new Map<number, SourceMetrics>();
  for (const s of secondaryMetrics) secondaryMap.set(s.netuid, s);

  const allNetuids = new Set([
    ...primaryMetrics.map(m => m.netuid),
    ...secondaryMetrics.map(m => m.netuid),
  ]);

  const results: ConsensusMetrics[] = [];

  for (const netuid of allNetuids) {
    const primary = primaryMetrics.find(m => m.netuid === netuid);
    const secondary = secondaryMap.get(netuid);
    const { score, divergences, dataUncertain, fieldDivergences } = computeConsensusConfidence(primary, secondary);

    // Median consensus for each field when both sources exist
    const fuseField = (field: keyof SourceMetrics): number | null => {
      const pVal = primary?.[field] as number | null;
      const sVal = secondary?.[field] as number | null;
      if (pVal != null && pVal > 0 && sVal != null && sVal > 0) {
        return median2(pVal, sVal);
      }
      return pVal ?? sVal ?? null;
    };

    const primarySource = primary && minutesAgo(primary.ts) < 15 ? "taostats" : "taomarketcap";

    results.push({
      netuid,
      price: fuseField("price"),
      cap: fuseField("cap"),
      vol24h: fuseField("vol24h"),
      liquidity: fuseField("liquidity"),
      primarySource,
      confianceData: score,
      dataUncertain,
      divergences,
      fieldDivergences,
    });
  }

  return results;
}

/* ─── Global DataFusion ─── */
export function computeGlobalConfianceData(
  primaryMetrics: SourceMetrics[],
  secondaryMetrics: SourceMetrics[]
): GlobalConfianceData {
  if (!primaryMetrics.length && !secondaryMetrics.length) {
    return { score: 0, concordance: 0, freshness: 0, completeness: 0, availability: 0, divergentSubnets: [] };
  }

  const secondaryMap = new Map<number, SourceMetrics>();
  for (const s of secondaryMetrics) secondaryMap.set(s.netuid, s);

  const allNetuids = new Set([
    ...primaryMetrics.map(m => m.netuid),
    ...secondaryMetrics.map(m => m.netuid),
  ]);

  let totalScore = 0;
  let totalConcordance = 0;
  let totalFreshness = 0;
  let totalCompleteness = 0;
  let count = 0;
  const allDivergences: DivergenceInfo[] = [];

  for (const netuid of allNetuids) {
    const primary = primaryMetrics.find(m => m.netuid === netuid);
    const secondary = secondaryMap.get(netuid);
    const { score, divergences } = computeConsensusConfidence(primary, secondary);
    totalScore += score;
    allDivergences.push(...divergences);

    if (primary && secondary) {
      const fields: (keyof SourceMetrics)[] = ["price", "cap", "vol24h"];
      let conc = 0, concN = 0;
      for (const f of fields) {
        const pv = primary[f] as number | null;
        const sv = secondary[f] as number | null;
        if (pv && pv > 0 && sv && sv > 0) {
          conc += Math.max(0, 100 - pctDiff(pv, sv) * 5);
          concN++;
        }
      }
      totalConcordance += concN > 0 ? conc / concN : 50;
    } else {
      totalConcordance += 40;
    }

    const pTs = primary?.ts;
    const sTs = secondary?.ts;
    const fPrimary = Math.max(0, 100 - minutesAgo(pTs ?? null) * 2);
    const fSecondary = Math.max(0, 100 - minutesAgo(sTs ?? null) * 2);
    totalFreshness += pTs && sTs ? fPrimary * 0.6 + fSecondary * 0.4 : pTs ? fPrimary : fSecondary;

    const cP = primary ? countFields(primary) : 0;
    const cS = secondary ? countFields(secondary) : 0;
    totalCompleteness += primary && secondary ? cP * 0.6 + cS * 0.4 : cP || cS;

    count++;
  }

  const n = Math.max(count, 1);
  const availability = secondaryMetrics.length > 0 ? 100 : 50;

  return {
    score: Math.round(Math.max(0, Math.min(100, totalScore / n))),
    concordance: Math.round(totalConcordance / n),
    freshness: Math.round(totalFreshness / n),
    completeness: Math.round(totalCompleteness / n),
    availability,
    divergentSubnets: allDivergences,
  };
}

/* ─── Confiance Data color ─── */
export function confianceColor(score: number): string {
  if (score >= 80) return "rgba(76,175,80,0.8)";
  if (score >= 60) return "rgba(255,193,7,0.8)";
  if (score >= 40) return "rgba(255,109,0,0.8)";
  return "rgba(229,57,53,0.7)";
}

/* ─── Strategy modulation based on Confiance Data ─── */
export function shouldModerateRecommendation(
  confianceData: number,
  opportunity: number,
  risk: number
): boolean {
  if (confianceData >= 60) return false;
  if (opportunity > 75 && risk < 20) return false;
  return true;
}
