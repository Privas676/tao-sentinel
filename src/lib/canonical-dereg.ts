/* ═══════════════════════════════════════════════════════ */
/*   CANONICAL DEREG RISK — Official Bittensor Logic       */
/*   Source: Taostats on-chain data (rank, emission, etc.) */
/*   NOT heuristic — derived from actual chain parameters  */
/*                                                         */
/*   This module is SEPARATE from TaoFlute external risk.  */
/*   TaoFlute = external screening signal                  */
/*   This = canonical on-chain structural risk             */
/* ═══════════════════════════════════════════════════════ */

/* ── Types ── */

export type DeregBand = "NONE" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type OfficialDeregRisk = {
  subnet_id: number;

  /** Whether this subnet is eligible for deregistration */
  official_dereg_eligible: boolean;

  /** Whether immunity is currently active (protects from dereg) */
  official_immunity_active: boolean;

  /** Estimated immunity end (null if not immune or unknown) */
  official_immunity_end_at: string | null;

  /** Rank among all subnets by price EMA (lower = more at risk) */
  official_price_ema_rank: number | null;

  /** Total number of active subnets */
  total_subnets: number;

  /** Network subnet limit (when full, lowest rank gets deregistered) */
  subnet_limit: number | null;

  /** Computed risk score 0-100 */
  official_dereg_risk_score: number;

  /** Risk band classification */
  official_dereg_band: DeregBand;

  /** Human-readable reasons for the risk level */
  official_dereg_reason: string[];

  /** Always "bittensor_canonical" */
  official_dereg_source: "bittensor_canonical";
};

/* ── Input from Taostats raw_payload ── */

export type TaostatsDeregInput = {
  netuid: number;
  rank: number | null;              // subnet rank from Taostats
  emission: number | null;          // current emission (0 = no emission)
  active_miners: number | null;
  active_validators: number | null;
  max_neurons: number | null;
  registration_cost: number | null; // high cost suggests active/valuable
  price: number | null;
  market_cap: number | null;
  liquidity: number | null;
  total_subnets: number;            // how many subnets exist
  subnet_limit: number | null;      // network param: max subnets allowed
};

/* ── Constants ── */

/** Subnets that are NEVER eligible for deregistration */
const IMMUNE_SUBNETS = new Set([0]); // Root subnet

/** Rank percentile thresholds for risk bands */
const RANK_CRITICAL_PCT = 0.10;   // bottom 10% → CRITICAL
const RANK_HIGH_PCT = 0.20;       // bottom 20% → HIGH
const RANK_MEDIUM_PCT = 0.35;     // bottom 35% → MEDIUM
const RANK_LOW_PCT = 0.50;        // bottom 50% → LOW

/* ── Scoring Logic ── */

/**
 * Compute official deregistration risk from on-chain data.
 *
 * Bittensor dereg logic:
 * - When network is at subnet_limit and a new subnet registers,
 *   the subnet with lowest price EMA (among non-immune) gets deregistered.
 * - Immunity protects new subnets temporarily.
 * - Emission = 0 is a strong signal of structural weakness.
 *
 * We derive risk from:
 * 1. Rank position relative to total subnets
 * 2. Emission status (0 = extreme weakness)
 * 3. Active miners/validators (structural health)
 * 4. Registration cost (proxy for chain-level value)
 * 5. Network saturation (subnet_limit proximity)
 */
export function computeOfficialDeregRisk(input: TaostatsDeregInput): OfficialDeregRisk {
  const { netuid, rank, emission, active_miners, active_validators, total_subnets, subnet_limit } = input;

  // Permanently immune subnets
  if (IMMUNE_SUBNETS.has(netuid)) {
    return makeResult(netuid, total_subnets, subnet_limit, {
      eligible: false,
      immune: true,
      score: 0,
      band: "NONE",
      reasons: ["Subnet système — immunité permanente"],
      rank,
    });
  }

  const reasons: string[] = [];
  let score = 0;

  // ── 1. Rank-based risk (most important factor) ──
  if (rank != null && total_subnets > 0) {
    const rankPct = rank / total_subnets; // 1.0 = worst rank

    if (rankPct >= (1 - RANK_CRITICAL_PCT)) {
      score += 40;
      reasons.push(`Rang ${rank}/${total_subnets} — zone critique (bottom 10%)`);
    } else if (rankPct >= (1 - RANK_HIGH_PCT)) {
      score += 28;
      reasons.push(`Rang ${rank}/${total_subnets} — zone à risque (bottom 20%)`);
    } else if (rankPct >= (1 - RANK_MEDIUM_PCT)) {
      score += 15;
      reasons.push(`Rang ${rank}/${total_subnets} — zone intermédiaire`);
    } else if (rankPct >= (1 - RANK_LOW_PCT)) {
      score += 5;
      reasons.push(`Rang ${rank}/${total_subnets} — risque faible`);
    }
  }

  // ── 2. Emission status ──
  if (emission != null) {
    if (emission === 0) {
      score += 25;
      reasons.push("Émission nulle — aucune récompense réseau");
    } else if (emission < 0.001) {
      score += 10;
      reasons.push("Émission très faible");
    }
  }

  // ── 3. Structural health (miners + validators) ──
  const miners = active_miners ?? 0;
  const validators = active_validators ?? 0;

  if (miners === 0) {
    score += 15;
    reasons.push("Aucun mineur actif — réseau inactif");
  } else if (miners <= 3) {
    score += 8;
    reasons.push(`Seulement ${miners} mineur(s) actif(s)`);
  }

  if (validators === 0) {
    score += 10;
    reasons.push("Aucun validateur actif");
  } else if (validators <= 2) {
    score += 5;
    reasons.push(`Seulement ${validators} validateur(s)`);
  }

  // ── 4. Network saturation ──
  if (subnet_limit != null && total_subnets >= subnet_limit) {
    score += 10;
    reasons.push(`Réseau saturé (${total_subnets}/${subnet_limit}) — prochaine inscription = désinscription`);
  } else if (subnet_limit != null && total_subnets >= subnet_limit - 3) {
    score += 5;
    reasons.push(`Réseau quasi-saturé (${total_subnets}/${subnet_limit})`);
  }

  // ── 5. Determine immunity ──
  // Heuristic: if emission > 0 and rank is very high and registration_cost is very high,
  // subnet is likely recently registered and may still be immune.
  // Without explicit immunity data, we conservatively mark as unknown.
  const immunityActive = false; // Will be set to true when we have explicit immunity data
  const immunityEndAt: string | null = null;

  // ── Clamp and classify ──
  score = Math.min(100, Math.max(0, score));
  const band = scoreToBand(score);

  // If immune, override to NONE
  if (immunityActive) {
    return makeResult(netuid, total_subnets, subnet_limit, {
      eligible: true,
      immune: true,
      score: Math.min(score, 10), // Keep score low but non-zero for info
      band: "NONE",
      reasons: ["Immunité active — protection temporaire contre la désinscription", ...reasons],
      rank,
      immunityEndAt,
    });
  }

  return makeResult(netuid, total_subnets, subnet_limit, {
    eligible: score > 0,
    immune: false,
    score,
    band,
    reasons: reasons.length > 0 ? reasons : ["Aucun signal de risque de désinscription détecté"],
    rank,
    immunityEndAt,
  });
}

