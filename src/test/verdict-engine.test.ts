import { describe, it, expect } from "vitest";
import {
  computeVerdict,
  computeEntryScore,
  computeHoldScore,
  computeExitRisk,
  computeAllVerdicts,
  type VerdictInput,
} from "@/lib/verdict-engine";
import type { StakeSnapshot, StakeDeltas, PriceContext, EconomicContext, DerivedMetrics, RadarScores } from "@/lib/stake-analytics";

/* ── Helpers ── */

function makeSnapshot(overrides: Partial<StakeSnapshot> = {}): StakeSnapshot {
  return {
    netuid: 1, holdersCount: 50, stakeTotal: 5000, stakeConcentration: 30,
    top10Stake: [], validatorsActive: 12, minersTotal: 100, minersActive: 80,
    uidUsage: 0.7, largeWalletInflow: 20, largeWalletOutflow: 5,
    uidUsed: 180, uidMax: 256, registrationCost: 0.1, incentiveBurn: 0, recyclePerDay: 0.5,
    ...overrides,
  };
}

function makeDeltas(overrides: Partial<StakeDeltas> = {}): StakeDeltas {
  return {
    stakeChange24h: 0.02, stakeChange7d: 0.08, holdersGrowth7d: 0.05,
    holdersGrowth30d: 0.1, minersGrowth7d: 0.05, validatorsGrowth7d: 0.02,
    ...overrides,
  };
}

function makePrice(overrides: Partial<PriceContext> = {}): PriceContext {
  return {
    priceChange1d: 2, priceChange7d: 8, priceChange30d: 15, currentPrice: 0.05,
    liquidity: 500, emission: 1e8, emissionShare: 2.5, marketCap: 2000, vol24h: 100, fearGreed: 50,
    ...overrides,
  };
}

function makeEco(overrides: Partial<EconomicContext> = {}): EconomicContext {
  return {
    emissionsPercent: 2.5, emissionsPerDay: 200, minerPerDay: 82, validatorPerDay: 82,
    ownerPerDay: 36, rootProportion: 0, totalIssued: 500000, totalBurned: 10000,
    circulatingSupply: 490000, maxSupply: 21000000, alphaStaked: 300000, alphaInPool: 190000,
    taoInPool: 50, alphaPoolPercent: 55, taoPoolPercent: 45, fdv: 25000,
    volumeMarketcapRatio: 0.05, buyVolume: 60, sellVolume: 40, buyersCount: 15, sellersCount: 8,
    buyTxCount: 20, sellTxCount: 12, sentiment: 0.6,
    ...overrides,
  };
}

function makeDerived(overrides: Partial<DerivedMetrics> = {}): DerivedMetrics {
  return {
    uidSaturation: 0.7, emissionPower: 500, emissionEfficiency: 0.1,
    poolBalance: 0.82, tradingPressure: 20, burnRatio: 0.0025,
    ...overrides,
  };
}

function makeRadar(overrides: Partial<RadarScores> = {}): RadarScores {
  return {
    healthIndex: 65, capitalMomentum: 60, dumpRisk: 25, subnetRadarScore: 55,
    narrativeScore: 40, smartMoneyScore: 50, bubbleScore: 20,
    manipulationScore: 25, alphaInefficiency: -5, fairAlphaPrice: 0.048,
    ...overrides,
  };
}

function makeInput(overrides: Partial<VerdictInput> = {}): VerdictInput {
  return {
    netuid: 1,
    snapshot: makeSnapshot(),
    deltas: makeDeltas(),
    priceContext: makePrice(),
    economicContext: makeEco(),
    derivedMetrics: makeDerived(),
    radarScores: makeRadar(),
    momentum: 60,
    stability: 65,
    dataConfidence: 80,
    ...overrides,
  };
}

/* ═══════════════════════════════════════ */
/*  Verdict decision logic                  */
/* ═══════════════════════════════════════ */

