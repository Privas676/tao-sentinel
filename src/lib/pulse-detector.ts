/* ═══════════════════════════════════════════════════════════ */
/*   TAOSTATS PRICE PULSE DETECTOR (Lot 1)                      */
/*                                                              */
/*   Mission : DÉTECTER tous les pumps visibles sur TaoStats,   */
/*             même risqués, illiquides, inconnus, toxiques.    */
/*                                                              */
/*   Règle absolue :                                            */
/*   - Pas de filtrage par risk_score                           */
/*   - Pas de filtrage par quality_score                        */
/*   - Pas de filtrage par opportunity_score                    */
/*   - Pas de filtrage par mapping name (Unknown OK)            */
/*   - Pas de filtrage par présence en portefeuille             */
/*                                                              */
/*   Le pump est d'abord détecté, PUIS classifié prudemment.    */
/*   Identifiant primaire : netuid (jamais le nom).             */
/* ═══════════════════════════════════════════════════════════ */

import type { CanonicalSubnetFacts, ExternalStatus } from "./canonical-types";
import type { CanonicalSubnetDecision } from "./canonical-types";
import type { DataTrustResult } from "./data-trust";

/* ── Types ── */

export type PulseType =
  | "PUMP_LIVE"
  | "EXTREME_PUMP"
  | "DAILY_BREAKOUT"
  | "WEEKLY_ROTATION"
  | "DEAD_CAT_BOUNCE"
  | "ILLIQUID_PUMP"
  | "TOXIC_PUMP"
  | "OVEREXTENDED"
  | "NONE";

export type PulseTradability =
  | "TRADABLE_CANDIDATE"
  | "WATCH_ONLY"
  | "LATE_PUMP"
  | "DEAD_CAT"
  | "ILLIQUID"
  | "TOXIC"
  | "AVOID"
  | "NEEDS_CONFIRMATION";

export type PulseRiskLabel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type PulseResult = {
  netuid: number;
  name: string;                   // jamais null — fallback "SN-{netuid} Unknown"
  pulse_type: PulseType;
  pulse_score: number;            // 0-100 indépendant du risk
  tradability: PulseTradability;
  risk_label: PulseRiskLabel;
  reasons: string[];
  // Raw market signals echoed for the UI (Layer A — faits bruts)
  price_change_1h: number | null;
  price_change_24h: number | null;
  price_change_7d: number | null;
  price_change_30d: number | null;
  volume_24h: number | null;
  liquidity: number | null;        // tao_in_pool
  alpha_in_pool: number | null;
  pool_ratio: number | null;
  slippage_1tau: number | null;
  slippage_10tau: number | null;
  spread: number | null;
  buys_count: number | null;
  sells_count: number | null;
  emissions_pct: number | null;
  data_freshness_ok: boolean;
  has_partial_data: boolean;
  /** Raw facts trigger a pulse but canonical engine is NEUTRAL — needs human review. */
  engineConflict: boolean;
  /** Short label for the conflict (UI). */
  conflict_reason: string | null;
  detected_at: string;
};

/* ── Thresholds (configurable centrally) ── */

export const PULSE_THRESHOLDS = {
  pumpLive1h: 3,
  pumpLive24h: 8,
  extreme1h: 8,
  extreme24h: 20,
  dailyBreakout24h: 8,
  weeklyRotation7d: 25,
  deadCat24h: 15,
  deadCatLoss7d: -30,
  deadCatLoss30d: -50,
  // liquidité considérée faible (TAO in pool ou volume 24h)
  illiquidPoolTau: 50,
  illiquidVol24hTau: 0.5,
  // seuils du score
  scoreLive: 85,
  scoreWatch: 70,
  scoreBuilding: 55,
} as const;

/* ── Helpers ── */

