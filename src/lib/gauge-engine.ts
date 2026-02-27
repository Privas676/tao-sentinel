/* ═══════════════════════════════════════ */
/*     ALIEN GAUGE — OPPORTUNITY/RISK ENGINE */
/* ═══════════════════════════════════════ */

export type GaugeState = "CALM" | "ALERT" | "IMMINENT" | "EXIT";
export type GaugePhase = "BUILD" | "ARMED" | "TRIGGER" | "NONE";
export type Asymmetry = "HIGH" | "MED" | "LOW";

export type SubnetSignal = {
  netuid: number;
  name: string;
  psi: number;
  opportunity: number;      // 0-100
  risk: number;             // 0-100
  t_minus_minutes: number;
  confidence: number;
  state: GaugeState;
  phase: GaugePhase;
  asymmetry: Asymmetry;
  sparkline_7d: number[];
  liquidity: number;
  momentum: number;
  reasons: string[];        // max 3
  dominant: "opportunity" | "risk" | "neutral";
};

export type RawSignal = {
  netuid: number | null;
  subnet_name: string | null;
  state: string | null;
  score: number | null;
  mpi: number | null;
  confidence_pct: number | null;
  quality_score: number | null;
  reasons: any;
  miner_filter: string | null;
  ts: string | null;
};

export function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

/* PSI thresholds */
export const PSI_THRESHOLDS = {
  BUILD_MIN: 35,
  ARMED_MIN: 55,
  TRIGGER_MIN: 70,
  IMMINENT_MIN: 85,
  IMMINENT_CONFIDENCE: 70,
};

export function deriveGaugeState(psi: number, confidence: number, riskHigh = false): GaugeState {
  if (riskHigh) return "EXIT";
  if (psi >= PSI_THRESHOLDS.IMMINENT_MIN && confidence >= PSI_THRESHOLDS.IMMINENT_CONFIDENCE) return "IMMINENT";
  if (psi >= PSI_THRESHOLDS.BUILD_MIN) return "ALERT";
  return "CALM";
}

export function derivePhase(psi: number): GaugePhase {
  if (psi >= PSI_THRESHOLDS.TRIGGER_MIN) return "TRIGGER";
  if (psi >= PSI_THRESHOLDS.ARMED_MIN) return "ARMED";
  if (psi >= PSI_THRESHOLDS.BUILD_MIN) return "BUILD";
  return "NONE";
}

export function deriveTMinus(psi: number): number {
  if (psi >= 95) return 2;
  if (psi >= 85) return Math.max(2, Math.round(12 - (psi - 85) * 1));
  if (psi >= 70) return Math.round(35 - (psi - 70) * 1.5);
  if (psi >= 55) return Math.round(90 - (psi - 55) * 3.5);
  if (psi >= 35) return Math.round(240 - (psi - 35) * 7.5);
  return Math.min(1440, Math.round(360 + (35 - psi) * 10));
}

export function formatTMinus(minutes: number): string {
  if (minutes < 60) return `T-${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `T-${h}h${m}m` : `T-${h}h`;
}

export function formatTimeClear(minutes: number): string {
  if (minutes < 60) return `${minutes}min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
}

/* ═══════════════════════════════════════ */
/*   OPPORTUNITY / RISK ENGINE              */
/* ═══════════════════════════════════════ */

/** Derive opportunity score from raw signal data */
function deriveOpportunity(psi: number, conf: number, quality: number, state: string | null): number {
  let opp = 0;
  // Momentum component (PSI-based) — higher PSI = more opportunity signal
  opp += clamp(psi * 0.45, 0, 45);
  // Confidence/consensus component
  opp += clamp(conf * 0.25, 0, 25);
  // Quality/adoption component
  opp += clamp(quality * 0.20, 0, 20);
  // Bond/traction bonus for high-signal states
  if (state === "GO" || state === "GO_SPECULATIVE") opp += 10;
  return Math.round(clamp(opp, 0, 100));
}

/** Derive risk score from raw signal data */
function deriveRisk(psi: number, conf: number, quality: number, state: string | null): number {
  let risk = 0;
  // Break/exit states carry high risk
  if (state === "BREAK" || state === "EXIT_FAST") risk += 45;
  // Inverse quality = higher risk (low adoption = risky)
  risk += clamp((100 - quality) * 0.25, 0, 25);
  // Low confidence = uncertain = risky
  risk += clamp((100 - conf) * 0.15, 0, 15);
  // Very high PSI can also signal overheated/volatile
  if (psi >= 85) risk += clamp((psi - 85) * 1.5, 0, 15);
  // Low PSI = low activity = low risk but also low signal
  if (psi < 20) risk = Math.max(risk - 10, 5);
  return Math.round(clamp(risk, 0, 100));
}

