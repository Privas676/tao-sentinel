/* ═══════════════════════════════════════ */
/*   GAUGE ENGINE — NORMALIZATION           */
/* ═══════════════════════════════════════ */

function sigmoid(x: number, steepness = 10, midpoint = 0.5): number {
  return 1 / (1 + Math.exp(-steepness * (x - midpoint)));
}

function percentileRank(values: number[]): number[] {
  if (values.length <= 1) return values.map(() => 50);
  const sorted = [...values].sort((a, b) => a - b);
  return values.map(v => {
    const below = sorted.filter(s => s < v).length;
    const equal = sorted.filter(s => s === v).length;
    return ((below + equal * 0.5) / sorted.length) * 100;
  });
}

function applySCurve(percentile: number, steepness = 3): number {
  const normalized = percentile / 100;
  const curved = sigmoid(normalized, steepness, 0.5);
  const min = sigmoid(0, steepness, 0.5);
  const max = sigmoid(1, steepness, 0.5);
  return Math.round(((curved - min) / (max - min)) * 100);
}

/** Normalize scores using percentile + mild S-curve, enforcing anti-100 rule */
export function normalizeWithVariance(rawScores: number[], steepness = 3): number[] {
  const ranks = percentileRank(rawScores);
  const normalized = ranks.map(r => applySCurve(r, steepness));
  const maxRaw = Math.max(...rawScores);
  const maxCount = rawScores.filter(v => v === maxRaw).length;
  const uniqueMax = maxCount === 1;

  return normalized.map((score, i) => {
    if (score >= 100) {
      if (uniqueMax && rawScores[i] === maxRaw) return 100;
      return 99;
    }
    return score;
  });
}

const OPP_ANCHORS: [number, number][] = [
  [0, 20], [10, 35], [25, 50], [50, 65], [75, 78], [90, 88], [97, 94], [99, 97], [100, 99],
];

function percentileToOppScore(pctile: number): number {
  if (pctile <= OPP_ANCHORS[0][0]) return OPP_ANCHORS[0][1];
  for (let j = 1; j < OPP_ANCHORS.length; j++) {
    const [p0, s0] = OPP_ANCHORS[j - 1];
    const [p1, s1] = OPP_ANCHORS[j];
    if (pctile <= p1) {
      const t = (pctile - p0) / (p1 - p0);
      return Math.round(s0 + t * (s1 - s0));
    }
  }
  return OPP_ANCHORS[OPP_ANCHORS.length - 1][1];
}

/** Normalize Opportunity scores using percentile mapping with anchor points */
export function normalizeOpportunity(rawScores: number[]): number[] {
  const ranks = percentileRank(rawScores);
  const mapped = ranks.map(r => percentileToOppScore(r));
  const maxRaw = Math.max(...rawScores);
  const maxCount = rawScores.filter(v => v === maxRaw).length;

  const result = mapped.map((score, i) => {
    if (score > 97) {
      if (maxCount === 1 && rawScores[i] === maxRaw) return 98;
      return 97;
    }
    return score;
  });

  if (result.length >= 5) {
    const sorted = [...result].sort((a, b) => a - b);
    const p = (f: number) => sorted[Math.floor(f * (sorted.length - 1))];
    console.log(`[OPP-DIST] n=${result.length} min=${sorted[0]} p25=${p(0.25)} median=${p(0.5)} p75=${p(0.75)} max=${sorted[sorted.length - 1]}`);
  }

  return result;
}
