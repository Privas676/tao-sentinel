/* ═══════════════════════════════════════ */
/*   DATA FUSION MODULE                     */
/*   Cross-source validation & fallback     */
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

export type FusedMetrics = {
  netuid: number;
  price: number | null;
  cap: number | null;
  vol24h: number | null;
  liquidity: number | null;
  primarySource: string;
  confianceData: number; // 0-100
  divergences: DivergenceInfo[];
};

export type DivergenceInfo = {
  netuid: number;
  field: string;
  primaryValue: number;
  secondaryValue: number;
  pctDiff: number;
};

export type GlobalConfianceData = {
  score: number;         // 0-100
  concordance: number;   // 0-100
  freshness: number;     // 0-100
  completeness: number;  // 0-100
  availability: number;  // 0-100
  divergentSubnets: DivergenceInfo[];
};

/* ─── Helpers ─── */
function pctDiff(a: number, b: number): number {
  if (a === 0 && b === 0) return 0;
  const avg = (Math.abs(a) + Math.abs(b)) / 2;
  if (avg === 0) return 0;
  return Math.abs(a - b) / avg * 100;
}

function minutesAgo(ts: string | null): number {
  if (!ts) return 999;
  return (Date.now() - new Date(ts).getTime()) / 60_000;
}

/* ─── Compute per-subnet Confiance Data ─── */
function computeSubnetConfiance(
  primary: SourceMetrics | undefined,
  secondary: SourceMetrics | undefined
): { score: number; divergences: DivergenceInfo[] } {
  const divergences: DivergenceInfo[] = [];

  if (!primary && !secondary) return { score: 0, divergences };
  if (!secondary) {
    // Only primary available — decent but not cross-validated
    const freshness = primary ? Math.max(0, 100 - minutesAgo(primary.ts) * 2) : 0;
    const completeness = primary ? countFields(primary) : 0;
    return { score: Math.round(freshness * 0.4 + completeness * 0.4 + 20), divergences };
  }
  if (!primary) {
    const freshness = Math.max(0, 100 - minutesAgo(secondary.ts) * 2);
    const completeness = countFields(secondary);
    return { score: Math.round(freshness * 0.4 + completeness * 0.4 + 10), divergences };
  }

  // Both sources available
  let concordanceTotal = 0;
  let concordanceCount = 0;

  // Compare fields — liquidity excluded from concordance (structural 2:1 ratio between sources)
  const concordanceFields: (keyof SourceMetrics)[] = ["price", "cap", "vol24h"];
  for (const field of concordanceFields) {
    const pVal = primary[field] as number | null;
    const sVal = secondary[field] as number | null;
    if (pVal != null && pVal > 0 && sVal != null && sVal > 0) {
      const diff = pctDiff(pVal, sVal);
      concordanceTotal += Math.max(0, 100 - diff * 5); // 20% diff = 0 concordance
      concordanceCount++;
      if (diff > 8) {
        divergences.push({ netuid: primary.netuid, field, primaryValue: pVal, secondaryValue: sVal, pctDiff: Math.round(diff * 10) / 10 });
      }
    }
  }

  const concordance = concordanceCount > 0 ? concordanceTotal / concordanceCount : 50;
  const freshnessPrimary = Math.max(0, 100 - minutesAgo(primary.ts) * 2);
  const freshnessSecondary = Math.max(0, 100 - minutesAgo(secondary.ts) * 2);
  const freshness = (freshnessPrimary * 0.6 + freshnessSecondary * 0.4);
  const completeness = (countFields(primary) * 0.6 + countFields(secondary) * 0.4);
  const availability = 100; // Both sources available

  const score = Math.round(
    concordance * 0.40 +
    freshness * 0.25 +
    completeness * 0.20 +
    availability * 0.15
  );

  return { score: Math.max(0, Math.min(100, score)), divergences };
}

function countFields(m: SourceMetrics): number {
  let count = 0;
  if (m.price != null && m.price > 0) count++;
  if (m.cap != null && m.cap > 0) count++;
  if (m.vol24h != null && m.vol24h > 0) count++;
  if (m.liquidity != null && m.liquidity > 0) count++;
  return (count / 4) * 100;
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
    const { score, divergences } = computeSubnetConfiance(primary, secondary);
    totalScore += score;
    allDivergences.push(...divergences);

    // Concordance
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

    // Freshness
    const pTs = primary?.ts;
    const sTs = secondary?.ts;
    const fPrimary = Math.max(0, 100 - minutesAgo(pTs ?? null) * 2);
    const fSecondary = Math.max(0, 100 - minutesAgo(sTs ?? null) * 2);
    totalFreshness += pTs && sTs ? fPrimary * 0.6 + fSecondary * 0.4 : pTs ? fPrimary : fSecondary;

    // Completeness
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

/* ─── Fuse metrics: primary + secondary fallback ─── */
export function fuseMetrics(
  primaryMetrics: SourceMetrics[],
  secondaryMetrics: SourceMetrics[]
): FusedMetrics[] {
  const secondaryMap = new Map<number, SourceMetrics>();
  for (const s of secondaryMetrics) secondaryMap.set(s.netuid, s);

  const allNetuids = new Set([
    ...primaryMetrics.map(m => m.netuid),
    ...secondaryMetrics.map(m => m.netuid),
  ]);

  const results: FusedMetrics[] = [];

  for (const netuid of allNetuids) {
    const primary = primaryMetrics.find(m => m.netuid === netuid);
    const secondary = secondaryMap.get(netuid);
    const { score, divergences } = computeSubnetConfiance(primary, secondary);

    // Determine which source to use (primary preferred, fallback to secondary)
    const source = primary && minutesAgo(primary.ts) < 15 ? primary : (secondary ?? primary);
    const primarySource = source === primary ? "taostats" : "taomarketcap";

    results.push({
      netuid,
      price: source?.price ?? null,
      cap: source?.cap ?? null,
      vol24h: source?.vol24h ?? null,
      liquidity: source?.liquidity ?? null,
      primarySource,
      confianceData: score,
      divergences,
    });
  }

  return results;
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
  // If Confiance Data < 60 → reduce aggressiveness (ENTER → WATCH unless very strong signal)
  if (confianceData >= 60) return false;
  // Allow ENTER only if signal is very strong (opp > 75 and risk < 20)
  if (opportunity > 75 && risk < 20) return false;
  return true;
}
