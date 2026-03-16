/* ═══════════════════════════════════════════════════════════════ */
/*   V3 FULL PIPELINE INTEGRATION TEST                             */
/*   SubnetFacts → Concordance → DerivedScores → VerdictV3        */
/*                → SubnetDecision (with TaoFlute guardrails)      */
/*                                                                  */
/*   Tests the COMPLETE analytical pipeline end-to-end,            */
/*   starting from raw payloads (like TaoStats data).              */
/* ═══════════════════════════════════════════════════════════════ */

import { describe, it, expect } from "vitest";
import { extractSubnetFacts, val } from "@/lib/subnet-facts";
import { computeConcordance } from "@/lib/source-concordance";
import { computeDerivedScores } from "@/lib/derived-scores";
import { computeVerdictV3, type VerdictV3Result } from "@/lib/verdict-engine-v3";
import { buildSubnetDecision, type SubnetDecision } from "@/lib/subnet-decision";
import {
  resolveTaoFluteStatus,
  TAOFLUTE_PRIORITY_CONFIRMED,
  TAOFLUTE_WATCH_CONFIRMED,
} from "@/lib/taoflute-resolver";
import type { UnifiedSubnetScore } from "@/hooks/use-subnet-scores";

const TAO_USD = 450;

/* ─── Helper: run the full V3 pipeline from raw payload ─── */

function runPipeline(netuid: number, payload: any): {
  v3: VerdictV3Result;
  decision: SubnetDecision;
} {
  const facts = extractSubnetFacts(netuid, payload, TAO_USD);
  const concordance = computeConcordance(facts);
  const scoring = computeDerivedScores(facts, concordance);
  const v3 = computeVerdictV3(facts, scoring, concordance);

  // Build a minimal UnifiedSubnetScore from the V3 result + facts
  const tf = resolveTaoFluteStatus(netuid);
  const mockUnified = buildMockUnified(netuid, payload, v3, facts);
  const decision = buildSubnetDecision(mockUnified, undefined, v3, true, tf);

  return { v3, decision };
}

/** Build a minimal UnifiedSubnetScore that respects the types needed by buildSubnetDecision */
function buildMockUnified(netuid: number, payload: any, v3: VerdictV3Result, facts: any): UnifiedSubnetScore {
  const price = Number(payload.price) || 0;
  return {
    netuid,
    name: v3.name,
    assetType: "SPECULATIVE",
    state: null,
    psi: 50,
    conf: 50,
    quality: 50,
    opp: v3.verdict === "ENTER" ? 65 : v3.verdict === "SORTIR" ? 10 : 35,
    risk: v3.verdict === "SORTIR" ? 75 : v3.verdict === "ENTER" ? 25 : 45,
    asymmetry: 0,
    momentum: 50,
    momentumLabel: "NEUTRE",
    momentumScore: 50,
    action: v3.verdict === "ENTER" ? "ENTER" : v3.verdict === "SORTIR" ? "EXIT" : "WATCH",
    sc: "NEUTRAL",
    confianceScore: v3.confidence,
    dataUncertain: v3.concordanceGrade === "D",
    isOverridden: false,
    isWarning: false,
    systemStatus: "OK",
    overrideReasons: [],
    healthScores: { liquidityHealth: 50, volumeHealth: 50, emissionPressure: 30, dilutionRisk: 20, activityHealth: 50 },
    recalc: { mcRecalc: 1e5, fdvRecalc: 1.5e5, dilutionRatio: 1.5, volumeToMc: 0.05, emissionToMc: 0.01, liquidityRecalc: 5e4, liquidityToMc: 0.1, liqHaircut: 0, poolPrice: price },
    displayedCap: 100000,
    displayedLiq: 50000,
    stability: 50,
    consensusPrice: price,
    alphaPrice: price,
    priceVar30d: null,
    delistCategory: "NORMAL",
    delistScore: 10,
    depegProbability: 5,
    depegState: "STABLE",
    depegSignals: [],
  } as unknown as UnifiedSubnetScore;
}

/* ════════════════════════════════════════ */
/*   RAW PAYLOADS                          */
/* ════════════════════════════════════════ */

