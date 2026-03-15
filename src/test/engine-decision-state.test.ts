import { describe, it, expect, beforeEach } from "vitest";
import {
  evaluateRawState,
  applyHysteresis,
  DecisionStateManager,
  stateSeverity,
  stateLabel,
  stateColor,
  DEFAULT_DECISION_SETTINGS,
  PERMISSIVE_SETTINGS,
  type DecisionSettings,
  type DecisionState,
} from "@/lib/engine-decision-state";
import type { DecisionOutput } from "@/lib/engine-decision";

/* ── Helpers ── */

function makeDecision(overrides: Partial<DecisionOutput> = {}): DecisionOutput {
  return {
    netuid: 1, name: "SN-1", assetType: "SPECULATIVE",
    state: "GO", psi: 60, conf: 60, quality: 60,
    opp: 70, risk: 30, asymmetry: 40,
    momentum: 60, momentumLabel: "FORT", momentumScore: 60,
    action: "ENTER", sc: "ACCUMULATION",
    confianceScore: 80, dataUncertain: false,
    isOverridden: false, isWarning: false,
    systemStatus: "OK", overrideReasons: [],
    healthScores: { liquidityHealth: 70, volumeHealth: 60, emissionPressure: 20, dilutionRisk: 15, activityHealth: 70 },
    recalc: { mcRecalc: 1e6, fdvRecalc: 1.2e6, dilutionRatio: 1.2, volumeToMc: 0.05, emissionToMc: 0.001, liquidityRecalc: 1e5, liquidityToMc: 0.1, liqHaircut: 0, poolPrice: 0.01 },
    displayedCap: 100000, displayedLiq: 50000, stability: 65,
    consensusPrice: 0.01, alphaPrice: 0.01, priceVar30d: 5,
    delistCategory: "NORMAL", delistScore: 10,
    ...overrides,
  };
}

/* ═══════════════════════════════════════ */
/*  evaluateRawState                       */
/* ═══════════════════════════════════════ */

describe("evaluateRawState", () => {
  const s = DEFAULT_DECISION_SETTINGS;

  it("returns OK for healthy subnet", () => {
    expect(evaluateRawState(makeDecision(), "ALIGNED", s)).toBe("OK");
  });

  it("returns DATA_STALE when alignment is STALE", () => {
    expect(evaluateRawState(makeDecision(), "STALE", s)).toBe("DATA_STALE");
  });

  it("returns DATA_UNSTABLE when low confidence + uncertain", () => {
    const d = makeDecision({ confianceScore: 30, dataUncertain: true });
    expect(evaluateRawState(d, "ALIGNED", s)).toBe("DATA_UNSTABLE");
  });

  it("does NOT return DATA_UNSTABLE if dataUncertain is false", () => {
    const d = makeDecision({ confianceScore: 30, dataUncertain: false });
    expect(evaluateRawState(d, "ALIGNED", s)).not.toBe("DATA_UNSTABLE");
  });

  it("returns DEPEG_CONFIRMED for DEPEG_PRIORITY category", () => {
    const d = makeDecision({ netuid: 70, delistCategory: "DEPEG_PRIORITY", delistScore: 90 });
    expect(evaluateRawState(d, "ALIGNED", s)).toBe("DEPEG_CONFIRMED");
  });

  it("returns DEPEG_CONFIRMED when delistScore >= depegEnter threshold (manual list)", () => {
    const d = makeDecision({ netuid: 70, delistScore: 50 });
    expect(evaluateRawState(d, "ALIGNED", s)).toBe("DEPEG_CONFIRMED");
  });

  it("returns DEPEG_HIGH_RISK for HIGH_RISK_NEAR_DELIST with score", () => {
    const d = makeDecision({ netuid: 99, delistCategory: "HIGH_RISK_NEAR_DELIST", delistScore: 30 });
    expect(evaluateRawState(d, "ALIGNED", s)).toBe("DEPEG_HIGH_RISK");
  });

  it("does NOT return DEPEG_CONFIRMED for subnet not in manual lists", () => {
    const d = makeDecision({ netuid: 999, delistCategory: "DEPEG_PRIORITY", delistScore: 90 });
    expect(evaluateRawState(d, "ALIGNED", s)).not.toBe("DEPEG_CONFIRMED");
  });

  it("returns OVERRIDE_CRITICAL when overridden + high risk", () => {
    const d = makeDecision({ isOverridden: true, risk: 75 });
    expect(evaluateRawState(d, "ALIGNED", s)).toBe("OVERRIDE_CRITICAL");
  });

  it("returns OVERRIDE_WARNING when warning flag set", () => {
    const d = makeDecision({ isWarning: true, risk: 50 });
    expect(evaluateRawState(d, "ALIGNED", s)).toBe("OVERRIDE_WARNING");
  });

  it("returns OVERRIDE_WARNING when high risk + non-OK status", () => {
    const d = makeDecision({ risk: 75, systemStatus: "SURVEILLANCE" });
    expect(evaluateRawState(d, "ALIGNED", s)).toBe("OVERRIDE_WARNING");
  });

  it("returns WATCH when action is EXIT", () => {
    const d = makeDecision({ action: "EXIT" });
    expect(evaluateRawState(d, "ALIGNED", s)).toBe("WATCH");
  });

  it("returns WATCH when action is WATCH", () => {
    const d = makeDecision({ action: "WATCH" });
    expect(evaluateRawState(d, "ALIGNED", s)).toBe("WATCH");
  });

  it("DEPEG_CONFIRMED takes priority over DATA_STALE", () => {
    const d = makeDecision({ netuid: 70, delistCategory: "DEPEG_PRIORITY", delistScore: 90 });
    expect(evaluateRawState(d, "STALE", s)).toBe("DEPEG_CONFIRMED");
  });

  it("DATA_STALE shows when no critical alert active", () => {
    const d = makeDecision({ delistScore: 0, risk: 20 });
    expect(evaluateRawState(d, "STALE", s)).toBe("DATA_STALE");
  });
});