function safeName(facts: CanonicalSubnetFacts): string {
  const n = (facts.subnet_name ?? "").trim();
  if (n.length > 0) return n;
  return `SN-${facts.subnet_id} Unknown`;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function normalize(value: number, mid: number, max: number): number {
  // Linear ramp 0→100 with `mid` mapped to 50 and `max` mapped to 100
  if (value <= 0) return 0;
  if (value >= max) return 100;
  if (value <= mid) return Math.round((value / mid) * 50);
  return Math.round(50 + ((value - mid) / (max - mid)) * 50);
}

function isExternalToxic(status: ExternalStatus): boolean {
  return status.startsWith("P"); // P1..P10 = critical
}

/* ── Score Pulse (independent of risk) ── */

/**
 * Compute the price_pulse_score (0-100) using ONLY market movement signals.
 * Risk, structure, name, portfolio are NOT inputs here.
 */
export function computePulseScore(f: CanonicalSubnetFacts): {
  score: number;
  hasPartial: boolean;
} {
  // Track which inputs were available so we can flag partial data.
  let availableWeight = 0;
  let totalWeight = 0;
  let acc = 0;

  const add = (weight: number, normalized: number, present: boolean) => {
    totalWeight += weight;
    if (present) {
      acc += weight * normalized;
      availableWeight += weight;
    }
  };

  add(35, normalize(Math.max(0, f.change_1h ?? 0), 3, 12), f.change_1h != null);
  add(25, normalize(Math.max(0, f.change_24h ?? 0), 8, 30), f.change_24h != null);
  add(15, normalize(Math.max(0, f.change_7d ?? 0), 25, 80), f.change_7d != null);

  // volume / market_cap
  const vmc =
    f.volume_24h != null && f.market_cap != null && f.market_cap > 0
      ? (f.volume_24h / f.market_cap) * 100
      : null;
  add(10, normalize(Math.max(0, vmc ?? 0), 5, 25), vmc != null);

  // 24h volume in TAO as flow proxy (we don't have flow_1d in the canonical model)
  add(10, normalize(Math.max(0, f.volume_24h ?? 0), 5, 50), f.volume_24h != null);

  // Buys count as chain_buys signal
  add(5, normalize(f.buys_count ?? 0, 5, 30), f.buys_count != null);

  if (availableWeight === 0) return { score: 0, hasPartial: true };
  // Rescale on the available weight so missing inputs don't sink the score.
  const score = clamp(Math.round(acc / availableWeight), 0, 100);
  const hasPartial = availableWeight < totalWeight;
  return { score, hasPartial };
}

/* ── Pump classification (rules-first, score is informative) ── */

type ClassificationContext = {
  isIlliquid: boolean;
  isToxic: boolean;
  hasDecision: boolean;
};

function classifyPulseType(
  f: CanonicalSubnetFacts,
  ctx: ClassificationContext,
  reasons: string[],
): PulseType {
  const ch1h = f.change_1h ?? 0;
  const ch24h = f.change_24h ?? 0;
  const ch7d = f.change_7d ?? 0;
  const ch30d = f.change_30d ?? 0;

  // 1) DEAD_CAT_BOUNCE — overrides all positive types
  const bigDay = ch24h >= PULSE_THRESHOLDS.deadCat24h;
  const collapsedWeek = ch7d <= PULSE_THRESHOLDS.deadCatLoss7d;
  const collapsedMonth = ch30d <= PULSE_THRESHOLDS.deadCatLoss30d;
  if (bigDay && (collapsedWeek || collapsedMonth)) {
    reasons.push(
      `Dead-cat: +${ch24h.toFixed(1)}% 1D mais ${
        collapsedWeek ? `${ch7d.toFixed(1)}% 7D` : `${ch30d.toFixed(1)}% 30D`
      }`,
    );
    return "DEAD_CAT_BOUNCE";
  }

  // 2) Detect any pump signal first (we still want to surface toxic/illiquid pumps)
  const hasPumpSignal =
    ch1h >= PULSE_THRESHOLDS.pumpLive1h ||
    ch24h >= PULSE_THRESHOLDS.pumpLive24h ||
    ch7d >= PULSE_THRESHOLDS.weeklyRotation7d;

  // 3) TOXIC_PUMP / ILLIQUID_PUMP override the "clean" pump labels
  if (hasPumpSignal && ctx.isToxic) {
    reasons.push("Pump détecté sur subnet toxique (dereg/depeg/delist/structure)");
    return "TOXIC_PUMP";
  }
  if (hasPumpSignal && ctx.isIlliquid) {
    reasons.push("Pump détecté avec liquidité faible");
    return "ILLIQUID_PUMP";
  }

  // 4) EXTREME_PUMP
  if (
    ch1h >= PULSE_THRESHOLDS.extreme1h ||
    ch24h >= PULSE_THRESHOLDS.extreme24h
  ) {
    reasons.push(
      `Pump extrême: ${ch1h >= PULSE_THRESHOLDS.extreme1h ? `+${ch1h.toFixed(1)}% 1H` : `+${ch24h.toFixed(1)}% 1D`}`,
    );
    return "EXTREME_PUMP";
  }

  // 5) DAILY_BREAKOUT — 24h above threshold AND 1h non-negative
  if (ch24h >= PULSE_THRESHOLDS.dailyBreakout24h && ch1h >= 0) {
    reasons.push(`Breakout journalier: +${ch24h.toFixed(1)}% 1D, 1H ${ch1h >= 0 ? "+" : ""}${ch1h.toFixed(1)}%`);
    return "DAILY_BREAKOUT";
  }

  // 6) WEEKLY_ROTATION — 7d strong AND 30d not collapsed
  if (ch7d >= PULSE_THRESHOLDS.weeklyRotation7d && ch30d >= -10) {
    reasons.push(`Rotation hebdo: +${ch7d.toFixed(1)}% 7J`);
    return "WEEKLY_ROTATION";
  }

  // 7) PUMP_LIVE — base case
  if (
    ch1h >= PULSE_THRESHOLDS.pumpLive1h ||
    ch24h >= PULSE_THRESHOLDS.pumpLive24h
  ) {
    reasons.push(
      `Pump live: ${ch1h >= PULSE_THRESHOLDS.pumpLive1h ? `+${ch1h.toFixed(1)}% 1H` : `+${ch24h.toFixed(1)}% 1D`}`,
    );
    return "PUMP_LIVE";
  }

  return "NONE";
}

/* ── Tradability (prudent classification — never hides pumps) ── */

function classifyTradability(
  pulseType: PulseType,
  f: CanonicalSubnetFacts,
  decision: CanonicalSubnetDecision | undefined,
  dataTrustOk: boolean,
  hasPartial: boolean,
  ctx: ClassificationContext,
): PulseTradability {
  if (pulseType === "DEAD_CAT_BOUNCE") return "DEAD_CAT";
  if (pulseType === "TOXIC_PUMP") return "TOXIC";
  if (pulseType === "ILLIQUID_PUMP") return "ILLIQUID";

  if (!dataTrustOk) return "NEEDS_CONFIRMATION";
  if (hasPartial) return "NEEDS_CONFIRMATION";

  // EXTREME_PUMP late = AVOID, otherwise WATCH_ONLY
  if (pulseType === "EXTREME_PUMP") {
    if ((f.change_7d ?? 0) > 80 || (f.change_30d ?? 0) > 200) return "LATE_PUMP";
    return "WATCH_ONLY";
  }

  // For positive types, gate ENTER candidacy on canonical decision
  const fa = decision?.final_action;
  if (fa === "SORTIR" || fa === "ÉVITER" || fa === "SYSTÈME") return "AVOID";

  // Clean pumps with healthy decision context
  if (
    (pulseType === "PUMP_LIVE" ||
      pulseType === "DAILY_BREAKOUT" ||
      pulseType === "WEEKLY_ROTATION") &&
    decision &&
    decision.risk_decision_score <= 35 &&
    decision.liquidity_quality_score >= 70 &&
    decision.confidence_score >= 90 &&
    !ctx.isIlliquid &&
    !ctx.isToxic
  ) {
    return "TRADABLE_CANDIDATE";
  }

  return "WATCH_ONLY";
}

/* ── Risk label (informative, decoupled from pump detection) ── */

function classifyRiskLabel(
  pulseType: PulseType,
  decision: CanonicalSubnetDecision | undefined,
  ctx: ClassificationContext,
): PulseRiskLabel {
  if (pulseType === "TOXIC_PUMP" || pulseType === "DEAD_CAT_BOUNCE") return "CRITICAL";
  if (ctx.isToxic) return "CRITICAL";
  if (pulseType === "ILLIQUID_PUMP") return "HIGH";
  if (decision) {
    if (decision.risk_decision_score >= 70) return "CRITICAL";
    if (decision.risk_decision_score >= 50) return "HIGH";
    if (decision.risk_decision_score >= 30) return "MEDIUM";
  }
  if (pulseType === "EXTREME_PUMP") return "HIGH";
  return "LOW";
}

/* ── Liquidity heuristic — RAW FACTS FIRST (no risk-score filtering) ── */

const LIQ_RAW = {
  poolTau: 50,           // tao_in_pool < 50 TAO
  vol24hTau: 0.5,        // volume_24h < 0.5 TAO
  slippage1Pct: 1.5,     // slippage 1 TAO > 1.5%
  slippage10Pct: 8,      // slippage 10 TAO > 8%
  spreadPct: 1.5,        // spread > 1.5%
  poolRatioMin: 0.05,    // pool ratio out of band
  poolRatioMax: 20,
} as const;

function isLiquidityWeak(f: CanonicalSubnetFacts): boolean {
  const pool = f.tao_in_pool ?? 0;
  const vol = f.volume_24h ?? 0;
  if (pool > 0 && pool < LIQ_RAW.poolTau) return true;
  if (vol > 0 && vol < LIQ_RAW.vol24hTau) return true;
  if ((f.slippage_1tau ?? 0) > LIQ_RAW.slippage1Pct) return true;
  if ((f.slippage_10tau ?? 0) > LIQ_RAW.slippage10Pct) return true;
  if ((f.spread ?? 0) > LIQ_RAW.spreadPct) return true;
  if (
    f.tao_pool_ratio != null &&
    (f.tao_pool_ratio < LIQ_RAW.poolRatioMin || f.tao_pool_ratio > LIQ_RAW.poolRatioMax)
  ) {
    return true;
  }
  return false;
}

/* ── Toxicity heuristic — RAW FACTS first, then decision enrichment ── */

function isStructurallyToxic(
  f: CanonicalSubnetFacts,
  decision: CanonicalSubnetDecision | undefined,
): boolean {
  // RAW: emission nulle = subnet structurellement mort
  if ((f.emissions_pct ?? 1) === 0 && (f.emissions_day ?? 1) === 0) return true;
  // RAW: external status TaoFlute P1..P10
  if (isExternalToxic(f.external_status)) return true;
  // Enrichi par le moteur si dispo (mais ne supprime jamais le pump)
  if (decision) {
    if (decision.depeg_risk_score >= 50) return true;
    if (decision.delist_risk_score >= 60) return true;
    if (decision.structural_fragility_score >= 75) return true;
    if (decision.guardrail_active && decision.final_action === "ÉVITER") return true;
  }
  return false;
}

/* ── Public API : single subnet ── */

export function detectPulse(
  facts: CanonicalSubnetFacts,
  decision: CanonicalSubnetDecision | undefined,
  dataTrust?: DataTrustResult,
): PulseResult {
  const reasons: string[] = [];
  const { score, hasPartial } = computePulseScore(facts);

  const isIlliquid = isLiquidityWeak(facts);
  const isToxic = isStructurallyToxic(facts, decision);
  const ctx: ClassificationContext = {
    isIlliquid,
    isToxic,
    hasDecision: !!decision,
  };

  const pulseType = classifyPulseType(facts, ctx, reasons);
  const dataOk = !dataTrust ? true : !dataTrust.isSafeMode;
  const tradability = classifyTradability(
    pulseType,
    facts,
    decision,
    dataOk,
    hasPartial,
    ctx,
  );
  const risk_label = classifyRiskLabel(pulseType, decision, ctx);

  if (hasPartial) reasons.push("Données partielles — score recalibré");
  if (!dataOk) reasons.push("Données non fiables — confirmation requise");

  return {
    netuid: facts.subnet_id,
    name: safeName(facts),
    pulse_type: pulseType,
    pulse_score: score,
    tradability,
    risk_label,
    reasons,
    price_change_1h: facts.change_1h,
    price_change_24h: facts.change_24h,
    price_change_7d: facts.change_7d,
    price_change_30d: facts.change_30d,
    volume_24h: facts.volume_24h,
    liquidity: facts.tao_in_pool,
    data_freshness_ok: dataOk,
    has_partial_data: hasPartial,
    detected_at: new Date().toISOString(),
  };
}

/* ── Batch detection (no filtering at all) ── */

export function detectAllPulses(
  factsMap: Map<number, CanonicalSubnetFacts>,
  decisions?: Map<number, CanonicalSubnetDecision>,
  dataTrust?: DataTrustResult,
): Map<number, PulseResult> {
  const out = new Map<number, PulseResult>();
  for (const [netuid, facts] of factsMap) {
    // Skip system subnet 0 — never tradable as alpha.
    if (netuid === 0) continue;
    const decision = decisions?.get(netuid);
    out.set(netuid, detectPulse(facts, decision, dataTrust));
  }
  return out;
}

/* ── HOT NOW selector — top N pulses regardless of risk ── */

const PULSE_TYPE_PRIORITY: Record<PulseType, number> = {
  EXTREME_PUMP: 100,
  PUMP_LIVE: 90,
  DAILY_BREAKOUT: 85,
  WEEKLY_ROTATION: 80,
  DEAD_CAT_BOUNCE: 75,   // affiché car dangereux mais visible
  TOXIC_PUMP: 70,
  ILLIQUID_PUMP: 65,
  OVEREXTENDED: 60,
  NONE: 0,
};

export function selectHotNow(
  pulses: Map<number, PulseResult>,
  limit: number = 8,
): PulseResult[] {
  const list = Array.from(pulses.values()).filter((p) => p.pulse_type !== "NONE");
  list.sort((a, b) => {
    const pr = PULSE_TYPE_PRIORITY[b.pulse_type] - PULSE_TYPE_PRIORITY[a.pulse_type];
    if (pr !== 0) return pr;
    return b.pulse_score - a.pulse_score;
  });
  return list.slice(0, limit);
}

/* ── Display helpers ── */

export function pulseTypeLabel(t: PulseType, fr: boolean = true): string {
  if (fr) {
    return {
      PUMP_LIVE: "Pump live",
      EXTREME_PUMP: "Pump extrême",
      DAILY_BREAKOUT: "Breakout 24h",
      WEEKLY_ROTATION: "Rotation 7j",
      DEAD_CAT_BOUNCE: "Dead-cat",
      ILLIQUID_PUMP: "Pump illiquide",
      TOXIC_PUMP: "Pump toxique",
      OVEREXTENDED: "Surextension",
      NONE: "—",
    }[t];
  }
  return {
    PUMP_LIVE: "Live pump",
    EXTREME_PUMP: "Extreme",
    DAILY_BREAKOUT: "24h breakout",
    WEEKLY_ROTATION: "Weekly rotation",
    DEAD_CAT_BOUNCE: "Dead-cat",
    ILLIQUID_PUMP: "Illiquid pump",
    TOXIC_PUMP: "Toxic pump",
    OVEREXTENDED: "Overextended",
    NONE: "—",
  }[t];
}

export function tradabilityLabel(t: PulseTradability, fr: boolean = true): string {
  if (fr) {
    return {
      TRADABLE_CANDIDATE: "Candidat",
      WATCH_ONLY: "Surveiller",
      LATE_PUMP: "Trop tard",
      DEAD_CAT: "Éviter (dead-cat)",
      ILLIQUID: "Éviter (liquidité)",
      TOXIC: "Éviter (toxique)",
      AVOID: "Éviter",
      NEEDS_CONFIRMATION: "À confirmer",
    }[t];
  }
  return {
    TRADABLE_CANDIDATE: "Candidate",
    WATCH_ONLY: "Watch",
    LATE_PUMP: "Too late",
    DEAD_CAT: "Avoid (dead-cat)",
    ILLIQUID: "Avoid (illiquid)",
    TOXIC: "Avoid (toxic)",
    AVOID: "Avoid",
    NEEDS_CONFIRMATION: "Needs confirmation",
  }[t];
}

/** Suggested action (UI hint only, never auto-trades) */
export function pulseSuggestedAction(p: PulseResult, fr: boolean = true): string {
  switch (p.tradability) {
    case "TRADABLE_CANDIDATE":
      return fr ? "Évaluer pour entrée prudente" : "Evaluate for prudent entry";
    case "WATCH_ONLY":
      return fr ? "Surveiller" : "Watch";
    case "LATE_PUMP":
      return fr ? "Ne pas chasser" : "Do not chase";
    case "DEAD_CAT":
      return fr ? "Éviter — dead-cat" : "Avoid — dead-cat";
    case "ILLIQUID":
      return fr ? "Éviter — liquidité faible" : "Avoid — illiquid";
    case "TOXIC":
      return fr ? "Éviter — structure critique" : "Avoid — toxic";
    case "AVOID":
      return fr ? "Éviter" : "Avoid";
    case "NEEDS_CONFIRMATION":
      return fr ? "À confirmer — données incertaines" : "Needs confirmation";
  }
}
