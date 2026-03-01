import { describe, it, expect } from "vitest";
import {
  evaluateKillSwitch,
  shouldSendPush,
  DEFAULT_KILL_SWITCH_CONFIG,
  type KillSwitchInput,
} from "@/lib/push-kill-switch";
import type { DataConfidenceScore } from "@/lib/data-confidence";
import type { FleetDistributionReport } from "@/lib/distribution-monitor";

function makeConfidence(score: number, errorRate = 100): DataConfidenceScore {
  return {
    score,
    components: { errorRate, latency: 90, freshness: 90, completeness: 90, varianceHealth: 90 },
    isUnstable: score < 40,
    reasons: [],
  };
}

function makeFleet(killSwitchActive: boolean, reasons: string[] = []): FleetDistributionReport {
  const base = {
    metric: "PSI", n: 30, mean: 50, std: 20, p10: 15, p50: 50, p90: 85,
    pctAbove85: 10, pctBelow15: 10,
    isCompressed: false, isExtremeHigh: false, isExtremeLow: false, isUnstable: false,
  };
  return {
    psi: base,
    risk: { ...base, metric: "Risk" },
    isFleetUnstable: killSwitchActive,
    killSwitchActive,
    reasons,
  };
}

function makeInput(overrides: Partial<KillSwitchInput> = {}): KillSwitchInput {
  return {
    dataConfidence: makeConfidence(90),
    fleetDistribution: makeFleet(false),
    criticalCount: 2,
    totalSubnets: 30,
    criticalSurgeStartedAt: null,
    ...overrides,
  };
}

describe("evaluateKillSwitch", () => {
  it("returns inactive when all healthy", () => {
    const result = evaluateKillSwitch(makeInput());
    expect(result.active).toBe(false);
    expect(result.triggers).toHaveLength(0);
  });

  it("triggers DATA_CONFIDENCE_LOW when score < 80", () => {
    const result = evaluateKillSwitch(makeInput({
      dataConfidence: makeConfidence(65),
    }));
    expect(result.active).toBe(true);
    expect(result.triggers).toContain("DATA_CONFIDENCE_LOW");
  });

  it("does not trigger at exactly 80", () => {
    const result = evaluateKillSwitch(makeInput({
      dataConfidence: makeConfidence(80),
    }));
    expect(result.triggers).not.toContain("DATA_CONFIDENCE_LOW");
  });

  it("triggers DISTRIBUTION_UNSTABLE when fleet killSwitch active", () => {
    const result = evaluateKillSwitch(makeInput({
      fleetDistribution: makeFleet(true, ["PSI compressé"]),
    }));
    expect(result.active).toBe(true);
    expect(result.triggers).toContain("DISTRIBUTION_UNSTABLE");
  });

  it("triggers CRITICAL_SURGE when >30% subnets critical", () => {
    const result = evaluateKillSwitch(makeInput({
      criticalCount: 12,
      totalSubnets: 30,
      criticalSurgeStartedAt: Date.now() - 5 * 60 * 1000,
    }));
    expect(result.active).toBe(true);
    expect(result.triggers).toContain("CRITICAL_SURGE");
  });

  it("does not trigger CRITICAL_SURGE at 25%", () => {
    const result = evaluateKillSwitch(makeInput({
      criticalCount: 7,
      totalSubnets: 30,
      criticalSurgeStartedAt: Date.now(),
    }));
    expect(result.triggers).not.toContain("CRITICAL_SURGE");
  });

  it("triggers CRITICAL_SURGE even without start time (first detection)", () => {
    const result = evaluateKillSwitch(makeInput({
      criticalCount: 10,
      totalSubnets: 30,
      criticalSurgeStartedAt: null,
    }));
    expect(result.triggers).toContain("CRITICAL_SURGE");
  });

  it("triggers API_ERRORS_HIGH when errorRate component < 50", () => {
    const result = evaluateKillSwitch(makeInput({
      dataConfidence: makeConfidence(85, 30),
    }));
    expect(result.active).toBe(true);
    expect(result.triggers).toContain("API_ERRORS_HIGH");
  });

  it("can fire multiple triggers simultaneously", () => {
    const result = evaluateKillSwitch(makeInput({
      dataConfidence: makeConfidence(35, 20),
      fleetDistribution: makeFleet(true, ["Risk extrême"]),
      criticalCount: 15,
      totalSubnets: 30,
      criticalSurgeStartedAt: Date.now() - 1000,
    }));
    expect(result.active).toBe(true);
    expect(result.triggers.length).toBeGreaterThanOrEqual(3);
  });

  it("handles null dataConfidence gracefully", () => {
    const result = evaluateKillSwitch(makeInput({
      dataConfidence: null,
    }));
    expect(result.triggers).not.toContain("DATA_CONFIDENCE_LOW");
    expect(result.triggers).not.toContain("API_ERRORS_HIGH");
  });

  it("handles null fleetDistribution gracefully", () => {
    const result = evaluateKillSwitch(makeInput({
      fleetDistribution: null,
    }));
    expect(result.triggers).not.toContain("DISTRIBUTION_UNSTABLE");
  });
});

describe("shouldSendPush", () => {
  const activeSwitch = evaluateKillSwitch(makeInput({
    dataConfidence: makeConfidence(30),
    fleetDistribution: makeFleet(true),
  }));

  const inactiveSwitch = evaluateKillSwitch(makeInput());

  it("allows everything when kill switch inactive", () => {
    expect(shouldSendPush("GO", inactiveSwitch)).toBe(true);
    expect(shouldSendPush("BREAK", inactiveSwitch)).toBe(true);
    expect(shouldSendPush("RISK_OVERRIDE", inactiveSwitch)).toBe(true);
    expect(shouldSendPush("DEPEG_CONFIRMED", inactiveSwitch)).toBe(true);
  });

  it("blocks non-critical events when active", () => {
    expect(shouldSendPush("GO", activeSwitch)).toBe(false);
    expect(shouldSendPush("GO_SPECULATIVE", activeSwitch)).toBe(false);
    expect(shouldSendPush("EARLY", activeSwitch)).toBe(false);
    expect(shouldSendPush("BREAK", activeSwitch)).toBe(false);
    expect(shouldSendPush("EXIT_FAST", activeSwitch)).toBe(false);
    expect(shouldSendPush("RISK_OVERRIDE", activeSwitch)).toBe(false);
  });

  it("allows DEPEG_CONFIRMED when active", () => {
    expect(shouldSendPush("DEPEG_CONFIRMED", activeSwitch)).toBe(true);
  });

  it("allows DATA_UNSTABLE when active", () => {
    expect(shouldSendPush("DATA_UNSTABLE", activeSwitch)).toBe(true);
  });
});
