/* ═══════════════════════════════════════ */
/*   DEPEG PROBABILITY ENGINE v2            */
/*   Pure price-drop based detection        */
/*   with tick confirmation + hysteresis    */
/* ═══════════════════════════════════════ */

export type DepegState = "NORMAL" | "DEPEG_HIGH_RISK" | "DEPEG_CONFIRMED";

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
};

export type DepegResult = {
  netuid: number;
  state: DepegState;
  confirmedTicks: number;
  stateEnteredAt: number;
  drop24: number | null;   // percent drop (negative = down)
  drop7: number | null;    // percent drop (negative = down)
  signals: DepegSignal[];
};

export type DepegSignal = {
  code: string;
  label: string;
  value?: number;
};

/* ── Thresholds ── */

/** RISQUE_DEPEG entry thresholds */
const HIGH_RISK_DROP24 = -0.20;  // -20% over 24h
const HIGH_RISK_DROP7  = -0.35;  // -35% over 7d

/** DEPEG_CONFIRMED entry thresholds */
const CONFIRMED_DROP24 = -0.30;  // -30% over 24h
const CONFIRMED_DROP7  = -0.50;  // -50% over 7d

/** Ticks required to confirm states */
const HIGH_RISK_CONFIRM_TICKS = 2;
const CONFIRMED_CONFIRM_TICKS = 3;

/** Hysteresis exit thresholds (must be sustained for EXIT_TICKS) */
const EXIT_DROP24 = -0.10;  // better than -10% 24h
const EXIT_DROP7  = -0.20;  // better than -20% 7d
const EXIT_TICKS  = 6;

/* ── State cache (per subnet) ── */

