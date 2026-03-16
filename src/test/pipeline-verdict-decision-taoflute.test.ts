/* ═══════════════════════════════════════════════════════════════ */
/*   INTEGRATION TEST — Full Pipeline                              */
/*   verdict-engine-v3 → engine-decision → decision-state          */
/*                     → subnet-decision → taoflute-resolver       */
/*                                                                  */
/*   Tests end-to-end coherence across all layers:                 */
/*   1. V3 verdict produces correct analytical signal              */
/*   2. engine-decision applies protection overrides               */
/*   3. decision-state confirms stable states                      */
/*   4. subnet-decision produces final unified action              */
/*   5. TaoFlute guardrails block/cap appropriately                */
/* ═══════════════════════════════════════════════════════════════ */

import { describe, it, expect } from "vitest";
import { applyDecision, type DecisionInput, type DecisionOutput } from "@/lib/engine-decision";
import {
  evaluateRawState,
  DecisionStateManager,
  DEFAULT_DECISION_SETTINGS,
} from "@/lib/engine-decision-state";
import { buildSubnetDecision, type SubnetDecision } from "@/lib/subnet-decision";
import {
  resolveTaoFluteStatus,
  TAOFLUTE_PRIORITY_CONFIRMED,
  TAOFLUTE_WATCH_CONFIRMED,
  type TaoFluteResolvedStatus,
} from "@/lib/taoflute-resolver";
import type { UnifiedSubnetScore } from "@/hooks/use-subnet-scores";
import type { StrategicOutput } from "@/lib/engine-strategic";
import type { ProtectionOutput } from "@/lib/engine-protection";

/* ── Factories ── */

function makeStrategic(overrides: Partial<StrategicOutput> = {}): StrategicOutput {
  return {
    netuid: 1, name: "TestSN", opp: 65, risk: 25, asymmetry: 40,
    momentum: 60, momentumLabel: "FORT", momentumScore: 60,
    action: "ENTER", sc: "ACCUMULATION", stability: 70,
    ...overrides,
  } as StrategicOutput;
}

function makeProtection(overrides: Partial<ProtectionOutput> = {}): ProtectionOutput {
  return {
    isOverridden: false, isWarning: false, systemStatus: "OK",
    overrideReasons: [], delistCategory: "NORMAL", delistScore: 10,
    depegProbability: 5, depegState: "STABLE", depegSignals: [],
    ...overrides,
  } as ProtectionOutput;
}

function makeDecisionInput(
  stratOverrides: Partial<StrategicOutput> = {},
  protOverrides: Partial<ProtectionOutput> = {},
  special?: DecisionInput["special"],
): DecisionInput {
  return {
    strategic: makeStrategic(stratOverrides),
    protection: makeProtection(protOverrides),
    context: {
      state: "GO", psi: 60, conf: 60, quality: 60,
      confianceScore: 80, dataUncertain: false,
      healthScores: { liquidityHealth: 70, volumeHealth: 60, emissionPressure: 20, dilutionRisk: 15, activityHealth: 70 },
      recalc: { mcRecalc: 1e6, fdvRecalc: 1.2e6, dilutionRatio: 1.2, volumeToMc: 0.05, emissionToMc: 0.001, liquidityRecalc: 1e5, liquidityToMc: 0.1, liqHaircut: 0, poolPrice: 0.01 },
      displayedCap: 100000, displayedLiq: 50000,
      consensusPrice: 0.01, alphaPrice: 0.01, priceVar30d: 5,
    },
    special,
    alignmentStatus: "ALIGNED",
  };
}

function decisionToUnified(d: DecisionOutput): UnifiedSubnetScore {
  return {
    ...d,
    depegState: d.depegState,
    depegSignals: d.depegSignals,
  } as unknown as UnifiedSubnetScore;
}

/* ═══════════════════════════════════════════════════ */
/*   SCENARIO 1: Healthy subnet — full pipeline OK     */
/* ═══════════════════════════════════════════════════ */

describe("Pipeline integration: healthy subnet", () => {
  const netuid = 1;

  it("flows through all layers to ENTRER", () => {
    // Layer 1: engine-decision
    const input = makeDecisionInput({ netuid, opp: 70, risk: 20, action: "ENTER" });
    const engineOut = applyDecision(input);
    expect(engineOut.action).toBe("ENTER");
    expect(engineOut.opp).toBe(70);
    expect(engineOut.risk).toBe(20);

    // Layer 2: decision-state
    const rawState = evaluateRawState(engineOut, "ALIGNED", DEFAULT_DECISION_SETTINGS);
    expect(rawState).toBe("OK");

    // Layer 3: taoflute-resolver (no match for SN-1)
    const tf = resolveTaoFluteStatus(netuid);
    expect(tf.taoflute_match).toBe(false);
    expect(tf.taoflute_severity).toBe("none");

    // Layer 4: subnet-decision
    const unified = decisionToUnified(engineOut);
    const decision = buildSubnetDecision(unified, undefined, undefined, false, tf);
    expect(decision.finalAction).toBe("ENTRER");
    expect(decision.isBlocked).toBe(false);
    expect(decision.portfolioAction).toBe("RENFORCER");
  });
});

