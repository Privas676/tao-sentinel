import { describe, it, expect } from "vitest";
import {
  deriveGaugeState,
  derivePhase,
  deriveOpportunity,
  deriveRisk,
  stateColor,
  stateGlow,
  rayColor,
  opportunityColor,
  riskColor,
  classifyMicroCaps,
  computeASMicro,
  detectPreHype,
  computeSaturationIndex,
  saturationAlert,
} from "@/lib/gauge-signals";
import type { SubnetSignal } from "@/lib/gauge-types";

describe("deriveGaugeState", () => {
  it("EXIT when riskHigh", () => {
    expect(deriveGaugeState(90, 90, true)).toBe("EXIT");
  });
  it("IMMINENT when psi ≥ 80 and conf ≥ 70", () => {
    expect(deriveGaugeState(85, 75)).toBe("IMMINENT");
  });
  it("ALERT when psi ≥ 50", () => {
    expect(deriveGaugeState(55, 30)).toBe("ALERT");
  });
  it("CALM when psi low", () => {
    expect(deriveGaugeState(30, 30)).toBe("CALM");
  });
});

describe("derivePhase", () => {
  it("TRIGGER when psi ≥ 85", () => {
    expect(derivePhase(90)).toBe("TRIGGER");
  });
  it("ARMED when psi ≥ 55", () => {
    expect(derivePhase(60)).toBe("ARMED");
  });
  it("BUILD when psi ≥ 35", () => {
    expect(derivePhase(40)).toBe("BUILD");
  });
  it("NONE when psi low", () => {
    expect(derivePhase(30)).toBe("NONE");
  });
});

describe("deriveOpportunity", () => {
  it("GO state adds 12 points", () => {
    const withGo = deriveOpportunity(60, 60, 60, "GO");
    const withNull = deriveOpportunity(60, 60, 60, null);
    expect(withGo).toBeGreaterThan(withNull);
  });
  it("BREAK state penalizes heavily", () => {
    const r = deriveOpportunity(60, 60, 60, "BREAK");
    expect(r).toBeLessThan(20);
  });
  it("low PSI penalizes", () => {
    const low = deriveOpportunity(20, 60, 60, null);
    const high = deriveOpportunity(80, 60, 60, null);
    expect(low).toBeLessThan(high);
  });
  it("clamped 0-100", () => {
    expect(deriveOpportunity(0, 0, 0, "BREAK")).toBeGreaterThanOrEqual(0);
    expect(deriveOpportunity(100, 100, 100, "GO")).toBeLessThanOrEqual(100);
  });
});

describe("deriveRisk", () => {
  it("BREAK state adds 15 risk", () => {
    const breakRisk = deriveRisk(60, 60, 60, "BREAK");
    const normalRisk = deriveRisk(60, 60, 60, null);
    expect(breakRisk).toBeGreaterThan(normalRisk);
  });
  it("no market data adds 15 penalty", () => {
    const noMarket = deriveRisk(60, 60, 60, null);
    const withMarket = deriveRisk(60, 60, 60, null, {
      volCap: 0.08, topMinersShare: 0.1, liqRatio: 0.05, priceVol7d: 0.05,
    });
    expect(noMarket).toBeGreaterThan(withMarket);
  });
  it("low confidence increases risk", () => {
    const lowConf = deriveRisk(60, 20, 60, null);
    const highConf = deriveRisk(60, 80, 60, null);
    expect(lowConf).toBeGreaterThan(highConf);
  });
  it("clamped 0-100", () => {
    expect(deriveRisk(100, 100, 100, null)).toBeLessThanOrEqual(100);
    expect(deriveRisk(0, 0, 0, "BREAK")).toBeLessThanOrEqual(100);
  });
});

