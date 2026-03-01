import { describe, it, expect } from "vitest";
import {
  computeMomentumScore,
  computeMomentumScoreV2,
  assignMomentumLabels,
  deriveMomentumLabel,
  momentumColor,
  computeStabilitySetup,
  stabilityColor,
} from "@/lib/gauge-momentum";

describe("computeMomentumScore", () => {
  it("high PSI → high score", () => {
    expect(computeMomentumScore(90)).toBeGreaterThan(60);
  });
  it("low PSI → low score", () => {
    expect(computeMomentumScore(10)).toBeLessThan(30);
  });
  it("acceleration bonus from prevPsi", () => {
    const rising = computeMomentumScore(70, 50);
    const flat = computeMomentumScore(70);
    expect(rising).toBeGreaterThan(flat);
  });
  it("deceleration penalty", () => {
    const falling = computeMomentumScore(50, 70);
    const flat = computeMomentumScore(50);
    expect(falling).toBeLessThan(flat);
  });
  it("clamped 0-100", () => {
    expect(computeMomentumScore(0)).toBeGreaterThanOrEqual(0);
    expect(computeMomentumScore(100, 0)).toBeLessThanOrEqual(100);
  });
});

describe("computeMomentumScoreV2", () => {
  it("PSI weight 40%", () => {
    const high = computeMomentumScoreV2(80, 0, 0);
    const low = computeMomentumScoreV2(30, 0, 0);
    expect(high).toBeGreaterThan(low);
  });
  it("priceChange7d weight 35%", () => {
    const bullish = computeMomentumScoreV2(50, 20, 0);
    const bearish = computeMomentumScoreV2(50, -20, 0);
    expect(bullish).toBeGreaterThan(bearish);
  });
  it("volMcRatio weight 25%", () => {
    const highVol = computeMomentumScoreV2(50, 0, 0.08);
    const lowVol = computeMomentumScoreV2(50, 0, 0.01);
    expect(highVol).toBeGreaterThan(lowVol);
  });
  it("handles null inputs", () => {
    const r = computeMomentumScoreV2(50, null, null);
    expect(r).toBeGreaterThanOrEqual(0);
  });
});

describe("assignMomentumLabels", () => {
  it("distributes labels by percentile", () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({
      momentumScoreV2: (i + 1) * 10,
      isCritical: false,
    }));
    const labels = assignMomentumLabels(rows);
    expect(labels).toHaveLength(10);
    expect(labels.filter(l => l === "FORT")).toHaveLength(2);
    expect(labels.filter(l => l === "DÉTÉRIORATION")).toHaveLength(1);
  });
  it("critical subnets capped to STABLE", () => {
    const rows = [
      { momentumScoreV2: 100, isCritical: true },
      { momentumScoreV2: 10, isCritical: false },
    ];
    const labels = assignMomentumLabels(rows);
    expect(labels[0]).toBe("STABLE");
  });
  it("empty input → empty output", () => {
    expect(assignMomentumLabels([])).toEqual([]);
  });
});

describe("deriveMomentumLabel (legacy)", () => {
  it("FORT for high PSI", () => {
    expect(deriveMomentumLabel(90)).toBe("FORT");
  });
  it("MODÉRÉ for mid PSI", () => {
    expect(deriveMomentumLabel(65)).toBe("MODÉRÉ");
  });
  it("STABLE for moderate", () => {
    expect(deriveMomentumLabel(50)).toBe("STABLE");
  });
  it("DÉTÉRIORATION for low", () => {
    expect(deriveMomentumLabel(10)).toBe("DÉTÉRIORATION");
  });
});

describe("momentumColor", () => {
  it("FORT → green", () => expect(momentumColor("FORT")).toContain("76,175,80"));
  it("MODÉRÉ → amber", () => expect(momentumColor("MODÉRÉ")).toContain("255,193,7"));
  it("STABLE → white", () => expect(momentumColor("STABLE")).toContain("255,255,255"));
  it("DÉTÉRIORATION → red", () => expect(momentumColor("DÉTÉRIORATION")).toContain("229,57,53"));
});

describe("computeStabilitySetup", () => {
  it("balanced inputs → high stability", () => {
    const s = computeStabilitySetup(50, 50, 80, 55, 70, false);
    expect(s).toBeGreaterThan(60);
  });
  it("extreme asymmetry → lower stability", () => {
    const balanced = computeStabilitySetup(50, 50, 60, 55, 50, false);
    const skewed = computeStabilitySetup(90, 10, 60, 55, 50, false);
    expect(skewed).toBeLessThanOrEqual(balanced);
  });
  it("clamped 0-100", () => {
    expect(computeStabilitySetup(0, 0, 0, 0, 0, false)).toBeGreaterThanOrEqual(0);
    expect(computeStabilitySetup(100, 100, 100, 55, 100, false)).toBeLessThanOrEqual(100);
  });
});

describe("stabilityColor", () => {
  it("high → green", () => expect(stabilityColor(80)).toContain("76,175,80"));
  it("mid → amber", () => expect(stabilityColor(60)).toContain("255,193,7"));
  it("low-mid → orange", () => expect(stabilityColor(35)).toContain("255,109,0"));
  it("low → red", () => expect(stabilityColor(20)).toContain("229,57,53"));
});
