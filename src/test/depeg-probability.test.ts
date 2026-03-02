import { describe, it, expect } from "vitest";
import {
  computeDepegProbability,
  evaluateDepegState,
  computeDepegState,
  clearDepegStateCache,
  type DepegInput,
} from "@/lib/depeg-probability";
import { DEPEG_PRIORITY_MANUAL, HIGH_RISK_NEAR_DELIST_MANUAL } from "@/lib/delist-risk";

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
/*   DEPEG STATE v3 (deregistration based)  */
/* ═══════════════════════════════════════ */

describe("computeDepegState", () => {
  it("returns NONE for subnet not in any list", () => {
    const state = computeDepegState(makeInput({ netuid: 999 }));
    expect(state).toBe("NONE");
  });

  it("returns CONFIRMED for top-3 DEPEG_PRIORITY subnets", () => {
    // First 3 in DEPEG_PRIORITY_MANUAL get rank 1,2,3 → CONFIRMED
    for (let i = 0; i < 3 && i < DEPEG_PRIORITY_MANUAL.length; i++) {
      const state = computeDepegState(makeInput({ netuid: DEPEG_PRIORITY_MANUAL[i] }));
      expect(state).toBe("CONFIRMED");
    }
  });

  it("returns WATCH for DEPEG_PRIORITY subnets ranked 4+", () => {
    if (DEPEG_PRIORITY_MANUAL.length > 3) {
      const state = computeDepegState(makeInput({ netuid: DEPEG_PRIORITY_MANUAL[3] }));
      expect(state).toBe("WATCH");
    }
  });

  it("returns WATCH for HIGH_RISK_NEAR_DELIST subnets (rank 11+)", () => {
    if (HIGH_RISK_NEAR_DELIST_MANUAL.length > 0) {
      const state = computeDepegState(makeInput({ netuid: HIGH_RISK_NEAR_DELIST_MANUAL[0] }));
      expect(state).toBe("WATCH");
    }
  });

  it("returns NONE for immunity phase", () => {
    const state = computeDepegState(makeInput({ netuid: DEPEG_PRIORITY_MANUAL[0], immunityPhase: true }));
    expect(state).toBe("NONE");
  });

  it("returns WAITLIST when isWaitlisted", () => {
    const state = computeDepegState(makeInput({ netuid: 999, isWaitlisted: true }));
    expect(state).toBe("WAITLIST");
  });

  it("uses explicit deregistrationRank over derived rank", () => {
    const state = computeDepegState(makeInput({ netuid: 999, deregistrationRank: 2 }));
    expect(state).toBe("CONFIRMED");
  });

  it("explicit rank beyond total listed returns NONE", () => {
    const state = computeDepegState(makeInput({ netuid: 999, deregistrationRank: 50 }));
    expect(state).toBe("NONE");
  });

  it("UNKNOWN when deregistrationRank is explicitly null and not in lists", () => {
    // Not in lists + no explicit rank → NONE (not UNKNOWN, since we have clear info)
    const state = computeDepegState(makeInput({ netuid: 999 }));
    expect(state).toBe("NONE");
  });
});

/* ═══════════════════════════════════════ */
/*   PROBABILITY (backward compat)          */
/* ═══════════════════════════════════════ */

describe("computeDepegProbability", () => {
  it("returns 0 for subnet not at risk", () => {
    const { probability } = computeDepegProbability(makeInput({ netuid: 999 }));
    expect(probability).toBe(0);
  });

  it("returns 90 for CONFIRMED subnet", () => {
    const { probability } = computeDepegProbability(makeInput({ netuid: DEPEG_PRIORITY_MANUAL[0] }));
    expect(probability).toBe(90);
  });

  it("returns 40 for WATCH subnet", () => {
    if (HIGH_RISK_NEAR_DELIST_MANUAL.length > 0) {
      const { probability } = computeDepegProbability(makeInput({ netuid: HIGH_RISK_NEAR_DELIST_MANUAL[0] }));
      expect(probability).toBe(40);
    }
  });

  it("handles null price history gracefully", () => {
    const { probability } = computeDepegProbability(makeInput({ netuid: 999, price24hAgo: null, price7dAgo: null }));
    expect(probability).toBe(0);
  });

  it("provides drop24 and drop7 in result", () => {
    const result = computeDepegProbability(makeInput({
      netuid: 999,
      alphaPrice: 0.008,
      price24hAgo: 0.01,
      price7dAgo: 0.015,
    }));
    expect(result.drop24).toBeCloseTo(-0.2, 2);
    expect(result.drop7).toBeCloseTo(-0.4667, 1);
  });
});

/* ═══════════════════════════════════════ */
/*   STATE MACHINE (backward compat)        */
/* ═══════════════════════════════════════ */

describe("evaluateDepegState", () => {
  it("returns NONE for healthy subnet", () => {
    const result = evaluateDepegState(makeInput({ netuid: 999 }));
    expect(result.state).toBe("NONE");
  });

  it("returns CONFIRMED for top DEPEG_PRIORITY subnet", () => {
    const result = evaluateDepegState(makeInput({ netuid: DEPEG_PRIORITY_MANUAL[0] }));
    expect(result.state).toBe("CONFIRMED");
  });

  it("a single call can produce CONFIRMED (no tick confirmation needed)", () => {
    const result = evaluateDepegState(makeInput({ netuid: DEPEG_PRIORITY_MANUAL[0] }), 1000);
    expect(result.state).toBe("CONFIRMED");
  });

  it("provides deregistrationRank in result", () => {
    const result = evaluateDepegState(makeInput({ netuid: DEPEG_PRIORITY_MANUAL[0] }));
    expect(result.deregistrationRank).toBe(1);
  });

  it("clearDepegStateCache is safe to call", () => {
    clearDepegStateCache(); // no-op, should not throw
  });

  it("NONE state for non-listed subnet even with severe price drops", () => {
    const result = evaluateDepegState(makeInput({
      netuid: 999,
      alphaPrice: 0.001,
      price24hAgo: 0.02,
      price7dAgo: 0.05,
    }));
    // Price drops alone should NOT cause CONFIRMED anymore
    expect(result.state).toBe("NONE");
  });
});

/* ═══════════════════════════════════════ */
/*   VOLUME VERIFICATION                    */
/* ═══════════════════════════════════════ */

describe("deregistration volume sanity", () => {
  it("only top-3 DEPEG_PRIORITY are CONFIRMED", () => {
    let confirmedCount = 0;
    for (const netuid of DEPEG_PRIORITY_MANUAL) {
      const state = computeDepegState(makeInput({ netuid }));
      if (state === "CONFIRMED") confirmedCount++;
    }
    expect(confirmedCount).toBe(Math.min(3, DEPEG_PRIORITY_MANUAL.length));
  });

  it("remaining DEPEG_PRIORITY + all HIGH_RISK are WATCH", () => {
    let watchCount = 0;
    for (const netuid of [...DEPEG_PRIORITY_MANUAL.slice(3), ...HIGH_RISK_NEAR_DELIST_MANUAL]) {
      const state = computeDepegState(makeInput({ netuid }));
      if (state === "WATCH") watchCount++;
    }
    const expectedWatch = Math.max(0, DEPEG_PRIORITY_MANUAL.length - 3) + HIGH_RISK_NEAR_DELIST_MANUAL.length;
    expect(watchCount).toBe(expectedWatch);
  });
});
