/**
 * Taoflute Integration Test — Verifies that external haircut penalties
 * from Taoflute correctly propagate through concordance → derived scores → prohibitions
 * for Priority (SN-70) and Watch (SN-96) scenarios.
 */
import { describe, it, expect } from "vitest";
import { computeConcordance } from "@/lib/source-concordance";
import { computeDerivedScores, type ScoringResult } from "@/lib/derived-scores";
import type { SubnetFacts, Sourced } from "@/lib/subnet-facts";

/* ─── Helpers ─── */

function s<T>(value: T): Sourced<T> {
  return { value, source: "taostats" };
}

function makeFacts(overrides: Partial<Record<keyof SubnetFacts, any>> = {}): SubnetFacts {
  return {
    netuid: 1,
    name: s("Test"),
    category: s("unknown"),
    price: s(0.01),
    priceUsd: s(0.01 * 400),
    priceChange1h: s(0),
    priceChange24h: s(0),
    priceChange7d: s(0),
    priceChange30d: s(0),
    marketCap: s(50),
    marketCapUsd: s(50 * 400),
    fdv: s(60),
    vol24h: s(1),
    vol24hUsd: s(400),
    buyCount: s(5),
    sellCount: s(5),
    buyerCount: s(3),
    sellerCount: s(3),
    taoInPool: s(100),
    alphaInPool: s(10000),
    poolRatio: s(0.01),
    poolPrice: s(0.01),
    liqPrice: s(4),
    liqHaircut: s(-5),  // small local haircut
    spread: s(0.1),
    slippage1tau: s(0.5),
    slippage10tau: s(3),
    depth: s(100),
    liquidity: s(100),
    emissionPerDay: s(0.5),
    burn: s(0.1),
    rootProportion: s(0.5),
    circulatingSupply: s(5000),
    totalSupply: s(6000),
    alphaStaked: s(2000),
    uidSaturation: s(0.5),
    activeUids: s(128),
    maxUids: s(256),
    validators: s(10),
    miners: s(20),
    registrations: s(5),
    holders: s(50),
    rank: s(70),
    lastSyncTs: s(new Date().toISOString()),
    taoUsd: 400,
    sevenDayPrices: [],
    ...overrides,
  } as SubnetFacts;
}

function score(facts: SubnetFacts, extHaircut: number | null): ScoringResult {
  const concordance = computeConcordance(facts, extHaircut);
  return computeDerivedScores(facts, concordance, extHaircut);
}

/* ─── Tests ─── */

describe("Taoflute Haircut → Concordance Check", () => {
  it("passes when no external haircut data", () => {
    const facts = makeFacts();
    const conc = computeConcordance(facts, null);
    const extCheck = conc.checks.find(c => c.code === "EXTERNAL_HAIRCUT");
    expect(extCheck).toBeDefined();
    expect(extCheck!.passed).toBe(true);
    expect(extCheck!.severity).toBe(0);
  });

  it("fails with severity 12 when both local and external haircuts are severe", () => {
    const facts = makeFacts({ liqHaircut: s(-30) });
    const conc = computeConcordance(facts, -25);
    const extCheck = conc.checks.find(c => c.code === "EXTERNAL_HAIRCUT");
    expect(extCheck!.passed).toBe(false);
    expect(extCheck!.severity).toBe(12);
  });

  it("fails with severity 10 when external severe but local mild (hidden risk)", () => {
    const facts = makeFacts({ liqHaircut: s(-3) });
    const conc = computeConcordance(facts, -25);
    const extCheck = conc.checks.find(c => c.code === "EXTERNAL_HAIRCUT");
    expect(extCheck!.passed).toBe(false);
    expect(extCheck!.severity).toBe(10);
  });

  it("passes when both sources are within tolerance", () => {
    const facts = makeFacts({ liqHaircut: s(-8) });
    const conc = computeConcordance(facts, -10);
    const extCheck = conc.checks.find(c => c.code === "EXTERNAL_HAIRCUT");
    expect(extCheck!.passed).toBe(true);
  });
});

