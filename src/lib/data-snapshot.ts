/* ═══════════════════════════════════════ */
/*   DATA SNAPSHOT — Unified Timestamping   */
/*   Ensures all data is time-aligned       */
/* ═══════════════════════════════════════ */

/** A single data capture from one source at a known point in time. */
export type DataSnapshot<T = unknown> = {
  /** Subnet identifier (null for global snapshots like fx_rates) */
  subnetId: number | null;
  /** Origin of the data (e.g. "taostats", "taomarketcap", "supabase") */
  source: string;
  /** When the frontend fetched this data (always set, monotonic) */
  fetchedAt: number; // epoch ms
  /** Timestamp from the upstream API/DB (may be null if not provided) */
  sourceTimestamp: number | null; // epoch ms
  /** Raw payload — typed generically for flexibility */
  payload: T;
};

/** Status of time alignment between multiple snapshots */
export type AlignmentStatus = "ALIGNED" | "DEGRADED" | "STALE";

export type AlignmentResult = {
  status: AlignmentStatus;
  /** Maximum delta between snapshots (ms) */
  maxDeltaMs: number;
  /** Age of the oldest snapshot relative to now (ms) */
  oldestAgeMs: number;
  /** Per-snapshot age diagnostics */
  ages: SnapshotAge[];
};

export type SnapshotAge = {
  source: string;
  subnetId: number | null;
  /** Effective timestamp used for alignment (sourceTimestamp ?? fetchedAt) */
  effectiveTs: number;
  /** Age in seconds relative to referenceTime */
  dataAgeSeconds: number;
};

/* ─── Constants ─── */

/** Max acceptable delta between snapshots combined in a single computation (ms) */
const MAX_ALIGNMENT_DELTA_MS = 120_000; // 120s

/** Beyond this age, a single snapshot is considered stale (ms) */
const STALE_THRESHOLD_MS = 600_000; // 10 min

/* ─── Factory ─── */

/** Create a DataSnapshot, capturing fetchedAt = Date.now() automatically. */
export function createSnapshot<T>(
  payload: T,
  source: string,
  subnetId: number | null = null,
  sourceTimestamp?: string | number | null,
): DataSnapshot<T> {
  let srcTs: number | null = null;
  if (sourceTimestamp != null) {
    srcTs = typeof sourceTimestamp === "string"
      ? new Date(sourceTimestamp).getTime()
      : sourceTimestamp;
    if (isNaN(srcTs)) srcTs = null;
  }
  return {
    subnetId,
    source,
    fetchedAt: Date.now(),
    sourceTimestamp: srcTs,
    payload,
  };
}

/* ─── Effective timestamp ─── */

/** Returns sourceTimestamp if available, else falls back to fetchedAt. */
export function effectiveTimestamp(snap: DataSnapshot): number {
  return snap.sourceTimestamp ?? snap.fetchedAt;
}

/* ─── Single snapshot age ─── */

/** Compute age of a snapshot in seconds, relative to a reference time (default: now). */
export function dataAgeSeconds(snap: DataSnapshot, referenceTime?: number): number {
  const ref = referenceTime ?? Date.now();
  const eff = effectiveTimestamp(snap);
  return Math.max(0, (ref - eff) / 1000);
}

/** Check if a single snapshot is stale (> STALE_THRESHOLD_MS). */
export function isSnapshotStale(snap: DataSnapshot, referenceTime?: number): boolean {
  const ref = referenceTime ?? Date.now();
  return (ref - effectiveTimestamp(snap)) > STALE_THRESHOLD_MS;
}

/* ─── Time Alignment Guard ─── */

/**
 * Check whether multiple snapshots are temporally aligned.
 *
 * Rules:
 * - If sourceTimestamp is missing → fallback to fetchedAt
 * - If max delta between any two snapshots > MAX_ALIGNMENT_DELTA_MS → STALE
 * - If any single snapshot > STALE_THRESHOLD_MS → DEGRADED
 * - Otherwise → ALIGNED
 *
 * @param snapshots  Array of snapshots to compare
 * @param referenceTime  Reference time (default: Date.now())
 * @returns AlignmentResult with status and diagnostics
 */
export function checkTimeAlignment(
  snapshots: DataSnapshot[],
  referenceTime?: number,
): AlignmentResult {
  const ref = referenceTime ?? Date.now();

  if (snapshots.length === 0) {
    return {
      status: "STALE",
      maxDeltaMs: 0,
      oldestAgeMs: Infinity,
      ages: [],
    };
  }

  const ages: SnapshotAge[] = snapshots.map(s => ({
    source: s.source,
    subnetId: s.subnetId,
    effectiveTs: effectiveTimestamp(s),
    dataAgeSeconds: dataAgeSeconds(s, ref),
  }));

  const timestamps = ages.map(a => a.effectiveTs);
  const minTs = Math.min(...timestamps);
  const maxTs = Math.max(...timestamps);
  const maxDeltaMs = maxTs - minTs;
  const oldestAgeMs = ref - minTs;

  let status: AlignmentStatus = "ALIGNED";

  // Rule 1: inter-snapshot delta too large → STALE (refuse computation)
  if (maxDeltaMs > MAX_ALIGNMENT_DELTA_MS) {
    status = "STALE";
  }
  // Rule 2: any single snapshot too old → DEGRADED
  else if (oldestAgeMs > STALE_THRESHOLD_MS) {
    status = "DEGRADED";
  }

  return { status, maxDeltaMs, oldestAgeMs, ages };
}

/**
 * Convenience: build a Map<number, DataSnapshot<T>> from a Map<number, T>,
 * tagging each entry with source and extracting ts from a getter.
 */
export function wrapMapAsSnapshots<T>(
  map: Map<number, T>,
  source: string,
  tsGetter?: (item: T) => string | null,
): Map<number, DataSnapshot<T>> {
  const result = new Map<number, DataSnapshot<T>>();
  for (const [netuid, item] of map) {
    const srcTs = tsGetter ? tsGetter(item) : null;
    result.set(netuid, createSnapshot(item, source, netuid, srcTs));
  }
  return result;
}

/**
 * Convenience: wrap an array fetch result into a single DataSnapshot.
 */
export function wrapArrayAsSnapshot<T>(
  data: T[],
  source: string,
  sourceTimestamp?: string | null,
): DataSnapshot<T[]> {
  return createSnapshot(data, source, null, sourceTimestamp);
}

/* ─── Debug logging ─── */

/** Log alignment diagnostics to console (debug only, never shown in UI). */
export function logAlignmentDiag(label: string, result: AlignmentResult): void {
  const ageStr = result.ages
    .map(a => `${a.source}${a.subnetId != null ? `[${a.subnetId}]` : ""}: ${a.dataAgeSeconds.toFixed(1)}s`)
    .join(", ");
  console.log(
    `[TIME-ALIGN] ${label} status=${result.status} maxDelta=${(result.maxDeltaMs / 1000).toFixed(1)}s oldestAge=${(result.oldestAgeMs / 1000).toFixed(1)}s | ${ageStr}`
  );
}
