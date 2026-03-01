import { describe, it, expect } from "vitest";
import { parseSnapshots, analyzeScoreVolatility } from "@/lib/score-volatility";

const H = 3600_000;

function mkRows(entries: { netuid: number; mpi: number; quality: number }[][], startMs = 0) {
  return entries.map((snapshot, i) => ({
    ts: new Date(startMs + i * H).toISOString(),
    snapshot,
  }));
}

describe("parseSnapshots", () => {
  it("groups entries by netuid and sorts by time", () => {
    const rows = mkRows([
      [{ netuid: 1, mpi: 50, quality: 80 }],
      [{ netuid: 1, mpi: 60, quality: 70 }],
    ]);
    const map = parseSnapshots(rows);
    expect(map.size).toBe(1);
    const series = map.get(1)!;
    expect(series).toHaveLength(2);
    expect(series[0].psi).toBe(50);
    expect(series[1].psi).toBe(60);
    expect(series[0].risk).toBe(20); // 100 - 80
    expect(series[1].risk).toBe(30); // 100 - 70
  });

  it("handles empty / missing netuids gracefully", () => {
    const rows = [{ ts: new Date().toISOString(), snapshot: [{ mpi: 10 }] }];
    const map = parseSnapshots(rows);
    expect(map.size).toBe(0);
  });

  it("handles non-array snapshot", () => {
    const rows = [{ ts: new Date().toISOString(), snapshot: null as any }];
    const map = parseSnapshots(rows);
    expect(map.size).toBe(0);
  });
});

describe("analyzeScoreVolatility", () => {
  it("returns zeroed report for empty input", () => {
    const r = analyzeScoreVolatility([]);
    expect(r.subnetCount).toBe(0);
    expect(r.scoreInstability).toBe(false);
  });

  it("computes deltas for a single subnet with 1h spacing", () => {
    const rows = mkRows([
      [{ netuid: 1, mpi: 40, quality: 80 }],
      [{ netuid: 1, mpi: 70, quality: 50 }], // ΔPSI=30, ΔRisk=30
    ]);
    const r = analyzeScoreVolatility(rows);
    expect(r.subnetCount).toBe(1);
    expect(r.subnets[0].deltaPsiMax1h).toBe(30);
    expect(r.subnets[0].deltaRiskMax1h).toBe(30);
  });

  it("flags instability when threshold exceeded", () => {
    // All subnets have big swings → >20% exceed threshold
    const rows = mkRows([
      [
        { netuid: 1, mpi: 10, quality: 90 },
        { netuid: 2, mpi: 20, quality: 80 },
      ],
      [
        { netuid: 1, mpi: 60, quality: 30 }, // ΔPSI=50, ΔRisk=60
        { netuid: 2, mpi: 80, quality: 20 }, // ΔPSI=60, ΔRisk=60
      ],
    ]);
    const r = analyzeScoreVolatility(rows);
    expect(r.scoreInstability).toBe(true);
    expect(r.scoreInstabilityPsi).toBe(true);
    expect(r.scoreInstabilityRisk).toBe(true);
    expect(r.pctPsiAbove20).toBe(100);
  });

  it("no instability for stable subnets", () => {
    const rows = mkRows([
      [{ netuid: 1, mpi: 50, quality: 70 }],
      [{ netuid: 1, mpi: 52, quality: 69 }], // ΔPSI=2, ΔRisk=1
    ]);
    const r = analyzeScoreVolatility(rows);
    expect(r.scoreInstability).toBe(false);
    expect(r.pctPsiAbove20).toBe(0);
  });

  it("respects window parameter", () => {
    const r = analyzeScoreVolatility([], "7d");
    expect(r.window).toBe("7d");
  });
});
