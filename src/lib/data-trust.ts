/* ═══════════════════════════════════════════════════════════ */
/*   DATA TRUST / KILL SWITCH (Lot 1 — TAO Sentinel spec)       */
/*                                                              */
/*   Rules:                                                     */
/*   - global_confidence = min(critical sources), not average   */
/*   - 4 levels: OK / DEGRADED / STALE / CRITICAL_STALE         */
/*   - In SAFE MODE (STALE+): ENTRER and RENFORCER are frozen   */
/*   - Pumps are STILL displayed but tagged NEEDS_CONFIRMATION  */
/*   - System alerts remain visible                             */
/*                                                              */
/*   This module is a PURE FUNCTION — no side effects.          */
/* ═══════════════════════════════════════════════════════════ */

import type { DataConfidenceScore } from "./data-confidence";

/* ── Types ── */

export type DataTrustLevel = "OK" | "DEGRADED" | "STALE" | "CRITICAL_STALE";

export type CriticalSource = {
  /** Source identifier (e.g. "taostats", "taoflute") */
  name: string;
  /** Last successful update timestamp (ISO), or null if never seen */
  lastUpdate: string | null;
  /** Whether this source is required for ENTRER/RENFORCER decisions */
  required: boolean;
};

export type DataTrustResult = {
  /** Overall trust level — limited by the worst critical source */
  level: DataTrustLevel;
  /** Global confidence score 0-100, computed as min() of all signals */
  globalConfidence: number;
  /** Whether SAFE MODE is active (level STALE or worse) */
  isSafeMode: boolean;
  /** Whether ENTRER/RENFORCER actions must be blocked */
  blockEntryActions: boolean;
  /** Source that triggered the worst level (if any) */
  worstSource: string | null;
  /** Age of the worst source in seconds (or -1 if unknown) */
  worstAgeSeconds: number;
  /** Last reliable update across all critical sources (ISO) */
  lastReliableUpdate: string | null;
  /** Human-readable reasons */
  reasons: string[];
  /** Timestamp of evaluation */
  evaluatedAt: string;
};

/* ── Thresholds (configurable) ── */

export const DATA_TRUST_THRESHOLDS = {
  /** OK: data < 5 min */
  okMaxSeconds: 5 * 60,
  /** DEGRADED: 5–15 min */
  degradedMaxSeconds: 15 * 60,
  /** STALE: 15–60 min */
  staleMaxSeconds: 60 * 60,
  /** CRITICAL_STALE: > 60 min */
  /** Confidence floor that triggers SAFE MODE regardless of freshness */
  safeModeConfidenceFloor: 60,
} as const;

/* ── Helpers ── */

function ageSeconds(iso: string | null, now: number): number {
  if (!iso) return -1;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return -1;
  return Math.max(0, Math.round((now - t) / 1000));
}

function levelFromAge(ageSec: number): DataTrustLevel {
  if (ageSec < 0) return "CRITICAL_STALE"; // unknown timestamp = treat as worst
  if (ageSec <= DATA_TRUST_THRESHOLDS.okMaxSeconds) return "OK";
  if (ageSec <= DATA_TRUST_THRESHOLDS.degradedMaxSeconds) return "DEGRADED";
  if (ageSec <= DATA_TRUST_THRESHOLDS.staleMaxSeconds) return "STALE";
  return "CRITICAL_STALE";
}

function levelRank(l: DataTrustLevel): number {
  return { OK: 0, DEGRADED: 1, STALE: 2, CRITICAL_STALE: 3 }[l];
}

function ageScore(ageSec: number): number {
  // 100 at 0s, 0 at staleMaxSeconds (60 min), monotonic
  if (ageSec < 0) return 0;
  const max = DATA_TRUST_THRESHOLDS.staleMaxSeconds;
  if (ageSec >= max) return 0;
  return Math.round(100 * (1 - ageSec / max));
}

/* ── Main evaluator ── */

/**
 * Evaluate the data trust level from critical sources + optional confidence.
 *
 * Key rule: globalConfidence = min(all signals), never an average.
 * The worst critical source pins the global level.
 */