/* ═══════════════════════════════════════ */
/*  applyHysteresis                        */
/* ═══════════════════════════════════════ */

describe("applyHysteresis", () => {
  const s = DEFAULT_DECISION_SETTINGS;

  it("returns raw candidate if same as current", () => {
    expect(applyHysteresis("OK", "OK", makeDecision(), s)).toBe("OK");
  });

  it("DEPEG_CONFIRMED is sticky when score >= depegExit", () => {
    const d = makeDecision({ delistScore: 35 }); // >= depegExit (30)
    expect(applyHysteresis("DEPEG_CONFIRMED", "OK", d, s)).toBe("DEPEG_CONFIRMED");
  });

  it("DEPEG_CONFIRMED can exit when score < depegExit", () => {
    const d = makeDecision({ delistScore: 20 }); // < depegExit (30)
    expect(applyHysteresis("DEPEG_CONFIRMED", "OK", d, s)).toBe("OK");
  });

  it("OVERRIDE_CRITICAL is sticky when risk >= overrideRiskExit", () => {
    const d = makeDecision({ risk: 60 }); // >= overrideRiskExit (55)
    expect(applyHysteresis("OVERRIDE_CRITICAL", "OK", d, s)).toBe("OVERRIDE_CRITICAL");
  });

  it("OVERRIDE_CRITICAL can exit when risk < overrideRiskExit", () => {
    const d = makeDecision({ risk: 50 }); // < overrideRiskExit (55)
    expect(applyHysteresis("OVERRIDE_CRITICAL", "OK", d, s)).toBe("OK");
  });

  it("DATA_UNSTABLE is sticky when confidence < recover threshold", () => {
    const d = makeDecision({ confianceScore: 50 }); // < dataConfidenceRecover (55)
    expect(applyHysteresis("DATA_UNSTABLE", "OK", d, s)).toBe("DATA_UNSTABLE");
  });

  it("DATA_UNSTABLE can exit when confidence >= recover threshold", () => {
    const d = makeDecision({ confianceScore: 60 }); // >= dataConfidenceRecover (55)
    expect(applyHysteresis("DATA_UNSTABLE", "OK", d, s)).toBe("OK");
  });

  it("WATCH → OK transitions freely (no hysteresis)", () => {
    expect(applyHysteresis("WATCH", "OK", makeDecision(), s)).toBe("OK");
  });
});

/* ═══════════════════════════════════════ */
/*  DecisionStateManager — Confirmation    */
/* ═══════════════════════════════════════ */

