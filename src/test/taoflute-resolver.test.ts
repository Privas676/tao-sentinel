import { describe, it, expect } from "vitest";
import {
  resolveTaoFluteStatus,
  taoFluteColumnLabel,
  taoFluteLabel,
  TAOFLUTE_PRIORITY_CONFIRMED,
  TAOFLUTE_WATCH_CONFIRMED,
} from "@/lib/taoflute-resolver";
import { buildSubnetDecision } from "@/lib/subnet-decision";
import type { UnifiedSubnetScore } from "@/hooks/use-subnet-scores";

/* ── Minimal score helper ── */
function makeScore(overrides: Partial<UnifiedSubnetScore> = {}): UnifiedSubnetScore {
  return {
    netuid: 1, name: "SN-1",
    assetType: "SPECULATIVE",
    state: null, psi: 60, conf: 60, quality: 60,
    opp: 70, risk: 30, asymmetry: 40,
    momentum: 60, momentumLabel: "FORT", momentumScore: 60,
    action: "ENTER", sc: "ACCUMULATION",
    confianceScore: 80, dataUncertain: false,
    isOverridden: false, isWarning: false,
    systemStatus: "OK", overrideReasons: [],
    healthScores: { liquidityHealth: 70, volumeHealth: 60, emissionPressure: 20, dilutionRisk: 15, activityHealth: 70 } as any,
    recalc: { mcRecalc: 1e6, fdvRecalc: 1.2e6, dilutionRatio: 1.2, volumeToMc: 0.05, emissionToMc: 0.001, liquidityRecalc: 1e5, liquidityToMc: 0.1, liqHaircut: 0, poolPrice: 0.01 } as any,
    displayedCap: 100000, displayedLiq: 50000,
    stability: 65, consensusPrice: 0.01, alphaPrice: 0.01, priceVar30d: 5,
    delistCategory: "NORMAL", delistScore: 10,
    depegProbability: 0, depegState: "SAFE", depegSignals: [],
    ...overrides,
  };
}

/* ═══════════════════════════════════════ */
/*  Test 1: No TaoFlute → no external     */
/* ═══════════════════════════════════════ */
describe("TaoFlute — Test 1: absent subnet shows no external", () => {
  it("subnet not in TaoFlute → taoflute_match = false, column = —", () => {
    const status = resolveTaoFluteStatus(999);
    expect(status.taoflute_match).toBe(false);
    expect(status.taoflute_severity).toBe("none");
    expect(status.externalRisk).toBeNull();
    expect(taoFluteColumnLabel(status)).toBe("—");
  });
});

/* ═══════════════════════════════════════ */
/*  Test 2: Priority subnet shows P#       */
/* ═══════════════════════════════════════ */
describe("TaoFlute — Test 2: priority subnet shows P#", () => {
  it("SN-79 (MVTRX) → P5", () => {
    const status = resolveTaoFluteStatus(79);
    expect(status.taoflute_match).toBe(true);
    expect(status.taoflute_severity).toBe("priority");
    expect(status.taoflute_priority_rank).toBe(5);
    expect(taoFluteColumnLabel(status)).toBe("P5");
  });

  it("SN-78 (Loosh) → P1", () => {
    const status = resolveTaoFluteStatus(78);
    expect(status.taoflute_match).toBe(true);
    expect(status.taoflute_severity).toBe("priority");
    expect(status.taoflute_priority_rank).toBe(1);
    expect(taoFluteColumnLabel(status)).toBe("P1");
  });
});

/* ═══════════════════════════════════════ */
/*  Test 3: final_action = exit → header   */
/*  cannot show enter                      */
/* ═══════════════════════════════════════ */
describe("TaoFlute — Test 3: exit verdict coherence", () => {
  it("SN-78 priority → finalAction = ÉVITER even with opportunity signal", () => {
    const s = makeScore({ netuid: 78, opp: 70, risk: 20, action: "ENTER" });
    const tf = resolveTaoFluteStatus(78);
    const d = buildSubnetDecision(s, undefined, undefined, true, tf);
    expect(d.finalAction).toBe("ÉVITER");
    expect(d.badgeAction).not.toBe("ENTRE");
    // rawSignal can still be opportunity
  });
});