const HEALTHY_PAYLOAD = {
  netuid: 3, name: "HealthyNet", price: 0.5,
  price_change_1_hour: 2, price_change_1_day: 12, price_change_1_week: 25, price_change_1_month: 40,
  market_cap: 500_000_000_000,
  tao_volume_24_hr: 80_000_000_000,
  buys_24_hr: 60, sells_24_hr: 25, buyers_24_hr: 30, sellers_24_hr: 10,
  protocol_provided_tao: 300_000_000_000, protocol_provided_alpha: 600_000_000_000,
  alpha_staked: 100_000_000_000, liquidity: 600_000_000_000, root_prop: 0.15, rank: 5,
  _chain: { active_validators: 15, active_miners: 60, active_uids: 220, max_neurons: 256, emission: 50_000_000, emission_per_day: 360_000_000_000, recycled_24_hours: 10_000_000_000, registrations: 8 },
};

const DEAD_PAYLOAD = {
  netuid: 99, name: "GhostNet", price: 0,
  _chain: { active_validators: 1, active_miners: 0, active_uids: 0, max_neurons: 256, emission: 0, registrations: 0 },
};

const TOXIC_PAYLOAD = {
  netuid: 50, name: "ToxicNet", price: 0.3,
  price_change_1_hour: 5, price_change_1_day: 15, price_change_1_week: 30, price_change_1_month: 50,
  market_cap: 100_000_000_000,
  tao_volume_24_hr: 5_000_000_000,
  buys_24_hr: 10, sells_24_hr: 5, buyers_24_hr: 5, sellers_24_hr: 2,
  protocol_provided_tao: 5_000_000_000, protocol_provided_alpha: 10_000_000_000,
  liquidity: 10_000_000_000, root_prop: 0.98,
  _chain: { active_validators: 2, active_miners: 1, active_uids: 3, max_neurons: 256, emission: 0, registrations: 0 },
};

const FRAGILE_PAYLOAD = {
  netuid: 25, name: "FragileNet", price: 0.8,
  price_change_1_hour: 3, price_change_1_day: 10, price_change_1_week: 20, price_change_1_month: 15,
  market_cap: 300_000_000_000,
  tao_volume_24_hr: 50_000_000_000,
  buys_24_hr: 40, sells_24_hr: 20, buyers_24_hr: 15, sellers_24_hr: 8,
  protocol_provided_tao: 50_000_000_000, protocol_provided_alpha: 62_500_000_000,
  liquidity: 100_000_000_000, root_prop: 0.3,
  _chain: { active_validators: 5, active_miners: 8, active_uids: 40, max_neurons: 256, emission: 10_000_000, emission_per_day: 72_000_000_000, recycled_24_hours: 2_000_000_000, registrations: 2 },
};

const BAD_DATA_PAYLOAD = {
  netuid: 77, name: "BadData", price: 0,
  _chain: { active_validators: 3, active_miners: 5, active_uids: 10, max_neurons: 256 },
};

/* ═══════════════════════════════════════════════════ */
/*   SCENARIO 1: Full V3 pipeline → healthy → ENTRER   */
/* ═══════════════════════════════════════════════════ */

describe("V3 Pipeline: healthy subnet end-to-end", () => {
  const { v3, decision } = runPipeline(3, HEALTHY_PAYLOAD);

  it("V3 verdict is ENTER", () => {
    expect(v3.verdict).toBe("ENTER");
    expect(v3.verdictFr).toBe("ENTRER");
    expect(v3.verdictEn).toBe("ENTER");
  });

  it("V3 has valid metadata", () => {
    expect(v3.engineVersion).toBe("v3.0");
    expect(v3.confidence).toBeGreaterThan(50);
    expect(v3.conviction).toMatch(/^(HIGH|MEDIUM)$/);
    expect(v3.riskFlags.length).toBeLessThanOrEqual(3);
    expect(v3.watchlist.length).toBeLessThanOrEqual(3);
    expect(v3.concordanceGrade).toMatch(/^[ABCD]$/);
  });

  it("SubnetDecision maps to ENTRER", () => {
    expect(decision.finalAction).toBe("ENTRER");
    expect(decision.actionFr).toBe("ENTRER");
    expect(decision.actionEn).toBe("ENTER");
    expect(decision.badgeAction).toBe("RENTRE");
  });

  it("portfolio action is RENFORCER", () => {
    expect(decision.portfolioAction).toBe("RENFORCER");
  });

  it("is not blocked", () => {
    expect(decision.isBlocked).toBe(false);
  });

  it("V3 result is attached to decision", () => {
    expect(decision.verdictV3).toBeDefined();
    expect(decision.verdictV3!.verdict).toBe("ENTER");
  });

  it("primaryReason comes from V3", () => {
    expect(decision.primaryReason.length).toBeGreaterThan(0);
  });
});

