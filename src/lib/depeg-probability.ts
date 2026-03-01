/* ═══════════════════════════════════════ */
/*   DEPEG PROBABILITY ENGINE               */
/*   Probabilistic depeg detection with     */
/*   tick confirmation + hysteresis         */
/* ═══════════════════════════════════════ */

export type DepegState = "NORMAL" | "DEPEG_HIGH_RISK" | "DEPEG_CONFIRMED";

export type DepegInput = {
  netuid: number;
  /** Current alpha price in TAO */
  alphaPrice: number;
  /** Previous prices: [oldest..newest], at least 2 ticks */
  priceHistory: number[];
  /** Pool TAO amount */
  taoInPool: number;
  /** Liquidity in USD */
  liquidityUsd: number;
  /** Market cap in TAO */
  capTao: number;
  /** Volatility baseline (e.g. 7d stdev / mean, 0..1) */
  volatility7d?: number;
};

export type DepegResult = {
  netuid: number;
  probability: number;       // 0–100
  state: DepegState;
  confirmedTicks: number;    // consecutive ticks above threshold
  stateEnteredAt: number;    // timestamp ms
  signals: DepegSignal[];
};

export type DepegSignal = {
  code: string;
  label: string;
  contribution: number;      // 0–100
  value?: number;
};

/* ── Weights ── */

const WEIGHTS = {
  PRICE_PEG_RATIO:      30,   // price vs baseline deviation
  FALL_VELOCITY:        25,   // rate of price decline (delta 1-5 ticks)
  SHORT_TERM_VOL:       15,   // short-term volatility spike
  LIQUIDITY_STRESS:     20,   // pool/liq stress
  POOL_DRAIN:           10,   // pool TAO critically low
} as const;

/* ── Thresholds ── */

const DEPEG_HIGH_RISK_PROB = 70;
const DEPEG_CONFIRMED_PROB = 85;
const DEPEG_EXIT_PROB = 60;
const HIGH_RISK_CONFIRM_TICKS = 2;
const CONFIRMED_CONFIRM_TICKS = 3;
const CONFIRMED_MIN_DURATION_MS = 5 * 60 * 1000; // 5 min
const EXIT_SUSTAIN_MS = 5 * 60 * 1000;           // 5 min below threshold to exit

/* ── State cache (per subnet) ── */

type DepegStateEntry = {
  state: DepegState;
  confirmedTicks: number;
  stateEnteredAt: number;
  exitStartedAt: number | null;      // when prob dropped below exit threshold
  lastProb: number;
};

const stateCache = new Map<number, DepegStateEntry>();

/** Reset state cache (for testing) */
export function clearDepegStateCache(): void {
  stateCache.clear();
}

/** Get current cached state (for testing/inspection) */
export function getDepegCachedState(netuid: number): DepegStateEntry | undefined {
  return stateCache.get(netuid);
}

/* ── Signal computation ── */

/**
 * Compute depeg probability from market signals.
 * Returns a probability 0–100 and signal breakdown.
 */
