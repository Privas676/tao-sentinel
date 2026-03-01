import { describe, it, expect } from "vitest";
import {
  recalculate,
  computeLiquidityHealth,
  computeVolumeHealth,
  computeEmissionPressure,
  computeDilutionRisk,
  computeActivityHealth,
  computeHealthRisk,
  computeHealthOpportunity,
  healthColor,
  dilutionLabel,
  formatUsd,
  type SubnetHealthData,
  type RecalculatedMetrics,
  type HealthScores,
} from "@/lib/subnet-health";

function makeHealthData(overrides: Partial<SubnetHealthData> = {}): SubnetHealthData {
  return {
    netuid: 1, marketCap: 50000, fdv: 60000, circulatingSupply: 5000000,
    totalSupply: 6000000, burned: 0, alphaPrice: 0.01, taoUsd: 200,
    liquidityUsd: 100000, taoInPool: 250, alphaInPool: 25000,
    emissionPct: 0.5, emissionPerDay: 3600, uidCount: 200, maxUids: 256,
    registrationCount: 10, validatorWeight: 0.5, minerWeight: 0.5,
    alphaStaked: 500, vol24h: 100, buys24h: 50, sells24h: 50,
    ...overrides,
  };
}

describe("recalculate", () => {
  it("computes mcRecalc from supply * price * taoUsd", () => {
    const d = makeHealthData();
    const r = recalculate(d);
    expect(r.mcRecalc).toBe(d.circulatingSupply * d.alphaPrice * d.taoUsd);
  });

  it("computes poolPrice from reserves", () => {
    const r = recalculate(makeHealthData({ taoInPool: 100, alphaInPool: 10000 }));
    expect(r.poolPrice).toBe(0.01);
  });

  it("liqHaircut = 0 when pool and spot prices match", () => {
    const r = recalculate(makeHealthData({ taoInPool: 100, alphaInPool: 10000, alphaPrice: 0.01 }));
    expect(r.liqHaircut).toBe(0);
  });

  it("liqHaircut positive when pool price > spot", () => {
    const r = recalculate(makeHealthData({ taoInPool: 120, alphaInPool: 10000, alphaPrice: 0.01 }));
    expect(r.liqHaircut).toBeGreaterThan(0);
  });

  it("dilutionRatio = fdvRecalc / mcRecalc", () => {
    const r = recalculate(makeHealthData());
    expect(r.dilutionRatio).toBeCloseTo(r.fdvRecalc / r.mcRecalc, 5);
  });
});

describe("computeLiquidityHealth", () => {
  it("high liq/MC → high score", () => {
    expect(computeLiquidityHealth(0.05, 200000)).toBeGreaterThan(80);
  });
  it("low liq/MC → low score", () => {
    expect(computeLiquidityHealth(0.001, 5000)).toBeLessThan(30);
  });
  it("absolute floor: <$10k always ≤25", () => {
    expect(computeLiquidityHealth(0.05, 8000)).toBeLessThanOrEqual(25);
  });
  it("returns 0-100", () => {
    const s = computeLiquidityHealth(0.01, 50000);
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(100);
  });
});

describe("computeVolumeHealth", () => {
  it("healthy range (1-10%) → high score", () => {
    expect(computeVolumeHealth(0.05)).toBeGreaterThan(70);
  });
  it("too low (<0.5%) → low score", () => {
    expect(computeVolumeHealth(0.001)).toBeLessThan(40);
  });
  it("speculative (>20%) → penalized", () => {
    expect(computeVolumeHealth(0.30)).toBeLessThan(50);
  });
  it("returns 5-100", () => {
    expect(computeVolumeHealth(0)).toBeGreaterThanOrEqual(5);
  });
});

describe("computeEmissionPressure", () => {
  it("low emission → low pressure", () => {
    expect(computeEmissionPressure(0.0003)).toBe(10);
  });
  it("high emission → high pressure", () => {
    expect(computeEmissionPressure(0.02)).toBeGreaterThanOrEqual(80);
  });
  it("moderate emission", () => {
    const p = computeEmissionPressure(0.003);
    expect(p).toBeGreaterThan(30);
    expect(p).toBeLessThan(60);
  });
});

