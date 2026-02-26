/* ═══════════════════════════════════════ */
/*     ALIEN GAUGE — PSI ENGINE            */
/* ═══════════════════════════════════════ */

export type GaugeState = "CALM" | "ALERT" | "IMMINENT" | "EXIT";
export type GaugePhase = "BUILD" | "ARMED" | "TRIGGER" | "NONE";
export type Asymmetry = "HIGH" | "MED" | "LOW";

export type SubnetSignal = {
  netuid: number;
  name: string;
  psi: number;
  t_minus_minutes: number;
  confidence: number;
  state: GaugeState;
  phase: GaugePhase;
  asymmetry: Asymmetry;
  sparkline_7d: number[];
  liquidity: number;
  momentum: number;
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

/**
 * T-minus estimation based on PSI velocity.
 * Higher PSI = closer to threshold = less time.
 * Returns minutes, bounded [2, 1440] (2min to 24h).
 */
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
      const tMinus = deriveTMinus(psi);
      const isBreak = s.state === "BREAK" || s.state === "EXIT_FAST";
      const quality = s.quality_score ?? 0;
      const asymScore = conf * 0.6 + quality * 0.4;
      const asymmetry: Asymmetry = asymScore >= 75 ? "HIGH" : asymScore >= 55 ? "MED" : "LOW";
      return {
        netuid: s.netuid!,
        name: s.subnet_name || `SN-${s.netuid}`,
        psi,
        t_minus_minutes: tMinus,
        confidence: conf,
        state: deriveGaugeState(psi, conf, isBreak),
        phase: derivePhase(psi),
        asymmetry,
        sparkline_7d: (sparklines[s.netuid!] ?? []).slice(-7),
        liquidity: 50,
        momentum: clamp(psi - 40, 0, 60) / 60 * 100,
      };
    })
    .sort((a, b) => b.psi - a.psi)
    .slice(0, 7);
}

/* Compute global PSI from all signals */
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
