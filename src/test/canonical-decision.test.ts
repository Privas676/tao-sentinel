import { describe, it, expect } from "vitest";

// We need to test the computeSocialBonus function which is not exported,
// so we test it indirectly through buildCanonicalDecision
import { buildCanonicalDecision } from "@/lib/canonical-decision";
import type { SubnetDecision } from "@/lib/subnet-decision";
import type { CanonicalSubnetFacts } from "@/lib/canonical-types";

/** Minimal SubnetDecision stub */
function makeDecision(overrides: Partial<SubnetDecision> = {}): SubnetDecision {
  return {
    netuid: 1,
    finalAction: "SURVEILLER",
    rawSignal: "neutral",
    portfolioAction: "CONSERVER",
    primaryReason: "test",
    thesis: [],
    invalidation: [],
    conflictExplanation: "",
    confidence: 50,
    convictionScore: 40,
    momentumScore: 30,
    isBlocked: false,
    blockReasons: [],
    dataUncertain: false,
    delistScore: 0,
    depegProbability: 0,
    score: { risk: 30, concordance: { score: 50 } } as any,
    verdictV3: undefined as any,
    ...overrides,
  } as SubnetDecision;
}

function makeFacts(social: { signal: number; credibility: number }): CanonicalSubnetFacts {
  return {
    subnet_id: 1,
    social_signal_strength: social.signal,
    social_credibility_score: social.credibility,
  } as CanonicalSubnetFacts;
}

describe("computeSocialBonus (via buildCanonicalDecision)", () => {
  it("returns zero bonus when social signal is null/zero", () => {
    const d = buildCanonicalDecision(makeDecision(), makeFacts({ signal: 0, credibility: 80 }));
    expect(d.conviction_score).toBe(40);
    expect(d.momentum_score).toBe(30);
  });

  it("returns zero bonus when social signal < 20 (noise)", () => {
    const d = buildCanonicalDecision(makeDecision(), makeFacts({ signal: 15, credibility: 90 }));
    expect(d.conviction_score).toBe(40);
    expect(d.momentum_score).toBe(30);
  });

  it("returns zero bonus on SORTIR action", () => {
    const dec = makeDecision({ finalAction: "SORTIR" });
    const d = buildCanonicalDecision(dec, makeFacts({ signal: 80, credibility: 90 }));
    expect(d.conviction_score).toBe(40);
    expect(d.momentum_score).toBe(30);
  });

  it("returns zero bonus on ÉVITER action", () => {
    const dec = makeDecision({ finalAction: "ÉVITER" });
    const d = buildCanonicalDecision(dec, makeFacts({ signal: 80, credibility: 90 }));
    expect(d.conviction_score).toBe(40);
    expect(d.momentum_score).toBe(30);
  });

  it("returns near-zero bonus when credibility is very low", () => {
    const d = buildCanonicalDecision(makeDecision(), makeFacts({ signal: 80, credibility: 10 }));
    // credWeight = max(0, (10-30)/70) = 0 → bonus = 0
    expect(d.conviction_score).toBe(40);
    expect(d.momentum_score).toBe(30);
  });

  it("returns minimal bonus when credibility is just above threshold (35)", () => {
    const d = buildCanonicalDecision(makeDecision(), makeFacts({ signal: 80, credibility: 35 }));
    // credWeight = (35-30)/70 ≈ 0.071, intensity = (80-20)/60 = 1.0
    // bonus = round(1.0 * 0.071 * 15) = round(1.07) = 1
    expect(d.conviction_score).toBe(41);
    expect(d.momentum_score).toBe(31); // round(1 * 0.6) = 1
  });

  it("returns strong bonus with high signal + high credibility", () => {
    const d = buildCanonicalDecision(makeDecision(), makeFacts({ signal: 80, credibility: 90 }));
    // credWeight = min(1, (90-30)/70) ≈ 0.857, intensity = 1.0
    // bonus = round(1.0 * 0.857 * 15) = round(12.86) = 13
    expect(d.conviction_score).toBe(53); // 40 + 13
    expect(d.momentum_score).toBe(38);   // 30 + round(13*0.6) = 30 + 8
  });

  it("caps conviction at 100", () => {
    const dec = makeDecision({ convictionScore: 95 });
    const d = buildCanonicalDecision(dec, makeFacts({ signal: 80, credibility: 100 }));
    expect(d.conviction_score).toBeLessThanOrEqual(100);
  });

  it("caps momentum at 100", () => {
    const dec = makeDecision({ momentumScore: 98 });
    const d = buildCanonicalDecision(dec, makeFacts({ signal: 80, credibility: 100 }));
    expect(d.momentum_score).toBeLessThanOrEqual(100);
  });

  it("returns zero bonus when no facts provided", () => {
    const d = buildCanonicalDecision(makeDecision());
    expect(d.conviction_score).toBe(40);
    expect(d.momentum_score).toBe(30);
  });
});
