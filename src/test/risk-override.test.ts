import { describe, it, expect, beforeEach } from "vitest";
import {
  evaluateRiskOverride,
  clearOverrideCooldowns,
  capOpportunity,
  checkCoherence,
  systemStatusColor,
  systemStatusLabel,
} from "@/lib/risk-override";

beforeEach(() => clearOverrideCooldowns());

const base = { netuid: 1, state: null as string | null, psi: 50, risk: 50, quality: 50 };

describe("evaluateRiskOverride v3", () => {
  it("returns OK with no flags", () => {
    const r = evaluateRiskOverride(base);
    expect(r.isOverridden).toBe(false);
    expect(r.isWarning).toBe(false);
    expect(r.systemStatus).toBe("OK");
    expect(r.overrideScore).toBe(0);
    expect(r.flags).toHaveLength(0);
  });

  it("1 strong flag → warning (surveillance)", () => {
    const r = evaluateRiskOverride({ ...base, state: "DEPEG" });
    expect(r.isOverridden).toBe(false);
    expect(r.isWarning).toBe(true);
    expect(r.flags).toContain("DEPEG");
    expect(r.systemStatus).toBe("DEPEG");
    expect(r.overrideScore).toBe(0.5);
  });

  it("1 weak flag alone → no warning (score < 0.30)", () => {
    const r = evaluateRiskOverride({ ...base, minersActive: 2 });
    expect(r.isOverridden).toBe(false);
    expect(r.isWarning).toBe(false);
    expect(r.flags).toContain("UID_FAIBLE");
  });

  it("2 flags but score < 0.70 → no override, no warning", () => {
    // UID_FAIBLE (0.12) + VOL_MC_ANOMALIE (0.18) = 0.30 < 0.70
    const r = evaluateRiskOverride({ ...base, minersActive: 2, volumeMcRatio: 0.001 });
    expect(r.isOverridden).toBe(false);
    expect(r.isWarning).toBe(false);
    expect(r.flags).toHaveLength(2);
  });

  it("2 strong flags → score >= 0.70 → warning (not critical)", () => {
    // ZONE_CRITIQUE_STATE (0.30) + POOL_FAIBLE (0.35) = 0.65... add VOL_MC
    // Actually: POOL_FAIBLE (0.35) + LIQUIDITY_STRESS (0.30) = 0.65
    // Need to hit 0.70: POOL_FAIBLE (0.35) + ZONE_CRITIQUE_STATE (0.30) + UID_FAIBLE (0.12) = 0.77
    const r = evaluateRiskOverride({ ...base, state: "BREAK", taoInPool: 2, minersActive: 1 });
    expect(r.flags.length).toBeGreaterThanOrEqual(2);
    expect(r.overrideScore).toBeGreaterThanOrEqual(0.70);
    // Score is 0.30 + 0.35 + 0.12 = 0.77 → warning (< 0.85)
    expect(r.isWarning).toBe(true);
    expect(r.isOverridden).toBe(false);
  });

  it("multiple strong flags → score >= 0.85 → critical override", () => {
    // DEPEG (0.50) + POOL_FAIBLE (0.35) = 0.85
    const r = evaluateRiskOverride({ ...base, state: "DEPEG", taoInPool: 2 });
    expect(r.isOverridden).toBe(true);
    expect(r.overrideScore).toBeGreaterThanOrEqual(0.85);
    expect(r.systemStatus).toBe("DEPEG");
  });

  it("DEREGISTRATION + pool → critical", () => {
    const r = evaluateRiskOverride({ ...base, state: "DEREGISTRATION", taoInPool: 2 });
    expect(r.isOverridden).toBe(true);
    expect(r.systemStatus).toBe("DEREGISTRATION");
    expect(r.flags).toContain("DEREGISTRATION");
    expect(r.flags).toContain("POOL_FAIBLE");
  });

  it("TAO pool critical triggers flag", () => {
    const r = evaluateRiskOverride({ ...base, taoInPool: 3 });
    expect(r.flags).toContain("POOL_FAIBLE");
  });

  it("liquidity USD critical", () => {
    const r = evaluateRiskOverride({ ...base, liquidityUsd: 200 });
    expect(r.flags).toContain("LIQUIDITY_STRESS");
  });

  it("vol/MC low", () => {
    const r = evaluateRiskOverride({ ...base, volumeMcRatio: 0.001 });
    expect(r.flags).toContain("VOL_MC_ANOMALIE");
  });

  it("slippage high", () => {
    const r = evaluateRiskOverride({ ...base, slippagePct: 0.08 });
    expect(r.flags).toContain("SLIPPAGE_HIGH");
  });

  it("emission zero", () => {
    const r = evaluateRiskOverride({ ...base, emissionTao: 0 });
    expect(r.flags).toContain("EMISSION_ZERO");
  });

  it("cooldown suppresses repeated critical override to warning", () => {
    // First call: critical override
    evaluateRiskOverride({ ...base, state: "DEPEG", taoInPool: 2 });
    // Second call within cooldown → warning
    const r2 = evaluateRiskOverride({ ...base, state: "DEPEG", taoInPool: 2 });
    expect(r2.isOverridden).toBe(false);
    expect(r2.isWarning).toBe(true);
  });

  it("overrideScore is capped at 1.0", () => {
    // Stack many flags
    const r = evaluateRiskOverride({
      ...base,
      state: "DEPEG",
      taoInPool: 1,
      liquidityUsd: 100,
      volumeMcRatio: 0.001,
      emissionTao: 0,
      slippagePct: 0.10,
      minersActive: 1,
    });
    expect(r.overrideScore).toBeLessThanOrEqual(1.0);
  });

  it("backward compat: hardConditions equals flags", () => {
    const r = evaluateRiskOverride({ ...base, state: "BREAK" });
    expect(r.hardConditions).toEqual(r.flags);
  });
});

describe("capOpportunity", () => {
  it("unique max at 100 stays, others capped at 99", () => {
    expect(capOpportunity([50, 80, 100])).toEqual([50, 80, 100]);
  });
  it("unique max can stay 100", () => {
    const r = capOpportunity([50, 60, 100]);
    expect(r[2]).toBe(100);
  });
  it("duplicate maxes capped at 99", () => {
    expect(capOpportunity([100, 100])).toEqual([99, 99]);
  });
});

describe("checkCoherence", () => {
  it("returns false when overridden + ENTER", () => {
    expect(checkCoherence(true, "ENTER")).toBe(false);
  });
  it("returns true when overridden + EXIT", () => {
    expect(checkCoherence(true, "EXIT")).toBe(true);
  });
  it("returns true when not overridden", () => {
    expect(checkCoherence(false, "ENTER")).toBe(true);
  });
});

describe("systemStatus helpers", () => {
  it("colors return rgba strings", () => {
    expect(systemStatusColor("OK")).toContain("76,175,80");
    expect(systemStatusColor("SURVEILLANCE")).toContain("255,193,7");
    expect(systemStatusColor("ZONE_CRITIQUE")).toContain("229,57,53");
    expect(systemStatusColor("DEPEG")).toContain("229,57,53");
  });
  it("labels return readable strings", () => {
    expect(systemStatusLabel("OK")).toBe("OK");
    expect(systemStatusLabel("ZONE_CRITIQUE")).toBe("Zone Critique");
    expect(systemStatusLabel("DEPEG")).toBe("Depeg");
  });
});