type DepegStateEntry = {
  state: DepegState;
  confirmedTicks: number;       // ticks meeting current threshold
  stateEnteredAt: number;
  exitTicks: number;            // consecutive ticks meeting exit criteria
  lastDrop24: number | null;
  lastDrop7: number | null;
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

/* ── Drop computation ── */

function computeDrops(input: DepegInput): { drop24: number | null; drop7: number | null } {
  const { alphaPrice, price24hAgo, price7dAgo } = input;

  let drop24: number | null = null;
  if (price24hAgo != null && price24hAgo > 0 && alphaPrice >= 0) {
    drop24 = (alphaPrice - price24hAgo) / price24hAgo; // negative = price fell
  }

  let drop7: number | null = null;
  if (price7dAgo != null && price7dAgo > 0 && alphaPrice >= 0) {
    drop7 = (alphaPrice - price7dAgo) / price7dAgo;
  }

  return { drop24, drop7 };
}

/* ── Signal generation ── */

function buildSignals(drop24: number | null, drop7: number | null): DepegSignal[] {
  const signals: DepegSignal[] = [];

  if (drop24 != null) {
    signals.push({
      code: "DROP_24H",
      label: `Chute 24h: ${(drop24 * 100).toFixed(1)}%`,
      value: Math.round(drop24 * 100),
    });
  }
  if (drop7 != null) {
    signals.push({
      code: "DROP_7D",
      label: `Chute 7j: ${(drop7 * 100).toFixed(1)}%`,
      value: Math.round(drop7 * 100),
    });
  }

  return signals;
}

/* ── Threshold checks ── */

function meetsHighRiskThreshold(drop24: number | null, drop7: number | null): boolean {
  return (drop24 != null && drop24 <= HIGH_RISK_DROP24) ||
         (drop7 != null && drop7 <= HIGH_RISK_DROP7);
}

function meetsConfirmedThreshold(drop24: number | null, drop7: number | null): boolean {
  return (drop24 != null && drop24 <= CONFIRMED_DROP24) ||
         (drop7 != null && drop7 <= CONFIRMED_DROP7);
}

function meetsExitCriteria(drop24: number | null, drop7: number | null): boolean {
  // Both must be above exit threshold (recovered enough)
  const d24ok = drop24 == null || drop24 > EXIT_DROP24;
  const d7ok  = drop7 == null || drop7 > EXIT_DROP7;
  return d24ok && d7ok;
}

/* ── Guard rails ── */

function canConfirmDepeg(input: DepegInput): boolean {
  // Cannot confirm if < 7 days of history
  if (input.historyDays != null && input.historyDays < 7) return false;
  // Cannot confirm if data confidence < 70%
  if (input.dataConfidence != null && input.dataConfidence < 70) return false;
  return true;
}

/* ── Public: compute probability (backward compat) ── */

/**
 * Compute depeg signals from price drops.
 * Returns drop values and signal breakdown.
 */
export function computeDepegProbability(input: DepegInput): { probability: number; signals: DepegSignal[]; drop24: number | null; drop7: number | null } {
  const { drop24, drop7 } = computeDrops(input);
  const signals = buildSignals(drop24, drop7);

  // Simple probability mapping for display
  let probability = 0;
  if (meetsConfirmedThreshold(drop24, drop7)) {
    probability = 90;
  } else if (meetsHighRiskThreshold(drop24, drop7)) {
    probability = 60;
  } else {
    // Mild concern if any drop > 10%
    const worst = Math.min(drop24 ?? 0, drop7 ?? 0);
    if (worst < -0.10) {
      probability = Math.round(Math.min(40, Math.abs(worst) * 200));
    }
  }

  return { probability, signals, drop24, drop7 };
}

/* ── State Machine with hysteresis ── */

/**
 * Evaluate depeg state for a subnet using pure price-drop logic.
 * Uses tick-based confirmation and hysteresis.
 */
export function evaluateDepegState(input: DepegInput, now: number = Date.now()): DepegResult {
  const { drop24, drop7 } = computeDrops(input);
  const signals = buildSignals(drop24, drop7);
  const netuid = input.netuid;

  // Get or create state entry
  let entry = stateCache.get(netuid);
  if (!entry) {
    entry = {
      state: "NORMAL",
      confirmedTicks: 0,
      stateEnteredAt: now,
      exitTicks: 0,
      lastDrop24: null,
      lastDrop7: null,
    };
    stateCache.set(netuid, entry);
  }

  const prevState = entry.state;

  // ─── State transitions ───

  if (prevState === "NORMAL") {
    if (meetsHighRiskThreshold(drop24, drop7)) {
      entry.confirmedTicks++;
      if (entry.confirmedTicks >= HIGH_RISK_CONFIRM_TICKS) {
        entry.state = "DEPEG_HIGH_RISK";
        entry.stateEnteredAt = now;
        entry.confirmedTicks = 0;
        entry.exitTicks = 0;
      }
    } else {
      entry.confirmedTicks = 0;
    }
  }

  else if (prevState === "DEPEG_HIGH_RISK") {
    if (meetsConfirmedThreshold(drop24, drop7) && canConfirmDepeg(input)) {
      entry.confirmedTicks++;
      if (entry.confirmedTicks >= CONFIRMED_CONFIRM_TICKS) {
        entry.state = "DEPEG_CONFIRMED";
        entry.stateEnteredAt = now;
        entry.confirmedTicks = 0;
        entry.exitTicks = 0;
      }
    } else if (meetsHighRiskThreshold(drop24, drop7)) {
      // Stay in HIGH_RISK, reset confirmed tick count for upgrade
      entry.confirmedTicks = 0;
    } else {
      // Dropped below HIGH_RISK threshold → back to NORMAL
      entry.state = "NORMAL";
      entry.confirmedTicks = 0;
      entry.stateEnteredAt = now;
      entry.exitTicks = 0;
    }
  }

  else if (prevState === "DEPEG_CONFIRMED") {
    // Hysteresis: only exit if drops recover for EXIT_TICKS consecutive scans
    if (meetsExitCriteria(drop24, drop7)) {
      entry.exitTicks++;
      if (entry.exitTicks >= EXIT_TICKS) {
        entry.state = "NORMAL";
        entry.confirmedTicks = 0;
        entry.stateEnteredAt = now;
        entry.exitTicks = 0;
      }
    } else {
      // Still bad → reset exit counter
      entry.exitTicks = 0;
    }
  }

  entry.lastDrop24 = drop24;
  entry.lastDrop7 = drop7;

  // Log state transitions
  if (entry.state !== prevState) {
    console.log(`[DEPEG] SN-${netuid}: ${prevState} → ${entry.state} | drop24=${drop24 != null ? (drop24 * 100).toFixed(1) + '%' : 'N/A'} | drop7=${drop7 != null ? (drop7 * 100).toFixed(1) + '%' : 'N/A'}`);
  }

  return {
    netuid,
    state: entry.state,
    confirmedTicks: entry.confirmedTicks,
    stateEnteredAt: entry.stateEnteredAt,
    drop24,
    drop7,
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
    case "DEPEG_HIGH_RISK": return fr ? "Risque Depeg" : "Depeg Risk";
    case "DEPEG_CONFIRMED": return fr ? "Depeg Confirmé" : "Depeg Confirmed";
  }
}
