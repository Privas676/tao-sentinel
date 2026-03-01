import { describe, it, expect } from "vitest";
import {
  fuseMetrics,
  computeGlobalConfianceData,
  confianceColor,
  shouldModerateRecommendation,
  type SourceMetrics,
} from "@/lib/data-fusion";

const now = new Date().toISOString();

function makeMetrics(netuid: number, price: number, source: string): SourceMetrics {
  return { netuid, price, cap: price * 1000, vol24h: price * 100, liquidity: price * 50, ts: now, source };
}

describe("fuseMetrics", () => {
  it("returns consensus for matching subnets", () => {
    const primary = [makeMetrics(1, 100, "taostats")];
    const secondary = [makeMetrics(1, 102, "tmc")];
    const result = fuseMetrics(primary, secondary);
    expect(result).toHaveLength(1);
    expect(result[0].price).toBe(101); // median
    expect(result[0].confianceData).toBeGreaterThan(0);
  });

  it("handles primary-only subnet", () => {
    const primary = [makeMetrics(1, 100, "taostats")];
    const result = fuseMetrics(primary, []);
    expect(result).toHaveLength(1);
    expect(result[0].price).toBe(100);
  });

  it("handles secondary-only subnet", () => {
    const secondary = [makeMetrics(2, 50, "tmc")];
    const result = fuseMetrics([], secondary);
    expect(result).toHaveLength(1);
    expect(result[0].price).toBe(50);
  });

  it("merges unique netuids from both sources", () => {
    const primary = [makeMetrics(1, 100, "taostats")];
    const secondary = [makeMetrics(2, 50, "tmc")];
    const result = fuseMetrics(primary, secondary);
    expect(result).toHaveLength(2);
  });

  it("detects dataUncertain on large price divergence", () => {
    const primary = [makeMetrics(1, 100, "taostats")];
    const secondary = [makeMetrics(1, 150, "tmc")]; // 40% divergence
    const result = fuseMetrics(primary, secondary);
    expect(result[0].dataUncertain).toBe(true);
    expect(result[0].divergences.length).toBeGreaterThan(0);
  });

  it("no dataUncertain on small divergence", () => {
    const primary = [makeMetrics(1, 100, "taostats")];
    const secondary = [makeMetrics(1, 100.5, "tmc")]; // 0.5%
    const result = fuseMetrics(primary, secondary);
    expect(result[0].dataUncertain).toBe(false);
  });
});

describe("computeGlobalConfianceData", () => {
  it("returns zero score for empty inputs", () => {
    const r = computeGlobalConfianceData([], []);
    expect(r.score).toBe(0);
  });

  it("returns valid score with single source", () => {
    const primary = [makeMetrics(1, 100, "taostats")];
    const r = computeGlobalConfianceData(primary, []);
    expect(r.score).toBeGreaterThan(0);
    expect(r.availability).toBe(50); // no secondary
  });

  it("availability is 100 when both sources present", () => {
    const primary = [makeMetrics(1, 100, "taostats")];
    const secondary = [makeMetrics(1, 101, "tmc")];
    const r = computeGlobalConfianceData(primary, secondary);
    expect(r.availability).toBe(100);
  });

  it("high concordance for near-identical data", () => {
    const primary = [makeMetrics(1, 100, "taostats")];
    const secondary = [makeMetrics(1, 100.01, "tmc")];
    const r = computeGlobalConfianceData(primary, secondary);
    expect(r.concordance).toBeGreaterThan(90);
  });
});

describe("confianceColor", () => {
  it("green for ≥80", () => expect(confianceColor(85)).toContain("76,175,80"));
  it("amber for ≥60", () => expect(confianceColor(65)).toContain("255,193,7"));
  it("orange for ≥40", () => expect(confianceColor(45)).toContain("255,109,0"));
  it("red for <40", () => expect(confianceColor(20)).toContain("229,57,53"));
});

describe("shouldModerateRecommendation", () => {
  it("no moderation when confidence ≥60", () => {
    expect(shouldModerateRecommendation(70, 50, 50)).toBe(false);
  });
  it("no moderation for strong opportunity", () => {
    expect(shouldModerateRecommendation(40, 80, 15)).toBe(false);
  });
  it("moderates when low confidence + ambiguous scores", () => {
    expect(shouldModerateRecommendation(40, 50, 50)).toBe(true);
  });
});
