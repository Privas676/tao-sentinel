/* ═══════════════════════════════════════ */
/*   DEPEG / DEREGISTRATION ENGINE v3        */
/*   Based on Taoflute deregistration rank   */
/*   NOT price-drop based anymore            */
/* ═══════════════════════════════════════ */

import {
  DEPEG_PRIORITY_MANUAL,
  HIGH_RISK_NEAR_DELIST_MANUAL,
} from "./delist-risk";

/**
 * Depeg state aligned with Taoflute deregistration risk.
 * - NONE: no deregistration risk
 * - WATCH: subnet is at risk of deregistration (~top 4-21 in Taoflute ranking)
 * - WAITLIST: subnet is on the waitlist for deregistration (~top 1-10 in DEPEG_PRIORITY)
 * - CONFIRMED: deregistration is highly probable (top 1-3 in DEPEG_PRIORITY)
 * - UNKNOWN: insufficient data to determine
 */
export type DepegState = "NONE" | "WATCH" | "WAITLIST" | "CONFIRMED" | "UNKNOWN";

export type DepegInput = {
  netuid: number;
  /** Current alpha price in TAO */
  alphaPrice: number;
  /** Price ~24h ago (null if unavailable) */
  price24hAgo: number | null;
  /** Price ~7d ago (null if unavailable) */
  price7dAgo: number | null;
  /** Data confidence 0–100 */
  dataConfidence?: number;
  /** Number of days of historical data available */
  historyDays?: number;
  /** Deregistration rank from Taoflute (1 = highest risk). null if unknown */
  deregistrationRank?: number | null;
  /** Whether subnet is on waitlist for deregistration */
  isWaitlisted?: boolean;
  /** Whether subnet is in immunity phase (unlikely to be deregistered soon) */
  immunityPhase?: boolean;
};

export type DepegResult = {
  netuid: number;
  state: DepegState;
  confirmedTicks: number;
  stateEnteredAt: number;
  drop24: number | null;
  drop7: number | null;
  signals: DepegSignal[];
  deregistrationRank: number | null;
};

export type DepegSignal = {
  code: string;
  label: string;
  value?: number;
};

/* ── Deregistration rank derivation from manual lists ── */

/**
 * Derive a deregistration rank from the manual Taoflute-aligned lists.
 * DEPEG_PRIORITY_MANUAL = top risk (ranks 1..N)
 * HIGH_RISK_NEAR_DELIST_MANUAL = next tier (ranks N+1..M)
 * Returns null if subnet is not in any list.
 */
function deriveDeregistrationRank(netuid: number): number | null {
  const depegIdx = DEPEG_PRIORITY_MANUAL.indexOf(netuid);
  if (depegIdx !== -1) return depegIdx + 1; // rank 1..10

  const highRiskIdx = HIGH_RISK_NEAR_DELIST_MANUAL.indexOf(netuid);
  if (highRiskIdx !== -1) return DEPEG_PRIORITY_MANUAL.length + highRiskIdx + 1; // rank 11..32

  return null;
}

/* ── Public: compute depeg state (v3 — deregistration based) ── */

const DEBUG_DEPEG = false;

/**
 * Compute depeg state based on Taoflute deregistration logic.
 * DEPEG = risk of deregistration, NOT price volatility.
 *
 * Rules:
 * - immunityPhase → NONE
 * - isWaitlisted → WAITLIST
 * - rank 1-3 → CONFIRMED
 * - rank 4-21 → WATCH
 * - rank > 21 or not in list → NONE
 * - no data → UNKNOWN (but we fallback to manual lists)
 */
export function computeDepegState(input: DepegInput): DepegState {
  // 1) Immunity phase => no depeg
  if (input.immunityPhase === true) return "NONE";

  // 2) Explicit waitlist
  if (input.isWaitlisted === true) return "WAITLIST";

  // 3) Use explicit deregistrationRank if provided, otherwise derive from manual lists
  let rank = input.deregistrationRank;
  if (rank === undefined || rank === null) {
    rank = deriveDeregistrationRank(input.netuid);
  }

  if (DEBUG_DEPEG) {
    console.log(`[DEPEG-v3] SN-${input.netuid}: rank=${rank}, immunityPhase=${input.immunityPhase}, isWaitlisted=${input.isWaitlisted}`);
  }

  if (rank === null) return "NONE"; // not in any list = no risk

  // Total listed subnets determines the WATCH boundary
  const totalListed = DEPEG_PRIORITY_MANUAL.length + HIGH_RISK_NEAR_DELIST_MANUAL.length;

  if (rank <= 3) return "CONFIRMED";
  if (rank <= totalListed) return "WATCH";

  return "NONE";
}

