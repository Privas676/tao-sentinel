/* ═══════════════════════════════════════════════════════ */
/*   TESTS: Canonical Dereg + Decision Fusion              */
/* ═══════════════════════════════════════════════════════ */

import { describe, it, expect } from "vitest";
import {
  computeOfficialDeregRisk,
  extractDeregInputFromPayload,
  type TaostatsDeregInput,
} from "@/lib/canonical-dereg";
import {
  buildCanonicalLayer,
  buildTaoFluteLayer,
  buildTaoStatsLayer,
  buildSocialLayer,
  fuseDecision,
} from "@/lib/decision-fusion";
import { resolveTaoFluteStatus } from "@/lib/taoflute-resolver";

/* ── Helpers ── */

function makeDeregInput(overrides: Partial<TaostatsDeregInput> = {}): TaostatsDeregInput {
  return {
    netuid: 42,
    rank: 60,
    emission: 0.05,
    active_miners: 100,
    active_validators: 10,
    max_neurons: 256,
    registration_cost: 1000,
    price: 1.5,
    market_cap: 50000,
    liquidity: 10000,
    total_subnets: 128,
    subnet_limit: 128,
    ...overrides,
  };
}

/* ══════════════════════════════════════ */
/*   Canonical Dereg Risk Tests           */
/* ══════════════════════════════════════ */

describe("computeOfficialDeregRisk", () => {
  it("SN-0 (Root) is always immune with score 0", () => {
    const result = computeOfficialDeregRisk(makeDeregInput({ netuid: 0, rank: 128 }));
    expect(result.official_dereg_risk_score).toBe(0);
    expect(result.official_immunity_active).toBe(true);
    expect(result.official_dereg_band).toBe("NONE");
    expect(result.official_dereg_eligible).toBe(false);
  });

  it("healthy subnet has NONE/LOW risk", () => {
    const result = computeOfficialDeregRisk(makeDeregInput({
      rank: 20,
      emission: 0.1,
      active_miners: 200,
      active_validators: 30,
      total_subnets: 100,
      subnet_limit: 128,
    }));
    expect(result.official_dereg_risk_score).toBeLessThan(20);
    expect(["NONE", "LOW"]).toContain(result.official_dereg_band);
  });

  it("bottom-rank + zero emission = CRITICAL", () => {
    const result = computeOfficialDeregRisk(makeDeregInput({
      rank: 126,
      emission: 0,
      active_miners: 0,
      active_validators: 0,
      total_subnets: 128,
      subnet_limit: 128,
    }));
    expect(result.official_dereg_risk_score).toBeGreaterThanOrEqual(70);
    expect(result.official_dereg_band).toBe("CRITICAL");
  });

  it("low rank but active miners = MEDIUM/HIGH", () => {
    const result = computeOfficialDeregRisk(makeDeregInput({
      rank: 120,
      emission: 0.01,
      active_miners: 50,
      active_validators: 8,
      total_subnets: 128,
      subnet_limit: 128,
    }));
    expect(result.official_dereg_risk_score).toBeGreaterThanOrEqual(30);
    expect(["MEDIUM", "HIGH"]).toContain(result.official_dereg_band);
  });

  it("network not saturated reduces risk", () => {
    const fullNet = computeOfficialDeregRisk(makeDeregInput({
      rank: 120, total_subnets: 128, subnet_limit: 128,
    }));
    const notFull = computeOfficialDeregRisk(makeDeregInput({
      rank: 120, total_subnets: 100, subnet_limit: 128,
    }));
    expect(notFull.official_dereg_risk_score).toBeLessThanOrEqual(fullNet.official_dereg_risk_score);
  });

  it("zero miners adds significant risk", () => {
    const withMiners = computeOfficialDeregRisk(makeDeregInput({ active_miners: 100 }));
    const noMiners = computeOfficialDeregRisk(makeDeregInput({ active_miners: 0 }));
    expect(noMiners.official_dereg_risk_score).toBeGreaterThan(withMiners.official_dereg_risk_score);
  });
});

describe("extractDeregInputFromPayload", () => {
  it("extracts fields from Taostats payload", () => {
    const payload = {
      rank: 42,
      market_cap: 50000,
      liquidity: 10000,
      price: 1.5,
      _chain: {
        emission: 0.05,
        active_miners: 100,
        active_validators: 10,
        max_neurons: 256,
        registration_cost: 1000,
      },
    };
    const result = extractDeregInputFromPayload(5, payload, 128, 128);
    expect(result.rank).toBe(42);
    expect(result.emission).toBe(0.05);
    expect(result.active_miners).toBe(100);
    expect(result.total_subnets).toBe(128);
  });

  it("handles null payload gracefully", () => {
    const result = extractDeregInputFromPayload(5, null, 100);
    expect(result.rank).toBeNull();
    expect(result.emission).toBeNull();
    expect(result.total_subnets).toBe(100);
  });
});

/* ══════════════════════════════════════ */
/*   Decision Fusion Tests                */
/* ══════════════════════════════════════ */

