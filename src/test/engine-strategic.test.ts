import { describe, it, expect } from "vitest";
import {
  deriveSubnetSC,
  computeStrategicScores,
  type StrategicInput,
} from "@/lib/engine-strategic";
import type { HealthScores, RecalculatedMetrics } from "@/lib/subnet-health";

/* ── Helpers ── */

function makeHealth(overrides: Partial<HealthScores> = {}): HealthScores {
  return {
    liquidityHealth: 70, volumeHealth: 60, emissionPressure: 20,
    dilutionRisk: 15, activityHealth: 70, ...overrides,
  };
}

function makeRecalc(overrides: Partial<RecalculatedMetrics> = {}): RecalculatedMetrics {
  return {
    mcRecalc: 1e6, fdvRecalc: 1.2e6, dilutionRatio: 1.2,
    volumeToMc: 0.05, emissionToMc: 0.001, liquidityRecalc: 1e5,
    liquidityToMc: 0.1, liqHaircut: 0, poolPrice: 0.01, ...overrides,
  };
}

function makeInput(overrides: Partial<StrategicInput> = {}): StrategicInput {
  return {
    netuid: 1, name: "SN-1", state: null,
    psi: 60, conf: 60, quality: 60,
    healthScores: makeHealth(), recalc: makeRecalc(),
    displayedCap: 100000, displayedLiq: 50000,
    confianceScore: 70, dataUncertain: false,
    priceChange7d: 5, volMcRatio: 0.05, sparklineLen: 7,
    ...overrides,
  };
}

/* ═══════════════════════════════════════ */
/*  deriveSubnetSC                         */
/* ═══════════════════════════════════════ */

describe("deriveSubnetSC", () => {
  it("high quality + conf → ACCUMULATION", () => {
    expect(deriveSubnetSC(60, 80, 70, null)).toBe("ACCUMULATION");
  });

  it("low quality + BREAK state → DISTRIBUTION", () => {
    expect(deriveSubnetSC(90, 10, 20, "BREAK")).toBe("DISTRIBUTION");
  });

  it("mid-range (50,50,50) → ACCUMULATION (score ≥ 65 due to +30 base)", () => {
    // accSignal=50*0.5+50*0.3+10=50, distSignal=(50*0.4)=20, score=50-10+30=70 → ACCUMULATION
    expect(deriveSubnetSC(50, 50, 50, null)).toBe("ACCUMULATION");
  });

  it("high psi + low quality triggers dist signal", () => {
    const sc = deriveSubnetSC(85, 30, 30, null);
    // High psi ≥80 && quality <50 → +30 dist signal
    expect(["STABLE", "DISTRIBUTION"]).toContain(sc);
  });

  it("EXIT_FAST treated like BREAK", () => {
    expect(deriveSubnetSC(90, 10, 20, "EXIT_FAST")).toBe("DISTRIBUTION");
  });
});

/* ═══════════════════════════════════════ */
/*  computeStrategicScores                  */
/* ═══════════════════════════════════════ */

describe("computeStrategicScores", () => {
  it("returns empty array for empty input", () => {
    expect(computeStrategicScores([])).toEqual([]);
  });

  it("returns one output per input", () => {
    const inputs = [makeInput({ netuid: 1 }), makeInput({ netuid: 2 })];
    const outputs = computeStrategicScores(inputs);
    expect(outputs).toHaveLength(2);
    expect(outputs[0].netuid).toBe(1);
    expect(outputs[1].netuid).toBe(2);
  });

  it("output scores are bounded 0-100", () => {
    const inputs = [
      makeInput({ psi: 0, quality: 0, conf: 0 }),
      makeInput({ psi: 100, quality: 100, conf: 100 }),
    ];
    const outputs = computeStrategicScores(inputs);
    for (const o of outputs) {
      expect(o.opp).toBeGreaterThanOrEqual(0);
      expect(o.opp).toBeLessThanOrEqual(100);
      expect(o.risk).toBeGreaterThanOrEqual(0);
      expect(o.risk).toBeLessThanOrEqual(100);
      expect(o.momentum).toBeGreaterThanOrEqual(0);
      expect(o.momentum).toBeLessThanOrEqual(100);
    }
  });

  it("BREAK state → opp = 0 and isCritical", () => {
    const inputs = [makeInput({ state: "BREAK", psi: 80, quality: 20 })];
    const [out] = computeStrategicScores(inputs);
    expect(out.opp).toBe(0);
    expect(out.isCritical).toBe(true);
  });

  it("DEPEG_CRITICAL → opp = 0 and isCritical", () => {
    const inputs = [makeInput({ state: "DEPEG_CRITICAL" })];
    const [out] = computeStrategicScores(inputs);
    expect(out.opp).toBe(0);
    expect(out.isCritical).toBe(true);
  });

  it("DEPEG_WARNING → opp = 0 and isCritical", () => {
    const inputs = [makeInput({ state: "DEPEG_WARNING" })];
    const [out] = computeStrategicScores(inputs);
    expect(out.opp).toBe(0);
    expect(out.isCritical).toBe(true);
  });

  it("EXIT_FAST → isCritical", () => {
    const inputs = [makeInput({ state: "EXIT_FAST" })];
    const [out] = computeStrategicScores(inputs);
    expect(out.isCritical).toBe(true);
  });

  it("normal state → not critical", () => {
    const inputs = [makeInput({ state: "GO" })];
    const [out] = computeStrategicScores(inputs);
    expect(out.isCritical).toBe(false);
  });

  it("asymmetry = opp - risk", () => {
    const inputs = [makeInput()];
    const [out] = computeStrategicScores(inputs);
    expect(out.asymmetry).toBe(out.opp - out.risk);
  });

  it("momentum clamped from psi", () => {
    const inputs = [makeInput({ psi: 30 })]; // psi-40 = -10 → clamped to 0
    const [out] = computeStrategicScores(inputs);
    expect(out.momentum).toBe(0);
  });

  it("high psi → high momentum", () => {
    const inputs = [makeInput({ psi: 100 })]; // (100-40)/60*100 = 100
    const [out] = computeStrategicScores(inputs);
    expect(out.momentum).toBe(100);
  });

  it("sc is one of ACCUMULATION | STABLE | DISTRIBUTION", () => {
    const inputs = [makeInput()];
    const [out] = computeStrategicScores(inputs);
    expect(["ACCUMULATION", "STABLE", "DISTRIBUTION"]).toContain(out.sc);
  });

  it("action is a valid strategic action", () => {
    const inputs = [makeInput()];
    const [out] = computeStrategicScores(inputs);
    expect(["ENTER", "HOLD", "WATCH", "EXIT"]).toContain(out.action);
  });

  it("does NOT depend on isOverridden (always false internally)", () => {
    // Strategic engine passes isOverridden: false to calibrateScores
    const inputs = [makeInput({ quality: 80, conf: 80, psi: 70 })];
    const [out] = computeStrategicScores(inputs);
    // Should produce a positive opp since no override zeroing
    expect(out.opp).toBeGreaterThan(0);
  });

  it("single subnet still normalizes correctly", () => {
    const inputs = [makeInput()];
    const outputs = computeStrategicScores(inputs);
    expect(outputs).toHaveLength(1);
    // Should not crash on single-element normalization
    expect(outputs[0].opp).toBeGreaterThanOrEqual(0);
  });
});