/* ═══════════════════════════════════════════════════ */
/*   SCENARIO 2: Dead subnet → NON_INVESTISSABLE      */
/* ═══════════════════════════════════════════════════ */

describe("V3 Pipeline: dead subnet → ÉVITER", () => {
  const { v3, decision } = runPipeline(99, DEAD_PAYLOAD);

  it("V3 verdict is NON_INVESTISSABLE", () => {
    expect(v3.verdict).toBe("NON_INVESTISSABLE");
  });

  it("SubnetDecision maps to ÉVITER", () => {
    expect(decision.finalAction).toBe("ÉVITER");
    expect(decision.badgeAction).toBe("EVITER");
  });

  it("portfolio action is SORTIR", () => {
    expect(decision.portfolioAction).toBe("SORTIR");
  });
});

/* ═══════════════════════════════════════════════════ */
/*   SCENARIO 3: Bad data → DONNÉES_INSTABLES          */
/* ═══════════════════════════════════════════════════ */

describe("V3 Pipeline: bad data → SURVEILLER", () => {
  const { v3, decision } = runPipeline(77, BAD_DATA_PAYLOAD);

  it("V3 verdict is DONNÉES_INSTABLES", () => {
    expect(v3.verdict).toBe("DONNÉES_INSTABLES");
    expect(v3.concordanceGrade).toBe("D");
  });

  it("SubnetDecision maps to SURVEILLER (unstable data → monitor)", () => {
    // DONNÉES_INSTABLES maps to SURVEILLER in v3ToFinalAction
    expect(decision.finalAction).toBe("SURVEILLER");
  });

  it("V3 is marked as blocked or low conviction", () => {
    expect(v3.conviction).toBe("NONE");
    expect(v3.portfolioAction).toBe("NE_PAS_ENTRER");
  });
});

/* ═══════════════════════════════════════════════════ */
/*   SCENARIO 4: Toxic structure → SORTIR / ÉVITER     */
/* ═══════════════════════════════════════════════════ */

describe("V3 Pipeline: toxic structure", () => {
  const { v3, decision } = runPipeline(50, TOXIC_PAYLOAD);

  it("V3 verdict is SORTIR or NON_INVESTISSABLE", () => {
    expect(["SORTIR", "NON_INVESTISSABLE"]).toContain(v3.verdict);
  });

  it("SubnetDecision is SORTIR or ÉVITER", () => {
    expect(["SORTIR", "ÉVITER"]).toContain(decision.finalAction);
  });

  it("portfolio action is SORTIR", () => {
    expect(decision.portfolioAction).toBe("SORTIR");
  });

  it("risk flags are present", () => {
    expect(v3.riskFlags.length).toBeGreaterThan(0);
  });
});

/* ═══════════════════════════════════════════════════ */
/*   SCENARIO 5: System subnet (netuid 0)              */
/* ═══════════════════════════════════════════════════ */

describe("V3 Pipeline: system subnet", () => {
  const { v3, decision } = runPipeline(0, HEALTHY_PAYLOAD);

  it("V3 verdict is SYSTÈME", () => {
    expect(v3.verdict).toBe("SYSTÈME");
    expect(v3.verdictFr).toBe("SYSTÈME");
  });

  it("SubnetDecision maps to SYSTÈME", () => {
    expect(decision.finalAction).toBe("SYSTÈME");
    expect(decision.isSystem).toBe(true);
    expect(decision.badgeAction).toBe("SYSTEME");
  });
});

/* ═══════════════════════════════════════════════════ */
/*   SCENARIO 6: V3 ENTER + TaoFlute PRIORITY          */
/*   → TaoFlute overrides V3 → ÉVITER                  */
/* ═══════════════════════════════════════════════════ */

