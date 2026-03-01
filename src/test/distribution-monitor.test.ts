import { describe, it, expect } from "vitest";
import {
  analyzeDistribution,
  normalizeZScore,
  normalizePsiFleet,
  normalizeRiskFleet,
  monitorFleetDistribution,
} from "@/lib/distribution-monitor";

describe("distribution-monitor", () => {
  describe("analyzeDistribution", () => {
    it("returns empty report for no values", () => {
      const report = analyzeDistribution([], "PSI");
      expect(report.n).toBe(0);
      expect(report.isUnstable).toBe(false);
    });

    it("detects compressed distribution (low std)", () => {
      // All values clustered around 70
      const values = Array.from({ length: 20 }, () => 70 + Math.random() * 3);
      const report = analyzeDistribution(values, "PSI");
      expect(report.isCompressed).toBe(true);
      expect(report.isUnstable).toBe(true);
    });

    it("detects extreme high distribution", () => {
      // >50% above 85
      const values = Array.from({ length: 20 }, (_, i) => i < 12 ? 90 : 40);
      const report = analyzeDistribution(values, "Risk");
      expect(report.isExtremeHigh).toBe(true);
      expect(report.pctAbove85).toBeGreaterThanOrEqual(50);
    });

    it("detects extreme low distribution", () => {
      const values = Array.from({ length: 20 }, (_, i) => i < 12 ? 10 : 60);
      const report = analyzeDistribution(values, "PSI");
      expect(report.isExtremeLow).toBe(true);
    });

    it("reports healthy distribution as stable", () => {
      // Well spread values
      const values = [10, 20, 30, 40, 50, 60, 70, 80, 90, 95];
      const report = analyzeDistribution(values, "PSI");
      expect(report.isCompressed).toBe(false);
      expect(report.isExtremeHigh).toBe(false);
      expect(report.isExtremeLow).toBe(false);
      expect(report.isUnstable).toBe(false);
    });

    it("computes percentiles correctly", () => {
      const values = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
      const report = analyzeDistribution(values, "test");
      expect(report.p50).toBeCloseTo(55, 0);
      expect(report.p10).toBeCloseTo(19, 0);
      expect(report.p90).toBeCloseTo(91, 0);
    });

    it("does not flag small samples (n<5)", () => {
      const values = [90, 90, 90]; // would be compressed but n<5
      const report = analyzeDistribution(values, "PSI");
      expect(report.isCompressed).toBe(false);
    });
  });

  describe("normalizeZScore", () => {
    it("returns empty for empty input", () => {
      expect(normalizeZScore([])).toEqual([]);
    });

    it("returns 50 for single value", () => {
      expect(normalizeZScore([75])).toEqual([50]);
    });

    it("spreads clustered values", () => {
      const clustered = [70, 71, 72, 73, 74, 75, 76, 77, 78, 79];
      const result = normalizeZScore(clustered);
      // Should spread across range
      const min = Math.min(...result);
      const max = Math.max(...result);
      expect(max - min).toBeGreaterThan(20);
      // Should preserve ordering
      for (let i = 1; i < result.length; i++) {
        expect(result[i]).toBeGreaterThanOrEqual(result[i - 1]);
      }
    });

    it("handles degenerate case (all same values)", () => {
      const same = [50, 50, 50, 50, 50];
      const result = normalizeZScore(same);
      // Rank-based fallback should spread them
      expect(result.length).toBe(5);
      result.forEach(v => expect(v).toBeGreaterThanOrEqual(5));
    });

    it("respects clamp bounds", () => {
      const values = [0, 10, 50, 90, 100];
      const result = normalizeZScore(values, 10, 90);
      result.forEach(v => {
        expect(v).toBeGreaterThanOrEqual(10);
        expect(v).toBeLessThanOrEqual(90);
      });
    });
  });

  describe("normalizePsiFleet / normalizeRiskFleet", () => {
    it("normalizes PSI fleet preserving relative order", () => {
      const raw = [30, 50, 70, 80, 90, 95];
      const result = normalizePsiFleet(raw);
      expect(result.length).toBe(6);
      // Should preserve ordering
      for (let i = 1; i < result.length; i++) {
        expect(result[i]).toBeGreaterThanOrEqual(result[i - 1]);
      }
      // All values in 0-100
      result.forEach(v => {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(100);
      });
    });

    it("normalizes Risk fleet to prevent all-red", () => {
      // All-high risk scenario
      const allHigh = [75, 78, 80, 82, 85, 88, 90, 92, 95];
      const result = normalizeRiskFleet(allHigh);
      // After normalization, should have more spread
      const min = Math.min(...result);
      const max = Math.max(...result);
      expect(max - min).toBeGreaterThan(10);
      // Min should be pulled down from 75
      expect(min).toBeLessThan(75);
    });

    it("passes through small arrays unchanged", () => {
      const small = [50, 60];
      expect(normalizePsiFleet(small)).toEqual(small);
      expect(normalizeRiskFleet(small)).toEqual(small);
    });
  });

  describe("monitorFleetDistribution", () => {
    it("reports stable for well-distributed values", () => {
      const psi = [20, 35, 45, 55, 65, 75, 85];
      const risk = [15, 30, 45, 55, 65, 75, 85];
      const report = monitorFleetDistribution(psi, risk);
      expect(report.isFleetUnstable).toBe(false);
      expect(report.killSwitchActive).toBe(false);
    });

    it("activates kill switch when risk is extreme high", () => {
      const psi = [50, 55, 60, 65, 70, 75, 80];
      const risk = [86, 87, 88, 89, 90, 91, 92]; // all above 85
      const report = monitorFleetDistribution(psi, risk);
      expect(report.risk.isExtremeHigh).toBe(true);
      expect(report.killSwitchActive).toBe(true);
    });

    it("activates kill switch when both metrics unstable", () => {
      const psi = [70, 71, 72, 73, 74]; // compressed
      const risk = [80, 81, 82, 83, 84]; // compressed
      const report = monitorFleetDistribution(psi, risk);
      expect(report.psi.isCompressed).toBe(true);
      expect(report.risk.isCompressed).toBe(true);
      expect(report.killSwitchActive).toBe(true);
    });

    it("flags fleet unstable but no kill switch for single metric issue", () => {
      const psi = [70, 71, 72, 73, 74]; // compressed
      const risk = [20, 35, 50, 65, 80]; // well spread
      const report = monitorFleetDistribution(psi, risk);
      expect(report.isFleetUnstable).toBe(true);
      expect(report.killSwitchActive).toBe(false);
    });

    it("includes reasons when unstable", () => {
      const psi = [70, 71, 72, 73, 74];
      const risk = [86, 87, 88, 89, 90, 91, 92];
      const report = monitorFleetDistribution(psi, risk);
      expect(report.reasons.length).toBeGreaterThan(0);
    });
  });
});