describe("fuseDecision", () => {
  const defaultTaostats = buildTaoStatsLayer({
    liquidityHealth: 70,
    flowScore: 60,
    structureScore: 65,
    momentumScore: 55,
    executionScore: 60,
    timestamp: null,
  });

  const emptySocial = buildSocialLayer(null);

  it("Example A: social bullish + canonical critical → dominant=CANONICAL, blockers present", () => {
    const canonDereg = computeOfficialDeregRisk(makeDeregInput({
      rank: 127, emission: 0, active_miners: 0, total_subnets: 128, subnet_limit: 128,
    }));
    const canonical = buildCanonicalLayer(canonDereg, null);
    const tf = buildTaoFluteLayer(resolveTaoFluteStatus(42), null);
    const social = buildSocialLayer({
      mentions_24h: 50, unique_accounts: 20, kol_score: 80,
      heat_score: 75, conviction_score: 85, pump_risk_score: 10,
      narrative_strength: 70, final_signal: "BULLISH",
      last_post_at: null, source_urls: [], timestamp: null,
    });

    const result = fuseDecision(42, canonical, tf, defaultTaostats, social, "SORTIR");
    expect(result.dominant_layer).toBe("CANONICAL");
    expect(result.final_blockers.length).toBeGreaterThan(0);
    expect(result.divergence_notes.length).toBeGreaterThan(0); // social vs structure conflict
  });

  it("Example B: TaoFlute priority but canonical immune → divergence noted", () => {
    const canonDereg = computeOfficialDeregRisk(makeDeregInput({
      netuid: 0, rank: 1, // immune
    }));
    const canonical = buildCanonicalLayer(canonDereg, null);
    // Create fake TaoFlute priority status for SN-78
    const tfStatus = resolveTaoFluteStatus(78);
    const tf = buildTaoFluteLayer(tfStatus, null);

    const result = fuseDecision(78, canonical, tf, defaultTaostats, emptySocial, "ÉVITER");
    // Canonical is safe (immune) but TaoFlute flags priority → divergence
    expect(result.taoflute.taoflute_severity).toBe("priority");
    expect(result.divergence_notes.length).toBeGreaterThan(0);
  });

  it("Example C: all green → TAOSTATS dominant, high confidence", () => {
    const canonDereg = computeOfficialDeregRisk(makeDeregInput({
      rank: 10, emission: 0.1, active_miners: 200, active_validators: 30,
      total_subnets: 100, subnet_limit: 128,
    }));
    const canonical = buildCanonicalLayer(canonDereg, null);
    const tf = buildTaoFluteLayer(resolveTaoFluteStatus(42), null);
    const strongTaostats = buildTaoStatsLayer({
      liquidityHealth: 85, flowScore: 80, structureScore: 75,
      momentumScore: 70, executionScore: 80, timestamp: null,
    });
    const bullishSocial = buildSocialLayer({
      mentions_24h: 30, unique_accounts: 15, kol_score: 60,
      heat_score: 50, conviction_score: 70, pump_risk_score: 5,
      narrative_strength: 55, final_signal: "BULLISH",
      last_post_at: null, source_urls: [], timestamp: null,
    });

    const result = fuseDecision(42, canonical, tf, strongTaostats, bullishSocial, "ENTRER");
    expect(result.dominant_layer).toBe("TAOSTATS");
    expect(result.canonical.verdict).toBe("SAFE");
    expect(strongTaostats.verdict).toBe("STRONG");
    expect(result.final_confidence).toBeGreaterThanOrEqual(60);
    expect(result.final_supports.length).toBeGreaterThan(0);
  });

  it("no social data → social layer NONE, no penalty", () => {
    const canonDereg = computeOfficialDeregRisk(makeDeregInput({ rank: 30 }));
    const canonical = buildCanonicalLayer(canonDereg, null);
    const tf = buildTaoFluteLayer(resolveTaoFluteStatus(42), null);

    const result = fuseDecision(42, canonical, tf, defaultTaostats, emptySocial, "SURVEILLER");
    expect(result.social.social_verdict).toBe("NONE");
    // No social penalty in blockers
    expect(result.final_blockers.every(b => !b.includes("social"))).toBe(true);
  });

  it("convergent canonical + taoflute danger → very high confidence", () => {
    const canonDereg = computeOfficialDeregRisk(makeDeregInput({
      rank: 126, emission: 0, active_miners: 1, total_subnets: 128, subnet_limit: 128,
    }));
    const canonical = buildCanonicalLayer(canonDereg, null);
    const tf = buildTaoFluteLayer(resolveTaoFluteStatus(78), null); // P1

    const result = fuseDecision(78, canonical, tf, defaultTaostats, emptySocial, "ÉVITER");
    expect(result.final_confidence).toBeGreaterThanOrEqual(80);
    expect(result.decision_trace.fusion_rules_applied).toContain("CONVERGENCE_CANONICAL_TAOFLUTE");
  });

  it("decision_trace contains all 4 layer verdicts", () => {
    const canonDereg = computeOfficialDeregRisk(makeDeregInput());
    const canonical = buildCanonicalLayer(canonDereg, null);
    const tf = buildTaoFluteLayer(resolveTaoFluteStatus(42), null);

    const result = fuseDecision(42, canonical, tf, defaultTaostats, emptySocial, "SURVEILLER");
    expect(result.decision_trace.canonical_verdict).toBeDefined();
    expect(result.decision_trace.taoflute_verdict).toBeDefined();
    expect(result.decision_trace.taostats_verdict).toBeDefined();
    expect(result.decision_trace.social_verdict).toBeDefined();
  });
});