describe("V3 Pipeline: TaoFlute priority overrides V3 ENTER", () => {
  // Use a known TaoFlute PRIORITY subnet ID with a healthy payload
  const priorityNetuid = Array.from(TAOFLUTE_PRIORITY_CONFIRMED)[0]; // first confirmed priority

  it("healthy payload + TaoFlute priority → ÉVITER", () => {
    // Run facts/concordance/scoring with healthy data
    const facts = extractSubnetFacts(priorityNetuid, { ...HEALTHY_PAYLOAD, netuid: priorityNetuid }, TAO_USD);
    const concordance = computeConcordance(facts);
    const scoring = computeDerivedScores(facts, concordance);
    const v3 = computeVerdictV3(facts, scoring, concordance);

    // V3 should see good data → likely ENTER or SURVEILLER
    // But TaoFlute priority MUST override to ÉVITER
    const tf = resolveTaoFluteStatus(priorityNetuid);
    expect(tf.taoflute_severity).toBe("priority");

    const mockUnified = buildMockUnified(priorityNetuid, HEALTHY_PAYLOAD, v3, facts);
    const decision = buildSubnetDecision(mockUnified, undefined, v3, true, tf);

    expect(decision.finalAction).toBe("ÉVITER");
    expect(decision.portfolioAction).toBe("SORTIR");
    expect(decision.taoFluteStatus.taoflute_match).toBe(true);
    expect(decision.blockReasons.length).toBeGreaterThan(0);
  });
});

/* ═══════════════════════════════════════════════════ */
/*   SCENARIO 7: V3 ENTER + TaoFlute WATCH             */
/*   → capped to SURVEILLER                            */
/* ═══════════════════════════════════════════════════ */

describe("V3 Pipeline: TaoFlute watch caps V3 ENTER to SURVEILLER", () => {
  const watchNetuid = Array.from(TAOFLUTE_WATCH_CONFIRMED)[0]; // first confirmed watch

  it("healthy payload + TaoFlute watch → SURVEILLER (never ENTRER)", () => {
    const facts = extractSubnetFacts(watchNetuid, { ...HEALTHY_PAYLOAD, netuid: watchNetuid }, TAO_USD);
    const concordance = computeConcordance(facts);
    const scoring = computeDerivedScores(facts, concordance);
    const v3 = computeVerdictV3(facts, scoring, concordance);

    const tf = resolveTaoFluteStatus(watchNetuid);
    expect(tf.taoflute_severity).toBe("watch");

    const mockUnified = buildMockUnified(watchNetuid, HEALTHY_PAYLOAD, v3, facts);
    const decision = buildSubnetDecision(mockUnified, undefined, v3, true, tf);

    expect(decision.finalAction).not.toBe("ENTRER");
    expect(decision.finalAction).toBe("SURVEILLER");
    expect(decision.delistScore).toBeGreaterThanOrEqual(60);
  });
});

/* ═══════════════════════════════════════════════════ */
/*   SCENARIO 8: Fragile structure through full pipe   */
/* ═══════════════════════════════════════════════════ */

describe("V3 Pipeline: fragile structure", () => {
  const { v3, decision } = runPipeline(25, FRAGILE_PAYLOAD);

  it("V3 produces ENTER or SURVEILLER", () => {
    expect(["ENTER", "SURVEILLER"]).toContain(v3.verdict);
  });

  it("decision finalAction is coherent with V3", () => {
    if (v3.verdict === "ENTER") {
      expect(["ENTRER", "SURVEILLER"]).toContain(decision.finalAction);
    } else {
      expect(decision.finalAction).toBe("SURVEILLER");
    }
  });

  it("conviction is not HIGH for fragile structure", () => {
    // Fragile structures shouldn't produce high conviction
    if (v3.verdict === "SURVEILLER") {
      expect(v3.conviction).not.toBe("HIGH");
    }
  });
});

/* ═══════════════════════════════════════════════════ */
/*   SCENARIO 9: V3 concordance consistency            */
/* ═══════════════════════════════════════════════════ */

describe("V3 Pipeline: concordance flows correctly", () => {
  it("healthy payload → concordance A or B → V3 allows strong verdict", () => {
    const facts = extractSubnetFacts(3, HEALTHY_PAYLOAD, TAO_USD);
    const concordance = computeConcordance(facts);
    expect(["A", "B"]).toContain(concordance.grade);
    expect(concordance.allowStrongVerdict).toBe(true);
    expect(concordance.forceUnstable).toBe(false);
  });

  it("bad data → concordance D → V3 produces DONNÉES_INSTABLES", () => {
    const facts = extractSubnetFacts(77, BAD_DATA_PAYLOAD, TAO_USD);
    const concordance = computeConcordance(facts);
    expect(concordance.grade).toBe("D");

    const scoring = computeDerivedScores(facts, concordance);
    const v3 = computeVerdictV3(facts, scoring, concordance);
    expect(v3.verdict).toBe("DONNÉES_INSTABLES");
  });

  it("concordance D never produces ENTER", () => {
    const facts = extractSubnetFacts(88, { netuid: 88, price: 0, _chain: { active_validators: 2, active_miners: 2, active_uids: 5, max_neurons: 256 } }, TAO_USD);
    const concordance = computeConcordance(facts);
    const scoring = computeDerivedScores(facts, concordance);
    const v3 = computeVerdictV3(facts, scoring, concordance);
    expect(v3.verdict).not.toBe("ENTER");
  });
});

