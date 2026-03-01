import { describe, it, expect } from "vitest";
import { calibrateScores, type CalibrationInput } from "@/lib/risk-calibration";

describe("calibrateScores", () => {
  it("applies absolute floor of 15", () => {
    const r = calibrateScores({ risk: 5, opportunity: 60, state: null });
    expect(r.risk).toBe(15);
  });

  it("preserves risk above absolute floor", () => {
    const r = calibrateScores({ risk: 40, opportunity: 60, state: null });
    expect(r.risk).toBe(40);
  });

  it("applies top-rank floor of 25", () => {
    const r = calibrateScores({ risk: 10, opportunity: 60, state: null, isTopRank: true });
    expect(r.risk).toBe(25);
  });

  it("top-rank floor does not lower existing higher risk", () => {
    const r = calibrateScores({ risk: 50, opportunity: 60, state: null, isTopRank: true });
    expect(r.risk).toBe(50);
  });

  it("critical state boosts risk dynamically (not hardcoded)", () => {
    for (const state of ["DEPEG", "DEREGISTERING", "BREAK", "EXIT_FAST"]) {
      const r = calibrateScores({ risk: 20, opportunity: 80, state });
      // Dynamic: risk=20 → boosted toward 55 via proportional gap fill
      expect(r.risk).toBeGreaterThan(20);
      expect(r.risk).toBeGreaterThanOrEqual(48); // 20 + (35 * 0.8) = 48
      // Opp capped dynamically based on risk
      expect(r.opportunity).toBeLessThan(80);
    }
  });

  it("critical state with already-high risk preserves it", () => {
    const r = calibrateScores({ risk: 80, opportunity: 50, state: "DEPEG" });
    expect(r.risk).toBe(80); // Already above MIN_CRITICAL_RISK
    expect(r.opportunity).toBeLessThanOrEqual(15); // 45 - 80*0.4 = 13
  });

  it("applies override when isOverridden=true", () => {
    const r = calibrateScores({ risk: 10, opportunity: 90, state: "OK", isOverridden: true });
    // Dynamic scaling: risk boosted, opp capped
    expect(r.risk).toBeGreaterThan(10);
    expect(r.opportunity).toBeLessThan(90);
  });

  it("calculates asymmetry correctly", () => {
    const r = calibrateScores({ risk: 30, opportunity: 80, state: null });
    expect(r.asymmetry).toBe(80 - 30);
  });

  it("clamps values to 0-100", () => {
    const r = calibrateScores({ risk: 150, opportunity: -10, state: null });
    expect(r.risk).toBe(100);
    expect(r.opportunity).toBe(0);
  });

  it("critical + topRank: critical floor dominates over topRank", () => {
    const r = calibrateScores({ risk: 10, opportunity: 90, state: "DEPEG", isTopRank: true });
    // Critical dynamic floor (≥48) > topRank floor (25)
    expect(r.risk).toBeGreaterThanOrEqual(46);
    expect(r.risk).toBeGreaterThan(25);
  });
});
