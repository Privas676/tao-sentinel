/* ═══════════════════════════════════════════════════ */
/*   DECISION STATE LAYER                              */
/*   Transforms raw scores into STABLE alert states    */
/*   with hysteresis, multi-tick confirmation,         */
/*   per-subnet cooldowns, and delta triggers.         */
/*                                                     */
/*   This layer sits ABOVE engine-decision.ts          */
/*   (which handles score arbitration) and BELOW       */
/*   the UI hook (use-subnet-scores).                  */
/*                                                     */
/*   Design principles:                                */
/*   - Immutable tick evaluation (pure per tick)        */
/*   - Mutable state manager (tracks history)          */
/*   - No flapping: once confirmed, state is sticky    */
/* ═══════════════════════════════════════════════════ */

import type { DecisionOutput } from "./engine-decision";
import type { SystemStatus } from "./risk-override";
import type { DelistCategory } from "./delist-risk";
import type { AlignmentStatus } from "./data-snapshot";

/* ══════════════════════════════════════ */
/*            STATE TYPES                 */
/* ══════════════════════════════════════ */

/** Stable states produced by the Decision State Layer */
export type DecisionState =
  | "DEPEG_CONFIRMED"     // Hard-confirmed depeg (sticky)
  | "DEPEG_HIGH_RISK"     // Probable depeg, pending confirmation
  | "OVERRIDE_CRITICAL"   // Multiple hard conditions met, confirmed
  | "OVERRIDE_WARNING"    // Single hard condition, pending
  | "DATA_UNSTABLE"       // Data confidence too low
  | "DATA_STALE"          // Data source stale
  | "WATCH"               // Neutral: monitoring
  | "OK";                 // Healthy state

/** Settings that control the state machine */
export type DecisionSettings = {
  mode: "strict" | "permissive";
  /** Number of consecutive ticks required to confirm a state transition */
  confirmationTicks: number;
  /** Cooldown in ms after a state fires before it can fire again */
  cooldownMs: number;
  /** Minimum score delta to allow re-firing during cooldown */
  deltaTrigger: number;
  /** Hysteresis thresholds for entering/exiting states */
  hysteresis: {
    depegEnter: number;   // delistScore ≥ this → DEPEG candidate
    depegExit: number;    // delistScore < this → can exit DEPEG
    overrideRiskEnter: number;  // risk ≥ this → OVERRIDE candidate
    overrideRiskExit: number;   // risk < this → can exit OVERRIDE
    dataConfidenceMin: number;  // confiance < this → DATA_UNSTABLE
    dataConfidenceRecover: number; // confiance ≥ this → can exit DATA_UNSTABLE
  };
};

/** Per-subnet tracking state (internal) */
export type SubnetStateRecord = {
  /** Current confirmed state */
  confirmedState: DecisionState;
  /** Candidate state being evaluated */
  candidateState: DecisionState | null;
  /** How many consecutive ticks the candidate has been active */
  candidateTicks: number;
  /** Timestamp (ms) when current confirmed state was last emitted */
  confirmedAt: number;
  /** Last delistScore when state was confirmed (for delta trigger) */
  lastConfirmedScore: number;
  /** Last risk when state was confirmed */
  lastConfirmedRisk: number;
};

/** Output per subnet per tick */
export type DecisionStateOutput = {
  netuid: number;
  state: DecisionState;
  /** Whether this is a newly confirmed transition (first tick) */
  isTransition: boolean;
  /** Whether the alert is in cooldown (suppressed) */
  isCooledDown: boolean;
  /** How many ticks the candidate has been pending */
  pendingTicks: number;
  /** The candidate state if still pending */
  pendingState: DecisionState | null;
};

/* ══════════════════════════════════════ */
/*         DEFAULT SETTINGS               */
/* ══════════════════════════════════════ */