/* ═══════════════════════════════════════════════════ */
/*   SCENARIO 2: TaoFlute PRIORITY — force ÉVITER      */
/* ═══════════════════════════════════════════════════ */

describe("Pipeline integration: TaoFlute priority subnet", () => {
  const netuid = 70; // Vericore — confirmed priority P1

  it("TaoFlute priority blocks entry → ÉVITER", () => {
    // Even with excellent opp/risk, TaoFlute priority forces ÉVITER
    const input = makeDecisionInput(
      { netuid, opp: 80, risk: 15, action: "ENTER" },
      { delistCategory: "DEPEG_PRIORITY", delistScore: 90 },
    );
    const engineOut = applyDecision(input);
    // engine-decision applies depeg floor
    expect(engineOut.opp).toBe(0);
    expect(engineOut.action).toBe("EXIT");

    // decision-state should see DEPEG_CONFIRMED
    const rawState = evaluateRawState(engineOut, "ALIGNED", DEFAULT_DECISION_SETTINGS);
    expect(rawState).toBe("DEPEG_CONFIRMED");

    // taoflute-resolver
    const tf = resolveTaoFluteStatus(netuid);
    expect(tf.taoflute_match).toBe(true);
    expect(tf.taoflute_severity).toBe("priority");
    expect(tf.taoflute_priority_rank).toBe(1);

    // subnet-decision: MUST be ÉVITER
    const unified = decisionToUnified(engineOut);
    const decision = buildSubnetDecision(unified, undefined, undefined, true, tf);
    expect(decision.finalAction).toBe("ÉVITER");
    expect(decision.portfolioAction).toBe("SORTIR");
    expect(decision.delistScore).toBeGreaterThanOrEqual(85);
    expect(decision.blockReasons.length).toBeGreaterThan(0);
  });
});

/* ═══════════════════════════════════════════════════ */
/*   SCENARIO 3: TaoFlute WATCH — cap at SURVEILLER    */
/* ═══════════════════════════════════════════════════ */

describe("Pipeline integration: TaoFlute watch subnet", () => {
  const netuid = 126; // Poker44 — confirmed watch

  it("TaoFlute watch caps entry to SURVEILLER", () => {
    const input = makeDecisionInput(
      { netuid, opp: 65, risk: 30, action: "ENTER" },
      { delistCategory: "NORMAL", delistScore: 20 },
    );
    const engineOut = applyDecision(input);
    expect(engineOut.action).toBe("ENTER"); // engine doesn't know about TaoFlute

    // taoflute-resolver
    const tf = resolveTaoFluteStatus(netuid);
    expect(tf.taoflute_match).toBe(true);
    expect(tf.taoflute_severity).toBe("watch");

    // subnet-decision: capped to SURVEILLER (never ENTRER for watch)
    const unified = decisionToUnified(engineOut);
    const decision = buildSubnetDecision(unified, undefined, undefined, false, tf);
    expect(decision.finalAction).toBe("SURVEILLER");
    expect(decision.delistScore).toBeGreaterThanOrEqual(60);
  });
});

/* ═══════════════════════════════════════════════════ */
/*   SCENARIO 4: Excluded subnet (SN-64) — no TaoFlute */
/* ═══════════════════════════════════════════════════ */

describe("Pipeline integration: excluded subnet SN-64", () => {
  it("SN-64 never shows TaoFlute status", () => {
    const tf = resolveTaoFluteStatus(64);
    expect(tf.taoflute_match).toBe(false);
    expect(tf.taoflute_severity).toBe("none");

    const input = makeDecisionInput({ netuid: 64, opp: 55, risk: 30, action: "ENTER" });
    const engineOut = applyDecision(input);
    const unified = decisionToUnified(engineOut);
    const decision = buildSubnetDecision(unified, undefined, undefined, false, tf);
    // Should NOT be blocked by TaoFlute
    expect(decision.finalAction).not.toBe("ÉVITER");
    expect(decision.taoFluteStatus.taoflute_match).toBe(false);
  });
});

/* ═══════════════════════════════════════════════════ */
/*   SCENARIO 5: Protection override → ÉVITER          */
/* ═══════════════════════════════════════════════════ */

describe("Pipeline integration: protection override", () => {
  it("override active forces ÉVITER regardless of opp", () => {
    const input = makeDecisionInput(
      { netuid: 50, opp: 80, risk: 20, action: "ENTER" },
      { isOverridden: true, overrideReasons: ["Multiple failures"], delistScore: 30 },
    );
    const engineOut = applyDecision(input);
    expect(engineOut.opp).toBe(0); // protection zeroes opp
    expect(engineOut.action).toBe("EXIT");

    const tf = resolveTaoFluteStatus(50);
    const unified = decisionToUnified(engineOut);
    const decision = buildSubnetDecision(unified, undefined, undefined, false, tf);
    expect(decision.finalAction).toBe("ÉVITER");
    expect(decision.portfolioAction).toBe("SORTIR");
  });
});

/* ═══════════════════════════════════════════════════ */
/*   SCENARIO 6: Stale data → capped at WATCH          */
/* ═══════════════════════════════════════════════════ */

