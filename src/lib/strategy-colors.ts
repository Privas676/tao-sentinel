/* ═══════════════════════════════════════ */
/*   STRATEGY COLOR / ICON HELPERS         */
/* ═══════════════════════════════════════ */

import type { MacroRecommendation } from "./strategy-macro";
import type { StrategicAction } from "./strategy-subnet";

// ── Macro colors ──

export function macroColor(rec: MacroRecommendation): string {
  switch (rec) {
    case "INCREASE": return "rgba(76,175,80,0.9)";
    case "NEUTRAL": return "rgba(255,193,7,0.9)";
    case "REDUCE": return "rgba(229,57,53,0.9)";
  }
}

export function macroBg(rec: MacroRecommendation): string {
  switch (rec) {
    case "INCREASE": return "rgba(76,175,80,0.08)";
    case "NEUTRAL": return "rgba(255,193,7,0.06)";
    case "REDUCE": return "rgba(229,57,53,0.08)";
  }
}

export function macroBorder(rec: MacroRecommendation): string {
  switch (rec) {
    case "INCREASE": return "rgba(76,175,80,0.25)";
    case "NEUTRAL": return "rgba(255,193,7,0.2)";
    case "REDUCE": return "rgba(229,57,53,0.25)";
  }
}

export function macroIcon(rec: MacroRecommendation): string {
  switch (rec) {
    case "INCREASE": return "📈";
    case "NEUTRAL": return "⚖️";
    case "REDUCE": return "📉";
  }
}

// ── Action colors ──

export function actionColor(action: StrategicAction): string {
  switch (action) {
    case "ENTER": return "rgba(76,175,80,0.9)";
    case "WATCH": return "rgba(255,193,7,0.9)";
    case "EXIT": return "rgba(229,57,53,0.9)";
    case "STAKE": return "rgba(100,181,246,0.9)";
    case "NEUTRAL": return "rgba(158,158,158,0.9)";
    case "HOLD": return "rgba(100,181,246,0.9)";
  }
}

export function actionBg(action: StrategicAction): string {
  switch (action) {
    case "ENTER": return "rgba(76,175,80,0.08)";
    case "WATCH": return "rgba(255,193,7,0.06)";
    case "EXIT": return "rgba(229,57,53,0.08)";
    case "STAKE": return "rgba(100,181,246,0.06)";
    case "NEUTRAL": return "rgba(158,158,158,0.06)";
    case "HOLD": return "rgba(100,181,246,0.06)";
  }
}

export function actionBorder(action: StrategicAction): string {
  switch (action) {
    case "ENTER": return "rgba(76,175,80,0.25)";
    case "WATCH": return "rgba(255,193,7,0.2)";
    case "EXIT": return "rgba(229,57,53,0.25)";
    case "STAKE": return "rgba(100,181,246,0.2)";
    case "NEUTRAL": return "rgba(158,158,158,0.2)";
    case "HOLD": return "rgba(100,181,246,0.2)";
  }
}

export function actionIcon(action: StrategicAction): string {
  switch (action) {
    case "ENTER": return "🟢";
    case "WATCH": return "🟡";
    case "EXIT": return "🔴";
    case "STAKE": return "🔵";
    case "NEUTRAL": return "⚪";
    case "HOLD": return "🔷";
  }
}