export const DEFAULT_DECISION_SETTINGS: DecisionSettings = {
  mode: "strict",
  confirmationTicks: 3,
  cooldownMs: 30 * 60 * 1000, // 30 minutes
  deltaTrigger: 0.15,
  hysteresis: {
    depegEnter: 45,
    depegExit: 30,
    overrideRiskEnter: 70,
    overrideRiskExit: 55,
    dataConfidenceMin: 40,
    dataConfidenceRecover: 55,
  },
};

export const PERMISSIVE_SETTINGS: DecisionSettings = {
  ...DEFAULT_DECISION_SETTINGS,
  mode: "permissive",
  confirmationTicks: 2,
  cooldownMs: 15 * 60 * 1000,
  deltaTrigger: 0.10,
  hysteresis: {
    depegEnter: 40,
    depegExit: 25,
    overrideRiskEnter: 60,
    overrideRiskExit: 45,
    dataConfidenceMin: 35,
    dataConfidenceRecover: 50,
  },
};

/* ══════════════════════════════════════ */
/*     PURE TICK EVALUATION               */
/* ══════════════════════════════════════ */

/**
 * Evaluate what state a subnet SHOULD be in, based on current scores.
 * This is a PURE function — no history or confirmation logic.
 */
export function evaluateRawState(
  decision: DecisionOutput,
  alignmentStatus: AlignmentStatus,
  settings: DecisionSettings,
): DecisionState {
  const h = settings.hysteresis;

  // Priority 1: Depeg/delist — highest severity, even if data is stale
  if (decision.delistCategory === "DEPEG_PRIORITY" || decision.delistScore >= h.depegEnter) {
    return "DEPEG_CONFIRMED";
  }
  if (decision.delistCategory === "HIGH_RISK_NEAR_DELIST" && decision.delistScore >= h.depegEnter * 0.6) {
    return "DEPEG_HIGH_RISK";
  }

  // Priority 2: Override states — critical overrides outrank data quality
  if (decision.isOverridden && decision.risk >= h.overrideRiskEnter) {
    return "OVERRIDE_CRITICAL";
  }

  // Priority 3: Data quality issues (below critical alerts)
  if (alignmentStatus === "STALE") return "DATA_STALE";
  if (decision.confianceScore < h.dataConfidenceMin && decision.dataUncertain) return "DATA_UNSTABLE";

  // Priority 4: Override warning (below data issues)
  if (decision.isWarning || (decision.risk >= h.overrideRiskEnter && decision.systemStatus !== "OK")) {
    return "OVERRIDE_WARNING";
  }

  // Priority 5: Watch state
  if (decision.action === "WATCH" || decision.action === "EXIT") {
    return "WATCH";
  }

  return "OK";
}

/**
 * Apply hysteresis: check if the current confirmed state should persist
 * even though raw evaluation says otherwise (prevents flapping).
 */
export function applyHysteresis(
  currentConfirmed: DecisionState,
  rawCandidate: DecisionState,
  decision: DecisionOutput,
  settings: DecisionSettings,
): DecisionState {
  const h = settings.hysteresis;

  // If raw says the same as current, no change
  if (rawCandidate === currentConfirmed) return rawCandidate;

  // DEPEG_CONFIRMED is sticky: only exit if score drops below depegExit
  if (currentConfirmed === "DEPEG_CONFIRMED") {
    if (decision.delistScore >= h.depegExit) return "DEPEG_CONFIRMED"; // Hold
    // Allowed to transition down
  }

  // OVERRIDE_CRITICAL is sticky: only exit if risk drops below overrideRiskExit
  if (currentConfirmed === "OVERRIDE_CRITICAL") {
    if (decision.risk >= h.overrideRiskExit) return "OVERRIDE_CRITICAL"; // Hold
  }

  // DATA_UNSTABLE: only recover if confidence exceeds recover threshold
  if (currentConfirmed === "DATA_UNSTABLE") {
    if (decision.confianceScore < h.dataConfidenceRecover) return "DATA_UNSTABLE"; // Hold
  }

  // No hysteresis for other state transitions
  return rawCandidate;
}

