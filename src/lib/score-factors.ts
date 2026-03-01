/* ═══════════════════════════════════════ */
/*   SCORE FACTORS — Auditable scoring     */
/*   Each score exposes value, top-3       */
/*   contributing factors, and snapshotId  */
/* ═══════════════════════════════════════ */

/** A single contributing factor to a score */
export type ScoreFactor = {
  /** Short code for programmatic use */
  code: string;
  /** Human-readable label */
  label: string;
  /** Contribution to the score (positive = increases, negative = decreases) */
  contribution: number;
  /** Raw value of the metric that triggered this factor */
  rawValue?: number;
};

/** A score with its contributing factors and provenance */
export type AuditableScore = {
  value: number;
  factors: ScoreFactor[];
  /** ID of the data snapshot used for computation */
  snapshotId: string;
};

/** Generate a snapshot ID from timestamp + source */
export function makeSnapshotId(fetchedAt: number, source: string): string {
  return `${source}:${fetchedAt}`;
}

/** Keep only the top-N factors by absolute contribution */
export function topFactors(factors: ScoreFactor[], n = 3): ScoreFactor[] {
  return [...factors]
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
    .slice(0, n);
}

/** Combine multiple factor lists, dedup by code, keep highest abs contribution */
export function mergeFactors(...lists: ScoreFactor[][]): ScoreFactor[] {
  const map = new Map<string, ScoreFactor>();
  for (const list of lists) {
    for (const f of list) {
      const existing = map.get(f.code);
      if (!existing || Math.abs(f.contribution) > Math.abs(existing.contribution)) {
        map.set(f.code, f);
      }
    }
  }
  return Array.from(map.values());
}