/* ═══════════════════════════════════════════════════ */
/*   SCENARIO 10: V3 → SubnetDecision field mapping    */
/* ═══════════════════════════════════════════════════ */

describe("V3 Pipeline: decision field mapping integrity", () => {
  const { v3, decision } = runPipeline(3, HEALTHY_PAYLOAD);

  it("thesis comes from V3 secondaryReasons", () => {
    // thesis should be populated from v3.secondaryReasons
    if (v3.secondaryReasons.length > 0) {
      expect(decision.thesis.length).toBeGreaterThan(0);
      expect(decision.thesis[0]).toBe(v3.secondaryReasons[0].text);
    }
  });

  it("invalidation comes from V3 riskFlags", () => {
    if (v3.riskFlags.length > 0) {
      expect(decision.invalidation.length).toBeGreaterThan(0);
      expect(decision.invalidation[0]).toBe(v3.riskFlags[0].text);
    }
  });

  it("conflictExplanation is set when V3 has blocks", () => {
    if (v3.isBlocked && v3.blocks.length > 0) {
      expect(decision.conflictExplanation).not.toBeNull();
    }
  });

  it("rawSignal is coherent with V3 verdict", () => {
    if (v3.verdict === "ENTER") expect(decision.rawSignal).toBe("opportunity");
    if (v3.verdict === "SORTIR") expect(decision.rawSignal).toBe("exit");
  });
});

/* ═══════════════════════════════════════════════════ */
/*   SCENARIO 11: All TaoFlute priority IDs → ÉVITER   */
/*   through the full V3 pipeline                      */
/* ═══════════════════════════════════════════════════ */

describe("V3 Pipeline: all TaoFlute priority IDs → ÉVITER (full pipeline)", () => {
  for (const netuid of TAOFLUTE_PRIORITY_CONFIRMED) {
    it(`SN-${netuid} with healthy data → still ÉVITER`, () => {
      const tf = resolveTaoFluteStatus(netuid);
      expect(tf.taoflute_severity).toBe("priority");

      const facts = extractSubnetFacts(netuid, { ...HEALTHY_PAYLOAD, netuid }, TAO_USD);
      const concordance = computeConcordance(facts);
      const scoring = computeDerivedScores(facts, concordance);
      const v3 = computeVerdictV3(facts, scoring, concordance);

      const mockUnified = buildMockUnified(netuid, HEALTHY_PAYLOAD, v3, facts);
      const decision = buildSubnetDecision(mockUnified, undefined, v3, true, tf);
      expect(decision.finalAction).toBe("ÉVITER");
    });
  }
});

/* ═══════════════════════════════════════════════════ */
/*   SCENARIO 12: Prohibition violations propagate     */
/* ═══════════════════════════════════════════════════ */

describe("V3 Pipeline: prohibition violations", () => {
  it("V3 result includes violations from DerivedScores", () => {
    const facts = extractSubnetFacts(3, HEALTHY_PAYLOAD, TAO_USD);
    const concordance = computeConcordance(facts);
    const scoring = computeDerivedScores(facts, concordance);
    const v3 = computeVerdictV3(facts, scoring, concordance);

    // prohibitionViolations should be an array (possibly empty)
    expect(Array.isArray(v3.prohibitionViolations)).toBe(true);
  });

  it("toxic payload may have prohibition violations", () => {
    const facts = extractSubnetFacts(50, TOXIC_PAYLOAD, TAO_USD);
    const concordance = computeConcordance(facts);
    const scoring = computeDerivedScores(facts, concordance);
    const v3 = computeVerdictV3(facts, scoring, concordance);

    // Violations array exists and each has the required fields
    for (const v of v3.prohibitionViolations) {
      expect(v.code).toBeDefined();
      expect(v.scoreCapped).toBeDefined();
      expect(typeof v.originalValue).toBe("number");
      expect(typeof v.cappedValue).toBe("number");
    }
  });
});