/* ═══════════════════════════════════════ */
/*  Test 4: priority → delistScore ≥ 85    */
/* ═══════════════════════════════════════ */
describe("TaoFlute — Test 4: priority implies high delist score", () => {
  it("SN-70 priority → delistScore >= 85", () => {
    const s = makeScore({ netuid: 70, delistScore: 10 });
    const tf = resolveTaoFluteStatus(70);
    const d = buildSubnetDecision(s, undefined, undefined, true, tf);
    expect(d.delistScore).toBeGreaterThanOrEqual(85);
  });
});

/* ═══════════════════════════════════════ */
/*  Test 5: SN-64 must NOT show TaoFlute  */
/* ═══════════════════════════════════════ */
describe("TaoFlute — Test 5: SN-64 Chutes excluded", () => {
  it("SN-64 → no TaoFlute match", () => {
    const status = resolveTaoFluteStatus(64);
    expect(status.taoflute_match).toBe(false);
    expect(status.taoflute_severity).toBe("none");
    expect(taoFluteColumnLabel(status)).toBe("—");
  });

  it("SN-64 not in any confirmed list", () => {
    expect(TAOFLUTE_PRIORITY_CONFIRMED.has(64)).toBe(false);
    expect(TAOFLUTE_WATCH_CONFIRMED.has(64)).toBe(false);
  });
});

/* ═══════════════════════════════════════ */
/*  Test 6: SN-78 → P1 + ÉVITER            */
/* ═══════════════════════════════════════ */
describe("TaoFlute — Test 6: SN-78 Loosh full scenario", () => {
  it("SN-78 → TaoFlute P1 and verdict ÉVITER", () => {
    const status = resolveTaoFluteStatus(78);
    expect(taoFluteColumnLabel(status)).toBe("P1");

    const s = makeScore({ netuid: 78, opp: 80, risk: 15, action: "ENTER", confianceScore: 90 });
    const d = buildSubnetDecision(s, undefined, undefined, true, status);
    expect(d.finalAction).toBe("ÉVITER");
    expect(d.taoFluteStatus.taoflute_severity).toBe("priority");
  });
});

/* ═══════════════════════════════════════ */
/*  Test 7: exit reasons classified        */
/* ═══════════════════════════════════════ */
describe("TaoFlute — Test 7: block reasons contain external source", () => {
  it("priority subnet has TaoFlute in block reasons", () => {
    const s = makeScore({ netuid: 70, opp: 70, action: "ENTER" });
    const tf = resolveTaoFluteStatus(70);
    const d = buildSubnetDecision(s, undefined, undefined, true, tf);
    expect(d.isBlocked).toBe(true);
    const hasExternal = d.blockReasons.some(r => r.includes("externe") || r.includes("external") || r.includes("TaoFlute"));
    expect(hasExternal).toBe(true);
  });

  it("watch subnet with opportunity has block reasons", () => {
    const s = makeScore({ netuid: 126, opp: 70, action: "ENTER" });
    const tf = resolveTaoFluteStatus(126);
    const d = buildSubnetDecision(s, undefined, undefined, true, tf);
    expect(d.finalAction).toBe("SURVEILLER");
    const hasExternal = d.blockReasons.some(r => r.includes("externe") || r.includes("external") || r.includes("TaoFlute") || r.includes("exécutable") || r.includes("actionable"));
    expect(hasExternal).toBe(true);
  });
});

/* ═══════════════════════════════════════ */
/*  Label tests                            */
/* ═══════════════════════════════════════ */
describe("TaoFlute — Labels", () => {
  it("no match → correct label FR", () => {
    const s = resolveTaoFluteStatus(999);
    expect(taoFluteLabel(s, true)).toBe("Aucun signal TaoFlute confirmé");
  });

  it("watch → correct label EN", () => {
    const s = resolveTaoFluteStatus(126);
    expect(taoFluteLabel(s, false)).toBe("Under TaoFlute external watch");
  });

  it("priority → correct label FR with rank", () => {
    const s = resolveTaoFluteStatus(70);
    expect(taoFluteLabel(s, true)).toContain("Priorité externe TaoFlute #1");
  });
});
