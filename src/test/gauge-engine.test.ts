import { describe, it, expect } from "vitest";
import {
  clamp,
  deriveGaugeState,
  derivePhase,
  computeMomentumScore,
  computeMomentumScoreV2,
  assignMomentumLabels,
  deriveMomentumLabel,
  computeStabilitySetup,
  normalizeWithVariance,
  normalizeOpportunity,
  opportunityColor,
  riskColor,
  stabilityColor,
  PSI_THRESHOLDS,
} from "@/lib/gauge-engine";

describe("clamp", () => {
  it("clamps below min", () => expect(clamp(-5, 0, 100)).toBe(0));
  it("clamps above max", () => expect(clamp(150, 0, 100)).toBe(100));
  it("passes through in range", () => expect(clamp(50, 0, 100)).toBe(50));
});

describe("deriveGaugeState", () => {
  it("returns EXIT when riskHigh", () => {
    expect(deriveGaugeState(90, 80, true)).toBe("EXIT");
  });
  it("returns IMMINENT when PSI≥85 and conf≥70", () => {
    expect(deriveGaugeState(90, 80)).toBe("IMMINENT");
  });
  it("returns ALERT when PSI≥35", () => {
    expect(deriveGaugeState(50, 50)).toBe("ALERT");
  });
  it("returns CALM when PSI<35", () => {
    expect(deriveGaugeState(20, 50)).toBe("CALM");
  });
  it("IMMINENT requires confidence≥70", () => {
    expect(deriveGaugeState(90, 60)).toBe("ALERT");
  });
});

describe("derivePhase", () => {
  it("TRIGGER when PSI≥70", () => expect(derivePhase(75)).toBe("TRIGGER"));
  it("ARMED when PSI≥55", () => expect(derivePhase(60)).toBe("ARMED"));
  it("BUILD when PSI≥35", () => expect(derivePhase(40)).toBe("BUILD"));
  it("NONE when PSI<35", () => expect(derivePhase(20)).toBe("NONE"));
});

describe("computeMomentumScore", () => {
  it("returns 0-100 range", () => {
    const s = computeMomentumScore(50);
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(100);
  });
  it("higher PSI gives higher score", () => {
    expect(computeMomentumScore(80)).toBeGreaterThan(computeMomentumScore(30));
  });
  it("acceleration bonus from prevPsi", () => {
    expect(computeMomentumScore(60, 40)).toBeGreaterThan(computeMomentumScore(60, 60));
  });
});

describe("computeMomentumScoreV2", () => {
  it("returns positive for healthy subnet", () => {
    const s = computeMomentumScoreV2(60, 10, 0.05);
    expect(s).toBeGreaterThan(0);
  });
  it("handles null price/vol gracefully", () => {
    const s = computeMomentumScoreV2(50, null, null);
    expect(s).toBeGreaterThanOrEqual(0);
  });
  it("max score respects component weights (40+35+25=100)", () => {
    const s = computeMomentumScoreV2(100, 50, 0.1);
    expect(s).toBeLessThanOrEqual(100);
  });
});

describe("assignMomentumLabels", () => {
  it("empty input returns empty", () => {
    expect(assignMomentumLabels([])).toEqual([]);
  });
  it("distributes labels by percentile", () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({
      momentumScoreV2: (i + 1) * 10,
      isCritical: false,
    }));
    const labels = assignMomentumLabels(rows);
    expect(labels).toHaveLength(10);
    expect(labels.filter(l => l === "FORT").length).toBe(2);
    expect(labels.filter(l => l === "DÉTÉRIORATION").length).toBe(1);
  });
  it("critical subnets capped at STABLE", () => {
    const rows = [
      { momentumScoreV2: 100, isCritical: true },
      { momentumScoreV2: 10, isCritical: false },
    ];
    const labels = assignMomentumLabels(rows);
    expect(labels[0]).toBe("STABLE");
  });
});

describe("computeStabilitySetup", () => {
  it("returns 0-100", () => {
    const s = computeStabilitySetup(60, 40, 80, 50, 70);
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(100);
  });
  it("balanced opp/risk gives higher stability", () => {
    const balanced = computeStabilitySetup(50, 50, 80, 50, 70);
    const skewed = computeStabilitySetup(90, 10, 80, 50, 70);
    expect(balanced).toBeGreaterThanOrEqual(skewed);
  });
  it("higher confidence increases stability", () => {
    const highConf = computeStabilitySetup(50, 50, 90, 50, 70);
    const lowConf = computeStabilitySetup(50, 50, 20, 50, 70);
    expect(highConf).toBeGreaterThan(lowConf);
  });
});

describe("normalizeWithVariance", () => {
  it("returns same length array", () => {
    const input = [10, 20, 30, 40, 50];
    expect(normalizeWithVariance(input)).toHaveLength(5);
  });
  it("anti-100 rule: multiple maxes capped at 99", () => {
    const input = [50, 50, 50];
    const result = normalizeWithVariance(input);
    result.forEach(v => expect(v).toBeLessThanOrEqual(99));
  });
});

describe("normalizeOpportunity", () => {
  it("returns same length", () => {
    const input = [10, 30, 50, 70, 90];
    expect(normalizeOpportunity(input)).toHaveLength(5);
  });
  it("scores capped at 98 max", () => {
    const input = [10, 20, 30, 40, 100];
    const result = normalizeOpportunity(input);
    result.forEach(v => expect(v).toBeLessThanOrEqual(98));
  });
  it("maintains relative ordering", () => {
    const input = [10, 50, 90];
    const result = normalizeOpportunity(input);
    expect(result[2]).toBeGreaterThanOrEqual(result[1]);
    expect(result[1]).toBeGreaterThanOrEqual(result[0]);
  });
});

describe("color functions", () => {
  it("opportunityColor returns rgba string", () => {
    expect(opportunityColor(80)).toContain("rgba");
    expect(opportunityColor(50)).toContain("rgba");
    expect(opportunityColor(25)).toContain("rgba");
    expect(opportunityColor(10)).toContain("rgba");
  });
  it("riskColor returns rgba string", () => {
    expect(riskColor(80)).toContain("rgba");
    expect(riskColor(50)).toContain("rgba");
  });
  it("stabilityColor thresholds", () => {
    expect(stabilityColor(80)).toContain("76,175,80"); // green
    expect(stabilityColor(60)).toContain("255,193,7"); // amber
    expect(stabilityColor(35)).toContain("255,109,0"); // orange
    expect(stabilityColor(10)).toContain("229,57,53"); // red
  });
});