export function evaluateDataTrust(
  sources: CriticalSource[],
  confidence?: DataConfidenceScore | null,
  nowMs: number = Date.now(),
): DataTrustResult {
  const reasons: string[] = [];
  let worstLevel: DataTrustLevel = "OK";
  let worstSource: string | null = null;
  let worstAge = 0;
  let lastReliable: string | null = null;

  // Collect age-based scores (only for required sources for the floor)
  const scoreCandidates: number[] = [];

  for (const src of sources) {
    const age = ageSeconds(src.lastUpdate, nowMs);
    const lvl = levelFromAge(age);

    // Track the worst REQUIRED source for the global level
    if (src.required) {
      if (levelRank(lvl) > levelRank(worstLevel)) {
        worstLevel = lvl;
        worstSource = src.name;
        worstAge = age;
      }
      scoreCandidates.push(ageScore(age));
    }

    // Track the most recent reliable update across all sources
    if (src.lastUpdate && lvl !== "CRITICAL_STALE") {
      if (!lastReliable || new Date(src.lastUpdate).getTime() > new Date(lastReliable).getTime()) {
        lastReliable = src.lastUpdate;
      }
    }

    if (lvl !== "OK" && src.required) {
      const ageLabel = age < 0 ? "inconnu" : age < 60 ? `${age}s` : `${Math.round(age / 60)}min`;
      reasons.push(`${src.name} en retard (${ageLabel}) — ${lvl}`);
    }
  }

  // Fold in DataConfidence components as additional signals (min rule)
  if (confidence) {
    scoreCandidates.push(confidence.components.errorRate);
    scoreCandidates.push(confidence.components.freshness);
    scoreCandidates.push(confidence.components.completeness);
    if (confidence.isUnstable) {
      reasons.push(`DataConfidence instable (${confidence.score}/100)`);
    }
  }

  // global_confidence = min of all critical signals
  const globalConfidence = scoreCandidates.length
    ? Math.min(...scoreCandidates)
    : 0;

  // If confidence floor breached, escalate level at least to STALE
  if (
    globalConfidence < DATA_TRUST_THRESHOLDS.safeModeConfidenceFloor &&
    levelRank(worstLevel) < levelRank("STALE")
  ) {
    worstLevel = "STALE";
    if (!worstSource) worstSource = "confidence_floor";
    reasons.push(
      `Confiance globale ${globalConfidence}% < ${DATA_TRUST_THRESHOLDS.safeModeConfidenceFloor}% — SAFE MODE`,
    );
  }

  const isSafeMode = levelRank(worstLevel) >= levelRank("STALE");

  return {
    level: worstLevel,
    globalConfidence,
    isSafeMode,
    // Décisions actives bloquées dès qu'on n'est plus OK confortable
    // (STALE+). En DEGRADED on autorise encore mais on warn.
    blockEntryActions: isSafeMode,
    worstSource,
    worstAgeSeconds: worstAge,
    lastReliableUpdate: lastReliable,
    reasons,
    evaluatedAt: new Date(nowMs).toISOString(),
  };
}

/* ── Display helpers ── */

export function dataTrustLabel(level: DataTrustLevel, fr: boolean = true): string {
  if (fr) {
    return {
      OK: "Données fraîches",
      DEGRADED: "Données dégradées",
      STALE: "Données obsolètes — décisions gelées",
      CRITICAL_STALE: "Données critiques obsolètes — décisions gelées",
    }[level];
  }
  return {
    OK: "Fresh",
    DEGRADED: "Degraded",
    STALE: "Stale — decisions frozen",
    CRITICAL_STALE: "Critical stale — decisions frozen",
  }[level];
}

export function dataTrustColorToken(level: DataTrustLevel): string {
  // Returns a CSS hsl() expression using existing semantic tokens
  switch (level) {
    case "OK":
      return "hsl(var(--go, 142 70% 45%))";
    case "DEGRADED":
      return "hsl(var(--warn, 38 92% 50%))";
    case "STALE":
    case "CRITICAL_STALE":
      return "hsl(var(--break, 4 80% 50%))";
  }
}