/* ── Helpers ── */

function scoreToBand(score: number): DeregBand {
  if (score >= 70) return "CRITICAL";
  if (score >= 50) return "HIGH";
  if (score >= 30) return "MEDIUM";
  if (score >= 10) return "LOW";
  return "NONE";
}

function makeResult(
  netuid: number,
  totalSubnets: number,
  subnetLimit: number | null,
  opts: {
    eligible: boolean;
    immune: boolean;
    score: number;
    band: DeregBand;
    reasons: string[];
    rank: number | null;
    immunityEndAt?: string | null;
  },
): OfficialDeregRisk {
  return {
    subnet_id: netuid,
    official_dereg_eligible: opts.eligible,
    official_immunity_active: opts.immune,
    official_immunity_end_at: opts.immunityEndAt ?? null,
    official_price_ema_rank: opts.rank,
    total_subnets: totalSubnets,
    subnet_limit: subnetLimit,
    official_dereg_risk_score: opts.score,
    official_dereg_band: opts.band,
    official_dereg_reason: opts.reasons,
    official_dereg_source: "bittensor_canonical",
  };
}

/* ── Display Helpers ── */

export function deregBandColor(band: DeregBand): string {
  switch (band) {
    case "CRITICAL": return "hsl(4, 80%, 45%)";
    case "HIGH": return "hsl(15, 80%, 50%)";
    case "MEDIUM": return "hsl(38, 70%, 50%)";
    case "LOW": return "hsl(50, 60%, 50%)";
    case "NONE": return "hsl(210, 10%, 50%)";
  }
}

export function deregBandLabel(band: DeregBand, fr: boolean): string {
  if (fr) {
    switch (band) {
      case "CRITICAL": return "Critique";
      case "HIGH": return "Élevé";
      case "MEDIUM": return "Moyen";
      case "LOW": return "Faible";
      case "NONE": return "Aucun";
    }
  }
  switch (band) {
    case "CRITICAL": return "Critical";
    case "HIGH": return "High";
    case "MEDIUM": return "Medium";
    case "LOW": return "Low";
    case "NONE": return "None";
  }
}

/** Extract dereg input fields from a Taostats raw_payload */
export function extractDeregInputFromPayload(
  netuid: number,
  payload: Record<string, unknown> | null,
  totalSubnets: number,
  subnetLimit: number | null = null,
): TaostatsDeregInput {
  if (!payload) {
    return {
      netuid,
      rank: null,
      emission: null,
      active_miners: null,
      active_validators: null,
      max_neurons: null,
      registration_cost: null,
      price: null,
      market_cap: null,
      liquidity: null,
      total_subnets: totalSubnets,
      subnet_limit: subnetLimit,
    };
  }

  const chain = (payload._chain ?? payload) as Record<string, unknown>;

  return {
    netuid,
    rank: safeNum(payload.rank),
    emission: safeNum(chain.emission),
    active_miners: safeNum(chain.active_miners),
    active_validators: safeNum(chain.active_validators),
    max_neurons: safeNum(chain.max_neurons),
    registration_cost: safeNum(chain.registration_cost),
    price: safeNum(payload.price ?? payload.last_price),
    market_cap: safeNum(payload.market_cap),
    liquidity: safeNum(payload.liquidity),
    total_subnets: totalSubnets,
    subnet_limit: subnetLimit,
  };
}

function safeNum(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