/* ══════════════════════════════════════ */
/*      STATEFUL MANAGER                  */
/* ══════════════════════════════════════ */

/**
 * Manages per-subnet state tracking with confirmation ticks,
 * cooldowns, and delta triggers.
 *
 * Call `tick()` each time new scores arrive.
 * The manager tracks history internally and produces stable output.
 */
export class DecisionStateManager {
  private records = new Map<number, SubnetStateRecord>();
  private settings: DecisionSettings;

  constructor(settings: DecisionSettings = DEFAULT_DECISION_SETTINGS) {
    this.settings = settings;
  }

  /** Update settings (e.g. when user switches strict/permissive) */
  updateSettings(settings: DecisionSettings): void {
    this.settings = settings;
  }

  /** Get current settings */
  getSettings(): DecisionSettings {
    return this.settings;
  }

  /** Get the tracking record for a subnet (or create default) */
  getRecord(netuid: number): SubnetStateRecord {
    if (!this.records.has(netuid)) {
      this.records.set(netuid, {
        confirmedState: "OK",
        candidateState: null,
        candidateTicks: 0,
        confirmedAt: 0,
        lastConfirmedScore: 0,
        lastConfirmedRisk: 0,
      });
    }
    return this.records.get(netuid)!;
  }

  /** Get all tracked netuids */
  getTrackedNetuids(): number[] {
    return [...this.records.keys()];
  }

  /**
   * Process a single subnet's decision output.
   * Returns the stable state output with transition/cooldown info.
   */
  tick(
    decision: DecisionOutput,
    alignmentStatus: AlignmentStatus,
    nowMs: number = Date.now(),
  ): DecisionStateOutput {
    const record = this.getRecord(decision.netuid);
    const rawState = evaluateRawState(decision, alignmentStatus, this.settings);

    // Apply hysteresis against current confirmed state
    const candidateAfterHysteresis = applyHysteresis(
      record.confirmedState, rawState, decision, this.settings,
    );

    // Multi-tick confirmation logic
    if (candidateAfterHysteresis !== record.confirmedState) {
      // We have a candidate transition
      if (record.candidateState === candidateAfterHysteresis) {
        // Same candidate as before → increment ticks
        record.candidateTicks++;
      } else {
        // New candidate → reset counter
        record.candidateState = candidateAfterHysteresis;
        record.candidateTicks = 1;
      }

      // Check if confirmed (enough ticks)
      if (record.candidateTicks >= this.settings.confirmationTicks) {
        return this.confirmTransition(record, candidateAfterHysteresis, decision, nowMs);
      }

      // Not yet confirmed: return current state with pending info
      return {
        netuid: decision.netuid,
        state: record.confirmedState,
        isTransition: false,
        isCooledDown: false,
        pendingTicks: record.candidateTicks,
        pendingState: candidateAfterHysteresis,
      };
    }

    // No candidate → state is stable, clear any pending
    record.candidateState = null;
    record.candidateTicks = 0;

    return {
      netuid: decision.netuid,
      state: record.confirmedState,
      isTransition: false,
      isCooledDown: false,
      pendingTicks: 0,
      pendingState: null,
    };
  }

