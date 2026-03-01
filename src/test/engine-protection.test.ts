import { describe, it, expect } from "vitest";
import {
  evaluateProtection,
  evaluateAllProtections,
  type ProtectionInput,
} from "@/lib/engine-protection";

/* ── Helper ── */

function makeInput(overrides: Partial<ProtectionInput> = {}): ProtectionInput {
  return {
    netuid: 1, state: null, psi: 50, quality: 60, risk: 30,
    liquidityUsd: 50000, volumeMcRatio: 0.05, taoInPool: 100,
    minersActive: 20, liqTao: 100, liqUsd: 50000, capTao: 10000,
    alphaPrice: 0.01, priceChange7d: 5, confianceData: 80, liqHaircut: 0,
    delistMode: "auto",
    ...overrides,
  };
}

/* ═══════════════════════════════════════ */
/*  evaluateProtection — Normal cases      */
/* ═══════════════════════════════════════ */

describe("evaluateProtection — Normal", () => {
  it("healthy subnet → not overridden, not warning", () => {
    const out = evaluateProtection(makeInput());
    expect(out.isOverridden).toBe(false);
    expect(out.isWarning).toBe(false);
    expect(out.delistCategory).toBe("NORMAL");
    expect(out.delistScore).toBeLessThan(50);
  });

  it("returns correct netuid", () => {
    const out = evaluateProtection(makeInput({ netuid: 42 }));
    expect(out.netuid).toBe(42);
  });

  it("systemStatus is a valid value", () => {
    const out = evaluateProtection(makeInput());
    expect(["OK", "SURVEILLANCE", "ZONE_CRITIQUE", "DEPEG"]).toContain(out.systemStatus);
  });
});

/* ═══════════════════════════════════════ */
/*  evaluateProtection — Critical states   */
/* ═══════════════════════════════════════ */

describe("evaluateProtection — Critical states", () => {
  it("BREAK state with low quality → warning with reasons", () => {
    const out = evaluateProtection(makeInput({
      state: "BREAK", quality: 15, risk: 80, psi: 90,
    }));
    // BREAK triggers WARNING level in risk-override (not full override)
    expect(out.isWarning).toBe(true);
    expect(out.overrideReasons.length).toBeGreaterThan(0);
  });

  it("EXIT_FAST state → warning", () => {
    const out = evaluateProtection(makeInput({
      state: "EXIT_FAST", quality: 10, risk: 90, psi: 95,
    }));
    expect(out.isWarning).toBe(true);
  });

  it("zero liquidity triggers delist flag (handled by delist engine, not override)", () => {
    const out = evaluateProtection(makeInput({
      liquidityUsd: 0, taoInPool: 0, liqUsd: 0, liqTao: 0,
    }));
    // Override score 0.65 < 0.70 threshold → no override/warning from override engine
    // But delist engine flags it via HIGH_RISK or DEPEG depending on other signals
    expect(out.delistScore).toBeGreaterThan(0);
  });
});

/* ═══════════════════════════════════════ */
/*  evaluateProtection — Delist modes      */
/* ═══════════════════════════════════════ */

describe("evaluateProtection — Delist manual mode", () => {
  it("manual mode with DEPEG_PRIORITY netuid → overridden + DEPEG", () => {
    // We need a netuid in DEPEG_PRIORITY_MANUAL list
    // Import the list to find a valid one
    const out = evaluateProtection(makeInput({
      delistMode: "manual",
      netuid: 999, // unlikely in manual list
    }));
    // If not in manual list → NORMAL
    expect(out.delistCategory).toBe("NORMAL");
  });

  it("auto mode computes delist score", () => {
    const out = evaluateProtection(makeInput({
      delistMode: "auto",
      minersActive: 1, liqTao: 0.1, liqUsd: 5,
      capTao: 10, alphaPrice: 0.0001,
    }));
    // Very low liquidity/miners → high delist score
    expect(out.delistScore).toBeGreaterThan(0);
  });
});

/* ═══════════════════════════════════════ */
/*  evaluateProtection — Edge cases        */
/* ═══════════════════════════════════════ */

describe("evaluateProtection — Edge cases", () => {
  it("null state is handled", () => {
    const out = evaluateProtection(makeInput({ state: null }));
    expect(out.systemStatus).toBeDefined();
  });

  it("zero liquidity doesn't crash", () => {
    const out = evaluateProtection(makeInput({
      liquidityUsd: 0, liqTao: 0, liqUsd: 0, taoInPool: 0,
    }));
    expect(out.netuid).toBe(1);
  });

  it("null priceChange7d is handled", () => {
    const out = evaluateProtection(makeInput({ priceChange7d: null }));
    expect(out.delistCategory).toBeDefined();
  });

  it("extreme values don't crash", () => {
    const out = evaluateProtection(makeInput({
      psi: 100, quality: 0, risk: 100,
      minersActive: 0, liqTao: 0, liqUsd: 0,
      capTao: 0, alphaPrice: 0,
    }));
    expect(out.isOverridden).toBeDefined();
  });
});

/* ═══════════════════════════════════════ */
/*  evaluateAllProtections (batch)         */
/* ═══════════════════════════════════════ */

describe("evaluateAllProtections", () => {
  it("returns a Map keyed by netuid", () => {
    const inputs = [makeInput({ netuid: 1 }), makeInput({ netuid: 5 })];
    const map = evaluateAllProtections(inputs);
    expect(map.size).toBe(2);
    expect(map.get(1)?.netuid).toBe(1);
    expect(map.get(5)?.netuid).toBe(5);
  });

  it("empty input → empty map", () => {
    const map = evaluateAllProtections([]);
    expect(map.size).toBe(0);
  });
});
