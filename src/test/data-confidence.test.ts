import { describe, it, expect } from "vitest";
import {
  computeErrorRateScore,
  computeLatencyScore,
  computeFreshnessScore,
  computeCompletenessScore,
  computeVarianceHealthScore,
  computeDataConfidence,
  computeSubnetConfidence,
  ApiHealthTracker,
  type ApiCallRecord,
  type DataConfidenceScore,
  DEFAULT_CONFIDENCE_CONFIG,
} from "@/lib/data-confidence";

const now = Date.now();
function makeRecord(success: boolean, latencyMs: number, source = "test"): ApiCallRecord {
  return { timestamp: now, success, latencyMs, source };
}

describe("computeErrorRateScore", () => {
  it("returns 70 for empty records", () => {
    expect(computeErrorRateScore([])).toBe(70);
  });

  it("returns 100 for all successes", () => {
    const records = Array.from({ length: 20 }, () => makeRecord(true, 100));
    expect(computeErrorRateScore(records)).toBe(100);
  });

  it("returns 0 for all failures", () => {
    const records = Array.from({ length: 10 }, () => makeRecord(false, 100));
    expect(computeErrorRateScore(records)).toBe(0);
  });

  it("degrades for moderate error rate", () => {
    // 3 errors out of 20 = 15%
    const records = [
      ...Array.from({ length: 17 }, () => makeRecord(true, 100)),
      ...Array.from({ length: 3 }, () => makeRecord(false, 100)),
    ];
    const score = computeErrorRateScore(records, 0.15);
    expect(score).toBeGreaterThan(55);
    expect(score).toBeLessThan(65);
  });

  it("penalizes heavily above threshold", () => {
    // 50% error rate
    const records = [
      ...Array.from({ length: 5 }, () => makeRecord(true, 100)),
      ...Array.from({ length: 5 }, () => makeRecord(false, 100)),
    ];
    const score = computeErrorRateScore(records, 0.15);
    expect(score).toBeLessThan(40);
  });
});

describe("computeLatencyScore", () => {
  it("returns 70 for empty records", () => {
    expect(computeLatencyScore([])).toBe(70);
  });

  it("returns 100 for fast responses", () => {
    const records = Array.from({ length: 10 }, () => makeRecord(true, 200));
    expect(computeLatencyScore(records)).toBe(100);
  });

  it("degrades for slow avg latency", () => {
    const records = Array.from({ length: 10 }, () => makeRecord(true, 4000));
    const score = computeLatencyScore(records);
    expect(score).toBeLessThan(50);
    expect(score).toBeGreaterThan(0);
  });

  it("penalizes high p95", () => {
    const records = [
      ...Array.from({ length: 9 }, () => makeRecord(true, 300)),
      makeRecord(true, 9000), // p95 spike
    ];
    const score = computeLatencyScore(records);
    expect(score).toBeLessThan(100);
  });
});

describe("computeFreshnessScore", () => {
  it("returns 100 for very fresh data (< 30s)", () => {
    expect(computeFreshnessScore(10)).toBe(100);
  });

  it("returns 0 for data beyond max staleness", () => {
    expect(computeFreshnessScore(700)).toBe(0);
  });

  it("degrades quadratically", () => {
    const mid = computeFreshnessScore(300); // ~halfway
    const early = computeFreshnessScore(100);
    expect(early).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(0);
  });
});

describe("computeCompletenessScore", () => {
  it("returns 100 when all fields present", () => {
    expect(computeCompletenessScore(4, 4)).toBe(100);
  });
  it("returns 50 when half fields present", () => {
    expect(computeCompletenessScore(2, 4)).toBe(50);
  });
  it("returns 0 when no fields", () => {
    expect(computeCompletenessScore(0, 4)).toBe(0);
  });
});

describe("computeVarianceHealthScore", () => {
  it("returns 100 when all healthy", () => {
    expect(computeVarianceHealthScore(false, false, false, false, false)).toBe(100);
  });
  it("penalizes compressed PSI", () => {
    expect(computeVarianceHealthScore(false, true, false, false, false)).toBe(80);
  });
  it("penalizes extreme high", () => {
    expect(computeVarianceHealthScore(false, false, false, true, false)).toBe(75);
  });
  it("compounds multiple penalties", () => {
    const score = computeVarianceHealthScore(true, true, true, true, false);
    expect(score).toBeLessThan(40);
  });
});