/** Generate explainable reasons (max 3) */
function deriveReasons(
  psi: number, conf: number, quality: number,
  state: string | null, lang: "fr" | "en" = "fr"
): string[] {
  const reasons: string[] = [];
  const fr = lang === "fr";

  // Momentum
  if (psi >= 70) reasons.push(fr ? "Momentum fort ↑" : "Strong momentum ↑");
  else if (psi >= 45) reasons.push(fr ? "Momentum modéré →" : "Moderate momentum →");

  // Consensus / Confidence
  if (conf >= 75) reasons.push(fr ? "Consensus élevé ✓" : "High consensus ✓");
  else if (conf < 40) reasons.push(fr ? "Consensus faible ⚠" : "Low consensus ⚠");

  // Quality / Adoption
  if (quality >= 70) reasons.push(fr ? "Adoption réelle détectée" : "Real adoption detected");
  else if (quality < 30) reasons.push(fr ? "Hype > Adoption" : "Hype > Adoption");

  // Break/exit
  if (state === "BREAK" || state === "EXIT_FAST") {
    reasons.unshift(fr ? "Signal de rupture ⛔" : "Break signal ⛔");
  }
  // GO states
  if (state === "GO") reasons.push(fr ? "Signal d'entrée actif" : "Active entry signal");
  if (state === "GO_SPECULATIVE") reasons.push(fr ? "Spéculatif · cap faible" : "Speculative · low cap");

  return reasons.slice(0, 3);
}

/* Colors */
export function stateColor(state: GaugeState): string {
  switch (state) {
    case "IMMINENT": return "#e53935";
    case "EXIT": return "#ff6d00";
    case "ALERT": return "#fbc02d";
    case "CALM": return "#546e7a";
  }
}

export function stateGlow(state: GaugeState): string {
  switch (state) {
    case "IMMINENT": return "rgba(229,57,53,0.3)";
    case "EXIT": return "rgba(255,109,0,0.2)";
    case "ALERT": return "rgba(251,192,45,0.1)";
    case "CALM": return "rgba(84,110,122,0.05)";
  }
}

export function rayColor(state: GaugeState, alpha = 0.6): string {
  switch (state) {
    case "IMMINENT": return `rgba(229,57,53,${alpha})`;
    case "EXIT": return `rgba(255,109,0,${alpha})`;
    case "ALERT": return `rgba(251,192,45,${alpha})`;
    case "CALM": return `rgba(84,110,122,${alpha * 0.5})`;
  }
}

/** Opportunity color (gold tones) */
export function opportunityColor(score: number, alpha = 1): string {
  if (score >= 75) return `rgba(255,215,0,${alpha})`;
  if (score >= 50) return `rgba(251,192,45,${alpha})`;
  if (score >= 25) return `rgba(200,170,80,${alpha})`;
  return `rgba(140,130,90,${alpha * 0.6})`;
}

/** Risk color (red tones) */
export function riskColor(score: number, alpha = 1): string {
  if (score >= 75) return `rgba(229,57,53,${alpha})`;
  if (score >= 50) return `rgba(255,109,0,${alpha})`;
  if (score >= 25) return `rgba(200,120,60,${alpha})`;
  return `rgba(100,90,80,${alpha * 0.5})`;
}

/* Process raw signals into SubnetSignals */
export function processSignals(
  raw: RawSignal[],
  sparklines: Record<number, number[]>
): SubnetSignal[] {
  return raw
    .filter(s => s.netuid != null)
    .map(s => {
      const psi = s.mpi ?? s.score ?? 0;
      const conf = s.confidence_pct ?? 0;
      const quality = s.quality_score ?? 0;
      const tMinus = deriveTMinus(psi);
      const isBreak = s.state === "BREAK" || s.state === "EXIT_FAST";
      const asymScore = conf * 0.6 + quality * 0.4;
      const asymmetry: Asymmetry = asymScore >= 75 ? "HIGH" : asymScore >= 55 ? "MED" : "LOW";
      const opportunity = deriveOpportunity(psi, conf, quality, s.state);
      const risk = deriveRisk(psi, conf, quality, s.state);
      const dominant = opportunity > risk + 10 ? "opportunity" as const :
                       risk > opportunity + 10 ? "risk" as const : "neutral" as const;
      return {
        netuid: s.netuid!,
        name: s.subnet_name || `SN-${s.netuid}`,
        psi,
        opportunity,
        risk,
        t_minus_minutes: tMinus,
        confidence: conf,
        state: deriveGaugeState(psi, conf, isBreak),
        phase: derivePhase(psi),
        asymmetry,
        sparkline_7d: (sparklines[s.netuid!] ?? []).slice(-7),
        liquidity: 50,
        momentum: clamp(psi - 40, 0, 60) / 60 * 100,
        reasons: deriveReasons(psi, conf, quality, s.state),
        dominant,
      };
    })
    .sort((a, b) => b.psi - a.psi)
    .slice(0, 7);
}

/* ═══════════════════════════════════════ */
/*   SMART CAPITAL MODULE                   */
/* ═══════════════════════════════════════ */

export type SmartCapitalState = "ACCUMULATION" | "STABLE" | "DISTRIBUTION";

export type SmartCapitalData = {
  score: number;          // 0-100
  state: SmartCapitalState;
};

