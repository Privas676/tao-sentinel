/* ═══════════════════════════════════════ */
/*   GAUGE ENGINE — TYPES & UTILITIES       */
/* ═══════════════════════════════════════ */

import type { SystemStatus } from "./risk-override";

export type GaugeState = "CALM" | "ALERT" | "IMMINENT" | "EXIT";
export type GaugePhase = "BUILD" | "ARMED" | "TRIGGER" | "NONE";
export type Asymmetry = "HIGH" | "MED" | "LOW";
export type MomentumLabel = "FORT" | "MODÉRÉ" | "STABLE" | "DÉTÉRIORATION";

export type SubnetSignal = {
  netuid: number;
  name: string;
  psi: number;
  opportunity: number;
  risk: number;
  confidence: number;
  state: GaugeState;
  phase: GaugePhase;
  asymmetry: Asymmetry;
  sparkline_7d: number[];
  liquidity: number;
  momentum: number;
  momentumLabel: MomentumLabel;
  momentumScore: number;
  reasons: string[];
  dominant: "opportunity" | "risk" | "neutral";
  isMicroCap: boolean;
  asMicro: number;
  preHype: boolean;
  preHypeIntensity: number;
  stabilitySetup: number;
  isOverridden: boolean;
  systemStatus: SystemStatus;
  overrideReasons: string[];
  dataUncertain: boolean;
  confianceData: number;
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

export type MarketRiskData = {
  volCap: number;
  topMinersShare: number;
  priceVol7d: number;
  liqRatio: number;
};

export type SmartCapitalState = "ACCUMULATION" | "STABLE" | "DISTRIBUTION";

export type SmartCapitalData = {
  score: number;
  state: SmartCapitalState;
};

export type DualCoreAllocation = {
  structurePct: number;
  sniperPct: number;
  structureNetuids: number[];
  sniperNetuids: number[];
};

export type ConsensusDataMap = Map<number, { confianceData: number; dataUncertain: boolean }>;

export function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

export const PSI_THRESHOLDS = {
  BUILD_MIN: 35,
  ARMED_MIN: 55,
  TRIGGER_MIN: 70,
  IMMINENT_MIN: 85,
  IMMINENT_CONFIDENCE: 70,
};