describe("DecisionStateManager — Multi-tick confirmation", () => {
  let mgr: DecisionStateManager;
  const settings: DecisionSettings = { ...DEFAULT_DECISION_SETTINGS, confirmationTicks: 3 };

  beforeEach(() => {
    mgr = new DecisionStateManager(settings);
  });

  it("starts at OK for unknown subnets", () => {
    const rec = mgr.getRecord(42);
    expect(rec.confirmedState).toBe("OK");
  });

  it("does not transition after 1 tick", () => {
    const d = makeDecision({ isOverridden: true, risk: 75 });
    const out = mgr.tick(d, "ALIGNED", 1000);
    expect(out.state).toBe("OK");
    expect(out.pendingState).toBe("OVERRIDE_CRITICAL");
    expect(out.pendingTicks).toBe(1);
    expect(out.isTransition).toBe(false);
  });

  it("does not transition after 2 ticks", () => {
    const d = makeDecision({ isOverridden: true, risk: 75 });
    mgr.tick(d, "ALIGNED", 1000);
    const out2 = mgr.tick(d, "ALIGNED", 2000);
    expect(out2.state).toBe("OK");
    expect(out2.pendingTicks).toBe(2);
  });

  it("transitions after 3 ticks (confirmationTicks)", () => {
    const d = makeDecision({ isOverridden: true, risk: 75 });
    mgr.tick(d, "ALIGNED", 1000);
    mgr.tick(d, "ALIGNED", 2000);
    const out3 = mgr.tick(d, "ALIGNED", 3000);
    expect(out3.state).toBe("OVERRIDE_CRITICAL");
    expect(out3.isTransition).toBe(true);
  });

  it("resets counter when candidate changes", () => {
    const d1 = makeDecision({ isOverridden: true, risk: 75 }); // OVERRIDE_CRITICAL
    mgr.tick(d1, "ALIGNED", 1000);
    mgr.tick(d1, "ALIGNED", 2000); // 2 ticks

    const d2 = makeDecision({ isWarning: true, risk: 50 }); // OVERRIDE_WARNING
    const out = mgr.tick(d2, "ALIGNED", 3000);
    expect(out.pendingState).toBe("OVERRIDE_WARNING");
    expect(out.pendingTicks).toBe(1); // Reset
  });

  it("returns stable state when no change", () => {
    const d = makeDecision(); // OK
    const out = mgr.tick(d, "ALIGNED", 1000);
    expect(out.state).toBe("OK");
    expect(out.pendingState).toBeNull();
    expect(out.pendingTicks).toBe(0);
    expect(out.isTransition).toBe(false);
  });
});

/* ═══════════════════════════════════════ */
/*  DecisionStateManager — Cooldown        */
/* ═══════════════════════════════════════ */

describe("DecisionStateManager — Cooldown", () => {
  it("suppresses re-firing within cooldown window", () => {
    const settings: DecisionSettings = { ...DEFAULT_DECISION_SETTINGS, confirmationTicks: 1, cooldownMs: 60_000 };
    const mgr = new DecisionStateManager(settings);

    const dCrit = makeDecision({ isOverridden: true, risk: 75 });

    // First confirmation at t=1000
    const out1 = mgr.tick(dCrit, "ALIGNED", 1000);
    expect(out1.state).toBe("OVERRIDE_CRITICAL");
    expect(out1.isTransition).toBe(true);

    // Same state persists at t=5000 — this is NOT a re-fire, just stable
    const out2 = mgr.tick(dCrit, "ALIGNED", 5000);
    expect(out2.state).toBe("OVERRIDE_CRITICAL");
    expect(out2.isTransition).toBe(false);
    expect(out2.isCooledDown).toBe(false);
  });

  it("allows re-firing after cooldown expires", () => {
    const settings: DecisionSettings = { ...DEFAULT_DECISION_SETTINGS, confirmationTicks: 1, cooldownMs: 5_000 };
    const mgr = new DecisionStateManager(settings);

    const d = makeDecision({ isOverridden: true, risk: 75 });
    mgr.tick(d, "ALIGNED", 1000);

    // Return to OK
    const dOk = makeDecision({ risk: 30 });
    mgr.tick(dOk, "ALIGNED", 2000);

    // Re-fire after cooldown at t=7000 (6s after first confirm)
    const out = mgr.tick(d, "ALIGNED", 7000);
    expect(out.state).toBe("OVERRIDE_CRITICAL");
    expect(out.isTransition).toBe(true);
    expect(out.isCooledDown).toBe(false);
  });
});

/* ═══════════════════════════════════════ */
/*  DecisionStateManager — Delta trigger   */
/* ═══════════════════════════════════════ */