/* ── Drop computation (kept for informational display only) ── */

function computeDrops(input: DepegInput): { drop24: number | null; drop7: number | null } {
  const { alphaPrice, price24hAgo, price7dAgo } = input;

  let drop24: number | null = null;
  if (price24hAgo != null && price24hAgo > 0 && alphaPrice >= 0) {
    drop24 = (alphaPrice - price24hAgo) / price24hAgo;
  }

  let drop7: number | null = null;
  if (price7dAgo != null && price7dAgo > 0 && alphaPrice >= 0) {
    drop7 = (alphaPrice - price7dAgo) / price7dAgo;
  }

  return { drop24, drop7 };
}

/* ── Signal generation ── */

function buildSignals(drop24: number | null, drop7: number | null, state: DepegState, rank: number | null): DepegSignal[] {
  const signals: DepegSignal[] = [];

  if (rank != null) {
    signals.push({
      code: "DEREG_RANK",
      label: `Rang déregistration: ${rank}`,
      value: rank,
    });
  }

  if (state !== "NONE" && state !== "UNKNOWN") {
    signals.push({
      code: "DEREG_STATE",
      label: `État: ${depegStateLabel(state, true)}`,
    });
  }

  if (drop24 != null && Math.abs(drop24) > 0.05) {
    signals.push({
      code: "DROP_24H",
      label: `Chute 24h: ${(drop24 * 100).toFixed(1)}%`,
      value: Math.round(drop24 * 100),
    });
  }
  if (drop7 != null && Math.abs(drop7) > 0.05) {
    signals.push({
      code: "DROP_7D",
      label: `Chute 7j: ${(drop7 * 100).toFixed(1)}%`,
      value: Math.round(drop7 * 100),
    });
  }

  return signals;
}

/* ── Backward-compatible: computeDepegProbability ── */

export function computeDepegProbability(input: DepegInput): { probability: number; signals: DepegSignal[]; drop24: number | null; drop7: number | null } {
  const state = computeDepegState(input);
  const { drop24, drop7 } = computeDrops(input);
  const rank = input.deregistrationRank ?? deriveDeregistrationRank(input.netuid);
  const signals = buildSignals(drop24, drop7, state, rank);

  let probability = 0;
  if (state === "CONFIRMED") probability = 90;
  else if (state === "WAITLIST") probability = 75;
  else if (state === "WATCH") probability = 40;

  return { probability, signals, drop24, drop7 };
}

/* ── State Machine wrapper (backward compat for evaluateDepegState) ── */

/** Reset state cache (for testing) — now a no-op since we don't use tick-based state */
export function clearDepegStateCache(): void {
  // No-op: v3 is stateless (deregistration rank based)
}

/** Get current cached state (for testing) — returns undefined since v3 is stateless */
export function getDepegCachedState(_netuid: number): { state: DepegState; confirmedTicks: number; stateEnteredAt: number; exitTicks: number; lastDrop24: number | null; lastDrop7: number | null } | undefined {
  return undefined;
}

/**
 * Evaluate depeg state — v3: deregistration-rank based, no tick confirmation needed.
 */
export function evaluateDepegState(input: DepegInput, _now: number = Date.now()): DepegResult {
  const state = computeDepegState(input);
  const { drop24, drop7 } = computeDrops(input);
  const rank = input.deregistrationRank ?? deriveDeregistrationRank(input.netuid);
  const signals = buildSignals(drop24, drop7, state, rank);

  return {
    netuid: input.netuid,
    state,
    confirmedTicks: 0,
    stateEnteredAt: _now,
    drop24,
    drop7,
    signals,
    deregistrationRank: rank,
  };
}

/* ── Color helpers ── */

export function depegStateColor(state: DepegState): string {
  switch (state) {
    case "NONE": return "rgba(76,175,80,0.7)";
    case "WATCH": return "rgba(255,152,0,0.9)";
    case "WAITLIST": return "rgba(255,87,34,0.9)";
    case "CONFIRMED": return "rgba(229,57,53,0.95)";
    case "UNKNOWN": return "rgba(158,158,158,0.5)";
  }
}

export function depegStateLabel(state: DepegState, fr: boolean = true): string {
  switch (state) {
    case "NONE": return "Normal";
    case "WATCH": return fr ? "Risque Dereg" : "Dereg Risk";
    case "WAITLIST": return fr ? "Liste d'attente" : "Waitlist";
    case "CONFIRMED": return fr ? "Dereg Confirmé" : "Dereg Confirmed";
    case "UNKNOWN": return "—";
  }
}