describe("color helpers", () => {
  it("stateColor returns hex", () => {
    expect(stateColor("IMMINENT")).toBe("#e53935");
    expect(stateColor("CALM")).toBe("#546e7a");
  });
  it("stateGlow returns rgba", () => {
    expect(stateGlow("IMMINENT")).toContain("229,57,53");
    expect(stateGlow("CALM")).toContain("84,110,122");
  });
  it("rayColor uses custom alpha", () => {
    expect(rayColor("ALERT", 0.8)).toContain("0.8");
  });
  it("opportunityColor tiers", () => {
    expect(opportunityColor(80)).toContain("255,215,0");
    expect(opportunityColor(60)).toContain("251,192,45");
    expect(opportunityColor(30)).toContain("200,170,80");
    expect(opportunityColor(10)).toContain("140,130,90");
  });
  it("riskColor tiers", () => {
    expect(riskColor(80)).toContain("229,57,53");
    expect(riskColor(60)).toContain("255,109,0");
    expect(riskColor(30)).toContain("200,120,60");
    expect(riskColor(10)).toContain("100,90,80");
  });
});

function makeSignal(overrides: Partial<SubnetSignal> = {}): SubnetSignal {
  return {
    netuid: 1, name: "SN-1", psi: 60, opportunity: 50, risk: 40,
    confidence: 60, state: "CALM", phase: "NONE", asymmetry: "MED",
    sparkline_7d: [], liquidity: 50, momentum: 50, momentumLabel: "MODÉRÉ",
    momentumScore: 50, reasons: [], dominant: "neutral", isMicroCap: false,
    asMicro: 0, preHype: false, preHypeIntensity: 0, stabilitySetup: 60,
    isOverridden: false, systemStatus: "OK", overrideReasons: [],
    dataUncertain: false, confianceData: 80,
    ...overrides,
  } as SubnetSignal;
}

describe("classifyMicroCaps", () => {
  it("marks bottom 40% as micro", () => {
    const signals = [
      makeSignal({ netuid: 1, confidence: 90, psi: 90 }),
      makeSignal({ netuid: 2, confidence: 10, psi: 10 }),
      makeSignal({ netuid: 3, confidence: 80, psi: 80 }),
      makeSignal({ netuid: 4, confidence: 20, psi: 20 }),
      makeSignal({ netuid: 5, confidence: 70, psi: 70 }),
    ];
    classifyMicroCaps(signals);
    expect(signals.find(s => s.netuid === 2)!.isMicroCap).toBe(true);
    expect(signals.find(s => s.netuid === 1)!.isMicroCap).toBe(false);
  });
});

describe("computeASMicro", () => {
  it("bonuses for FORT momentum + ACCUMULATION", () => {
    const s = makeSignal({ opportunity: 60, risk: 30, momentumLabel: "FORT" });
    const result = computeASMicro(s, "ACCUMULATION", "up", "up");
    expect(result).toBeGreaterThan(s.opportunity - s.risk);
  });
  it("penalties for high risk + DISTRIBUTION", () => {
    const s = makeSignal({ opportunity: 30, risk: 70, momentumLabel: "DÉTÉRIORATION" });
    const result = computeASMicro(s, "DISTRIBUTION", "down", "down");
    expect(result).toBeLessThan(s.opportunity - s.risk);
  });
});

describe("detectPreHype", () => {
  it("active when conditions align", () => {
    const s = makeSignal({ opportunity: 70, risk: 30, momentumLabel: "FORT", psi: 55, stabilitySetup: 60 });
    const r = detectPreHype(s, "ACCUMULATION", "up", "up");
    expect(r.active).toBe(true);
    expect(r.intensity).toBeGreaterThan(0);
  });
  it("inactive for weak signals", () => {
    const s = makeSignal({ opportunity: 30, risk: 60, momentumLabel: "STABLE", psi: 80, stabilitySetup: 30 });
    const r = detectPreHype(s, "STABLE", "down", "down");
    expect(r.active).toBe(false);
  });
});

describe("saturation", () => {
  it("computeSaturationIndex counts high AS signals", () => {
    const signals = [
      makeSignal({ opportunity: 80, risk: 20 }),
      makeSignal({ opportunity: 30, risk: 50 }),
    ];
    expect(computeSaturationIndex(signals)).toBe(50);
  });
  it("empty returns 0", () => {
    expect(computeSaturationIndex([])).toBe(0);
  });
  it("saturationAlert triggers above 60%", () => {
    expect(saturationAlert(70)).toBe(true);
    expect(saturationAlert(50)).toBe(false);
  });
});
