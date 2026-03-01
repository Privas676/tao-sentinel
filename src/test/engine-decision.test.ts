import { describe, it, expect } from "vitest";
import {
  applyDecision,
  applyAllDecisions,
  type DecisionInput,
} from "@/lib/engine-decision";
import type { StrategicOutput } from "@/lib/engine-strategic";
import type { ProtectionOutput } from "@/lib/engine-protection";
import type { HealthScores, RecalculatedMetrics } from "@/lib/subnet-health";

/* ── Helpers ── */

function makeStrat(overrides: Partial<StrategicOutput> = {}): StrategicOutput {
  return {
    netuid: 1, name: "SN-1",
    opp: 70, risk: 30, asymmetry: 40,
    momentum: 60, momentumLabel: "FORT", momentumScore: 60,
    momentumScoreV2: 55, stability: 65,
    sc: "ACCUMULATION", scScore: 70,
    action: "ENTER", oppRaw: 65, riskRaw: 28, isCritical: false,
    ...overrides,
  };
}

function makeProt(overrides: Partial<ProtectionOutput> = {}): ProtectionOutput {
  return {
    netuid: 1, isOverridden: false, isWarning: false,
    systemStatus: "OK", overrideReasons: [],
    delistCategory: "NORMAL", delistScore: 10,
    ...overrides,
  };
}

function makeContext() {
  return {
    state: null as string | null, psi: 60, conf: 60, quality: 60,
    confianceScore: 80, dataUncertain: false,
    healthScores: { liquidityHealth: 70, volumeHealth: 60, emissionPressure: 20, dilutionRisk: 15, activityHealth: 70 } as HealthScores,
    recalc: { mcRecalc: 1e6, fdvRecalc: 1.2e6, dilutionRatio: 1.2, volumeToMc: 0.05, emissionToMc: 0.001, liquidityRecalc: 1e5, liquidityToMc: 0.1, liqHaircut: 0, poolPrice: 0.01 } as RecalculatedMetrics,
    displayedCap: 100000, displayedLiq: 50000,
    consensusPrice: 0.01, alphaPrice: 0.01, priceVar30d: 5 as number | null,
  };
}

function makeInput(overrides: {
  strat?: Partial<StrategicOutput>;
  prot?: Partial<ProtectionOutput>;
  special?: DecisionInput["special"];
  alignment?: DecisionInput["alignmentStatus"];
} = {}): DecisionInput {
  return {
    strategic: makeStrat(overrides.strat),
    protection: makeProt(overrides.prot),
    context: makeContext(),
    special: overrides.special,
    alignmentStatus: overrides.alignment ?? "ALIGNED",
  };
}

/* ═══════════════════════════════════════ */
/*  Normal flow                            */
/* ═══════════════════════════════════════ */

describe("applyDecision — Normal", () => {
  it("passes through strategic scores when no protection issues", () => {
    const out = applyDecision(makeInput());
    expect(out.opp).toBe(70);
    expect(out.risk).toBe(30);
    expect(out.action).toBe("ENTER");
    expect(out.assetType).toBe("SPECULATIVE");
  });

  it("preserves all context fields", () => {
    const out = applyDecision(makeInput());
    expect(out.psi).toBe(60);
    expect(out.conf).toBe(60);
    expect(out.confianceScore).toBe(80);
    expect(out.consensusPrice).toBe(0.01);
    expect(out.priceVar30d).toBe(5);
  });

  it("preserves momentum from strategic", () => {
    const out = applyDecision(makeInput());
    expect(out.momentum).toBe(60);
    expect(out.momentumLabel).toBe("FORT");
    expect(out.sc).toBe("ACCUMULATION");
  });
});

/* ═══════════════════════════════════════ */
/*  Whitelist overrides                    */
/* ═══════════════════════════════════════ */

describe("applyDecision — Whitelist", () => {
  const special = { label: "ROOT", forceStatus: "OK" as const, forceAction: "HOLD" as const, forceRiskMax: 20 };

  it("caps risk at forceRiskMax", () => {
    const out = applyDecision(makeInput({ strat: { risk: 50 }, special }));
    expect(out.risk).toBe(20);
  });

  it("clamps opp to 30-60", () => {
    const out = applyDecision(makeInput({ strat: { opp: 90 }, special }));
    expect(out.opp).toBeLessThanOrEqual(60);
    expect(out.opp).toBeGreaterThanOrEqual(30);
  });

  it("forces action to HOLD", () => {
    const out = applyDecision(makeInput({ strat: { action: "EXIT" }, special }));
    expect(out.action).toBe("HOLD");
  });

  it("sets assetType to CORE_NETWORK", () => {
    const out = applyDecision(makeInput({ special }));
    expect(out.assetType).toBe("CORE_NETWORK");
  });

  it("recalculates asymmetry after whitelist overrides", () => {
    const out = applyDecision(makeInput({ strat: { opp: 90, risk: 50 }, special }));
    expect(out.asymmetry).toBe(out.opp - out.risk);
  });

  it("protection override ignored for whitelisted", () => {
    const out = applyDecision(makeInput({ prot: { isOverridden: true }, special }));
    expect(out.action).toBe("HOLD"); // not EXIT
    expect(out.opp).toBeGreaterThan(0);
  });
});

