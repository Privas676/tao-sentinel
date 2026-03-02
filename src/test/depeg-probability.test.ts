import { describe, it, expect, beforeEach } from "vitest";
import {
  computeDepegProbability,
  evaluateDepegState,
  clearDepegStateCache,
  getDepegCachedState,
  type DepegInput,
} from "@/lib/depeg-probability";

/* ─── Helpers ─── */

function makeInput(overrides: Partial<DepegInput> = {}): DepegInput {
  return {
    netuid: 42,
    alphaPrice: 0.01,
    price24hAgo: 0.011,
    price7dAgo: 0.012,
    ...overrides,
  };
}

/* ═══════════════════════════════════════ */
/*   PROBABILITY COMPUTATION (v2)           */
/* ═══════════════════════════════════════ */

describe("computeDepegProbability", () => {
  it("returns 0 for healthy subnet (no significant drop)", () => {
    const input = makeInput({
      alphaPrice: 0.01,
      price24hAgo: 0.0105,
      price7dAgo: 0.011,
    });
    const { probability } = computeDepegProbability(input);
    expect(probability).toBeLessThan(10);
  });

  it("detects 24h drop meeting HIGH_RISK threshold (-20%)", () => {
    const input = makeInput({
      alphaPrice: 0.008,
      price24hAgo: 0.01, // -20%
      price7dAgo: 0.012,
    });
    const { probability, signals } = computeDepegProbability(input);
    expect(probability).toBeGreaterThanOrEqual(60);
    expect(signals.find(s => s.code === "DROP_24H")).toBeDefined();
  });

  it("detects 7d drop meeting HIGH_RISK threshold (-35%)", () => {
    const input = makeInput({
      alphaPrice: 0.0065,
      price24hAgo: 0.008,
      price7dAgo: 0.01, // -35%
    });
    const { probability, signals } = computeDepegProbability(input);
    expect(probability).toBeGreaterThanOrEqual(60);
    expect(signals.find(s => s.code === "DROP_7D")).toBeDefined();
  });

  it("detects confirmed threshold (-30% 24h)", () => {
    const input = makeInput({
      alphaPrice: 0.007,
      price24hAgo: 0.01, // -30%
    });
    const { probability } = computeDepegProbability(input);
    expect(probability).toBe(90);
  });

  it("detects confirmed threshold (-50% 7d)", () => {
    const input = makeInput({
      alphaPrice: 0.005,
      price7dAgo: 0.01, // -50%
    });
    const { probability } = computeDepegProbability(input);
    expect(probability).toBe(90);
  });

  it("handles null price history gracefully", () => {
    const input = makeInput({ price24hAgo: null, price7dAgo: null });
    const { probability } = computeDepegProbability(input);
    expect(probability).toBe(0);
  });

  it("provides drop24 and drop7 in result", () => {
    const input = makeInput({
      alphaPrice: 0.008,
      price24hAgo: 0.01,
      price7dAgo: 0.015,
    });
    const result = computeDepegProbability(input);
    expect(result.drop24).toBeCloseTo(-0.2, 2);
    expect(result.drop7).toBeCloseTo(-0.4667, 1);
  });
});

/* ═══════════════════════════════════════ */
/*   STATE MACHINE (tick-based, v2)         */
/* ═══════════════════════════════════════ */

