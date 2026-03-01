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

  it("applies critical state override (risk≥70, opp≤30)", () => {
    for (const state of ["DEPEG", "DEREGISTERING", "BREAK", "EXIT_FAST"]) {
      const r = calibrateScores({ risk: 20, opportunity: 80, state });
      expect(r.risk).toBeGreaterThanOrEqual(70);
      expect(r.opportunity).toBeLessThanOrEqual(30);
    }
  });

  it("applies override when isOverridden=true", () => {
    const r = calibrateScores({ risk: 10, opportunity: 90, state: "OK", isOverridden: true });
    expect(r.risk).toBeGreaterThanOrEqual(70);
    expect(r.opportunity).toBeLessThanOrEqual(30);
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

  it("critical + topRank: critical floor dominates", () => {
    const r = calibrateScores({ risk: 10, opportunity: 90, state: "DEPEG", isTopRank: true });
    expect(r.risk).toBe(70);
  });
});
