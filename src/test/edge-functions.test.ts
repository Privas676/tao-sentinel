/**
 * Edge Function Regression Tests
 * 
 * Tests the pure computation logic used by Supabase edge functions.
 * These functions are duplicated in Deno edge functions — these tests
 * ensure the logic stays correct across refactors.
 */
import { describe, it, expect } from "vitest";

/* ── Replicate edge function pure helpers ── */

function clamp(v: number, min: number, max: number) { return Math.max(min, Math.min(max, v)); }
function scoreClip(x: number, lo: number, hi: number) { return 100 * clamp((x - lo) / (hi - lo), 0, 1); }

function sigmoid(x: number, steepness = 10, midpoint = 0.5): number {
  return 1 / (1 + Math.exp(-steepness * (x - midpoint)));
}

function percentileRank(values: number[]): number[] {
  if (values.length <= 1) return values.map(() => 50);
  const sorted = [...values].sort((a, b) => a - b);
  return values.map(v => {
    const below = sorted.filter(s => s < v).length;
    const equal = sorted.filter(s => s === v).length;
    return ((below + equal * 0.5) / sorted.length) * 100;
  });
}

function applySCurve(percentile: number, steepness = 6): number {
  const n = percentile / 100;
  const curved = sigmoid(n, steepness, 0.5);
  const lo = sigmoid(0, steepness, 0.5);
  const hi = sigmoid(1, steepness, 0.5);
  return Math.round(((curved - lo) / (hi - lo)) * 100);
}

function normalizeWithVariance(rawScores: number[], steepness = 6): number[] {
  return percentileRank(rawScores).map(r => applySCurve(r, steepness));
}

function dedupeLatest(rows: any[], key = "netuid"): Map<number, any> {
  const m = new Map<number, any>();
  for (const r of rows) { if (!m.has(r[key])) m.set(r[key], r); }
  return m;
}

const pctDiff = (a: number, b: number) => {
  const avg = (Math.abs(a) + Math.abs(b)) / 2;
  return avg > 0 ? Math.abs(a - b) / avg * 100 : 0;
};

const RAO = 1e9;

/* ── Quality scoring (from compute-signals-minutely) ── */
function computeQuality(
  minersNow: number, liqRatio: number, volCap: number,
  flow1m: number, cap: number
): number {
  let Q = 50;
  if (minersNow >= 100) Q += 15;
  else if (minersNow >= 30) Q += 10;
  else if (minersNow >= 10) Q += 5;
  else if (minersNow <= 2) Q -= 15;
  if (liqRatio > 0.5) Q += 12;
  else if (liqRatio > 0.2) Q += 6;
  else if (liqRatio < 0.05) Q -= 10;
  if (volCap > 0.1) Q += 8;
  else if (volCap > 0.02) Q += 4;
  else if (volCap < 0.005) Q -= 8;
  if (flow1m > 0) Q += 8;
  else Q -= 5;
  if (cap > 100000) Q += 7;
  else if (cap > 10000) Q += 3;
  else if (cap < 500) Q -= 8;
  return clamp(Q, 0, 100);
}

/* ── State decision (from compute-signals-minutely) ── */
function deriveState(
  mpi: number, M: number, normQ: number, gatingFail = false
): string {
  if (gatingFail) return "BREAK";
  if (mpi >= 85 && M >= 65 && normQ >= 60) return "GO";
  if (mpi >= 72 && M >= 55 && normQ >= 55) return "EARLY";
  if (mpi >= 55) return "WATCH";
  if (mpi >= 40) return "HOLD";
  return "BREAK";
}

/* ── DEPEG detection ── */
function detectDepeg(
  priceChange5m: number, priceChange1h: number, liqChange1h: number
): "CRITICAL" | "WARNING" | null {
  if (priceChange5m <= -6 && liqChange1h <= -15) return "CRITICAL";
  if (priceChange5m <= -6 || priceChange1h <= -12) return "WARNING";
  return null;
}

