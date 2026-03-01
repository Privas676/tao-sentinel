/* ═══════════════════════════════════════ */
/*   DATA CONFIDENCE ENGINE                  */
/*   Real-time quality scoring based on:    */
/*   - API error rate (rolling window)       */
/*   - Latency (avg + p95, rolling)          */
/*   - Staleness (data age)                  */
/*   - Variance anomaly (DistributionMonitor)*/
/*                                           */
/*   Produces 0-100 score that fluctuates    */
/*   naturally with actual data quality.     */
/* ═══════════════════════════════════════ */

import { clamp } from "./gauge-types";

/* ══════════════════════════════════════ */
/*            TYPES                        */
/* ══════════════════════════════════════ */

export type DataConfidenceScore = {
  /** Final composite score 0-100 */
  score: number;
  /** Sub-scores for transparency */
  components: {
    errorRate: number;       // 0-100 (100 = no errors)
    latency: number;         // 0-100 (100 = fast)
    freshness: number;       // 0-100 (100 = fresh)
    completeness: number;    // 0-100 (100 = all fields present)
    varianceHealth: number;  // 0-100 (100 = normal distribution)
  };
  /** Whether confidence is below critical threshold */
  isUnstable: boolean;
  /** Human-readable reasons when unstable */
  reasons: string[];
};

/** A single API call record for rolling window tracking */
export type ApiCallRecord = {
  /** Timestamp of the call (ms) */
  timestamp: number;
  /** Whether the call succeeded */
  success: boolean;
  /** Response latency in ms */
  latencyMs: number;
  /** Source identifier (e.g. "taostats", "supabase") */
  source: string;
};

export type DataConfidenceConfig = {
  /** Rolling window size in ms (default: 10 minutes) */
  rollingWindowMs: number;
  /** Max acceptable average latency in ms */
  maxAcceptableLatencyMs: number;
  /** Max acceptable p95 latency in ms */
  maxAcceptableP95Ms: number;
  /** Max acceptable staleness in seconds */
  maxAcceptableStalenessS: number;
  /** Error rate threshold for penalty (0-1) */
  errorRateThreshold: number;
  /** Score below which isUnstable = true */
  unstableThreshold: number;
  /** Weights for composite score */
  weights: {
    errorRate: number;
    latency: number;
    freshness: number;
    completeness: number;
    varianceHealth: number;
  };
};

/* ══════════════════════════════════════ */
/*         DEFAULT CONFIG                  */
/* ══════════════════════════════════════ */

export const DEFAULT_CONFIDENCE_CONFIG: DataConfidenceConfig = {
  rollingWindowMs: 10 * 60 * 1000, // 10 minutes
  maxAcceptableLatencyMs: 5_000,    // 5s avg
  maxAcceptableP95Ms: 10_000,       // 10s p95
  maxAcceptableStalenessS: 600,     // 10 min
  errorRateThreshold: 0.15,         // 15% error rate starts penalty
  unstableThreshold: 40,            // Below 40 → DATA_UNSTABLE
  weights: {
    errorRate: 0.25,
    latency: 0.15,
    freshness: 0.30,
    completeness: 0.15,
    varianceHealth: 0.15,
  },
};

/* ══════════════════════════════════════ */
/*     ROLLING WINDOW TRACKER              */
/* ══════════════════════════════════════ */

/**
 * Tracks API call records in a rolling window.
 * Pure data structure — no side effects.
 */
export class ApiHealthTracker {
  private records: ApiCallRecord[] = [];
  private windowMs: number;

  constructor(windowMs: number = DEFAULT_CONFIDENCE_CONFIG.rollingWindowMs) {
    this.windowMs = windowMs;
  }

  /** Record an API call result */
  record(call: ApiCallRecord): void {
    this.records.push(call);
    this.prune();
  }

  /** Prune records outside the rolling window */
  private prune(): void {
    const cutoff = Date.now() - this.windowMs;
    this.records = this.records.filter(r => r.timestamp >= cutoff);
  }

  /** Get all records in the current window */
  getRecords(source?: string): ApiCallRecord[] {
    this.prune();
    if (source) return this.records.filter(r => r.source === source);
    return [...this.records];
  }

