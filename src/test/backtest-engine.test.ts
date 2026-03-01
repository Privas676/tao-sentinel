import { describe, it, expect } from "vitest";
import { runBacktest, type PipelineSnapshot, type HistoricalEvent } from "@/lib/backtest-engine";

function makeSnapshot(ts: string, subnets: { netuid: number; state: string }[]): PipelineSnapshot {
  return {
    ts,
    snapshot: subnets.map((s) => ({
      netuid: s.netuid,
      price: 1, price_5m: 1, price_1h: 1,
      liq: 100, liq_1h: 100,
      miners: 10, miners_delta: 0,
      price_max_7d: 1,
      mpi_raw: 50, M: 50, A: 50, L: 50, B: 0, Q: 50,
      mpi: 50, quality: 50, confidence: 50,
      state: s.state,
      gating_fail: false, breakout: false,
    })),
    subnet_count: subnets.length,
    engine_version: "v4",
  };
}

function makeEvent(ts: string, netuid: number, type: string, severity = 2): HistoricalEvent {
  return { ts, netuid, type, severity };
}

describe("backtest-engine", () => {
  it("returns empty result for no snapshots", () => {
    const r = runBacktest([], []);
    expect(r.tickCount).toBe(0);
    expect(r.falsePositiveRate).toBe(0);
  });

  it("counts ticks and subnets correctly", () => {
    const snaps = [
      makeSnapshot("2026-01-01T00:00:00Z", [{ netuid: 1, state: "HOLD" }, { netuid: 2, state: "WATCH" }]),
      makeSnapshot("2026-01-01T00:05:00Z", [{ netuid: 1, state: "HOLD" }, { netuid: 2, state: "WATCH" }]),
    ];
    const r = runBacktest(snaps, []);
    expect(r.tickCount).toBe(2);
    expect(r.subnetCount).toBe(2);
  });

  it("detects false positives (GO alert without confirming event)", () => {
    const snaps = [
      makeSnapshot("2026-01-01T00:00:00Z", [{ netuid: 1, state: "HOLD" }]),
      makeSnapshot("2026-01-01T00:05:00Z", [{ netuid: 1, state: "GO" }]),
      makeSnapshot("2026-01-01T00:10:00Z", [{ netuid: 1, state: "HOLD" }]),
    ];
    const r = runBacktest(snaps, []);
    expect(r.details.totalAlerts).toBe(1);
    expect(r.details.unconfirmedAlerts).toBe(1);
    expect(r.falsePositiveRate).toBe(100);
  });

  it("confirms alert when matching event exists", () => {
    const snaps = [
      makeSnapshot("2026-01-01T00:00:00Z", [{ netuid: 1, state: "HOLD" }]),
      makeSnapshot("2026-01-01T00:05:00Z", [{ netuid: 1, state: "GO" }]),
    ];
    const events = [makeEvent("2026-01-01T00:10:00Z", 1, "GO")];
    const r = runBacktest(snaps, events);
    expect(r.details.confirmedAlerts).toBe(1);
    expect(r.falsePositiveRate).toBe(0);
  });

  it("detects false negatives (critical event without prior alert)", () => {
    const snaps = [
      makeSnapshot("2026-01-01T00:00:00Z", [{ netuid: 1, state: "HOLD" }]),
      makeSnapshot("2026-01-01T00:05:00Z", [{ netuid: 1, state: "HOLD" }]),
    ];
    const events = [makeEvent("2026-01-01T00:05:00Z", 1, "BREAK", 3)];
    const r = runBacktest(snaps, events);
    expect(r.details.eventsMissed).toBe(1);
    expect(r.falseNegativeRate).toBe(100);
  });

  it("computes detection delay", () => {
    const snaps = [
      makeSnapshot("2026-01-01T00:00:00Z", [{ netuid: 1, state: "HOLD" }]),
      makeSnapshot("2026-01-01T00:05:00Z", [{ netuid: 1, state: "GO" }]),
    ];
    // Alert at 00:05, critical event at 00:15 → 10 min delay
    const events = [makeEvent("2026-01-01T00:15:00Z", 1, "BREAK", 3)];
    const r = runBacktest(snaps, events);
    expect(r.avgDetectionDelayMin).toBe(10);
  });

  it("computes flapping rate", () => {
    // 3 ticks, 1 subnet, state changes: HOLD→GO→HOLD = 2 changes
    const snaps = [
      makeSnapshot("2026-01-01T00:00:00Z", [{ netuid: 1, state: "HOLD" }]),
      makeSnapshot("2026-01-01T01:00:00Z", [{ netuid: 1, state: "GO" }]),
      makeSnapshot("2026-01-01T02:00:00Z", [{ netuid: 1, state: "HOLD" }]),
    ];
    const r = runBacktest(snaps, []);
    // 2 changes over 2 subnet-hours = 1.0/h
    expect(r.flappingRate).toBe(1);
  });

  it("handles multiple subnets independently", () => {
    const snaps = [
      makeSnapshot("2026-01-01T00:00:00Z", [
        { netuid: 1, state: "HOLD" },
        { netuid: 2, state: "HOLD" },
      ]),
      makeSnapshot("2026-01-01T00:05:00Z", [
        { netuid: 1, state: "GO" },
        { netuid: 2, state: "EARLY" },
      ]),
    ];
    const events = [makeEvent("2026-01-01T00:10:00Z", 1, "GO")];
    const r = runBacktest(snaps, events);
    expect(r.details.totalAlerts).toBe(2);
    expect(r.details.confirmedAlerts).toBe(1);
    expect(r.details.unconfirmedAlerts).toBe(1);
  });

  it("does not count non-alert states as alerts", () => {
    const snaps = [
      makeSnapshot("2026-01-01T00:00:00Z", [{ netuid: 1, state: "HOLD" }]),
      makeSnapshot("2026-01-01T00:05:00Z", [{ netuid: 1, state: "WATCH" }]),
      makeSnapshot("2026-01-01T00:10:00Z", [{ netuid: 1, state: "BREAK" }]),
    ];
    const r = runBacktest(snaps, []);
    expect(r.details.totalAlerts).toBe(0);
  });
});