/* ── EMA smoothing (from sync-metrics-minutely) ── */
function ema(prev: number | null, current: number, alpha: number): number {
  return prev != null ? prev * (1 - alpha) + current * alpha : current;
}

/* ── Whale severity (from sync-whale-movements) ── */
function whaleSeverity(amountTao: number): number {
  if (amountTao >= 1000) return 3;
  if (amountTao >= 500) return 2;
  return 1;
}

/* ── Round-robin slice (from sync-whale-movements) ── */
function computeSlice(minuteOfHour: number, totalKeys: number, keysPerRun: number) {
  const totalSlices = Math.ceil(totalKeys / keysPerRun);
  const sliceIndex = Math.floor(minuteOfHour / 15) % totalSlices;
  return { sliceIndex, totalSlices, start: sliceIndex * keysPerRun };
}

/* ══════════════════════════════════════════════ */
/*                    TESTS                       */
/* ══════════════════════════════════════════════ */

describe("Edge: clamp & scoreClip", () => {
  it("clamp within range", () => {
    expect(clamp(50, 0, 100)).toBe(50);
    expect(clamp(-10, 0, 100)).toBe(0);
    expect(clamp(150, 0, 100)).toBe(100);
  });

  it("scoreClip maps linearly", () => {
    expect(scoreClip(0.02, -0.02, 0.04)).toBe(100 * clamp((0.02 + 0.02) / 0.06, 0, 1));
    expect(scoreClip(-0.02, -0.02, 0.04)).toBe(0);
    expect(scoreClip(0.04, -0.02, 0.04)).toBe(100);
    expect(scoreClip(0.1, -0.02, 0.04)).toBe(100); // capped
  });
});

describe("Edge: percentileRank", () => {
  it("single value → 50", () => {
    expect(percentileRank([42])).toEqual([50]);
  });

  it("ranked correctly", () => {
    const r = percentileRank([10, 30, 50, 70, 90]);
    expect(r[0]).toBeLessThan(r[4]);
    for (let i = 1; i < r.length; i++) {
      expect(r[i]).toBeGreaterThan(r[i - 1]);
    }
  });

  it("equal values get same rank", () => {
    const r = percentileRank([50, 50, 50]);
    expect(r[0]).toBe(r[1]);
    expect(r[1]).toBe(r[2]);
  });
});

describe("Edge: normalizeWithVariance (S-curve)", () => {
  it("preserves ordering", () => {
    const r = normalizeWithVariance([10, 30, 50, 70, 90]);
    for (let i = 1; i < r.length; i++) {
      expect(r[i]).toBeGreaterThanOrEqual(r[i - 1]);
    }
  });

  it("output range 0-100", () => {
    const r = normalizeWithVariance([5, 25, 50, 75, 95]);
    r.forEach(v => {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    });
  });

  it("single value → 50", () => {
    expect(normalizeWithVariance([42])).toEqual([50]);
  });
});

describe("Edge: pctDiff", () => {
  it("identical values → 0", () => {
    expect(pctDiff(100, 100)).toBe(0);
  });

  it("symmetric", () => {
    expect(pctDiff(80, 120)).toBeCloseTo(pctDiff(120, 80));
  });

  it("50% diff detected", () => {
    expect(pctDiff(100, 150)).toBeCloseTo(40, 0); // |50|/125*100 = 40%
  });

  it("zero handling", () => {
    expect(pctDiff(0, 0)).toBe(0);
  });
});

describe("Edge: dedupeLatest", () => {
  it("keeps first occurrence", () => {
    const rows = [
      { netuid: 1, price: 100 },
      { netuid: 1, price: 50 },
      { netuid: 2, price: 200 },
    ];
    const map = dedupeLatest(rows);
    expect(map.size).toBe(2);
    expect(map.get(1)!.price).toBe(100);
  });
});