export function computeDepegProbability(input: DepegInput): { probability: number; signals: DepegSignal[] } {
  const signals: DepegSignal[] = [];
  let totalProb = 0;

  const { alphaPrice, priceHistory, taoInPool, liquidityUsd, capTao, volatility7d } = input;

  // ─── 1. Price/Peg Ratio (deviation from baseline) ───
  // Use the median of history as "peg baseline"
  if (priceHistory.length >= 2 && alphaPrice > 0) {
    const sorted = [...priceHistory].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    if (median > 0) {
      const deviation = (median - alphaPrice) / median; // positive = price fell
      // Scale: 0% dev → 0 contribution, 30%+ dev → full contribution
      const score = Math.min(1, Math.max(0, deviation / 0.30));
      const contribution = Math.round(score * WEIGHTS.PRICE_PEG_RATIO);
      if (contribution > 0) {
        signals.push({
          code: "PRICE_PEG_RATIO",
          label: "Déviation prix/peg",
          contribution,
          value: Math.round(deviation * 100),
        });
        totalProb += contribution;
      }
    }
  }

  // ─── 2. Fall Velocity (delta over recent ticks) ───
  if (priceHistory.length >= 2) {
    // Compare last price vs 1-tick-ago and vs oldest available
    const recent = priceHistory[priceHistory.length - 1] || alphaPrice;
    const prev = priceHistory[priceHistory.length - 2];
    const oldest = priceHistory[0];
    
    if (prev > 0 && oldest > 0) {
      const shortDelta = (prev - alphaPrice) / prev;  // 1-tick fall
      const longDelta = (oldest - alphaPrice) / oldest; // full-window fall
      const maxDelta = Math.max(shortDelta, longDelta * 0.6); // weight recent more
      
      // Scale: 5%+ drop → starts contributing, 20%+ → full
      const score = Math.min(1, Math.max(0, (maxDelta - 0.05) / 0.15));
      const contribution = Math.round(score * WEIGHTS.FALL_VELOCITY);
      if (contribution > 0) {
        signals.push({
          code: "FALL_VELOCITY",
          label: "Vitesse de chute",
          contribution,
          value: Math.round(maxDelta * 100),
        });
        totalProb += contribution;
      }
    }
  }

  // ─── 3. Short-term Volatility ───
  if (priceHistory.length >= 3) {
    const returns: number[] = [];
    for (let i = 1; i < priceHistory.length; i++) {
      if (priceHistory[i - 1] > 0) {
        returns.push((priceHistory[i] - priceHistory[i - 1]) / priceHistory[i - 1]);
      }
    }
    if (returns.length >= 2) {
      const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
      const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length;
      const stdev = Math.sqrt(variance);
      
      // Compare to baseline volatility
      const baseline = volatility7d ?? 0.02; // default 2%
      const volRatio = baseline > 0 ? stdev / baseline : stdev / 0.02;
      
      // Scale: 2x normal vol → starts, 5x+ → full
      const score = Math.min(1, Math.max(0, (volRatio - 2) / 3));
      const contribution = Math.round(score * WEIGHTS.SHORT_TERM_VOL);
      if (contribution > 0) {
        signals.push({
          code: "SHORT_TERM_VOL",
          label: "Volatilité court terme",
          contribution,
          value: Math.round(volRatio * 100),
        });
        totalProb += contribution;
      }
    }
  }

  // ─── 4. Liquidity Stress ───
  if (liquidityUsd >= 0 && capTao > 0) {
    // Stress = very low liquidity relative to cap
    const liqCapRatio = capTao > 0 ? liquidityUsd / (capTao * 0.01) : 100; // normalized
    // Also absolute: < $500 is critical
    const absStress = liquidityUsd < 500 ? 1.0 :
                      liquidityUsd < 2000 ? 0.6 :
                      liquidityUsd < 5000 ? 0.2 : 0;
    const relStress = liqCapRatio < 1 ? 0.8 :
                      liqCapRatio < 5 ? 0.3 : 0;
    const stress = Math.max(absStress, relStress);
    const contribution = Math.round(stress * WEIGHTS.LIQUIDITY_STRESS);
    if (contribution > 0) {
      signals.push({
        code: "LIQUIDITY_STRESS",
        label: "Stress liquidité",
        contribution,
        value: Math.round(liquidityUsd),
      });
      totalProb += contribution;
    }
  }

  // ─── 5. Pool Drain ───
  if (taoInPool < 10) {
    const score = taoInPool < 1 ? 1.0 : taoInPool < 5 ? 0.7 : 0.4;
    const contribution = Math.round(score * WEIGHTS.POOL_DRAIN);
    signals.push({
      code: "POOL_DRAIN",
      label: "Pool TAO critique",
      contribution,
      value: Math.round(taoInPool * 10) / 10,
    });
    totalProb += contribution;
  }

  const probability = Math.min(100, Math.max(0, totalProb));
  return { probability, signals };
}

/* ── State Machine with hysteresis ── */

