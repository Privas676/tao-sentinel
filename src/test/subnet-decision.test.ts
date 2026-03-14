import { describe, it, expect } from "vitest";
import { buildSubnetDecision, type SubnetDecision } from "@/lib/subnet-decision";
import type { UnifiedSubnetScore } from "@/hooks/use-subnet-scores";
import type { SubnetVerdictData } from "@/hooks/use-subnet-verdict";

/* ── Minimal score helper ── */

function makeScore(overrides: Partial<UnifiedSubnetScore> = {}): UnifiedSubnetScore {
  return {
    netuid: 90, name: "SN-90",
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
/*  HIGH_RISK_NEAR_DELIST blocking          */
/* ═══════════════════════════════════════ */

describe("subnet-decision — HIGH_RISK_NEAR_DELIST", () => {
  it("blocks ENTRER when delistCategory is HIGH_RISK_NEAR_DELIST", () => {
    const s = makeScore({ delistCategory: "HIGH_RISK_NEAR_DELIST", action: "ENTER" });
    const d = buildSubnetDecision(s, undefined, undefined, true);
    expect(d.finalAction).not.toBe("ENTRER");
    expect(["SURVEILLER", "SORTIR"]).toContain(d.finalAction);
  });

  it("forces SORTIR when HIGH_RISK_NEAR_DELIST + depeg >= 30%", () => {
    const s = makeScore({ delistCategory: "HIGH_RISK_NEAR_DELIST", depegProbability: 40 });
    const d = buildSubnetDecision(s, undefined, undefined, true);
    expect(d.finalAction).toBe("SORTIR");
  });

  it("forces SORTIR when HIGH_RISK_NEAR_DELIST + high risk", () => {
    const s = makeScore({ delistCategory: "HIGH_RISK_NEAR_DELIST", risk: 65 });
    const d = buildSubnetDecision(s, undefined, undefined, true);
    expect(d.finalAction).toBe("SORTIR");
  });

  it("forces SURVEILLER when HIGH_RISK_NEAR_DELIST + moderate risk", () => {
    const s = makeScore({ delistCategory: "HIGH_RISK_NEAR_DELIST", risk: 30, depegProbability: 10 });
    const d = buildSubnetDecision(s, undefined, undefined, true);
    expect(d.finalAction).toBe("SURVEILLER");
  });

  it("isBlocked is true when raw signal is opportunity + HIGH_RISK_NEAR_DELIST", () => {
    const s = makeScore({ delistCategory: "HIGH_RISK_NEAR_DELIST", opp: 70, momentumScore: 60 });
    const d = buildSubnetDecision(s, undefined, undefined, true);
    expect(d.isBlocked).toBe(true);
    expect(d.blockReasons.length).toBeGreaterThan(0);
  });

  it("portfolioAction is coherent with finalAction for near-delist", () => {
    const s = makeScore({ delistCategory: "HIGH_RISK_NEAR_DELIST", depegProbability: 40 });
    const d = buildSubnetDecision(s, undefined, undefined, true);
    // finalAction = SORTIR → portfolioAction must be SORTIR
    expect(d.portfolioAction).toBe("SORTIR");
  });
});

/* ═══════════════════════════════════════ */
/*  SN-90 exact scenario reproduction       */
/* ═══════════════════════════════════════ */

describe("subnet-decision — SN-90 scenario", () => {
  it("SN-90 with HIGH_RISK_NEAR_DELIST + depeg 40% → SORTIR, not ENTRER", () => {
    const s = makeScore({
      netuid: 90,
      delistCategory: "HIGH_RISK_NEAR_DELIST",
      depegProbability: 40,
      opp: 70,
      risk: 30,
      action: "ENTER",
      confianceScore: 80,
    });
    const d = buildSubnetDecision(s, undefined, true);
    expect(d.finalAction).not.toBe("ENTRER");
    expect(d.finalAction).toBe("SORTIR");
    expect(d.badgeAction).toBe("SORS");
    expect(d.portfolioAction).toBe("SORTIR");
  });
});

/* ═══════════════════════════════════════ */
/*  DEPEG_PRIORITY always SORTIR            */
/* ═══════════════════════════════════════ */

describe("subnet-decision — DEPEG_PRIORITY", () => {
  it("always forces SORTIR", () => {
    const s = makeScore({ delistCategory: "DEPEG_PRIORITY" });
    const d = buildSubnetDecision(s, undefined, true);
    expect(d.finalAction).toBe("SORTIR");
  });
});

/* ═══════════════════════════════════════ */
/*  Normal flow still works                 */
/* ═══════════════════════════════════════ */

describe("subnet-decision — Normal", () => {
  it("NORMAL + ENTER + low risk → ENTRER", () => {
    const s = makeScore({ delistCategory: "NORMAL", action: "ENTER", risk: 30 });
    const d = buildSubnetDecision(s, undefined, true);
    expect(d.finalAction).toBe("ENTRER");
  });

  it("NORMAL + EXIT → SORTIR", () => {
    const s = makeScore({ delistCategory: "NORMAL", action: "EXIT" });
    const d = buildSubnetDecision(s, undefined, true);
    expect(d.finalAction).toBe("SORTIR");
  });
});
