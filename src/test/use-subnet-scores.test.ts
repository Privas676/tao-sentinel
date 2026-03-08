import { describe, it, expect } from "vitest";
import {
  SPECIAL_SUBNETS,
  getSubnetScore,
  type UnifiedSubnetScore,
} from "@/hooks/use-subnet-scores";

function makeScore(overrides: Partial<UnifiedSubnetScore> = {}): UnifiedSubnetScore {
  return {
    netuid: 1, name: "SN-1", assetType: "SPECULATIVE",
    state: null, psi: 60, conf: 60, quality: 60,
    opp: 50, risk: 40, asymmetry: 10, momentum: 50,
    momentumLabel: "MODÉRÉ", momentumScore: 50,
    action: "WATCH", sc: "STABLE", confianceScore: 70,
    dataUncertain: false, isOverridden: false, isWarning: false,
    systemStatus: "OK", overrideReasons: [],
    healthScores: { liquidityHealth: 80, volumeHealth: 60, emissionPressure: 20, dilutionRisk: 15, activityHealth: 70 },
    recalc: { mcRecalc: 1e6, fdvRecalc: 1.2e6, dilutionRatio: 1.2, volumeToMc: 0.05, emissionToMc: 0.001, liquidityRecalc: 1e5, liquidityToMc: 0.1, liqHaircut: 0, poolPrice: 0.01 },
    displayedCap: 100000, displayedLiq: 50000, stability: 60,
    consensusPrice: 0.01, alphaPrice: 0.01,
    priceVar30d: null, delistCategory: "NORMAL", delistScore: 0,
    ...overrides,
  } as UnifiedSubnetScore;
}

describe("SPECIAL_SUBNETS", () => {
  it("SN-0 (Root) is whitelisted as system subnet", () => {
    expect(SPECIAL_SUBNETS[0]).toBeDefined();
    expect(SPECIAL_SUBNETS[0].forceAction).toBe("HOLD");
    expect(SPECIAL_SUBNETS[0].forceStatus).toBe("OK");
    expect(SPECIAL_SUBNETS[0].forceRiskMax).toBe(20);
    expect(SPECIAL_SUBNETS[0].isSystem).toBe(true);
    expect(SPECIAL_SUBNETS[0].label).toContain("ROOT");
  });

  it("non-special subnets are undefined", () => {
    expect(SPECIAL_SUBNETS[1]).toBeUndefined();
    expect(SPECIAL_SUBNETS[42]).toBeUndefined();
  });
});

describe("getSubnetScore", () => {
  it("returns score for existing netuid", () => {
    const map = new Map<number, UnifiedSubnetScore>();
    const s = makeScore({ netuid: 5 });
    map.set(5, s);
    expect(getSubnetScore(map, 5)).toBe(s);
  });

  it("returns undefined for missing netuid", () => {
    const map = new Map<number, UnifiedSubnetScore>();
    expect(getSubnetScore(map, 999)).toBeUndefined();
  });
});

describe("UnifiedSubnetScore invariants", () => {
  it("asymmetry = opp - risk", () => {
    const s = makeScore({ opp: 70, risk: 30, asymmetry: 40 });
    expect(s.asymmetry).toBe(s.opp - s.risk);
  });

  it("overridden → opp should be 0", () => {
    const s = makeScore({ isOverridden: true, opp: 0, risk: 80, action: "EXIT" });
    expect(s.opp).toBe(0);
    expect(s.action).toBe("EXIT");
  });

  it("DEPEG_PRIORITY → opp=0, risk≥80, action=EXIT", () => {
    const s = makeScore({ delistCategory: "DEPEG_PRIORITY", opp: 0, risk: 85, action: "EXIT", isOverridden: true });
    expect(s.opp).toBe(0);
    expect(s.risk).toBeGreaterThanOrEqual(80);
    expect(s.action).toBe("EXIT");
  });

  it("HIGH_RISK_NEAR_DELIST → opp≤25, risk≥60", () => {
    const s = makeScore({ delistCategory: "HIGH_RISK_NEAR_DELIST", opp: 20, risk: 65, action: "WATCH", isWarning: true });
    expect(s.opp).toBeLessThanOrEqual(25);
    expect(s.risk).toBeGreaterThanOrEqual(60);
  });

  it("CORE_NETWORK asset type for whitelisted", () => {
    const s = makeScore({ netuid: 0, assetType: "CORE_NETWORK", action: "HOLD", risk: 15 });
    expect(s.assetType).toBe("CORE_NETWORK");
    expect(s.risk).toBeLessThanOrEqual(20);
  });
});