/** Derive Smart Capital from available metrics (flow, volume, miners, quality) */
export function computeSmartCapital(raw: RawSignal[]): SmartCapitalData {
  if (!raw?.length) return { score: 50, state: "STABLE" };

  // Aggregate signals to detect capital flow patterns
  const scores = raw.map(s => {
    const psi = s.mpi ?? s.score ?? 0;
    const conf = s.confidence_pct ?? 0;
    const quality = s.quality_score ?? 0;
    // High quality + rising momentum = accumulation signal
    // Low quality + high PSI = distribution signal (hype > adoption)
    const accumulationSignal = quality * 0.5 + conf * 0.3 + clamp(psi * 0.2, 0, 20);
    const distributionSignal = clamp((100 - quality) * 0.4, 0, 40) + 
      (psi >= 80 && quality < 50 ? 30 : 0) +
      (s.state === "BREAK" || s.state === "EXIT_FAST" ? 25 : 0);
    return { acc: accumulationSignal, dist: distributionSignal };
  });

  const avgAcc = scores.reduce((a, s) => a + s.acc, 0) / scores.length;
  const avgDist = scores.reduce((a, s) => a + s.dist, 0) / scores.length;
  
  // Smart Capital Score: higher = more accumulation detected
  const scScore = Math.round(clamp(avgAcc - avgDist * 0.5 + 30, 0, 100));
  
  let state: SmartCapitalState;
  if (scScore >= 65) state = "ACCUMULATION";
  else if (scScore <= 35) state = "DISTRIBUTION";
  else state = "STABLE";

  return { score: scScore, state };
}

/* ═══════════════════════════════════════ */
/*   DUAL CORE STRATEGY                     */
/* ═══════════════════════════════════════ */

export type DualCoreAllocation = {
  structurePct: number;   // 60-70% recommended for solid subnets
  sniperPct: number;      // 30-40% recommended for low-cap opportunities
  structureNetuids: number[];
  sniperNetuids: number[];
};

/** Compute Dual Core allocation from processed signals */
export function computeDualCore(signals: SubnetSignal[], smartCapital: SmartCapitalData): DualCoreAllocation {
  if (!signals.length) return { structurePct: 65, sniperPct: 35, structureNetuids: [], sniperNetuids: [] };

  // Structure: high quality, stable, moderate opportunity
  const structure = signals
    .filter(s => s.confidence >= 60 && s.risk < 50 && s.asymmetry !== "HIGH")
    .sort((a, b) => (b.opportunity * 0.6 + b.confidence * 0.4) - (a.opportunity * 0.6 + a.confidence * 0.4))
    .slice(0, 4);

  // Sniper: high asymmetry, low cap potential, strong momentum
  const sniper = signals
    .filter(s => s.asymmetry === "HIGH" || (s.opportunity >= 65 && s.confidence < 70))
    .sort((a, b) => b.opportunity - a.opportunity)
    .slice(0, 3);

  // Adjust allocation based on Smart Capital state
  let structurePct = 65;
  let sniperPct = 35;
  if (smartCapital.state === "ACCUMULATION") {
    structurePct = 55; sniperPct = 45; // More aggressive
  } else if (smartCapital.state === "DISTRIBUTION") {
    structurePct = 75; sniperPct = 25; // More defensive
  }

  return {
    structurePct,
    sniperPct,
    structureNetuids: structure.map(s => s.netuid),
    sniperNetuids: sniper.map(s => s.netuid),
  };
}

/* Compute global scores */
export function computeGlobalPsi(raw: RawSignal[]): number {
  if (!raw?.length) return 0;
  const mpis = raw.map(s => s.mpi ?? s.score ?? 0).filter(m => m > 0);
  if (!mpis.length) return 0;
  const totalW = mpis.reduce((a, m) => a + m, 0);
  const weighted = mpis.reduce((a, m) => a + m * m, 0);
  return Math.round(weighted / totalW);
}

export function computeGlobalConfidence(raw: RawSignal[]): number {
  if (!raw?.length) return 0;
  const confs = raw.map(s => s.confidence_pct ?? 0).filter(c => c > 0);
  return confs.length ? Math.round(confs.reduce((a, b) => a + b, 0) / confs.length) : 0;
}

export function computeGlobalOpportunity(raw: RawSignal[]): number {
  if (!raw?.length) return 0;
  const scores = raw.map(s => {
    const psi = s.mpi ?? s.score ?? 0;
    const conf = s.confidence_pct ?? 0;
    const quality = s.quality_score ?? 0;
    return deriveOpportunity(psi, conf, quality, s.state);
  }).filter(s => s > 0);
  if (!scores.length) return 0;
  return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
}

export function computeGlobalRisk(raw: RawSignal[]): number {
  if (!raw?.length) return 0;
  const scores = raw.map(s => {
    const psi = s.mpi ?? s.score ?? 0;
    const conf = s.confidence_pct ?? 0;
    const quality = s.quality_score ?? 0;
    return deriveRisk(psi, conf, quality, s.state);
  }).filter(s => s > 0);
  if (!scores.length) return 0;
  return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
}
