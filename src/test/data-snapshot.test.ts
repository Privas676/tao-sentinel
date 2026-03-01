import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createSnapshot,
  effectiveTimestamp,
  dataAgeSeconds,
  isSnapshotStale,
  checkTimeAlignment,
  wrapMapAsSnapshots,
  wrapArrayAsSnapshot,
  type DataSnapshot,
  type AlignmentStatus,
} from "@/lib/data-snapshot";

describe("createSnapshot", () => {
  it("sets fetchedAt to current time", () => {
    const before = Date.now();
    const snap = createSnapshot({ foo: 1 }, "test-source");
    const after = Date.now();
    expect(snap.fetchedAt).toBeGreaterThanOrEqual(before);
    expect(snap.fetchedAt).toBeLessThanOrEqual(after);
  });

  it("sets subnetId to null by default", () => {
    const snap = createSnapshot("data", "src");
    expect(snap.subnetId).toBeNull();
  });

  it("sets subnetId when provided", () => {
    const snap = createSnapshot("data", "src", 42);
    expect(snap.subnetId).toBe(42);
  });

  it("parses string sourceTimestamp", () => {
    const ts = "2026-03-01T12:00:00Z";
    const snap = createSnapshot("data", "src", null, ts);
    expect(snap.sourceTimestamp).toBe(new Date(ts).getTime());
  });

  it("accepts numeric sourceTimestamp", () => {
    const snap = createSnapshot("data", "src", null, 1700000000000);
    expect(snap.sourceTimestamp).toBe(1700000000000);
  });

  it("sets sourceTimestamp to null when not provided", () => {
    const snap = createSnapshot("data", "src");
    expect(snap.sourceTimestamp).toBeNull();
  });

  it("sets sourceTimestamp to null for invalid string", () => {
    const snap = createSnapshot("data", "src", null, "not-a-date");
    expect(snap.sourceTimestamp).toBeNull();
  });

  it("stores payload correctly", () => {
    const payload = { netuid: 1, price: 0.05 };
    const snap = createSnapshot(payload, "taostats");
    expect(snap.payload).toEqual(payload);
  });
});

describe("effectiveTimestamp", () => {
  it("returns sourceTimestamp when available", () => {
    const snap = createSnapshot("d", "s", null, 1700000000000);
    expect(effectiveTimestamp(snap)).toBe(1700000000000);
  });

  it("falls back to fetchedAt when sourceTimestamp is null", () => {
    const snap = createSnapshot("d", "s");
    expect(effectiveTimestamp(snap)).toBe(snap.fetchedAt);
  });
});

describe("dataAgeSeconds", () => {
  it("computes age relative to reference time", () => {
    const snap = createSnapshot("d", "s", null, 1000000);
    const age = dataAgeSeconds(snap, 1060000); // 60s later
    expect(age).toBe(60);
  });

  it("returns 0 when reference is before snapshot", () => {
    const snap = createSnapshot("d", "s", null, 2000000);
    const age = dataAgeSeconds(snap, 1000000);
    expect(age).toBe(0);
  });

  it("uses Date.now() when no reference provided", () => {
    const now = Date.now();
    const snap = createSnapshot("d", "s", null, now - 5000);
    const age = dataAgeSeconds(snap);
    expect(age).toBeGreaterThanOrEqual(4.9);
    expect(age).toBeLessThanOrEqual(6);
  });
});

describe("isSnapshotStale", () => {
  it("returns false for fresh snapshot", () => {
    const snap = createSnapshot("d", "s", null, Date.now());
    expect(isSnapshotStale(snap)).toBe(false);
  });

  it("returns true for old snapshot (>10 min)", () => {
    const snap = createSnapshot("d", "s", null, Date.now() - 700_000);
    expect(isSnapshotStale(snap)).toBe(true);
  });

  it("returns false at exactly 10 min boundary", () => {
    const now = Date.now();
    const snap = createSnapshot("d", "s", null, now - 599_000);
    expect(isSnapshotStale(snap, now)).toBe(false);
  });
});

