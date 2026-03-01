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
    priceHistory: [0.012, 0.011, 0.0105, 0.01],
    taoInPool: 100,
    liquidityUsd: 5000,
    capTao: 50000,
    ...overrides,
  };
}

/* ═══════════════════════════════════════ */
/*   PROBABILITY COMPUTATION                */
/* ═══════════════════════════════════════ */

describe("computeDepegProbability", () => {
  it("returns 0 for healthy subnet", () => {
    const input = makeInput({
      alphaPrice: 0.01,
      priceHistory: [0.0098, 0.0099, 0.01, 0.0101],
      taoInPool: 500,
      liquidityUsd: 50000,
      capTao: 100000,
    });
    const { probability } = computeDepegProbability(input);
    expect(probability).toBeLessThan(10);
  });

  it("detects price/peg deviation", () => {
    // Current price is 50% below median
    const input = makeInput({
      alphaPrice: 0.005,
      priceHistory: [0.01, 0.01, 0.01, 0.01],
      taoInPool: 500,
      liquidityUsd: 50000,
    });
    const { probability, signals } = computeDepegProbability(input);
    expect(probability).toBeGreaterThan(25);
    expect(signals.find(s => s.code === "PRICE_PEG_RATIO")).toBeDefined();
  });

  it("detects fall velocity", () => {
    const input = makeInput({
      alphaPrice: 0.005,
      priceHistory: [0.01, 0.009, 0.007],
      taoInPool: 500,
      liquidityUsd: 50000,
    });
    const { signals } = computeDepegProbability(input);
    const fallSig = signals.find(s => s.code === "FALL_VELOCITY");
    expect(fallSig).toBeDefined();
    expect(fallSig!.contribution).toBeGreaterThan(0);
  });

  it("detects short-term volatility spike", () => {
    // Wild price swings
    const input = makeInput({
      alphaPrice: 0.01,
      priceHistory: [0.01, 0.015, 0.008, 0.013, 0.007],
      taoInPool: 500,
      liquidityUsd: 50000,
      volatility7d: 0.01,
    });
    const { signals } = computeDepegProbability(input);
    const volSig = signals.find(s => s.code === "SHORT_TERM_VOL");
    expect(volSig).toBeDefined();
  });

  it("detects liquidity stress", () => {
    const input = makeInput({
      liquidityUsd: 200,
      capTao: 50000,
    });
    const { signals } = computeDepegProbability(input);
    const liqSig = signals.find(s => s.code === "LIQUIDITY_STRESS");
    expect(liqSig).toBeDefined();
    expect(liqSig!.contribution).toBeGreaterThan(10);
  });

  it("detects pool drain", () => {
    const input = makeInput({ taoInPool: 2 });
    const { signals } = computeDepegProbability(input);
    const poolSig = signals.find(s => s.code === "POOL_DRAIN");
    expect(poolSig).toBeDefined();
  });

  it("combines multiple signals for high probability", () => {
    const input = makeInput({
      alphaPrice: 0.003,
      priceHistory: [0.01, 0.008, 0.006, 0.004],
      taoInPool: 3,
      liquidityUsd: 100,
      capTao: 5000,
    });
    const { probability } = computeDepegProbability(input);
    expect(probability).toBeGreaterThan(70);
  });

  it("caps probability at 100", () => {
    const input = makeInput({
      alphaPrice: 0.001,
      priceHistory: [0.02, 0.015, 0.008, 0.003],
      taoInPool: 0.5,
      liquidityUsd: 10,
      capTao: 1000,
      volatility7d: 0.005,
    });
    const { probability } = computeDepegProbability(input);
    expect(probability).toBeLessThanOrEqual(100);
  });

  it("handles empty price history gracefully", () => {
    const input = makeInput({ priceHistory: [] });
    const { probability } = computeDepegProbability(input);
    expect(probability).toBeGreaterThanOrEqual(0);
  });

  it("handles single price in history", () => {
    const input = makeInput({ priceHistory: [0.01] });
    const { probability } = computeDepegProbability(input);
    expect(probability).toBeGreaterThanOrEqual(0);
  });
});