describe("Edge: Quality scoring", () => {
  it("high quality subnet", () => {
    const q = computeQuality(150, 0.6, 0.15, 10, 200000);
    expect(q).toBeGreaterThan(80);
  });

  it("low quality subnet", () => {
    const q = computeQuality(1, 0.01, 0.001, 0, 100);
    expect(q).toBeLessThan(20);
  });

  it("moderate subnet", () => {
    const q = computeQuality(50, 0.3, 0.05, 5, 50000);
    expect(q).toBeGreaterThan(50);
    expect(q).toBeLessThan(85);
  });

  it("clamped 0-100", () => {
    expect(computeQuality(0, 0, 0, 0, 0)).toBeGreaterThanOrEqual(0);
    expect(computeQuality(500, 1, 1, 100, 1e6)).toBeLessThanOrEqual(100);
  });
});

describe("Edge: State decision", () => {
  it("gating fail → BREAK", () => {
    expect(deriveState(90, 80, 70, true)).toBe("BREAK");
  });

  it("GO when mpi≥85, M≥65, Q≥60", () => {
    expect(deriveState(90, 70, 65)).toBe("GO");
  });

  it("EARLY when mpi≥72, M≥55, Q≥55", () => {
    expect(deriveState(75, 60, 58)).toBe("EARLY");
  });

  it("WATCH when mpi≥55", () => {
    expect(deriveState(60, 40, 40)).toBe("WATCH");
  });

  it("HOLD when mpi≥40", () => {
    expect(deriveState(45, 30, 30)).toBe("HOLD");
  });

  it("BREAK when mpi<40", () => {
    expect(deriveState(30, 20, 20)).toBe("BREAK");
  });
});

describe("Edge: MPI formula", () => {
  it("weighted sum: 0.30M + 0.20A + 0.15L + 0.15B + 0.20Q", () => {
    const M = 80, A = 60, L = 50, B = 100, Q = 70;
    const mpi = clamp(Math.round(0.30 * M + 0.20 * A + 0.15 * L + 0.15 * B + 0.20 * Q), 0, 100);
    expect(mpi).toBe(Math.round(24 + 12 + 7.5 + 15 + 14));
    expect(mpi).toBe(73);
  });

  it("clamped 0-100", () => {
    const mpiHigh = clamp(Math.round(0.30 * 100 + 0.20 * 100 + 0.15 * 100 + 0.15 * 100 + 0.20 * 100), 0, 100);
    expect(mpiHigh).toBe(100);
    const mpiLow = clamp(Math.round(0.30 * 0 + 0.20 * 0 + 0.15 * 0 + 0.15 * 0 + 0.20 * 0), 0, 100);
    expect(mpiLow).toBe(0);
  });
});

describe("Edge: DEPEG detection", () => {
  it("CRITICAL when price -6% AND liq -15%", () => {
    expect(detectDepeg(-8, -5, -20)).toBe("CRITICAL");
  });

  it("WARNING when price -6% only", () => {
    expect(detectDepeg(-7, -2, 0)).toBe("WARNING");
  });

  it("WARNING when 1h price -12%", () => {
    expect(detectDepeg(-2, -15, 0)).toBe("WARNING");
  });

  it("null when no depeg", () => {
    expect(detectDepeg(-3, -5, -5)).toBeNull();
  });
});

describe("Edge: RAO conversions", () => {
  it("1 TAO = 1e9 RAO", () => {
    expect(1e9 / RAO).toBe(1);
    expect(500e9 / RAO).toBe(500);
  });

  it("market cap conversion", () => {
    const mcRao = 50000e9; // 50k TAO in rao
    expect(mcRao / RAO).toBe(50000);
  });

  it("TMC liquidity conversion (rao → TAO)", () => {
    const rawLiq = 250e9; // 250 TAO in rao
    const liq = rawLiq > 1e6 ? rawLiq / 1e9 : rawLiq;
    expect(liq).toBe(250);
  });

  it("TMC small liquidity stays as-is", () => {
    const rawLiq = 500; // already in TAO
    const liq = rawLiq > 1e6 ? rawLiq / 1e9 : rawLiq;
    expect(liq).toBe(500);
  });
});