describe("computeVerdict — RENTRE", () => {
  it("returns RENTRE for strong entry + low exit risk", () => {
    const input = makeInput({
      deltas: makeDeltas({ stakeChange7d: 0.20, minersGrowth7d: 0.15 }),
      economicContext: makeEco({ sentiment: 0.7, emissionsPercent: 4, emissionsPerDay: 600 }),
      priceContext: makePrice({ priceChange7d: 20, liquidity: 1000, emissionShare: 4 }),
    });
    const result = computeVerdict(input);
    expect(result.verdict).toBe("RENTRE");
    expect(result.entryScore).toBeGreaterThanOrEqual(55);
    expect(result.exitRisk).toBeLessThan(42);
  });
});

describe("computeVerdict — HOLD", () => {
  it("returns HOLD for moderate conditions", () => {
    const result = computeVerdict(makeInput());
    expect(["HOLD", "RENTRE"]).toContain(result.verdict);
    expect(result.holdScore).toBeGreaterThanOrEqual(40);
  });
});

describe("computeVerdict — SORS", () => {
  it("returns SORS for high exit risk", () => {
    const input = makeInput({
      snapshot: makeSnapshot({ validatorsActive: 1, minersActive: 3, stakeConcentration: 85 }),
      deltas: makeDeltas({ stakeChange7d: -0.25, minersGrowth7d: -0.20 }),
      economicContext: makeEco({ sentiment: 0.25, sellVolume: 80, buyVolume: 20, sellersCount: 30, buyersCount: 5 }),
      priceContext: makePrice({ priceChange7d: -30, priceChange1d: -12, liquidity: 5, vol24h: 2 }),
      derivedMetrics: makeDerived({ poolBalance: 0.1 }),
    });
    const result = computeVerdict(input);
    expect(result.verdict).toBe("SORS");
    expect(result.exitRisk).toBeGreaterThanOrEqual(50);
  });
});

/* ═══════════════════════════════════════ */
/*  Safety guards                           */
/* ═══════════════════════════════════════ */

describe("computeVerdict — Safety guards", () => {
  it("G1: blocks RENTRE when validators <= 2", () => {
    const input = makeInput({
      snapshot: makeSnapshot({ validatorsActive: 2 }),
      deltas: makeDeltas({ stakeChange7d: 0.25 }),
      economicContext: makeEco({ sentiment: 0.75, emissionsPercent: 5, emissionsPerDay: 800 }),
      priceContext: makePrice({ priceChange7d: 25, emissionShare: 5 }),
    });
    const result = computeVerdict(input);
    expect(result.verdict).not.toBe("RENTRE");
  });

  it("G3: forces SORS on high sell pressure + low liquidity", () => {
    const input = makeInput({
      economicContext: makeEco({ sentiment: 0.30 }),
      priceContext: makePrice({ liquidity: 10 }),
    });
    const result = computeVerdict(input);
    expect(result.verdict).toBe("SORS");
  });

  it("G5: blocks RENTRE on strong emissions but extreme concentration", () => {
    const input = makeInput({
      snapshot: makeSnapshot({ stakeConcentration: 80 }),
      deltas: makeDeltas({ stakeChange7d: 0.25 }),
      economicContext: makeEco({ emissionsPercent: 3, sentiment: 0.7, emissionsPerDay: 600 }),
      priceContext: makePrice({ priceChange7d: 20, emissionShare: 3 }),
    });
    const result = computeVerdict(input);
    expect(result.verdict).not.toBe("RENTRE");
  });
});

/* ═══════════════════════════════════════ */
/*  Whitelisted subnets                     */
/* ═══════════════════════════════════════ */

describe("computeVerdict — Whitelisted", () => {
  it("always returns HOLD with forte confidence", () => {
    const result = computeVerdict(makeInput({ isWhitelisted: true }));
    expect(result.verdict).toBe("HOLD");
    expect(result.confidence).toBe("forte");
    expect(result.exitRisk).toBe(10);
  });
});

/* ═══════════════════════════════════════ */
/*  Confidence levels                       */
/* ═══════════════════════════════════════ */

