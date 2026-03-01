import { describe, it, expect, beforeEach } from "vitest";
import {
  processSignals,
  computeSmartCapital,
  computeDualCore,
  computeGlobalPsi,
  computeGlobalConfidence,
  computeGlobalOpportunity,
  computeGlobalRisk,
  classifyMicroCaps,
  computeASMicro,
  detectPreHype,
  computeSaturationIndex,
  type RawSignal,
  type SubnetSignal,
} from "@/lib/gauge-engine";
import { clearOverrideCooldowns } from "@/lib/risk-override";

function makeRaw(overrides: Partial<RawSignal> = {}): RawSignal {
  return {
    netuid: 1, mpi: 60, confidence_pct: 65, quality_score: 60,
    state: null, subnet_name: "SN-1", score: null,
    ...overrides,
  } as RawSignal;
}

/** Build a realistic fleet of 10 subnets with varied profiles */
function buildFleet(): RawSignal[] {
  return [
    makeRaw({ netuid: 1, mpi: 85, confidence_pct: 80, quality_score: 75, state: "GO", subnet_name: "Alpha" }),
    makeRaw({ netuid: 2, mpi: 70, confidence_pct: 60, quality_score: 55, state: "WATCH", subnet_name: "Beta" }),
    makeRaw({ netuid: 3, mpi: 45, confidence_pct: 50, quality_score: 40, state: "HOLD", subnet_name: "Gamma" }),
    makeRaw({ netuid: 4, mpi: 30, confidence_pct: 35, quality_score: 30, state: null, subnet_name: "Delta" }),
    makeRaw({ netuid: 5, mpi: 90, confidence_pct: 85, quality_score: 80, state: "GO", subnet_name: "Epsilon" }),
    makeRaw({ netuid: 6, mpi: 20, confidence_pct: 25, quality_score: 20, state: "BREAK", subnet_name: "Zeta" }),
    makeRaw({ netuid: 7, mpi: 55, confidence_pct: 60, quality_score: 50, state: "EARLY", subnet_name: "Eta" }),
    makeRaw({ netuid: 8, mpi: 75, confidence_pct: 70, quality_score: 65, state: "GO_SPECULATIVE", subnet_name: "Theta" }),
    makeRaw({ netuid: 9, mpi: 40, confidence_pct: 30, quality_score: 25, state: "EXIT_FAST", subnet_name: "Iota" }),
    makeRaw({ netuid: 10, mpi: 65, confidence_pct: 55, quality_score: 50, state: "WATCH", subnet_name: "Kappa" }),
  ];
}

beforeEach(() => clearOverrideCooldowns());