/* ═══════════════════════════════════════ */
/*  Protection overrides                   */
/* ═══════════════════════════════════════ */

describe("applyDecision — Protection overrides", () => {
  it("override → opp=0, action=EXIT", () => {
    const out = applyDecision(makeInput({ prot: { isOverridden: true } }));
    expect(out.opp).toBe(0);
    expect(out.action).toBe("EXIT");
  });

  it("override → negative asymmetry", () => {
    const out = applyDecision(makeInput({ prot: { isOverridden: true }, strat: { risk: 80 } }));
    expect(out.asymmetry).toBeLessThan(0);
  });
});

/* ═══════════════════════════════════════ */
/*  Delist/Depeg coherence                 */
/* ═══════════════════════════════════════ */

describe("applyDecision — Delist/Depeg", () => {
  it("DEPEG_PRIORITY → opp=0, risk≥80, action=EXIT", () => {
    const out = applyDecision(makeInput({ prot: { delistCategory: "DEPEG_PRIORITY" } }));
    expect(out.opp).toBe(0);
    expect(out.risk).toBeGreaterThanOrEqual(80);
    expect(out.action).toBe("EXIT");
  });

  it("HIGH_RISK_NEAR_DELIST → opp≤25, risk≥60", () => {
    const out = applyDecision(makeInput({ prot: { delistCategory: "HIGH_RISK_NEAR_DELIST" } }));
    expect(out.opp).toBeLessThanOrEqual(25);
    expect(out.risk).toBeGreaterThanOrEqual(60);
  });

  it("HIGH_RISK_NEAR_DELIST downgrades ENTER → WATCH", () => {
    const out = applyDecision(makeInput({
      strat: { action: "ENTER" },
      prot: { delistCategory: "HIGH_RISK_NEAR_DELIST" },
    }));
    expect(out.action).toBe("WATCH");
  });

  it("HIGH_RISK_NEAR_DELIST keeps HOLD as HOLD", () => {
    const out = applyDecision(makeInput({
      strat: { action: "HOLD" },
      prot: { delistCategory: "HIGH_RISK_NEAR_DELIST" },
    }));
    expect(out.action).toBe("HOLD");
  });
});

/* ═══════════════════════════════════════ */
/*  System status downgrade                */
/* ═══════════════════════════════════════ */

describe("applyDecision — System status", () => {
  it("non-OK status + ENTER → WATCH", () => {
    const out = applyDecision(makeInput({
      strat: { action: "ENTER" },
      prot: { systemStatus: "SURVEILLANCE" },
    }));
    expect(out.action).toBe("WATCH");
  });

  it("non-OK status + HOLD → stays HOLD", () => {
    const out = applyDecision(makeInput({
      strat: { action: "HOLD" },
      prot: { systemStatus: "ZONE_CRITIQUE" },
    }));
    expect(out.action).toBe("HOLD");
  });
});

/* ═══════════════════════════════════════ */
/*  Stale data guard                       */
/* ═══════════════════════════════════════ */

describe("applyDecision — Stale data guard", () => {
  it("STALE + ENTER → WATCH", () => {
    const out = applyDecision(makeInput({
      strat: { action: "ENTER" },
      alignment: "STALE",
    }));
    expect(out.action).toBe("WATCH");
  });

  it("STALE + HOLD → stays HOLD", () => {
    const out = applyDecision(makeInput({
      strat: { action: "HOLD" },
      alignment: "STALE",
    }));
    expect(out.action).toBe("HOLD");
  });

  it("DEGRADED + ENTER → stays ENTER", () => {
    const out = applyDecision(makeInput({
      strat: { action: "ENTER" },
      alignment: "DEGRADED",
    }));
    expect(out.action).toBe("ENTER");
  });

  it("ALIGNED + ENTER → stays ENTER", () => {
    const out = applyDecision(makeInput({ alignment: "ALIGNED" }));
    expect(out.action).toBe("ENTER");
  });
});

/* ═══════════════════════════════════════ */
/*  Batch decisions                        */
/* ═══════════════════════════════════════ */

describe("applyAllDecisions", () => {
  it("returns sorted by asymmetry descending", () => {
    const inputs = [
      makeInput({ strat: { netuid: 1, asymmetry: 10, opp: 40, risk: 30 } }),
      makeInput({ strat: { netuid: 2, asymmetry: 50, opp: 80, risk: 30 } }),
      makeInput({ strat: { netuid: 3, asymmetry: -20, opp: 20, risk: 40 } }),
    ];
    const results = applyAllDecisions(inputs);
    expect(results[0].netuid).toBe(2);
    expect(results[results.length - 1].netuid).toBe(3);
  });

  it("empty input → empty output", () => {
    expect(applyAllDecisions([])).toEqual([]);
  });
});