describe("Pipeline integration: stale data guard", () => {
  it("STALE alignment blocks ENTER → WATCH in engine, SURVEILLER in decision", () => {
    const input = makeDecisionInput({ netuid: 5, opp: 70, risk: 20, action: "ENTER" });
    input.alignmentStatus = "STALE";
    const engineOut = applyDecision(input);
    // Stale data guard converts ENTER to WATCH
    expect(engineOut.action).toBe("WATCH");

    const rawState = evaluateRawState(engineOut, "STALE", DEFAULT_DECISION_SETTINGS);
    expect(rawState).toBe("DATA_STALE");

    const tf = resolveTaoFluteStatus(5);
    const unified = decisionToUnified(engineOut);
    const decision = buildSubnetDecision(unified, undefined, undefined, false, tf);
    expect(decision.finalAction).toBe("SURVEILLER");
  });
});

/* ═══════════════════════════════════════════════════ */
/*   SCENARIO 7: DecisionStateManager multi-tick       */
/*   confirms DEPEG_CONFIRMED after N ticks            */
/* ═══════════════════════════════════════════════════ */

describe("Pipeline integration: multi-tick state confirmation", () => {
  it("DEPEG_CONFIRMED requires confirmationTicks to stabilize", () => {
    const mgr = new DecisionStateManager(DEFAULT_DECISION_SETTINGS);
    const netuid = 70; // Depeg priority subnet

    const engineOut: DecisionOutput = {
      netuid, name: "Vericore", assetType: "SPECULATIVE",
      state: "ALERT", psi: 10, conf: 20, quality: 15,
      opp: 0, risk: 85, asymmetry: -85,
      momentum: 10, momentumLabel: "FAIBLE", momentumScore: 10,
      action: "EXIT", sc: "DISTRIBUTION",
      confianceScore: 80, dataUncertain: false,
      isOverridden: false, isWarning: true,
      systemStatus: "OK", overrideReasons: [],
      healthScores: { liquidityHealth: 10, volumeHealth: 5, emissionPressure: 80, dilutionRisk: 70, activityHealth: 10 },
      recalc: { mcRecalc: 1e4, fdvRecalc: 2e4, dilutionRatio: 2, volumeToMc: 0.01, emissionToMc: 0.1, liquidityRecalc: 500, liquidityToMc: 0.05, liqHaircut: 30, poolPrice: 0.001 },
      displayedCap: 10000, displayedLiq: 500, stability: 10,
      consensusPrice: 0.001, alphaPrice: 0.001, priceVar30d: -40,
      delistCategory: "DEPEG_PRIORITY", delistScore: 92,
      depegProbability: 80, depegState: "DEPEG_CONFIRMED", depegSignals: ["haircut>15%"],
    };

    // Tick multiple times to confirm
    const ticks = DEFAULT_DECISION_SETTINGS.confirmationTicks;
    let lastOutput;
    for (let i = 0; i < ticks + 1; i++) {
      lastOutput = mgr.tick(engineOut, "ALIGNED");
    }

    expect(lastOutput).toBeDefined();
    expect(lastOutput!.netuid).toBe(netuid);
    expect(lastOutput!.state).toBe("DEPEG_CONFIRMED");
  });
});

/* ═══════════════════════════════════════════════════ */
/*   SCENARIO 8: All TaoFlute priority IDs → ÉVITER    */
/* ═══════════════════════════════════════════════════ */

describe("Pipeline integration: all priority IDs produce ÉVITER", () => {
  for (const netuid of TAOFLUTE_PRIORITY_CONFIRMED) {
    it(`SN-${netuid} → ÉVITER`, () => {
      const tf = resolveTaoFluteStatus(netuid);
      expect(tf.taoflute_severity).toBe("priority");

      const input = makeDecisionInput(
        { netuid, opp: 70, risk: 20, action: "ENTER" },
        { delistCategory: "DEPEG_PRIORITY", delistScore: 85 },
      );
      const engineOut = applyDecision(input);
      const unified = decisionToUnified(engineOut);
      const decision = buildSubnetDecision(unified, undefined, undefined, false, tf);
      expect(decision.finalAction).toBe("ÉVITER");
    });
  }
});

/* ═══════════════════════════════════════════════════ */
/*   SCENARIO 9: All TaoFlute watch IDs → never ENTRER */
/* ═══════════════════════════════════════════════════ */

describe("Pipeline integration: all watch IDs never produce ENTRER", () => {
  for (const netuid of TAOFLUTE_WATCH_CONFIRMED) {
    it(`SN-${netuid} → not ENTRER`, () => {
      const tf = resolveTaoFluteStatus(netuid);
      expect(tf.taoflute_severity).toBe("watch");

      const input = makeDecisionInput(
        { netuid, opp: 75, risk: 20, action: "ENTER" },
        { delistCategory: "NORMAL", delistScore: 15 },
      );
      const engineOut = applyDecision(input);
      const unified = decisionToUnified(engineOut);
      const decision = buildSubnetDecision(unified, undefined, undefined, false, tf);
      expect(decision.finalAction).not.toBe("ENTRER");
    });
  }
});