describe("computeDilutionRisk", () => {
  it("low dilution (≤1.2) → minimal risk", () => {
    expect(computeDilutionRisk(1.1)).toBe(5);
  });
  it("high dilution (>5) → high risk", () => {
    expect(computeDilutionRisk(8)).toBeGreaterThanOrEqual(70);
  });
  it("moderate dilution", () => {
    const r = computeDilutionRisk(2.5);
    expect(r).toBeGreaterThan(20);
    expect(r).toBeLessThan(50);
  });
});

describe("computeActivityHealth", () => {
  it("full UIDs + registrations → high score", () => {
    const s = computeActivityHealth(makeHealthData({ uidCount: 250, maxUids: 256, registrationCount: 20, alphaStaked: 2000 }));
    expect(s).toBeGreaterThan(70);
  });
  it("zero UIDs → very low score", () => {
    const s = computeActivityHealth(makeHealthData({ uidCount: 0, maxUids: 256, emissionPct: 0 }));
    expect(s).toBeLessThan(30);
  });
});

describe("computeHealthRisk", () => {
  const goodScores: HealthScores = { liquidityHealth: 90, volumeHealth: 80, emissionPressure: 15, dilutionRisk: 10, activityHealth: 85 };
  const badScores: HealthScores = { liquidityHealth: 10, volumeHealth: 20, emissionPressure: 80, dilutionRisk: 75, activityHealth: 15 };

  it("healthy scores → low risk", () => {
    expect(computeHealthRisk(goodScores, 0)).toBeLessThan(30);
  });
  it("bad scores → high risk", () => {
    expect(computeHealthRisk(badScores, 0)).toBeGreaterThan(60);
  });
  it("liq haircut >20% adds penalty", () => {
    const recalc = { liqHaircut: 25 } as RecalculatedMetrics;
    const withHaircut = computeHealthRisk(goodScores, 0, recalc);
    const without = computeHealthRisk(goodScores, 0);
    expect(withHaircut).toBeGreaterThan(without);
  });
});

describe("computeHealthOpportunity", () => {
  const goodScores: HealthScores = { liquidityHealth: 90, volumeHealth: 80, emissionPressure: 15, dilutionRisk: 10, activityHealth: 85 };
  const recalc: RecalculatedMetrics = { mcRecalc: 1e6, fdvRecalc: 1.2e6, dilutionRatio: 1.2, volumeToMc: 0.05, emissionToMc: 0.001, liquidityRecalc: 1e5, liquidityToMc: 0.1, liqHaircut: 0, poolPrice: 0.01 };

  it("good inputs → reasonable opportunity", () => {
    const s = computeHealthOpportunity(70, goodScores, 60, 30, recalc);
    expect(s).toBeGreaterThan(30);
  });
  it("high dilution penalizes opportunity", () => {
    const highDil = { ...recalc, dilutionRatio: 6 };
    const normal = computeHealthOpportunity(70, goodScores, 60, 30, recalc);
    const penalized = computeHealthOpportunity(70, goodScores, 60, 30, highDil);
    expect(penalized).toBeLessThan(normal);
  });
  it("low liquidity health penalizes", () => {
    const lowLiq = { ...goodScores, liquidityHealth: 20 };
    const s = computeHealthOpportunity(70, lowLiq, 60, 30, recalc);
    expect(s).toBeLessThan(computeHealthOpportunity(70, goodScores, 60, 30, recalc));
  });
});

describe("healthColor", () => {
  it("high score → green", () => expect(healthColor(80)).toContain("76,175,80"));
  it("mid score → amber", () => expect(healthColor(50)).toContain("255,193,7"));
  it("low score → red", () => expect(healthColor(10)).toContain("229,57,53"));
  it("inverted: low score → green", () => expect(healthColor(10, true)).toContain("76,175,80"));
});

describe("dilutionLabel", () => {
  it("low", () => expect(dilutionLabel(1.2)).toBe("Faible"));
  it("moderate", () => expect(dilutionLabel(2)).toBe("Modéré"));
  it("high", () => expect(dilutionLabel(4)).toBe("Élevé"));
  it("very high", () => expect(dilutionLabel(6)).toBe("Très élevé"));
});

describe("formatUsd", () => {
  it("billions", () => expect(formatUsd(2.5e9)).toBe("$2.5B"));
  it("millions", () => expect(formatUsd(3.7e6)).toBe("$3.7M"));
  it("thousands", () => expect(formatUsd(45000)).toBe("$45K"));
  it("small", () => expect(formatUsd(123)).toBe("$123"));
});
