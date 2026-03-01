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

describe("evaluateRiskOverride", () => {
  it("returns OK with no hard conditions", () => {
    const r = evaluateRiskOverride(base);
    expect(r.isOverridden).toBe(false);
    expect(r.isWarning).toBe(false);
    expect(r.systemStatus).toBe("OK");
  });

  it("1 hard condition → warning only", () => {
    const r = evaluateRiskOverride({ ...base, state: "BREAK" });
    expect(r.isOverridden).toBe(false);
    expect(r.isWarning).toBe(true);
    expect(r.hardConditions).toContain("BREAK_STATE");
    expect(r.systemStatus).toBe("SURVEILLANCE");
  });

  it("2+ hard conditions → override", () => {
    const r = evaluateRiskOverride({ ...base, state: "BREAK", emissionTao: 0 });
    expect(r.isOverridden).toBe(true);
    expect(r.hardConditions).toHaveLength(2);
    expect(r.systemStatus).toBe("ZONE_CRITIQUE");
  });

  it("DEPEG state triggers hard condition + status", () => {
    const r = evaluateRiskOverride({ ...base, state: "DEPEG", emissionTao: 0 });
    expect(r.isOverridden).toBe(true);
    expect(r.systemStatus).toBe("DEPEG");
    expect(r.hardConditions).toContain("DEPEG");
  });

  it("DEREGISTRATION state", () => {
    const r = evaluateRiskOverride({ ...base, state: "DEREGISTRATION", taoInPool: 2 });
    expect(r.isOverridden).toBe(true);
    expect(r.systemStatus).toBe("DEREGISTRATION");
  });

  it("TAO pool critical triggers hard condition", () => {
    const r = evaluateRiskOverride({ ...base, taoInPool: 3 });
    expect(r.hardConditions).toContain("TAO_POOL_CRITICAL");
  });

  it("liquidity USD critical", () => {
    const r = evaluateRiskOverride({ ...base, liquidityUsd: 200 });
    expect(r.hardConditions).toContain("LIQUIDITY_USD_CRITICAL");
  });

  it("vol/MC low", () => {
    const r = evaluateRiskOverride({ ...base, volumeMcRatio: 0.001 });
    expect(r.hardConditions).toContain("VOL_MC_LOW");
  });

  it("slippage high", () => {
    const r = evaluateRiskOverride({ ...base, slippagePct: 0.08 });
    expect(r.hardConditions).toContain("SLIPPAGE_HIGH");
  });

  it("cooldown downgrades second override to warning", () => {
    evaluateRiskOverride({ ...base, state: "BREAK", emissionTao: 0 }); // first → override
    const r2 = evaluateRiskOverride({ ...base, state: "BREAK", emissionTao: 0 }); // second → cooldown
    expect(r2.isOverridden).toBe(false);
    expect(r2.isWarning).toBe(true);
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
