import { describe, it, expect } from "vitest";
import {
  computeSmartCapital,
  computeDualCore,
  computeGlobalPsi,
  computeGlobalConfidence,
  computeGlobalOpportunity,
  computeGlobalRisk,
} from "@/lib/gauge-smart-capital";
import type { RawSignal, SubnetSignal } from "@/lib/gauge-types";

function makeRaw(overrides: Partial<RawSignal> = {}): RawSignal {
  return {
    netuid: 1, mpi: 60, confidence_pct: 60, quality_score: 60,
    state: null, subnet_name: "SN-1", score: null,
    ...overrides,
  } as RawSignal;
}

function makeSignal(overrides: Partial<SubnetSignal> = {}): SubnetSignal {
  return {
    netuid: 1, name: "SN-1", psi: 60, opportunity: 50, risk: 40,
    confidence: 60, state: "CALM", phase: "NONE", asymmetry: "MED",
    sparkline_7d: [], liquidity: 50, momentum: 50, momentumLabel: "MODÉRÉ",
    momentumScore: 50, reasons: [], dominant: "neutral", isMicroCap: false,
    asMicro: 0, preHype: false, preHypeIntensity: 0, stabilitySetup: 60,
    isOverridden: false, systemStatus: "OK", overrideReasons: [],
    dataUncertain: false, confianceData: 80,
    ...overrides,
  } as SubnetSignal;
}

describe("computeSmartCapital", () => {
  it("empty → STABLE score 50", () => {
    const r = computeSmartCapital([]);
    expect(r.score).toBe(50);
    expect(r.state).toBe("STABLE");
  });
  it("high quality + confidence → ACCUMULATION", () => {
    const raws = Array(5).fill(null).map(() => makeRaw({ quality_score: 85, confidence_pct: 80, mpi: 50 }));
    const r = computeSmartCapital(raws);
    expect(r.state).toBe("ACCUMULATION");
    expect(r.score).toBeGreaterThanOrEqual(65);
  });
  it("BREAK states → DISTRIBUTION", () => {
    const raws = Array(5).fill(null).map(() => makeRaw({ quality_score: 20, mpi: 85, state: "BREAK" }));
    const r = computeSmartCapital(raws);
    expect(r.state).toBe("DISTRIBUTION");
  });
  it("score clamped 0-100", () => {
    const r = computeSmartCapital([makeRaw({ quality_score: 100, confidence_pct: 100, mpi: 100 })]);
    expect(r.score).toBeLessThanOrEqual(100);
    expect(r.score).toBeGreaterThanOrEqual(0);
  });
});

describe("computeDualCore", () => {
  it("empty → default 65/35 split", () => {
    const r = computeDualCore([], { score: 50, state: "STABLE" });
    expect(r.structurePct).toBe(65);
    expect(r.sniperPct).toBe(35);
  });
  it("ACCUMULATION shifts to 55/45", () => {
    const signals = [makeSignal({ confidence: 80, risk: 30, asymmetry: "MED", opportunity: 70 })];
    const r = computeDualCore(signals, { score: 70, state: "ACCUMULATION" });
    expect(r.structurePct).toBe(55);
    expect(r.sniperPct).toBe(45);
  });
  it("DISTRIBUTION shifts to 75/25", () => {
    const signals = [makeSignal({ confidence: 80, risk: 30, asymmetry: "MED", opportunity: 70 })];
    const r = computeDualCore(signals, { score: 30, state: "DISTRIBUTION" });
    expect(r.structurePct).toBe(75);
    expect(r.sniperPct).toBe(25);
  });
});

describe("computeGlobalPsi", () => {
  it("empty → 0", () => {
    expect(computeGlobalPsi([])).toBe(0);
  });
  it("weighted by squared values", () => {
    const raws = [makeRaw({ mpi: 80 }), makeRaw({ mpi: 20 })];
    const r = computeGlobalPsi(raws);
    expect(r).toBeGreaterThan(50); // weighted towards higher
  });
});

describe("computeGlobalConfidence", () => {
  it("empty → 0", () => {
    expect(computeGlobalConfidence([])).toBe(0);
  });
  it("averages confidence", () => {
    const raws = [makeRaw({ confidence_pct: 80 }), makeRaw({ confidence_pct: 40 })];
    expect(computeGlobalConfidence(raws)).toBe(60);
  });
});

describe("computeGlobalOpportunity", () => {
  it("empty → 0", () => {
    expect(computeGlobalOpportunity([])).toBe(0);
  });
  it("returns reasonable score for mixed signals", () => {
    const raws = [
      makeRaw({ mpi: 80, confidence_pct: 70, quality_score: 70, state: "GO" }),
      makeRaw({ mpi: 30, confidence_pct: 40, quality_score: 30, state: null }),
    ];
    const r = computeGlobalOpportunity(raws);
    expect(r).toBeGreaterThan(0);
    expect(r).toBeLessThanOrEqual(100);
  });
});

describe("computeGlobalRisk", () => {
  it("empty → 0", () => {
    expect(computeGlobalRisk([])).toBe(0);
  });
  it("BREAK signals increase global risk", () => {
    const normal = [makeRaw({ mpi: 60, confidence_pct: 60, quality_score: 60 }), makeRaw({ mpi: 60, confidence_pct: 60, quality_score: 60 })];
    const breaking = [makeRaw({ mpi: 60, confidence_pct: 60, quality_score: 60, state: "BREAK" }), makeRaw({ mpi: 60, confidence_pct: 60, quality_score: 60, state: "BREAK" })];
    expect(computeGlobalRisk(breaking)).toBeGreaterThanOrEqual(computeGlobalRisk(normal));
  });
});