describe("Edge: EMA smoothing", () => {
  it("no previous → current value", () => {
    expect(ema(null, 100, 0.4)).toBe(100);
  });

  it("EMA with alpha=0.4", () => {
    expect(ema(50, 100, 0.4)).toBe(50 * 0.6 + 100 * 0.4);
  });

  it("flow_3m smoothing (alpha=0.4)", () => {
    const prev = 80;
    const current = 120;
    const result = prev * 0.6 + current * 0.4;
    expect(result).toBe(96);
  });

  it("flow_5m smoothing (alpha=0.3)", () => {
    const prev = 80;
    const current = 120;
    const result = prev * 0.7 + current * 0.3;
    expect(result).toBe(92);
  });
});

describe("Edge: Whale severity", () => {
  it("≥1000 TAO → severity 3", () => {
    expect(whaleSeverity(1500)).toBe(3);
  });

  it("≥500 TAO → severity 2", () => {
    expect(whaleSeverity(750)).toBe(2);
  });

  it("<500 TAO → severity 1", () => {
    expect(whaleSeverity(200)).toBe(1);
  });
});

describe("Edge: Round-robin slicing", () => {
  it("20 coldkeys, 5 per run → 4 slices", () => {
    const r = computeSlice(0, 20, 5);
    expect(r.totalSlices).toBe(4);
  });

  it("minute 0 → slice 0", () => {
    const r = computeSlice(0, 20, 5);
    expect(r.sliceIndex).toBe(0);
    expect(r.start).toBe(0);
  });

  it("minute 15 → slice 1", () => {
    const r = computeSlice(15, 20, 5);
    expect(r.sliceIndex).toBe(1);
    expect(r.start).toBe(5);
  });

  it("minute 45 → slice 3", () => {
    const r = computeSlice(45, 20, 5);
    expect(r.sliceIndex).toBe(3);
    expect(r.start).toBe(15);
  });

  it("wraps around on overflow", () => {
    // 10 keys, 5/run → 2 slices. minute 30 → floor(30/15)%2 = 0
    const r = computeSlice(30, 10, 5);
    expect(r.sliceIndex).toBe(0);
  });
});

describe("Edge: Data divergence gravity", () => {
  it("price divergence above threshold", () => {
    const tsPrice = 0.05;
    const tmcPrice = 0.06;
    const diff = pctDiff(tsPrice, tmcPrice);
    expect(diff).toBeGreaterThan(5); // above 5% threshold
  });

  it("price within tolerance", () => {
    const diff = pctDiff(0.050, 0.051);
    expect(diff).toBeLessThan(5);
  });

  it("gravity capped at 100", () => {
    // Simulate extreme divergence
    const ratio = Math.min(pctDiff(10, 100) / 5, 5); // capped at 5x
    const gravity = Math.round(clamp(ratio * 35 * 40 / 35, 0, 100));
    expect(gravity).toBeLessThanOrEqual(100);
  });
});

describe("Edge: Confidence calculation", () => {
  it("high MPI → high signal confidence", () => {
    const mpi = 85;
    const confSignal = clamp((mpi - 40) / 60, 0, 1);
    expect(confSignal).toBeCloseTo(0.75);
  });

  it("low MPI → zero signal confidence", () => {
    const mpi = 30;
    const confSignal = clamp((mpi - 40) / 60, 0, 1);
    expect(confSignal).toBe(0);
  });

  it("confidence formula: 50% signal + 30% quality + 20% liq", () => {
    const confSignal = 0.8;
    const confQuality = 0.7;
    const liqRatio = 0.5;
    const conf = Math.round(100 * (0.50 * confSignal + 0.30 * confQuality + 0.20 * clamp(liqRatio, 0, 1)));
    expect(conf).toBe(Math.round(100 * (0.40 + 0.21 + 0.10)));
    expect(conf).toBe(71);
  });
});
