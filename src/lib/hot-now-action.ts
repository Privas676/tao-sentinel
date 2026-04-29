/* ═══════════════════════════════════════════════════════════ */
/*   HOT NOW ACTION MAPPING (Lot 2)                             */
/*                                                              */
/*   Maps a PulseResult + canonical decision + position state   */
/*   to a single user-facing action:                            */
/*     GO        → all prudent conditions met                   */
/*     WATCH     → interesting signal but incomplete            */
/*     AVOID     → TOXIC / DEAD_CAT / ILLIQUID / high risk      */
/*     EXIT_FAST → user holds + critical risk                   */
/* ═══════════════════════════════════════════════════════════ */

import type { PulseResult } from "./pulse-detector";
import type { CanonicalSubnetDecision } from "./canonical-types";

export type HotNowAction = "GO" | "WATCH" | "AVOID" | "EXIT_FAST";

export function deriveHotNowAction(
  pulse: PulseResult,
  decision: CanonicalSubnetDecision | undefined,
  isHeld: boolean,
): HotNowAction {
  // Critical danger types
  const isCritical =
    pulse.tradability === "TOXIC" ||
    pulse.tradability === "DEAD_CAT" ||
    pulse.tradability === "ILLIQUID" ||
    pulse.risk_label === "CRITICAL";

  if (isHeld && isCritical) return "EXIT_FAST";
  if (isCritical) return "AVOID";

  // Non-investable canonical decisions
  if (decision) {
    const fa = decision.final_action;
    if (fa === "ÉVITER" || fa === "SORTIR" || fa === "SYSTÈME") {
      return isHeld ? "EXIT_FAST" : "AVOID";
    }
  }

  if (pulse.tradability === "AVOID") return "AVOID";
  if (pulse.tradability === "LATE_PUMP") return "AVOID";

  // GO requires all prudent conditions
  if (
    pulse.tradability === "TRADABLE_CANDIDATE" &&
    pulse.data_freshness_ok &&
    !pulse.has_partial_data &&
    decision &&
    decision.final_action === "ENTRER"
  ) {
    return "GO";
  }

  return "WATCH";
}

export function actionLabel(a: HotNowAction, fr: boolean = true): string {
  if (fr) {
    return { GO: "GO", WATCH: "WATCH", AVOID: "ÉVITER", EXIT_FAST: "EXIT FAST" }[a];
  }
  return { GO: "GO", WATCH: "WATCH", AVOID: "AVOID", EXIT_FAST: "EXIT FAST" }[a];
}

export function actionExplanation(a: HotNowAction, pulse: PulseResult, fr: boolean = true): string {
  const why = pulse.reasons[0] ?? "";
  if (fr) {
    switch (a) {
      case "GO": return "Conditions prudentes réunies — entrée évaluable";
      case "WATCH": return why || "Signal intéressant, conditions incomplètes";
      case "AVOID": return why || "Risque élevé — ne pas entrer";
      case "EXIT_FAST": return "Position détenue + risque critique — sortir vite";
    }
  }
  switch (a) {
    case "GO": return "All prudent conditions met";
    case "WATCH": return why || "Interesting signal, incomplete conditions";
    case "AVOID": return why || "High risk — do not enter";
    case "EXIT_FAST": return "Held position + critical risk — exit fast";
  }
}
