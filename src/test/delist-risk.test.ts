import { describe, it, expect } from "vitest";
import {
  computeDelistRiskScore,
  evaluateAllDelistRisks,
  isDepegOrDelist,
  delistCategoryColor,
  delistCategoryLabel,
  DEPEG_PRIORITY_MANUAL,
  HIGH_RISK_NEAR_DELIST_MANUAL,
  type SubnetMetricsForDelist,
} from "@/lib/delist-risk";

function makeSubnet(overrides: Partial<SubnetMetricsForDelist> = {}): SubnetMetricsForDelist {
  return {
    netuid: 42,
    minersActive: 100,
    liqTao: 500,
    liqUsd: 50000,
    capTao: 100000,
    alphaPrice: 0.05,
    volMcRatio: 0.05,
    psi: 60,
    quality: 60,
    state: null,
    priceChange7d: 0,
    confianceData: 80,
    liqHaircut: 0,
    ...overrides,
  };
}

describe("computeDelistRiskScore", () => {
  it("healthy subnet → NORMAL, score 0", () => {
    const r = computeDelistRiskScore(makeSubnet());
    expect(r.category).toBe("NORMAL");
    expect(r.score).toBe(0);
  });

  it("whitelisted subnet (netuid 0) → always NORMAL", () => {
    const r = computeDelistRiskScore(makeSubnet({ netuid: 0, minersActive: 0, liqTao: 0 }));
    expect(r.category).toBe("NORMAL");
    expect(r.score).toBe(0);
  });

  it("zero miners → EMISSION_ZERO reason", () => {
    const r = computeDelistRiskScore(makeSubnet({ minersActive: 0 }));
    expect(r.reasons.some(r => r.code === "EMISSION_ZERO")).toBe(true);
    expect(r.score).toBeGreaterThan(0);
  });

  it("critical UIDs (≤5)", () => {
    const r = computeDelistRiskScore(makeSubnet({ minersActive: 3 }));
    expect(r.reasons.some(r => r.code === "UID_CRITICAL")).toBe(true);
  });

  it("pool collapse (liqTao < 10)", () => {
    const r = computeDelistRiskScore(makeSubnet({ liqTao: 5 }));
    expect(r.reasons.some(r => r.code === "POOL_COLLAPSE")).toBe(true);
  });

  it("liquidity USD critical", () => {
    const r = computeDelistRiskScore(makeSubnet({ liqUsd: 1000 }));
    expect(r.reasons.some(r => r.code === "LIQ_CRITICAL")).toBe(true);
  });

  it("micro price triggers MICRO_PRICE", () => {
    const r = computeDelistRiskScore(makeSubnet({ alphaPrice: 0.003 }));
    expect(r.reasons.some(r => r.code === "MICRO_PRICE")).toBe(true);
  });

  it("cap concentration (liq/cap > 0.85)", () => {
    const r = computeDelistRiskScore(makeSubnet({ liqTao: 900, capTao: 1000 }));
    expect(r.reasons.some(r => r.code === "CAP_CONCENTRATED")).toBe(true);
  });

  it("small cap (< 10k TAO)", () => {
    const r = computeDelistRiskScore(makeSubnet({ capTao: 5000 }));
    expect(r.reasons.some(r => r.code === "SMALL_CAP")).toBe(true);
  });

  it("price collapse ≤-20%", () => {
    const r = computeDelistRiskScore(makeSubnet({ priceChange7d: -30 }));
    expect(r.reasons.some(r => r.code === "PRICE_COLLAPSE")).toBe(true);
  });

  it("multiple factors → DEPEG_PRIORITY (score ≥ 45)", () => {
    const r = computeDelistRiskScore(makeSubnet({
      minersActive: 0, liqTao: 3, alphaPrice: 0.002, capTao: 5000,
    }));
    expect(r.category).toBe("DEPEG_PRIORITY");
    expect(r.score).toBeGreaterThanOrEqual(45);
  });

  it("moderate factors → HIGH_RISK_NEAR_DELIST (score 28-44)", () => {
    const r = computeDelistRiskScore(makeSubnet({
      minersActive: 15, liqTao: 30, volMcRatio: 0.005,
    }));
    expect(r.score).toBeGreaterThanOrEqual(28);
    expect(r.category).toBe("HIGH_RISK_NEAR_DELIST");
  });
});

describe("evaluateAllDelistRisks", () => {
  it("manual mode returns results for listed subnets", () => {
    const subnets = DEPEG_PRIORITY_MANUAL.slice(0, 2).map(netuid =>
      makeSubnet({ netuid })
    );
    const results = evaluateAllDelistRisks("manual", subnets);
    expect(results.length).toBe(2);
    results.forEach(r => expect(r.category).toBe("DEPEG_PRIORITY"));
  });

  it("manual mode ignores unlisted subnets", () => {
    const results = evaluateAllDelistRisks("manual", [makeSubnet({ netuid: 999 })]);
    expect(results).toHaveLength(0);
  });

  it("auto mode returns only non-NORMAL", () => {
    const subnets = [
      makeSubnet({ netuid: 1 }), // healthy
      makeSubnet({ netuid: 2, minersActive: 0, liqTao: 3, alphaPrice: 0.002 }), // risky
    ];
    const results = evaluateAllDelistRisks("auto_taostats", subnets);
    expect(results.length).toBe(1);
    expect(results[0].netuid).toBe(2);
    expect(results[0].source).toBe("Auto (Taostats)");
  });

  it("results sorted by score descending", () => {
    const subnets = [
      makeSubnet({ netuid: 1, minersActive: 3, liqTao: 30 }),
      makeSubnet({ netuid: 2, minersActive: 0, liqTao: 3, alphaPrice: 0.002 }),
    ];
    const results = evaluateAllDelistRisks("auto_taostats", subnets);
    if (results.length >= 2) {
      expect(results[0].score).toBeGreaterThanOrEqual(results[1].score);
    }
  });
});

describe("isDepegOrDelist", () => {
  it("finds matching netuid", () => {
    const results = [{ netuid: 42, category: "DEPEG_PRIORITY" as const, score: 80, reasons: [], source: "" }];
    expect(isDepegOrDelist(42, results)).toBeDefined();
  });
  it("returns undefined for missing", () => {
    expect(isDepegOrDelist(999, [])).toBeUndefined();
  });
});

describe("delistCategory helpers", () => {
  it("colors", () => {
    expect(delistCategoryColor("DEPEG_PRIORITY")).toContain("229,57,53");
    expect(delistCategoryColor("HIGH_RISK_NEAR_DELIST")).toContain("255,152,0");
    expect(delistCategoryColor("NORMAL")).toContain("158,158,158");
  });
  it("labels FR", () => {
    expect(delistCategoryLabel("DEPEG_PRIORITY", true)).toContain("DEPEG PRIORITAIRE");
    expect(delistCategoryLabel("HIGH_RISK_NEAR_DELIST", true)).toContain("PROCHE DELIST");
  });
  it("labels EN", () => {
    expect(delistCategoryLabel("DEPEG_PRIORITY", false)).toContain("DEPEG PRIORITY");
    expect(delistCategoryLabel("HIGH_RISK_NEAR_DELIST", false)).toContain("NEAR DELIST");
  });
});