describe("DecisionStateManager — Delta trigger", () => {
  it("allows re-firing during cooldown if score delta exceeds threshold", () => {
    const settings: DecisionSettings = {
      ...DEFAULT_DECISION_SETTINGS,
      confirmationTicks: 1,
      cooldownMs: 60_000,
      deltaTrigger: 0.15,
    };
    const mgr = new DecisionStateManager(settings);

    // First fire: delistScore=50
    const d1 = makeDecision({ netuid: 70, delistCategory: "DEPEG_PRIORITY", delistScore: 50 });
    mgr.tick(d1, "ALIGNED", 1000);

    // Return to OK
    const dOk = makeDecision({ netuid: 70, delistScore: 5 });
    mgr.tick(dOk, "ALIGNED", 2000);

    // Re-fire with delistScore=70 (delta = |70-50|/100 = 0.20 > 0.15)
    const d2 = makeDecision({ netuid: 70, delistCategory: "DEPEG_PRIORITY", delistScore: 70 });
    const out = mgr.tick(d2, "ALIGNED", 5000); // Still within cooldown
    expect(out.state).toBe("DEPEG_CONFIRMED");
    expect(out.isTransition).toBe(true);
    expect(out.isCooledDown).toBe(false);
  });

  it("suppresses when delta is below threshold", () => {
    const settings: DecisionSettings = {
      ...DEFAULT_DECISION_SETTINGS,
      confirmationTicks: 1,
      cooldownMs: 60_000,
      deltaTrigger: 0.15,
    };
    const mgr = new DecisionStateManager(settings);

    // Confirm DEPEG at score=50
    const d1 = makeDecision({ netuid: 96, delistCategory: "DEPEG_PRIORITY", delistScore: 50 });
    const out1 = mgr.tick(d1, "ALIGNED", 1000);
    expect(out1.state).toBe("DEPEG_CONFIRMED");
    expect(out1.isTransition).toBe(true);

    // Same state with similar score — no new transition
    const d2 = makeDecision({ netuid: 96, delistCategory: "DEPEG_PRIORITY", delistScore: 55 });
    const out2 = mgr.tick(d2, "ALIGNED", 5000);
    // Still DEPEG_CONFIRMED, but not a new transition
    expect(out2.state).toBe("DEPEG_CONFIRMED");
    expect(out2.isTransition).toBe(false);
  });
});

/* ═══════════════════════════════════════ */
/*  DecisionStateManager — Hysteresis      */
/* ═══════════════════════════════════════ */

describe("DecisionStateManager — Hysteresis integration", () => {
  it("DEPEG_CONFIRMED sticks until score drops below depegExit", () => {
    const settings: DecisionSettings = { ...DEFAULT_DECISION_SETTINGS, confirmationTicks: 1 };
    const mgr = new DecisionStateManager(settings);

    // Confirm DEPEG
    const dDepeg = makeDecision({ netuid: 96, delistCategory: "DEPEG_PRIORITY", delistScore: 90 });
    mgr.tick(dDepeg, "ALIGNED", 1000);

    // Score drops to 35 (still >= depegExit=30) → should stay DEPEG
    const dMid = makeDecision({ netuid: 96, delistScore: 35 });
    const out = mgr.tick(dMid, "ALIGNED", 2000);
    expect(out.state).toBe("DEPEG_CONFIRMED");

    // Score drops to 20 (< depegExit=30) → allowed to exit
    const dLow = makeDecision({ netuid: 96, delistScore: 20 });
    const out2 = mgr.tick(dLow, "ALIGNED", 3000);
    expect(out2.state).toBe("OK");
  });
});

/* ═══════════════════════════════════════ */
/*  DecisionStateManager — tickAll         */
/* ═══════════════════════════════════════ */

describe("DecisionStateManager — tickAll", () => {
  it("processes multiple subnets in one call", () => {
    const mgr = new DecisionStateManager({ ...DEFAULT_DECISION_SETTINGS, confirmationTicks: 1 });
    const decisions = [
      makeDecision({ netuid: 1 }),
      makeDecision({ netuid: 2, isOverridden: true, risk: 75 }),
      makeDecision({ netuid: 96, delistCategory: "DEPEG_PRIORITY", delistScore: 90 }),
    ];
    const outs = mgr.tickAll(decisions, "ALIGNED", 1000);
    expect(outs).toHaveLength(3);
    expect(outs[0].state).toBe("OK");
    expect(outs[1].state).toBe("OVERRIDE_CRITICAL");
    expect(outs[2].state).toBe("DEPEG_CONFIRMED");
  });
});