describe("evaluateDepegState", () => {
  beforeEach(() => {
    clearDepegStateCache();
  });

  it("starts in NORMAL state", () => {
    const input = makeInput();
    const result = evaluateDepegState(input);
    expect(result.state).toBe("NORMAL");
  });

  it("requires 2 ticks to enter DEPEG_HIGH_RISK", () => {
    const input = makeInput({
      alphaPrice: 0.007,
      price24hAgo: 0.01, // -30%
      price7dAgo: 0.012,
    });

    // Tick 1: meets threshold but only 1 tick
    const r1 = evaluateDepegState(input, 1000);
    expect(r1.state).toBe("NORMAL");

    // Tick 2: enters HIGH_RISK
    const r2 = evaluateDepegState(input, 2000);
    expect(r2.state).toBe("DEPEG_HIGH_RISK");
  });

  it("resets tick count when drop recovers", () => {
    const severeInput = makeInput({
      alphaPrice: 0.007,
      price24hAgo: 0.01,
      price7dAgo: 0.015,
    });

    // Tick 1: severe
    evaluateDepegState(severeInput, 1000);

    // Tick 2: healthy
    const healthyInput = makeInput({
      alphaPrice: 0.0095,
      price24hAgo: 0.01,
      price7dAgo: 0.011,
    });
    evaluateDepegState(healthyInput, 2000);

    // Tick 3: severe again, but tick count reset
    const r3 = evaluateDepegState(severeInput, 3000);
    expect(r3.state).toBe("NORMAL");
  });

  it("transitions HIGH_RISK → CONFIRMED after 3 ticks at confirmed threshold", () => {
    const extremeInput = makeInput({
      alphaPrice: 0.005,
      price24hAgo: 0.01,  // -50% 24h
      price7dAgo: 0.015,  // -67% 7d
      historyDays: 30,
    });

    // Ticks 1-2: enter HIGH_RISK
    evaluateDepegState(extremeInput, 1000);
    const r2 = evaluateDepegState(extremeInput, 2000);
    expect(r2.state).toBe("DEPEG_HIGH_RISK");

    // Ticks 3-5: confirmed threshold met, need 3 ticks
    evaluateDepegState(extremeInput, 3000);
    evaluateDepegState(extremeInput, 4000);
    const r5 = evaluateDepegState(extremeInput, 5000);
    expect(r5.state).toBe("DEPEG_CONFIRMED");
  });

  it("blocks DEPEG_CONFIRMED if history < 7 days", () => {
    const extremeInput = makeInput({
      alphaPrice: 0.005,
      price24hAgo: 0.01,
      price7dAgo: 0.015,
      historyDays: 3, // insufficient
    });

    // Enter HIGH_RISK
    evaluateDepegState(extremeInput, 1000);
    evaluateDepegState(extremeInput, 2000);
    expect(getDepegCachedState(42)?.state).toBe("DEPEG_HIGH_RISK");

    // Even with many ticks, can't confirm
    for (let i = 3; i <= 10; i++) {
      evaluateDepegState(extremeInput, i * 1000);
    }
    expect(getDepegCachedState(42)?.state).toBe("DEPEG_HIGH_RISK");
  });

  it("blocks DEPEG_CONFIRMED if data confidence < 70%", () => {
    const extremeInput = makeInput({
      alphaPrice: 0.005,
      price24hAgo: 0.01,
      price7dAgo: 0.015,
      historyDays: 30,
      dataConfidence: 50,
    });

    evaluateDepegState(extremeInput, 1000);
    evaluateDepegState(extremeInput, 2000);
    for (let i = 3; i <= 10; i++) {
      evaluateDepegState(extremeInput, i * 1000);
    }
    expect(getDepegCachedState(42)?.state).toBe("DEPEG_HIGH_RISK");
  });

  it("DEPEG_CONFIRMED requires 6 consecutive recovery ticks to exit", () => {
    const extremeInput = makeInput({
      alphaPrice: 0.005,
      price24hAgo: 0.01,
      price7dAgo: 0.015,
      historyDays: 30,
    });

    // Push to CONFIRMED
    for (let i = 0; i < 6; i++) {
      evaluateDepegState(extremeInput, i * 1000);
    }
    expect(getDepegCachedState(42)?.state).toBe("DEPEG_CONFIRMED");

    // Recovery ticks (drop > -10% and > -20%)
    const healthyInput = makeInput({
      alphaPrice: 0.0095,
      price24hAgo: 0.01,   // -5% (above -10% exit)
      price7dAgo: 0.011,   // -13% (above -20% exit)
    });

    // 5 ticks: still confirmed
    for (let i = 0; i < 5; i++) {
      evaluateDepegState(healthyInput, 10000 + i * 1000);
    }
    expect(getDepegCachedState(42)?.state).toBe("DEPEG_CONFIRMED");

    // 6th tick: exits
    const r = evaluateDepegState(healthyInput, 10000 + 5 * 1000);
    expect(r.state).toBe("NORMAL");
  });

  it("DEPEG_CONFIRMED exit timer resets if drop worsens again", () => {
    const extremeInput = makeInput({
      alphaPrice: 0.005,
      price24hAgo: 0.01,
      price7dAgo: 0.015,
      historyDays: 30,
    });

    // Push to CONFIRMED
    for (let i = 0; i < 6; i++) {
      evaluateDepegState(extremeInput, i * 1000);
    }

    // Start recovery
    const healthyInput = makeInput({
      alphaPrice: 0.0095,
      price24hAgo: 0.01,
      price7dAgo: 0.011,
    });
    for (let i = 0; i < 3; i++) {
      evaluateDepegState(healthyInput, 10000 + i * 1000);
    }

    // Drop again → reset exit counter
    evaluateDepegState(extremeInput, 13000);
    const cached = getDepegCachedState(42);
    expect(cached?.exitTicks).toBe(0);
    expect(cached?.state).toBe("DEPEG_CONFIRMED");
  });

  it("drops from HIGH_RISK back to NORMAL when drop recovers", () => {
    const severeInput = makeInput({
      alphaPrice: 0.007,
      price24hAgo: 0.01,
      price7dAgo: 0.015,
    });

    // Enter HIGH_RISK
    evaluateDepegState(severeInput, 1000);
    evaluateDepegState(severeInput, 2000);
    expect(getDepegCachedState(42)?.state).toBe("DEPEG_HIGH_RISK");

    // Recovery
    const healthyInput = makeInput({
      alphaPrice: 0.0095,
      price24hAgo: 0.01,
      price7dAgo: 0.011,
    });
    const r = evaluateDepegState(healthyInput, 3000);
    expect(r.state).toBe("NORMAL");
  });

  it("handles different subnets independently", () => {
    const severeA = makeInput({
      netuid: 10,
      alphaPrice: 0.007,
      price24hAgo: 0.01,
      price7dAgo: 0.015,
    });
    const healthyB = makeInput({
      netuid: 20,
      alphaPrice: 0.0095,
      price24hAgo: 0.01,
      price7dAgo: 0.011,
    });

    evaluateDepegState(severeA, 1000);
    evaluateDepegState(severeA, 2000);
    evaluateDepegState(healthyB, 1000);
    evaluateDepegState(healthyB, 2000);

    expect(getDepegCachedState(10)?.state).toBe("DEPEG_HIGH_RISK");
    expect(getDepegCachedState(20)?.state).toBe("NORMAL");
  });

  it("a single snapshot never produces DEPEG_CONFIRMED", () => {
    const extremeInput = makeInput({
      alphaPrice: 0.001,
      price24hAgo: 0.02,
      price7dAgo: 0.05,
      historyDays: 30,
    });
    const r = evaluateDepegState(extremeInput, 1000);
    expect(r.state).not.toBe("DEPEG_CONFIRMED");
  });

  it("provides drop24 and drop7 in result", () => {
    const input = makeInput({
      alphaPrice: 0.007,
      price24hAgo: 0.01,
      price7dAgo: 0.015,
    });
    const r = evaluateDepegState(input, 1000);
    expect(r.drop24).toBeCloseTo(-0.3, 2);
    expect(r.drop7).toBeCloseTo(-0.5333, 1);
  });
});