describe("processSignals — full pipeline integration", () => {
  const fleet = buildFleet();
  const sparklines: Record<number, number[]> = {
    1: [0.05, 0.06, 0.07, 0.08, 0.09, 0.10, 0.11],
    5: [0.10, 0.12, 0.14, 0.13, 0.15, 0.16, 0.18],
  };

  it("returns one signal per valid input", () => {
    const signals = processSignals(fleet, sparklines);
    expect(signals).toHaveLength(10);
  });

  it("all signals have required fields", () => {
    const signals = processSignals(fleet, sparklines);
    for (const s of signals) {
      expect(s.netuid).toBeGreaterThan(0);
      expect(s.name).toBeTruthy();
      expect(s.opportunity).toBeGreaterThanOrEqual(0);
      expect(s.opportunity).toBeLessThanOrEqual(100);
      expect(s.risk).toBeGreaterThanOrEqual(0);
      expect(s.risk).toBeLessThanOrEqual(100);
      expect(["CALM", "ALERT", "IMMINENT", "EXIT"]).toContain(s.state);
      expect(["BUILD", "ARMED", "TRIGGER", "NONE"]).toContain(s.phase);
      expect(["HIGH", "MED", "LOW"]).toContain(s.asymmetry);
      expect(["FORT", "MODÉRÉ", "STABLE", "DÉTÉRIORATION"]).toContain(s.momentumLabel);
      expect(["opportunity", "risk", "neutral"]).toContain(s.dominant);
    }
  });

  it("sorted by PSI descending", () => {
    const signals = processSignals(fleet, sparklines);
    for (let i = 1; i < signals.length; i++) {
      expect(signals[i - 1].psi).toBeGreaterThanOrEqual(signals[i].psi);
    }
  });

  it("BREAK/EXIT_FAST → opportunity = 0", () => {
    const signals = processSignals(fleet, sparklines);
    const breakSignal = signals.find(s => s.netuid === 6)!;
    const exitFastSignal = signals.find(s => s.netuid === 9)!;
    expect(breakSignal.opportunity).toBe(0);
    expect(exitFastSignal.opportunity).toBe(0);
  });

  it("BREAK/EXIT_FAST → state = EXIT", () => {
    const signals = processSignals(fleet, sparklines);
    const breakSignal = signals.find(s => s.netuid === 6)!;
    const exitFastSignal = signals.find(s => s.netuid === 9)!;
    expect(breakSignal.state).toBe("EXIT");
    expect(exitFastSignal.state).toBe("EXIT");
  });

  it("GO state with high PSI → high opportunity", () => {
    const signals = processSignals(fleet, sparklines);
    const goSignal = signals.find(s => s.netuid === 5)!;
    const holdSignal = signals.find(s => s.netuid === 3)!;
    expect(goSignal.opportunity).toBeGreaterThan(holdSignal.opportunity);
  });

  it("sparklines are sliced to last 7 values", () => {
    const signals = processSignals(fleet, sparklines);
    const s1 = signals.find(s => s.netuid === 1)!;
    expect(s1.sparkline_7d.length).toBeLessThanOrEqual(7);
  });

  it("micro caps are classified (bottom 40%)", () => {
    const signals = processSignals(fleet, sparklines);
    const microCount = signals.filter(s => s.isMicroCap).length;
    expect(microCount).toBeGreaterThan(0);
    expect(microCount).toBeLessThanOrEqual(Math.ceil(signals.length * 0.4));
  });

  it("empty input → empty output", () => {
    expect(processSignals([], {})).toEqual([]);
  });

  it("filters out null netuids", () => {
    const withNull = [makeRaw({ netuid: null as any }), makeRaw({ netuid: 1 })];
    const signals = processSignals(withNull, {});
    expect(signals).toHaveLength(1);
  });

  it("reasons array is populated (max 4)", () => {
    const signals = processSignals(fleet, sparklines);
    for (const s of signals) {
      expect(s.reasons.length).toBeLessThanOrEqual(4);
      if (!s.isOverridden) {
        expect(s.reasons.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("full pipeline → Smart Capital", () => {
  const fleet = buildFleet();

  it("computeSmartCapital returns valid state for fleet", () => {
    const sc = computeSmartCapital(fleet);
    expect(["ACCUMULATION", "STABLE", "DISTRIBUTION"]).toContain(sc.state);
    expect(sc.score).toBeGreaterThanOrEqual(0);
    expect(sc.score).toBeLessThanOrEqual(100);
  });

  it("computeDualCore selects structure + sniper subnets", () => {
    const signals = processSignals(fleet, {});
    const sc = computeSmartCapital(fleet);
    const dc = computeDualCore(signals, sc);
    expect(dc.structurePct + dc.sniperPct).toBe(100);
    expect(dc.structureNetuids.length).toBeLessThanOrEqual(4);
    expect(dc.sniperNetuids.length).toBeLessThanOrEqual(3);
  });
});

describe("full pipeline → Global aggregates", () => {
  const fleet = buildFleet();

  it("global PSI weighted toward high values", () => {
    const gPsi = computeGlobalPsi(fleet);
    expect(gPsi).toBeGreaterThan(0);
    expect(gPsi).toBeLessThanOrEqual(100);
    // Weighted by squared → should be above simple average
    const simpleAvg = fleet.reduce((a, s) => a + (s.mpi ?? 0), 0) / fleet.length;
    expect(gPsi).toBeGreaterThanOrEqual(Math.round(simpleAvg));
  });

  it("global confidence is average", () => {
    const gc = computeGlobalConfidence(fleet);
    expect(gc).toBeGreaterThan(0);
    expect(gc).toBeLessThanOrEqual(100);
  });

  it("global opportunity and risk are in range", () => {
    const go = computeGlobalOpportunity(fleet);
    const gr = computeGlobalRisk(fleet);
    expect(go).toBeGreaterThanOrEqual(0);
    expect(go).toBeLessThanOrEqual(100);
    expect(gr).toBeGreaterThanOrEqual(0);
    expect(gr).toBeLessThanOrEqual(100);
  });
});

describe("full pipeline → Micro-cap & Pre-hype", () => {
  it("computeASMicro integrates with processSignals output", () => {
    const fleet = buildFleet();
    const signals = processSignals(fleet, {});
    const sc = computeSmartCapital(fleet);
    for (const s of signals) {
      const asMicro = computeASMicro(s, sc.state, "stable", "stable");
      expect(asMicro).toBeGreaterThanOrEqual(-100);
      expect(asMicro).toBeLessThanOrEqual(100);
    }
  });

  it("detectPreHype integrates with processSignals output", () => {
    const fleet = buildFleet();
    const signals = processSignals(fleet, {});
    for (const s of signals) {
      const ph = detectPreHype(s, "ACCUMULATION", "up", "up");
      expect(typeof ph.active).toBe("boolean");
      expect(ph.intensity).toBeGreaterThanOrEqual(0);
      expect(ph.intensity).toBeLessThanOrEqual(100);
    }
  });

  it("saturation index from real pipeline output", () => {
    const fleet = buildFleet();
    const signals = processSignals(fleet, {});
    const sat = computeSaturationIndex(signals);
    expect(sat).toBeGreaterThanOrEqual(0);
    expect(sat).toBeLessThanOrEqual(100);
  });
});

describe("pipeline coherence checks", () => {
  it("overridden signals have opportunity = 0", () => {
    const fleet = buildFleet();
    const signals = processSignals(fleet, {});
    const overridden = signals.filter(s => s.isOverridden);
    for (const s of overridden) {
      expect(s.opportunity).toBe(0);
    }
  });

  it("no signal has both risk=0 and opportunity=0 (unless BREAK/EXIT)", () => {
    const fleet = buildFleet();
    const signals = processSignals(fleet, {});
    for (const s of signals) {
      if (s.risk === 0 && s.opportunity === 0) {
        // Only acceptable for broken/exit states
        expect(s.state).toBe("EXIT");
      }
    }
  });

  it("dominant field is coherent with risk/opportunity gap", () => {
    const fleet = buildFleet();
    const signals = processSignals(fleet, {});
    for (const s of signals) {
      if (s.isOverridden) {
        expect(s.dominant).toBe("risk");
      } else if (s.opportunity > s.risk + 15) {
        expect(s.dominant).toBe("opportunity");
      } else if (s.risk > s.opportunity + 15) {
        expect(s.dominant).toBe("risk");
      } else {
        expect(s.dominant).toBe("neutral");
      }
    }
  });
});