/* ═══════════════════════════════════════ */
/*  DecisionStateManager — Utility         */
/* ═══════════════════════════════════════ */

describe("DecisionStateManager — Utilities", () => {
  it("reset clears all state", () => {
    const mgr = new DecisionStateManager({ ...DEFAULT_DECISION_SETTINGS, confirmationTicks: 1 });
    mgr.tick(makeDecision({ netuid: 5, isOverridden: true, risk: 80 }), "ALIGNED", 1000);
    mgr.reset();
    expect(mgr.getTrackedNetuids()).toEqual([]);
  });

  it("snapshot returns current confirmed states", () => {
    const mgr = new DecisionStateManager({ ...DEFAULT_DECISION_SETTINGS, confirmationTicks: 1 });
    mgr.tick(makeDecision({ netuid: 1 }), "ALIGNED", 1000);
    mgr.tick(makeDecision({ netuid: 2, isOverridden: true, risk: 75 }), "ALIGNED", 1000);
    const snap = mgr.snapshot();
    expect(snap.get(1)).toBe("OK");
    expect(snap.get(2)).toBe("OVERRIDE_CRITICAL");
  });

  it("updateSettings changes behavior", () => {
    const mgr = new DecisionStateManager(DEFAULT_DECISION_SETTINGS);
    mgr.updateSettings(PERMISSIVE_SETTINGS);
    expect(mgr.getSettings().mode).toBe("permissive");
    expect(mgr.getSettings().confirmationTicks).toBe(2);
  });
});

/* ═══════════════════════════════════════ */
/*  Settings presets                       */
/* ═══════════════════════════════════════ */

describe("Settings presets", () => {
  it("strict has higher thresholds than permissive", () => {
    expect(DEFAULT_DECISION_SETTINGS.hysteresis.depegEnter).toBeGreaterThan(PERMISSIVE_SETTINGS.hysteresis.depegEnter);
    expect(DEFAULT_DECISION_SETTINGS.hysteresis.overrideRiskEnter).toBeGreaterThan(PERMISSIVE_SETTINGS.hysteresis.overrideRiskEnter);
    expect(DEFAULT_DECISION_SETTINGS.confirmationTicks).toBeGreaterThan(PERMISSIVE_SETTINGS.confirmationTicks);
    expect(DEFAULT_DECISION_SETTINGS.cooldownMs).toBeGreaterThan(PERMISSIVE_SETTINGS.cooldownMs);
  });
});

/* ═══════════════════════════════════════ */
/*  Display helpers                        */
/* ═══════════════════════════════════════ */

describe("Display helpers", () => {
  it("stateSeverity ranks correctly", () => {
    expect(stateSeverity("DEPEG_CONFIRMED")).toBe(4);
    expect(stateSeverity("OVERRIDE_CRITICAL")).toBe(3);
    expect(stateSeverity("DEPEG_HIGH_RISK")).toBe(2);
    expect(stateSeverity("OVERRIDE_WARNING")).toBe(2);
    expect(stateSeverity("DATA_STALE")).toBe(1);
    expect(stateSeverity("DATA_UNSTABLE")).toBe(1);
    expect(stateSeverity("WATCH")).toBe(0);
    expect(stateSeverity("OK")).toBe(0);
  });

  it("stateLabel returns French labels for all states", () => {
    const states: DecisionState[] = [
      "DEPEG_CONFIRMED", "DEPEG_HIGH_RISK", "OVERRIDE_CRITICAL",
      "OVERRIDE_WARNING", "DATA_UNSTABLE", "DATA_STALE", "WATCH", "OK",
    ];
    for (const s of states) {
      expect(stateLabel(s)).toBeTruthy();
    }
  });

  it("stateColor returns colors for all states", () => {
    const states: DecisionState[] = [
      "DEPEG_CONFIRMED", "DEPEG_HIGH_RISK", "OVERRIDE_CRITICAL",
      "OVERRIDE_WARNING", "DATA_UNSTABLE", "DATA_STALE", "WATCH", "OK",
    ];
    for (const s of states) {
      expect(stateColor(s)).toMatch(/rgba/);
    }
  });
});
