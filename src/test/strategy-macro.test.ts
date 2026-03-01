import { describe, it, expect } from "vitest";
import {
  deriveMacroRecommendation,
  computeSentinelIndex,
  sentinelIndexColor,
  sentinelIndexLabel,
} from "@/lib/strategy-macro";

describe("deriveMacroRecommendation", () => {
  it("REDUCE when sentinelIndex < 35", () => {
    expect(deriveMacroRecommendation(30, "STABLE", 60, 60)).toBe("REDUCE");
  });
  it("REDUCE when DISTRIBUTION", () => {
    expect(deriveMacroRecommendation(60, "DISTRIBUTION", 60, 60)).toBe("REDUCE");
  });
  it("REDUCE when low stability + low sentinel", () => {
    expect(deriveMacroRecommendation(45, "STABLE", 25, 60)).toBe("REDUCE");
  });
  it("INCREASE when sentinel≥65 + ACCUMULATION + conf≥50", () => {
    expect(deriveMacroRecommendation(70, "ACCUMULATION", 60, 55)).toBe("INCREASE");
  });
  it("INCREASE when sentinel≥55 + stability≥60 + ACCUMULATION", () => {
    expect(deriveMacroRecommendation(58, "ACCUMULATION", 65, 40)).toBe("INCREASE");
  });
  it("NEUTRAL for ambiguous conditions", () => {
    expect(deriveMacroRecommendation(50, "STABLE", 55, 55)).toBe("NEUTRAL");
  });
});

describe("computeSentinelIndex", () => {
  it("returns 0-100", () => {
    const s = computeSentinelIndex(60, 40, 50);
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(100);
  });
  it("higher opportunity raises index", () => {
    expect(computeSentinelIndex(80, 30, 50)).toBeGreaterThan(computeSentinelIndex(40, 30, 50));
  });
  it("higher risk lowers index", () => {
    expect(computeSentinelIndex(60, 80, 50)).toBeLessThan(computeSentinelIndex(60, 20, 50));
  });
});

describe("sentinelIndexColor", () => {
  it("green for ≥65", () => expect(sentinelIndexColor(70)).toContain("76,175,80"));
  it("amber for ≥45", () => expect(sentinelIndexColor(50)).toContain("255,193,7"));
  it("red for <45", () => expect(sentinelIndexColor(30)).toContain("229,57,53"));
});

describe("sentinelIndexLabel", () => {
  it("OFFENSIF/OFFENSIVE for ≥65", () => {
    expect(sentinelIndexLabel(70, "fr")).toBe("OFFENSIF");
    expect(sentinelIndexLabel(70, "en")).toBe("OFFENSIVE");
  });
  it("NEUTRE/NEUTRAL for ≥45", () => {
    expect(sentinelIndexLabel(50, "fr")).toBe("NEUTRE");
    expect(sentinelIndexLabel(50, "en")).toBe("NEUTRAL");
  });
  it("DÉFENSIF/DEFENSIVE for <45", () => {
    expect(sentinelIndexLabel(30, "fr")).toBe("DÉFENSIF");
    expect(sentinelIndexLabel(30, "en")).toBe("DEFENSIVE");
  });
});