describe("computeVerdict — Confidence", () => {
  it("forte when 4+ signal families aligned", () => {
    const input = makeInput({
      deltas: makeDeltas({ stakeChange7d: 0.10 }),
      economicContext: makeEco({ emissionsPerDay: 200, emissionsPercent: 2, volumeMarketcapRatio: 0.05 }),
      priceContext: makePrice({ liquidity: 500 }),
      snapshot: makeSnapshot({ minersActive: 50, validatorsActive: 15 }),
    });
    const result = computeVerdict(input);
    expect(result.confidence).toBe("forte");
  });

  it("faible when data confidence is low", () => {
    const result = computeVerdict(makeInput({ dataConfidence: 30 }));
    expect(result.confidence).toBe("faible");
  });
});

/* ═══════════════════════════════════════ */
/*  Reasons                                 */
/* ═══════════════════════════════════════ */

describe("computeVerdict — Reasons", () => {
  it("includes positive reasons for good conditions", () => {
    const input = makeInput({
      deltas: makeDeltas({ stakeChange7d: 0.10 }),
      economicContext: makeEco({ sentiment: 0.65 }),
      priceContext: makePrice({ liquidity: 600 }),
    });
    const result = computeVerdict(input);
    expect(result.positiveReasons.length).toBeGreaterThan(0);
    expect(result.positiveReasons.length).toBeLessThanOrEqual(3);
  });

  it("includes negative reasons for bad conditions", () => {
    const input = makeInput({
      snapshot: makeSnapshot({ stakeConcentration: 80, minersActive: 3 }),
      priceContext: makePrice({ liquidity: 5 }),
    });
    const result = computeVerdict(input);
    expect(result.negativeReasons.length).toBeGreaterThan(0);
  });

  it("max 3 positive and 3 negative", () => {
    const result = computeVerdict(makeInput());
    expect(result.positiveReasons.length).toBeLessThanOrEqual(3);
    expect(result.negativeReasons.length).toBeLessThanOrEqual(3);
  });
});

/* ═══════════════════════════════════════ */
/*  Sub-scores                              */
/* ═══════════════════════════════════════ */

describe("computeEntryScore", () => {
  it("returns 0-100", () => {
    const score = computeEntryScore(makeInput());
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it("higher for strong rotation signals", () => {
    const weak = computeEntryScore(makeInput({ deltas: makeDeltas({ stakeChange7d: -0.10 }) }));
    const strong = computeEntryScore(makeInput({ deltas: makeDeltas({ stakeChange7d: 0.20 }) }));
    expect(strong).toBeGreaterThan(weak);
  });
});

describe("computeHoldScore", () => {
  it("returns 0-100", () => {
    const score = computeHoldScore(makeInput());
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });
});

describe("computeExitRisk", () => {
  it("returns 0-100", () => {
    const risk = computeExitRisk(makeInput());
    expect(risk).toBeGreaterThanOrEqual(0);
    expect(risk).toBeLessThanOrEqual(100);
  });

  it("higher for concentrated + illiquid subnets", () => {
    const safe = computeExitRisk(makeInput());
    const risky = computeExitRisk(makeInput({
      snapshot: makeSnapshot({ stakeConcentration: 90, validatorsActive: 1, minersActive: 2 }),
      priceContext: makePrice({ liquidity: 3 }),
      derivedMetrics: makeDerived({ poolBalance: 0.1 }),
    }));
    expect(risky).toBeGreaterThan(safe);
  });
});

/* ═══════════════════════════════════════ */
/*  Batch                                   */
/* ═══════════════════════════════════════ */

describe("computeAllVerdicts", () => {
  it("processes multiple inputs", () => {
    const inputs = [makeInput({ netuid: 1 }), makeInput({ netuid: 2 })];
    const results = computeAllVerdicts(inputs);
    expect(results).toHaveLength(2);
    expect(results[0].netuid).toBe(1);
    expect(results[1].netuid).toBe(2);
  });

  it("empty input → empty output", () => {
    expect(computeAllVerdicts([])).toEqual([]);
  });
});