/**
 * Evaluate depeg state for a subnet. Uses tick-based confirmation
 * and hysteresis for stable state transitions.
 */
export function evaluateDepegState(input: DepegInput, now: number = Date.now()): DepegResult {
  const { probability, signals } = computeDepegProbability(input);
  const netuid = input.netuid;

  // Get or create state entry
  let entry = stateCache.get(netuid);
  if (!entry) {
    entry = {
      state: "NORMAL",
      confirmedTicks: 0,
      stateEnteredAt: now,
      exitStartedAt: null,
      lastProb: 0,
    };
    stateCache.set(netuid, entry);
  }

  const prevState = entry.state;

  // ─── State transitions ───

  if (prevState === "NORMAL") {
    if (probability >= DEPEG_HIGH_RISK_PROB) {
      entry.confirmedTicks++;
      if (entry.confirmedTicks >= HIGH_RISK_CONFIRM_TICKS) {
        entry.state = "DEPEG_HIGH_RISK";
        entry.stateEnteredAt = now;
        entry.exitStartedAt = null;
      }
    } else {
      entry.confirmedTicks = 0;
    }
  }

  else if (prevState === "DEPEG_HIGH_RISK") {
    if (probability >= DEPEG_CONFIRMED_PROB) {
      entry.confirmedTicks++;
      const duration = now - entry.stateEnteredAt;
      if (entry.confirmedTicks >= CONFIRMED_CONFIRM_TICKS || duration >= CONFIRMED_MIN_DURATION_MS) {
        entry.state = "DEPEG_CONFIRMED";
        entry.stateEnteredAt = now;
        entry.confirmedTicks = 0;
        entry.exitStartedAt = null;
      }
    } else if (probability >= DEPEG_HIGH_RISK_PROB) {
      // Stay in HIGH_RISK, reset confirmed tick count for upgrade
      entry.confirmedTicks = 0;
    } else {
      // Dropped below HIGH_RISK threshold → back to NORMAL
      entry.state = "NORMAL";
      entry.confirmedTicks = 0;
      entry.stateEnteredAt = now;
      entry.exitStartedAt = null;
    }
  }

  else if (prevState === "DEPEG_CONFIRMED") {
    // Hysteresis: only exit if prob < EXIT threshold for >= 5 min
    if (probability < DEPEG_EXIT_PROB) {
      if (!entry.exitStartedAt) {
        entry.exitStartedAt = now;
      }
      const exitDuration = now - entry.exitStartedAt;
      if (exitDuration >= EXIT_SUSTAIN_MS) {
        entry.state = "NORMAL";
        entry.confirmedTicks = 0;
        entry.stateEnteredAt = now;
        entry.exitStartedAt = null;
      }
    } else {
      // Still above exit threshold → reset exit timer
      entry.exitStartedAt = null;
    }
  }

  entry.lastProb = probability;

  // Log state transitions
  if (entry.state !== prevState) {
    console.log(`[DEPEG] SN-${netuid}: ${prevState} → ${entry.state} | prob=${probability} | ticks=${entry.confirmedTicks} | signals=${signals.map(s => s.code).join(',')}`);
  }

  return {
    netuid,
    probability,
    state: entry.state,
    confirmedTicks: entry.confirmedTicks,
    stateEnteredAt: entry.stateEnteredAt,
    signals,
  };
}

/* ── Color helpers ── */

export function depegStateColor(state: DepegState): string {
  switch (state) {
    case "NORMAL": return "rgba(76,175,80,0.7)";
    case "DEPEG_HIGH_RISK": return "rgba(255,152,0,0.9)";
    case "DEPEG_CONFIRMED": return "rgba(229,57,53,0.95)";
  }
}

export function depegStateLabel(state: DepegState, fr: boolean = true): string {
  switch (state) {
    case "NORMAL": return "Normal";
    case "DEPEG_HIGH_RISK": return fr ? "Depeg Probable" : "Depeg Likely";
    case "DEPEG_CONFIRMED": return fr ? "Depeg Confirmé" : "Depeg Confirmed";
  }
}