  /**
   * Attempt to confirm a state transition.
   * Applies cooldown and delta trigger logic.
   */
  private confirmTransition(
    record: SubnetStateRecord,
    newState: DecisionState,
    decision: DecisionOutput,
    nowMs: number,
  ): DecisionStateOutput {
    const timeSinceConfirm = nowMs - record.confirmedAt;
    const inCooldown = timeSinceConfirm < this.settings.cooldownMs && record.confirmedAt > 0;

    // Delta trigger: allow re-firing even during cooldown if score changed significantly
    const scoreDelta = Math.abs(decision.delistScore - record.lastConfirmedScore) / 100;
    const riskDelta = Math.abs(decision.risk - record.lastConfirmedRisk) / 100;
    const maxDelta = Math.max(scoreDelta, riskDelta);
    const deltaOverride = maxDelta >= this.settings.deltaTrigger;

    if (inCooldown && !deltaOverride) {
      // Suppressed by cooldown — still update state internally but mark as cooled down
      record.confirmedState = newState;
      record.candidateState = null;
      record.candidateTicks = 0;

      return {
        netuid: decision.netuid,
        state: newState,
        isTransition: false,
        isCooledDown: true,
        pendingTicks: 0,
        pendingState: null,
      };
    }

    // Confirmed transition
    record.confirmedState = newState;
    record.confirmedAt = nowMs;
    record.lastConfirmedScore = decision.delistScore;
    record.lastConfirmedRisk = decision.risk;
    record.candidateState = null;
    record.candidateTicks = 0;

    return {
      netuid: decision.netuid,
      state: newState,
      isTransition: true,
      isCooledDown: false,
      pendingTicks: 0,
      pendingState: null,
    };
  }

  /**
   * Process a batch of decisions for all subnets.
   */
  tickAll(
    decisions: DecisionOutput[],
    alignmentStatus: AlignmentStatus,
    nowMs: number = Date.now(),
  ): DecisionStateOutput[] {
    return decisions.map(d => this.tick(d, alignmentStatus, nowMs));
  }

  /** Reset all tracked state (e.g. on settings change) */
  reset(): void {
    this.records.clear();
  }

  /** Get a snapshot of all current confirmed states */
  snapshot(): Map<number, DecisionState> {
    const snap = new Map<number, DecisionState>();
    for (const [netuid, rec] of this.records) {
      snap.set(netuid, rec.confirmedState);
    }
    return snap;
  }
}

/* ══════════════════════════════════════ */
/*     SEVERITY HELPERS                   */
/* ══════════════════════════════════════ */

/** Returns a numeric severity (0=lowest, 4=highest) for sorting/display */
export function stateSeverity(state: DecisionState): number {
  switch (state) {
    case "DEPEG_CONFIRMED": return 4;
    case "OVERRIDE_CRITICAL": return 3;
    case "DEPEG_HIGH_RISK": return 2;
    case "OVERRIDE_WARNING": return 2;
    case "DATA_STALE": return 1;
    case "DATA_UNSTABLE": return 1;
    case "WATCH": return 0;
    case "OK": return 0;
  }
}

/** Returns a human-readable French label */
export function stateLabel(state: DecisionState): string {
  switch (state) {
    case "DEPEG_CONFIRMED": return "DEPEG CONFIRMÉ";
    case "DEPEG_HIGH_RISK": return "RISQUE DEPEG";
    case "OVERRIDE_CRITICAL": return "OVERRIDE CRITIQUE";
    case "OVERRIDE_WARNING": return "OVERRIDE ALERTE";
    case "DATA_UNSTABLE": return "DONNÉES INSTABLES";
    case "DATA_STALE": return "DONNÉES OBSOLÈTES";
    case "WATCH": return "SURVEILLANCE";
    case "OK": return "OK";
  }
}

/** Returns a display color for the state */
export function stateColor(state: DecisionState): string {
  switch (state) {
    case "DEPEG_CONFIRMED": return "rgba(229, 57, 53, 0.9)";
    case "OVERRIDE_CRITICAL": return "rgba(229, 57, 53, 0.8)";
    case "DEPEG_HIGH_RISK": return "rgba(255, 152, 0, 0.9)";
    case "OVERRIDE_WARNING": return "rgba(255, 152, 0, 0.8)";
    case "DATA_STALE": return "rgba(158, 158, 158, 0.8)";
    case "DATA_UNSTABLE": return "rgba(158, 158, 158, 0.7)";
    case "WATCH": return "rgba(255, 193, 7, 0.7)";
    case "OK": return "rgba(76, 175, 80, 0.8)";
  }
}