describe("computeDataConfidence", () => {
  const healthyFleet = { isFleetUnstable: false, isCompressedPsi: false, isCompressedRisk: false, isExtremeHigh: false, isExtremeLow: false };

  it("returns high score for healthy conditions", () => {
    const result = computeDataConfidence({
      apiRecords: Array.from({ length: 10 }, () => makeRecord(true, 200)),
      dataAgeSeconds: 20,
      fieldsPresent: 4,
      fieldsTotal: 4,
      fleetHealth: healthyFleet,
    });
    expect(result.score).toBeGreaterThan(85);
    expect(result.isUnstable).toBe(false);
    expect(result.reasons).toHaveLength(0);
  });

  it("returns low score for degraded conditions", () => {
    const result = computeDataConfidence({
      apiRecords: Array.from({ length: 10 }, () => makeRecord(false, 8000)),
      dataAgeSeconds: 500,
      fieldsPresent: 1,
      fieldsTotal: 4,
      fleetHealth: { ...healthyFleet, isFleetUnstable: true, isCompressedPsi: true },
    });
    expect(result.score).toBeLessThan(40);
    expect(result.isUnstable).toBe(true);
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  it("marks isUnstable when below threshold", () => {
    const result = computeDataConfidence({
      apiRecords: Array.from({ length: 10 }, () => makeRecord(false, 12000)),
      dataAgeSeconds: 700,
      fieldsPresent: 0,
      fieldsTotal: 4,
      fleetHealth: { ...healthyFleet, isFleetUnstable: true, isCompressedPsi: true, isExtremeHigh: true },
    });
    expect(result.isUnstable).toBe(true);
  });

  it("includes sub-component scores", () => {
    const result = computeDataConfidence({
      apiRecords: [makeRecord(true, 100)],
      dataAgeSeconds: 60,
      fieldsPresent: 3,
      fieldsTotal: 4,
      fleetHealth: healthyFleet,
    });
    expect(result.components.errorRate).toBe(100);
    expect(result.components.freshness).toBeGreaterThan(0);
    expect(result.components.completeness).toBe(75);
    expect(result.components.varianceHealth).toBe(100);
  });
});

describe("computeSubnetConfidence", () => {
  const globalConf: DataConfidenceScore = {
    score: 80,
    components: { errorRate: 90, latency: 85, freshness: 80, completeness: 100, varianceHealth: 90 },
    isUnstable: false,
    reasons: [],
  };

  it("blends local and global scores", () => {
    const score = computeSubnetConfidence(
      { dataAgeSeconds: 20, fieldsPresent: 4, fieldsTotal: 4 },
      globalConf,
    );
    expect(score).toBeGreaterThan(80);
  });

  it("degrades for stale subnet data", () => {
    const fresh = computeSubnetConfidence(
      { dataAgeSeconds: 20, fieldsPresent: 4, fieldsTotal: 4 },
      globalConf,
    );
    const stale = computeSubnetConfidence(
      { dataAgeSeconds: 500, fieldsPresent: 4, fieldsTotal: 4 },
      globalConf,
    );
    expect(fresh).toBeGreaterThan(stale);
  });

  it("degrades for incomplete subnet data", () => {
    const full = computeSubnetConfidence(
      { dataAgeSeconds: 30, fieldsPresent: 4, fieldsTotal: 4 },
      globalConf,
    );
    const partial = computeSubnetConfidence(
      { dataAgeSeconds: 30, fieldsPresent: 1, fieldsTotal: 4 },
      globalConf,
    );
    expect(full).toBeGreaterThan(partial);
  });
});

describe("ApiHealthTracker", () => {
  it("records and retrieves calls", () => {
    const tracker = new ApiHealthTracker(60_000);
    tracker.record(makeRecord(true, 100, "src1"));
    tracker.record(makeRecord(false, 200, "src2"));
    expect(tracker.getCount()).toBe(2);
    expect(tracker.getCount("src1")).toBe(1);
  });

  it("prunes old records", () => {
    const tracker = new ApiHealthTracker(1000); // 1s window
    tracker.record({ timestamp: now - 2000, success: true, latencyMs: 100, source: "old" });
    tracker.record(makeRecord(true, 100, "new"));
    expect(tracker.getCount()).toBe(1);
  });

  it("resets all records", () => {
    const tracker = new ApiHealthTracker();
    tracker.record(makeRecord(true, 100));
    tracker.reset();
    expect(tracker.getCount()).toBe(0);
  });

  it("filters by source", () => {
    const tracker = new ApiHealthTracker();
    tracker.record(makeRecord(true, 100, "a"));
    tracker.record(makeRecord(true, 200, "b"));
    tracker.record(makeRecord(false, 300, "a"));
    expect(tracker.getRecords("a")).toHaveLength(2);
    expect(tracker.getRecords("b")).toHaveLength(1);
  });
});