describe("checkTimeAlignment", () => {
  function makeSnap(source: string, sourceTs: number): DataSnapshot {
    return {
      subnetId: null,
      source,
      fetchedAt: Date.now(),
      sourceTimestamp: sourceTs,
      payload: null,
    };
  }

  it("returns ALIGNED when all snapshots are close", () => {
    const now = Date.now();
    const result = checkTimeAlignment([
      makeSnap("a", now - 10_000),
      makeSnap("b", now - 15_000),
      makeSnap("c", now - 20_000),
    ], now);
    expect(result.status).toBe("ALIGNED");
    expect(result.maxDeltaMs).toBe(10_000);
  });

  it("returns STALE when inter-snapshot delta > 120s", () => {
    const now = Date.now();
    const result = checkTimeAlignment([
      makeSnap("a", now - 10_000),
      makeSnap("b", now - 200_000), // 190s apart
    ], now);
    expect(result.status).toBe("STALE");
    expect(result.maxDeltaMs).toBe(190_000);
  });

  it("returns DEGRADED when single snapshot too old but delta OK", () => {
    const now = Date.now();
    const result = checkTimeAlignment([
      makeSnap("a", now - 650_000), // 10.8 min old
      makeSnap("b", now - 640_000), // 10.6 min old — delta = 10s < 120s
    ], now);
    expect(result.status).toBe("DEGRADED");
  });

  it("returns STALE for empty array", () => {
    const result = checkTimeAlignment([]);
    expect(result.status).toBe("STALE");
  });

  it("single snapshot ALIGNED when fresh", () => {
    const now = Date.now();
    const result = checkTimeAlignment([makeSnap("a", now - 5_000)], now);
    expect(result.status).toBe("ALIGNED");
    expect(result.maxDeltaMs).toBe(0);
  });

  it("populates ages array with diagnostics", () => {
    const now = Date.now();
    const result = checkTimeAlignment([
      makeSnap("signals", now - 30_000),
      makeSnap("metrics", now - 45_000),
    ], now);
    expect(result.ages).toHaveLength(2);
    expect(result.ages[0].source).toBe("signals");
    expect(result.ages[0].dataAgeSeconds).toBeCloseTo(30, 0);
    expect(result.ages[1].source).toBe("metrics");
    expect(result.ages[1].dataAgeSeconds).toBeCloseTo(45, 0);
  });

  it("uses fetchedAt when sourceTimestamp is null", () => {
    const now = Date.now();
    const snap: DataSnapshot = {
      subnetId: null,
      source: "test",
      fetchedAt: now - 20_000,
      sourceTimestamp: null,
      payload: null,
    };
    const result = checkTimeAlignment([snap], now);
    expect(result.status).toBe("ALIGNED");
    expect(result.ages[0].effectiveTs).toBe(now - 20_000);
  });

  it("STALE takes priority over DEGRADED", () => {
    const now = Date.now();
    // One very old, AND large delta
    const result = checkTimeAlignment([
      makeSnap("a", now - 700_000),
      makeSnap("b", now - 10_000), // delta = 690s > 120s
    ], now);
    expect(result.status).toBe("STALE");
  });
});

describe("wrapMapAsSnapshots", () => {
  it("wraps each map entry as a snapshot", () => {
    const map = new Map<number, { price: number; ts: string }>([
      [1, { price: 0.05, ts: "2026-03-01T12:00:00Z" }],
      [2, { price: 0.10, ts: "2026-03-01T12:01:00Z" }],
    ]);
    const result = wrapMapAsSnapshots(map, "taostats", item => item.ts);
    expect(result.size).toBe(2);
    const s1 = result.get(1)!;
    expect(s1.source).toBe("taostats");
    expect(s1.subnetId).toBe(1);
    expect(s1.sourceTimestamp).toBe(new Date("2026-03-01T12:00:00Z").getTime());
    expect(s1.payload.price).toBe(0.05);
  });
});

describe("wrapArrayAsSnapshot", () => {
  it("wraps array data as a single snapshot", () => {
    const data = [{ netuid: 1 }, { netuid: 2 }];
    const snap = wrapArrayAsSnapshot(data, "supabase", "2026-03-01T12:00:00Z");
    expect(snap.payload).toHaveLength(2);
    expect(snap.source).toBe("supabase");
    expect(snap.subnetId).toBeNull();
    expect(snap.sourceTimestamp).toBe(new Date("2026-03-01T12:00:00Z").getTime());
  });
});