/* ═══════════════════════════════════════ */
/*   STATE MACHINE (tick-based)             */
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
      alphaPrice: 0.003,
      priceHistory: [0.01, 0.008, 0.006, 0.004],
      taoInPool: 3,
      liquidityUsd: 100,
      capTao: 5000,
    });
    
    // Tick 1: probability > 70 but only 1 tick
    const r1 = evaluateDepegState(input, 1000);
    expect(r1.state).toBe("NORMAL");
    expect(r1.probability).toBeGreaterThan(70);

    // Tick 2: enters HIGH_RISK
    const r2 = evaluateDepegState(input, 2000);
    expect(r2.state).toBe("DEPEG_HIGH_RISK");
  });

  it("resets tick count when prob drops below threshold", () => {
    const severeInput = makeInput({
      alphaPrice: 0.003,
      priceHistory: [0.01, 0.008, 0.006, 0.004],
      taoInPool: 3,
      liquidityUsd: 100,
      capTao: 5000,
    });
    
    // Tick 1
    evaluateDepegState(severeInput, 1000);
    
    // Tick 2: healthy
    const healthyInput = makeInput({
      alphaPrice: 0.01,
      priceHistory: [0.0098, 0.0099, 0.01, 0.0101],
      taoInPool: 500,
      liquidityUsd: 50000,
    });
    evaluateDepegState(healthyInput, 2000);
    
    // Tick 3: severe again, but tick count reset
    const r3 = evaluateDepegState(severeInput, 3000);
    expect(r3.state).toBe("NORMAL");
  });

  it("transitions HIGH_RISK → CONFIRMED after 3 ticks at prob ≥ 85", () => {
    const extremeInput = makeInput({
      alphaPrice: 0.001,
      priceHistory: [0.02, 0.015, 0.008, 0.003],
      taoInPool: 0.5,
      liquidityUsd: 10,
      capTao: 1000,
      volatility7d: 0.005,
    });

    // Ticks 1-2: enter HIGH_RISK
    evaluateDepegState(extremeInput, 1000);
    const r2 = evaluateDepegState(extremeInput, 2000);
    expect(r2.state).toBe("DEPEG_HIGH_RISK");

    // Ticks 3-5: prob >= 85, need 3 ticks for CONFIRMED
    evaluateDepegState(extremeInput, 3000);
    evaluateDepegState(extremeInput, 4000);
    const r5 = evaluateDepegState(extremeInput, 5000);
    expect(r5.state).toBe("DEPEG_CONFIRMED");
  });

  it("transitions HIGH_RISK → CONFIRMED after 5 min duration", () => {
    const highInput = makeInput({
      alphaPrice: 0.003,
      priceHistory: [0.01, 0.008, 0.006, 0.004],
      taoInPool: 3,
      liquidityUsd: 100,
      capTao: 5000,
    });
    
    // Enter HIGH_RISK at t=2000
    evaluateDepegState(highInput, 1000);
    evaluateDepegState(highInput, 2000);
    
    // Stay in HIGH_RISK with prob >= 85 for > 5 min
    const extremeInput = makeInput({
      alphaPrice: 0.001,
      priceHistory: [0.02, 0.015, 0.008, 0.003],
      taoInPool: 0.5,
      liquidityUsd: 10,
      capTao: 1000,
    });
    
    // At t = 2000 + 5*60*1000 + 1 = after 5 min
    const r = evaluateDepegState(extremeInput, 2000 + 5 * 60 * 1000 + 1);
    expect(r.state).toBe("DEPEG_CONFIRMED");
  });

  it("DEPEG_CONFIRMED requires sustained low prob for 5 min to exit", () => {
    const extremeInput = makeInput({
      alphaPrice: 0.001,
      priceHistory: [0.02, 0.015, 0.008, 0.003],
      taoInPool: 0.5,
      liquidityUsd: 10,
      capTao: 1000,
      volatility7d: 0.005,
    });

    // Rapidly push to CONFIRMED
    for (let i = 0; i < 6; i++) {
      evaluateDepegState(extremeInput, i * 1000);
    }
    const cached = getDepegCachedState(42);
    expect(cached?.state).toBe("DEPEG_CONFIRMED");

    // Drop prob below 60 but not long enough
    const healthyInput = makeInput({
      alphaPrice: 0.01,
      priceHistory: [0.0098, 0.0099, 0.01, 0.0101],
      taoInPool: 500,
      liquidityUsd: 50000,
    });
    const t = 10000;
    const r1 = evaluateDepegState(healthyInput, t);
    expect(r1.state).toBe("DEPEG_CONFIRMED"); // Still confirmed

    // 4 min later: still confirmed
    const r2 = evaluateDepegState(healthyInput, t + 4 * 60 * 1000);
    expect(r2.state).toBe("DEPEG_CONFIRMED");

    // 5 min + 1ms later: exits
    const r3 = evaluateDepegState(healthyInput, t + 5 * 60 * 1000 + 1);
    expect(r3.state).toBe("NORMAL");
  });

  it("DEPEG_CONFIRMED exit timer resets if prob goes back up", () => {
    const extremeInput = makeInput({
      alphaPrice: 0.001,
      priceHistory: [0.02, 0.015, 0.008, 0.003],
      taoInPool: 0.5,
      liquidityUsd: 10,
      capTao: 1000,
      volatility7d: 0.005,
    });

    // Push to CONFIRMED
    for (let i = 0; i < 6; i++) {
      evaluateDepegState(extremeInput, i * 1000);
    }

    // Start exit (healthy)
    const healthyInput = makeInput({
      alphaPrice: 0.01,
      priceHistory: [0.0098, 0.0099, 0.01, 0.0101],
      taoInPool: 500,
      liquidityUsd: 50000,
    });
    evaluateDepegState(healthyInput, 10000);

    // Go back to extreme before 5 min
    evaluateDepegState(extremeInput, 10000 + 3 * 60 * 1000);
    
    // Check exit timer was reset
    const cached = getDepegCachedState(42);
    expect(cached?.exitStartedAt).toBeNull();
    expect(cached?.state).toBe("DEPEG_CONFIRMED");
  });

  it("drops from HIGH_RISK back to NORMAL when prob drops", () => {
    const severeInput = makeInput({
      alphaPrice: 0.003,
      priceHistory: [0.01, 0.008, 0.006, 0.004],
      taoInPool: 3,
      liquidityUsd: 100,
      capTao: 5000,
    });

    // Enter HIGH_RISK
    evaluateDepegState(severeInput, 1000);
    evaluateDepegState(severeInput, 2000);
    expect(getDepegCachedState(42)?.state).toBe("DEPEG_HIGH_RISK");

    // Drop to healthy
    const healthyInput = makeInput({
      alphaPrice: 0.01,
      priceHistory: [0.0098, 0.0099, 0.01, 0.0101],
      taoInPool: 500,
      liquidityUsd: 50000,
    });
    const r = evaluateDepegState(healthyInput, 3000);
    expect(r.state).toBe("NORMAL");
  });

  it("handles different subnets independently", () => {
    const severeA = makeInput({
      netuid: 10,
      alphaPrice: 0.003,
      priceHistory: [0.01, 0.008, 0.006, 0.004],
      taoInPool: 3,
      liquidityUsd: 100,
      capTao: 5000,
    });
    const healthyB = makeInput({
      netuid: 20,
      alphaPrice: 0.01,
      priceHistory: [0.0098, 0.0099, 0.01, 0.0101],
      taoInPool: 500,
      liquidityUsd: 50000,
    });

    evaluateDepegState(severeA, 1000);
    evaluateDepegState(severeA, 2000);
    evaluateDepegState(healthyB, 1000);
    evaluateDepegState(healthyB, 2000);

    expect(getDepegCachedState(10)?.state).toBe("DEPEG_HIGH_RISK");
    expect(getDepegCachedState(20)?.state).toBe("NORMAL");
  });
});