  /** Get number of records in window */
  getCount(source?: string): number {
    return this.getRecords(source).length;
  }

  /** Reset all records */
  reset(): void {
    this.records = [];
  }
}

/* ══════════════════════════════════════ */
/*     COMPONENT SCORE FUNCTIONS           */
/* ══════════════════════════════════════ */

/**
 * Error rate score: 100 = no errors, 0 = all errors.
 * Smooth degradation with penalty acceleration above threshold.
 */
export function computeErrorRateScore(
  records: ApiCallRecord[],
  threshold: number = DEFAULT_CONFIDENCE_CONFIG.errorRateThreshold,
): number {
  if (records.length === 0) return 70; // No data → moderate confidence (not 100, not 0)

  const errorCount = records.filter(r => !r.success).length;
  const errorRate = errorCount / records.length;

  if (errorRate <= 0.02) return 100; // ≤2% errors → perfect
  if (errorRate <= threshold) {
    // Linear degradation from 100 to 60
    return Math.round(100 - (errorRate / threshold) * 40);
  }
  // Above threshold: accelerated penalty
  const excess = (errorRate - threshold) / (1 - threshold);
  return Math.round(Math.max(0, 60 - excess * 60));
}

/**
 * Latency score: based on average and p95 latency.
 * 100 = fast responses, 0 = unacceptably slow.
 */
export function computeLatencyScore(
  records: ApiCallRecord[],
  maxAvg: number = DEFAULT_CONFIDENCE_CONFIG.maxAcceptableLatencyMs,
  maxP95: number = DEFAULT_CONFIDENCE_CONFIG.maxAcceptableP95Ms,
): number {
  if (records.length === 0) return 70;

  const latencies = records.map(r => r.latencyMs).sort((a, b) => a - b);
  const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;
  const p95Idx = Math.ceil(latencies.length * 0.95) - 1;
  const p95 = latencies[Math.max(0, p95Idx)];

  // Avg score: 100 at ≤500ms, 0 at maxAvg
  const avgScore = avg <= 500 ? 100 : Math.max(0, 100 - ((avg - 500) / (maxAvg - 500)) * 100);

  // P95 score: 100 at ≤2000ms, 0 at maxP95
  const p95Score = p95 <= 2000 ? 100 : Math.max(0, 100 - ((p95 - 2000) / (maxP95 - 2000)) * 100);

  // Weighted: avg matters more than p95
  return Math.round(avgScore * 0.6 + p95Score * 0.4);
}

/**
 * Freshness score: based on data staleness.
 * 100 = just fetched, 0 = beyond max acceptable staleness.
 * Nonlinear: degrades slowly at first, then accelerates.
 */
export function computeFreshnessScore(
  dataAgeSeconds: number,
  maxStaleness: number = DEFAULT_CONFIDENCE_CONFIG.maxAcceptableStalenessS,
): number {
  if (dataAgeSeconds <= 30) return 100;  // < 30s = perfect
  if (dataAgeSeconds >= maxStaleness) return 0;

  // Quadratic decay: gentle at first, steep near max
  const ratio = (dataAgeSeconds - 30) / (maxStaleness - 30);
  return Math.round(100 * (1 - ratio * ratio));
}

/**
 * Completeness score: based on how many expected fields are present and valid.
 */
export function computeCompletenessScore(
  fieldsPresent: number,
  fieldsTotal: number,
): number {
  if (fieldsTotal <= 0) return 0;
  return Math.round((fieldsPresent / fieldsTotal) * 100);
}

/**
 * Variance health score: derived from DistributionMonitor output.
 * 100 = normal distribution, 0 = severely abnormal.
 */
export function computeVarianceHealthScore(
  isFleetUnstable: boolean,
  isCompressedPsi: boolean,
  isCompressedRisk: boolean,
  isExtremeHigh: boolean,
  isExtremeLow: boolean,
): number {
  let score = 100;

  if (isCompressedPsi) score -= 20;
  if (isCompressedRisk) score -= 20;
  if (isExtremeHigh) score -= 25;
  if (isExtremeLow) score -= 25;
  if (isFleetUnstable && score > 30) score -= 10; // additional fleet penalty

  return Math.max(0, score);
}