describe("SN-70 scenario — Priority subnet with severe external haircut", () => {
  const facts70 = makeFacts({
    netuid: 70,
    liqHaircut: s(-5),       // local: mild
    taoInPool: s(500),       // decent pool → would normally give high liq score
    slippage1tau: s(0.3),
    slippage10tau: s(2),
    spread: s(0.05),
    marketCap: s(200),
    vol24h: s(5),
    priceChange7d: s(15),    // positive momentum
  });

  it("caps liquidityQuality when external haircut > 25%", () => {
    const result = score(facts70, -35); // severe Taoflute haircut
    // RULE 1b: extHaircut > 25 → liq capped at 40
    expect(result.scores.liquidityQuality).toBeLessThanOrEqual(40);
    const violation = result.violations.find(v => v.code === "LIQ_EXT_HAIRCUT_SEVERE");
    expect(violation).toBeDefined();
  });

  it("raises depeg risk floor when external haircut > 20%", () => {
    const result = score(facts70, -30);
    // RULE 1c: extHaircut > 20 → depeg risk >= 45
    expect(result.scores.depegRisk).toBeGreaterThanOrEqual(45);
    const violation = result.violations.find(v => v.code === "DEPEG_EXT_HAIRCUT_FLOOR");
    expect(violation).toBeDefined();
  });

  it("caps execution quality when external haircut > 15%", () => {
    const result = score(facts70, -20);
    // RULE 1d: extHaircut > 15 → exec capped at 45
    expect(result.scores.executionQuality).toBeLessThanOrEqual(45);
    const violation = result.violations.find(v => v.code === "EXEC_EXT_HAIRCUT_CAP");
    expect(violation).toBeDefined();
  });

  it("concordance score degrades with severe external haircut", () => {
    const concWithout = computeConcordance(facts70, null);
    const concWith = computeConcordance(facts70, -35);
    expect(concWith.score).toBeLessThan(concWithout.score);
  });
});

describe("SN-96 scenario — Watch subnet with moderate external haircut", () => {
  const facts96 = makeFacts({
    netuid: 96,
    liqHaircut: s(-12),      // moderate local haircut
    taoInPool: s(30),        // thin pool
    slippage1tau: s(2),
    slippage10tau: s(12),    // high slippage
    spread: s(0.8),
    marketCap: s(20),
    vol24h: s(0.3),
    validators: s(5),
    miners: s(3),
  });

  it("execution quality capped by both slippage and external haircut rules", () => {
    const result = score(facts96, -18);
    // RULE 6: slippage10 > 10 → exec capped at 45
    // RULE 1d: extHaircut > 15 → exec capped at 45
    expect(result.scores.executionQuality).toBeLessThanOrEqual(45);
    const slippageViolation = result.violations.find(v => v.code === "EXECUTION_SLIPPAGE_CAP");
    const haircutViolation = result.violations.find(v => v.code === "EXEC_EXT_HAIRCUT_CAP");
    // At least one should fire (both may fire)
    expect(slippageViolation || haircutViolation).toBeDefined();
  });

  it("depeg risk raised with moderate external haircut", () => {
    const result = score(facts96, -22);
    expect(result.scores.depegRisk).toBeGreaterThanOrEqual(45);
  });

  it("liquidity score remains low for thin pool even without external data", () => {
    const result = score(facts96, null);
    expect(result.scores.liquidityQuality).toBeLessThanOrEqual(50);
  });
});

describe("No external haircut — prohibitions should NOT fire", () => {
  const healthyFacts = makeFacts({
    taoInPool: s(500),
    slippage1tau: s(0.2),
    slippage10tau: s(1),
    spread: s(0.05),
    liqHaircut: s(-2),
    marketCap: s(200),
    vol24h: s(5),
    validators: s(20),
    miners: s(30),
  });

  it("no Taoflute-related violations for healthy subnet without external data", () => {
    const result = score(healthyFacts, null);
    const taofluteViolations = result.violations.filter(v =>
      ["LIQ_HAIRCUT_CAP", "LIQ_EXT_HAIRCUT_SEVERE", "DEPEG_EXT_HAIRCUT_FLOOR", "EXEC_EXT_HAIRCUT_CAP"].includes(v.code)
    );
    expect(taofluteViolations).toHaveLength(0);
  });

  it("no Taoflute-related violations for healthy subnet with small external haircut", () => {
    const result = score(healthyFacts, -3);
    const taofluteViolations = result.violations.filter(v =>
      ["LIQ_EXT_HAIRCUT_SEVERE", "DEPEG_EXT_HAIRCUT_FLOOR", "EXEC_EXT_HAIRCUT_CAP"].includes(v.code)
    );
    expect(taofluteViolations).toHaveLength(0);
  });
});
