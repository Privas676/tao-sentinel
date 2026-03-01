import { describe, it, expect } from "vitest";
import {
  computeTaoIndex,
  deriveRegime,
  evaluateRegime,
  regimeLabel,
  regimeColor,
  taoIndexColor,
  type RegimeInput,
} from "@/lib/engine-regime";

/* ── Helper ── */

function makeInput(overrides: Partial<RegimeInput> = {}): RegimeInput {
  return {
    avgOpportunity: 60, avgRisk: 40, smartCapitalScore: 50,
    avgStability: 55, avgConfiance: 65,
    overridePct: 5, warningPct: 10,
    ...overrides,
  };
}

/* ═══════════════════════════════════════ */
/*  computeTaoIndex                        */
/* ═══════════════════════════════════════ */

describe("computeTaoIndex", () => {
  it("returns value in 0-100 range", () => {
    const idx = computeTaoIndex(makeInput());
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(idx).toBeLessThanOrEqual(100);
  });

  it("high opportunity + low risk → high index", () => {
    const idx = computeTaoIndex(makeInput({
      avgOpportunity: 90, avgRisk: 10, smartCapitalScore: 80,
    }));
    expect(idx).toBeGreaterThanOrEqual(50);
  });

  it("low opportunity + high risk → low index", () => {
    const idx = computeTaoIndex(makeInput({
      avgOpportunity: 10, avgRisk: 90, smartCapitalScore: 20,
    }));
    expect(idx).toBeLessThan(30);
  });

  it("high overridePct (>30) penalizes index by 10", () => {
    const base = computeTaoIndex(makeInput({ overridePct: 5 }));
    const penalized = computeTaoIndex(makeInput({ overridePct: 35 }));
    expect(penalized).toBeLessThan(base);
  });

  it("overridePct 15-30 penalizes by 5", () => {
    const base = computeTaoIndex(makeInput({ overridePct: 5 }));
    const mid = computeTaoIndex(makeInput({ overridePct: 20 }));
    expect(mid).toBeLessThanOrEqual(base);
    expect(mid).toBeGreaterThanOrEqual(base - 5);
  });

  it("high warningPct (>50) penalizes by 5", () => {
    const base = computeTaoIndex(makeInput({ warningPct: 10 }));
    const penalized = computeTaoIndex(makeInput({ warningPct: 55 }));
    expect(penalized).toBeLessThan(base);
  });

  it("low avgStability (<35) penalizes by 8", () => {
    const base = computeTaoIndex(makeInput({ avgStability: 60 }));
    const penalized = computeTaoIndex(makeInput({ avgStability: 30 }));
    expect(penalized).toBeLessThan(base);
  });

  it("low avgConfiance (<40) penalizes by 5", () => {
    const base = computeTaoIndex(makeInput({ avgConfiance: 70 }));
    const penalized = computeTaoIndex(makeInput({ avgConfiance: 30 }));
    expect(penalized).toBeLessThan(base);
  });

  it("clamped at 0 for extreme negative", () => {
    const idx = computeTaoIndex(makeInput({
      avgOpportunity: 0, avgRisk: 100, smartCapitalScore: 0,
      avgStability: 10, avgConfiance: 10,
      overridePct: 50, warningPct: 80,
    }));
    expect(idx).toBe(0);
  });

  it("clamped at 100 for extreme positive", () => {
    const idx = computeTaoIndex(makeInput({
      avgOpportunity: 100, avgRisk: 0, smartCapitalScore: 100,
      avgStability: 100, avgConfiance: 100,
      overridePct: 0, warningPct: 0,
    }));
    expect(idx).toBeLessThanOrEqual(100);
  });
});

/* ═══════════════════════════════════════ */
/*  deriveRegime                           */
/* ═══════════════════════════════════════ */

describe("deriveRegime", () => {
  it("high index + high SC + high confiance → OFFENSIVE", () => {
    expect(deriveRegime(70, 65, 60, 55)).toBe("OFFENSIVE");
  });

  it("index ≥55, stability ≥60, SC ≥60 → OFFENSIVE", () => {
    expect(deriveRegime(55, 60, 65, 55)).toBe("OFFENSIVE");
  });

  it("low index (<35) → DEFENSIVE", () => {
    expect(deriveRegime(30, 50, 60, 70)).toBe("DEFENSIVE");
  });

  it("index <45 + low stability → DEFENSIVE", () => {
    expect(deriveRegime(40, 50, 40, 70)).toBe("DEFENSIVE");
  });

  it("very low SC (≤30) → DEFENSIVE", () => {
    expect(deriveRegime(50, 25, 60, 70)).toBe("DEFENSIVE");
  });

  it("mid-range values → NEUTRAL", () => {
    expect(deriveRegime(50, 50, 55, 60)).toBe("NEUTRAL");
  });

  it("boundary: index=65, SC=60, confiance=50 → OFFENSIVE", () => {
    expect(deriveRegime(65, 60, 50, 50)).toBe("OFFENSIVE");
  });

  it("boundary: index=35 → not DEFENSIVE (≥35)", () => {
    expect(deriveRegime(35, 50, 60, 70)).not.toBe("DEFENSIVE");
  });
});

/* ═══════════════════════════════════════ */
/*  evaluateRegime (full pipeline)         */
/* ═══════════════════════════════════════ */

describe("evaluateRegime", () => {
  it("returns all required fields", () => {
    const out = evaluateRegime(makeInput());
    expect(out).toHaveProperty("taoIndex");
    expect(out).toHaveProperty("regime");
    expect(out).toHaveProperty("regimeLabel");
    expect(out).toHaveProperty("regimeColor");
  });

  it("regime matches taoIndex", () => {
    const out = evaluateRegime(makeInput({
      avgOpportunity: 0, avgRisk: 100, smartCapitalScore: 10,
      avgStability: 20, avgConfiance: 20,
    }));
    expect(out.taoIndex).toBeLessThan(35);
    expect(out.regime).toBe("DEFENSIVE");
  });
});

/* ═══════════════════════════════════════ */
/*  Display helpers                        */
/* ═══════════════════════════════════════ */

describe("regimeLabel", () => {
  it("OFFENSIVE → OFFENSIF", () => expect(regimeLabel("OFFENSIVE")).toBe("OFFENSIF"));
  it("NEUTRAL → NEUTRE", () => expect(regimeLabel("NEUTRAL")).toBe("NEUTRE"));
  it("DEFENSIVE → DÉFENSIF", () => expect(regimeLabel("DEFENSIVE")).toBe("DÉFENSIF"));
});

describe("regimeColor", () => {
  it("returns rgba strings", () => {
    expect(regimeColor("OFFENSIVE")).toContain("rgba");
    expect(regimeColor("NEUTRAL")).toContain("rgba");
    expect(regimeColor("DEFENSIVE")).toContain("rgba");
  });
});

describe("taoIndexColor", () => {
  it("≥65 → green", () => expect(taoIndexColor(70)).toContain("76,175,80"));
  it("45-64 → amber", () => expect(taoIndexColor(50)).toContain("255,193,7"));
  it("<45 → red", () => expect(taoIndexColor(30)).toContain("229,57,53"));
});
