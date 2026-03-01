import { describe, it, expect } from "vitest";
import { normalizeWithVariance, normalizeOpportunity } from "@/lib/gauge-normalize";

describe("normalizeWithVariance", () => {
  it("returns same length", () => {
    const r = normalizeWithVariance([10, 20, 30, 40, 50]);
    expect(r).toHaveLength(5);
  });

  it("all values 0-100", () => {
    const r = normalizeWithVariance([5, 15, 25, 50, 75, 90]);
    r.forEach(v => {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    });
  });

  it("preserves relative ordering", () => {
    const r = normalizeWithVariance([10, 30, 50, 70, 90]);
    for (let i = 1; i < r.length; i++) {
      expect(r[i]).toBeGreaterThanOrEqual(r[i - 1]);
    }
  });

  it("single value → 50", () => {
    const r = normalizeWithVariance([42]);
    expect(r).toEqual([50]);
  });

  it("two values spread apart", () => {
    const r = normalizeWithVariance([10, 90]);
    expect(r[0]).toBeLessThan(r[1]);
  });

  it("unique max can reach 100, duplicates capped at 99", () => {
    const unique = normalizeWithVariance([10, 20, 30, 40, 100]);
    expect(unique[4]).toBeLessThanOrEqual(100);

    const dupes = normalizeWithVariance([100, 100, 50]);
    dupes.filter((_, i) => [0, 1].includes(i)).forEach(v => {
      expect(v).toBeLessThanOrEqual(99);
    });
  });

  it("identical values all get 50", () => {
    const r = normalizeWithVariance([50, 50, 50]);
    r.forEach(v => expect(v).toBe(50));
  });

  it("steepness parameter affects spread", () => {
    const mild = normalizeWithVariance([10, 50, 90], 2);
    const steep = normalizeWithVariance([10, 50, 90], 8);
    const mildSpread = mild[2] - mild[0];
    const steepSpread = steep[2] - steep[0];
    expect(steepSpread).toBeGreaterThanOrEqual(mildSpread);
  });
});

describe("normalizeOpportunity", () => {
  it("returns same length", () => {
    const r = normalizeOpportunity([10, 20, 30, 40, 50]);
    expect(r).toHaveLength(5);
  });

  it("all values within anchor range (20-98)", () => {
    const r = normalizeOpportunity([5, 15, 30, 60, 80, 95]);
    r.forEach(v => {
      expect(v).toBeGreaterThanOrEqual(20);
      expect(v).toBeLessThanOrEqual(98);
    });
  });

  it("hard cap at 98 for unique max", () => {
    const r = normalizeOpportunity([10, 20, 30, 40, 100]);
    expect(Math.max(...r)).toBeLessThanOrEqual(98);
  });

  it("non-unique max capped at 97", () => {
    const r = normalizeOpportunity([10, 20, 100, 100]);
    const maxIndices = [2, 3];
    maxIndices.forEach(i => expect(r[i]).toBeLessThanOrEqual(97));
  });

  it("preserves relative ordering", () => {
    const r = normalizeOpportunity([10, 30, 50, 70, 90]);
    for (let i = 1; i < r.length; i++) {
      expect(r[i]).toBeGreaterThanOrEqual(r[i - 1]);
    }
  });

  it("single value → 50 (from percentile)", () => {
    const r = normalizeOpportunity([42]);
    expect(r[0]).toBe(65); // percentile 50 → anchor maps to 65
  });

  it("empty-ish inputs don't crash", () => {
    expect(normalizeOpportunity([])).toEqual([]);
  });
});