/* ══════════════════════════════════════ */
/*     COMPOSITE CONFIDENCE SCORE          */
/* ══════════════════════════════════════ */

export type ComputeConfidenceInput = {
  /** API call records for error rate + latency */
  apiRecords: ApiCallRecord[];
  /** Age of the most recent data in seconds */
  dataAgeSeconds: number;
  /** Number of non-null fields present per subnet (avg) */
  fieldsPresent: number;
  /** Total expected fields per subnet */
  fieldsTotal: number;
  /** Fleet distribution report flags */
  fleetHealth: {
    isFleetUnstable: boolean;
    isCompressedPsi: boolean;
    isCompressedRisk: boolean;
    isExtremeHigh: boolean;
    isExtremeLow: boolean;
  };
};

/**
 * Compute the composite DataConfidence score.
 * Combines all sub-scores with configurable weights.
 * Returns a score that fluctuates naturally with data quality.
 */
export function computeDataConfidence(
  input: ComputeConfidenceInput,
  config: DataConfidenceConfig = DEFAULT_CONFIDENCE_CONFIG,
): DataConfidenceScore {
  const errorRate = computeErrorRateScore(input.apiRecords, config.errorRateThreshold);
  const latency = computeLatencyScore(input.apiRecords, config.maxAcceptableLatencyMs, config.maxAcceptableP95Ms);
  const freshness = computeFreshnessScore(input.dataAgeSeconds, config.maxAcceptableStalenessS);
  const completeness = computeCompletenessScore(input.fieldsPresent, input.fieldsTotal);
  const varianceHealth = computeVarianceHealthScore(
    input.fleetHealth.isFleetUnstable,
    input.fleetHealth.isCompressedPsi,
    input.fleetHealth.isCompressedRisk,
    input.fleetHealth.isExtremeHigh,
    input.fleetHealth.isExtremeLow,
  );

  const w = config.weights;
  const raw =
    errorRate * w.errorRate +
    latency * w.latency +
    freshness * w.freshness +
    completeness * w.completeness +
    varianceHealth * w.varianceHealth;

  const score = clamp(Math.round(raw), 0, 100);

  // Build reasons list
  const reasons: string[] = [];
  if (errorRate < 60) reasons.push(`Taux d'erreur API élevé (${100 - errorRate}%)`);
  if (latency < 50) reasons.push(`Latence API élevée`);
  if (freshness < 40) reasons.push(`Données obsolètes (${Math.round(input.dataAgeSeconds)}s)`);
  if (completeness < 60) reasons.push(`Données incomplètes (${input.fieldsPresent}/${input.fieldsTotal} champs)`);
  if (varianceHealth < 60) reasons.push(`Distribution anormale des scores`);

  return {
    score,
    components: { errorRate, latency, freshness, completeness, varianceHealth },
    isUnstable: score < config.unstableThreshold,
    reasons,
  };
}

/* ══════════════════════════════════════ */
/*     PER-SUBNET CONFIDENCE               */
/* ══════════════════════════════════════ */

export type SubnetConfidenceInput = {
  /** Data age for this specific subnet in seconds */
  dataAgeSeconds: number;
  /** Number of non-null metric fields for this subnet */
  fieldsPresent: number;
  /** Total expected metric fields */
  fieldsTotal: number;
};

/**
 * Compute per-subnet confidence (simplified: freshness + completeness only).
 * API health and variance are fleet-level concerns handled by the global score.
 */
export function computeSubnetConfidence(
  input: SubnetConfidenceInput,
  globalScore: DataConfidenceScore,
  config: DataConfidenceConfig = DEFAULT_CONFIDENCE_CONFIG,
): number {
  const freshness = computeFreshnessScore(input.dataAgeSeconds, config.maxAcceptableStalenessS);
  const completeness = computeCompletenessScore(input.fieldsPresent, input.fieldsTotal);

  // Per-subnet: 50% local (freshness+completeness), 50% global confidence
  const localScore = freshness * 0.6 + completeness * 0.4;
  const blended = localScore * 0.5 + globalScore.score * 0.5;

  return clamp(Math.round(blended), 0, 100);
}
