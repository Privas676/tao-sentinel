/* ═══════════════════════════════════════ */
/*   STRATEGY ENGINE — BARREL RE-EXPORT    */
/* ═══════════════════════════════════════ */
/*   Split into focused modules:           */
/*   - strategy-macro.ts   (Sentinel + Macro) */
/*   - strategy-subnet.ts  (Per-subnet actions) */
/*   - strategy-colors.ts  (Color/icon helpers) */
/* ═══════════════════════════════════════ */

// Macro
export {
  type MacroRecommendation,
  deriveMacroRecommendation,
  computeSentinelIndex,
  sentinelIndexColor,
  sentinelIndexLabel,
} from "./strategy-macro";

// Subnet actions
export {
  type StrategicAction,
  type StrategyMode,
  deriveStrategicAction,
  deriveStrategicActionMicro,
  deriveSubnetAction,
} from "./strategy-subnet";

// Colors & icons
export {
  macroColor, macroBg, macroBorder, macroIcon,
  actionColor, actionBg, actionBorder, actionIcon,
  actionLabel, actionLabelFr, actionLabelEn,
} from "./strategy-colors";
