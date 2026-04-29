/* ═══════════════════════════════════════════════ */
/*   USE CANONICAL SUBNETS — Single unified hook           */
/*   Exposes CanonicalSubnetFacts + CanonicalSubnetDecision */
/*   + EarlyPumpResult + PulseResult + DataTrustResult.    */
/*   NO local re-derivation. ONE truth. ZERO doublons.     */
/* ═══════════════════════════════════════════════ */

import { useMemo } from "react";
import { useSubnetDecisions, type SubnetDecision } from "@/hooks/use-subnet-decisions";
import { useExternalDelist } from "@/hooks/use-external-delist";
import { useSocialSubnetScores } from "@/hooks/use-social-signal";
import { useSubnetScores } from "@/hooks/use-subnet-scores";
import { buildAllCanonicalFacts } from "@/lib/canonical-facts";
import { buildAllCanonicalDecisions } from "@/lib/canonical-decision";
import { detectAllEarlyPumps, type EarlyPumpResult } from "@/lib/early-pump-detector";
import { detectAllPulses, type PulseResult } from "@/lib/pulse-detector";
import {
  evaluateDataTrust,
  type DataTrustResult,
  type CriticalSource,
} from "@/lib/data-trust";
import type { CanonicalSubnetFacts } from "@/lib/canonical-types";
import type { CanonicalSubnetDecision } from "@/lib/canonical-types";

export type { CanonicalSubnetFacts, CanonicalSubnetDecision } from "@/lib/canonical-types";
export type { EarlyPumpResult, EarlyPumpTag } from "@/lib/early-pump-detector";
export type { PulseResult, PulseType, PulseTradability } from "@/lib/pulse-detector";
export type { DataTrustResult, DataTrustLevel } from "@/lib/data-trust";

export type CanonicalSubnetsResult = {
  /** Canonical facts per subnet (merged TaoStats + TaoFlute + Social) */
  facts: Map<number, CanonicalSubnetFacts>;
  /** Canonical decisions per subnet (single truth, gated by data trust) */
  canonicalDecisions: Map<number, CanonicalSubnetDecision>;
  /** Early pump detection results per subnet */
  earlyPumps: Map<number, EarlyPumpResult>;
  /** TaoStats Price Pulse Detector results per subnet (unfiltered) */
  pulses: Map<number, PulseResult>;
  /** Global data trust evaluation (kill switch source) */
  dataTrust: DataTrustResult;
  /** Legacy SubnetDecision objects (for backward compat) */
  decisions: Map<number, SubnetDecision>;
  decisionsList: SubnetDecision[];
  isLoading: boolean;
};

/* ── DATA SAFE MODE gating — degrade ENTRER/ADD when sources are stale ── */

function gateDecisionForSafeMode(
  d: CanonicalSubnetDecision,
  trust: DataTrustResult,
): CanonicalSubnetDecision {
  if (!trust.blockEntryActions) return d;
  let next = d;
  if (d.final_action === "ENTRER") {
    next = {
      ...next,
      final_action: "SURVEILLER",
      final_reason_primary:
        "Décision gelée — DATA SAFE MODE (" + trust.level + ")",
      final_reason_secondary: [
        d.final_reason_primary,
        ...d.final_reason_secondary,
      ].filter(Boolean).slice(0, 3),
      guardrail_active: true,
      guardrail_reason: [
        "DATA_SAFE_MODE",
        ...(trust.worstSource ? [`source: ${trust.worstSource}`] : []),
        ...d.guardrail_reason,
      ],
    };
  }
  if (next.portfolio_action === "ADD") {
    next = {
      ...next,
      portfolio_action: "HOLD",
    };
  }
  return next;
}

export function useCanonicalSubnets(): CanonicalSubnetsResult {
  const { decisions, decisionsList, isLoading: decisionsLoading } = useSubnetDecisions();
  const { subnetFacts, scoreTimestamp, dataConfidence } = useSubnetScores();
  const { taoFluteStatuses, isLoading: delistLoading } = useExternalDelist();
  const { data: socialScores, isLoading: socialLoading } = useSocialSubnetScores();

  const result = useMemo(() => {
    // ── Evaluate data trust (kill switch source) FIRST so it can gate decisions ──
    // TaoStats is the only HARD-required source for ENTRER/RENFORCER. TaoFlute and
    // Social are tracked for transparency but not blocking by themselves.
    const socialIso = socialScores?.[0]?.created_at ?? null;
    const sources: CriticalSource[] = [
      { name: "taostats", lastUpdate: scoreTimestamp ?? null, required: true },
      { name: "social", lastUpdate: socialIso, required: false },
    ];
    const dataTrust = evaluateDataTrust(sources, dataConfidence ?? null);

    if (decisionsLoading || !decisionsList.length) {
      return {
        facts: new Map<number, CanonicalSubnetFacts>(),
        canonicalDecisions: new Map<number, CanonicalSubnetDecision>(),
        earlyPumps: new Map<number, EarlyPumpResult>(),
        pulses: new Map<number, PulseResult>(),
        dataTrust,
        decisions: new Map<number, SubnetDecision>(),
        decisionsList: [] as SubnetDecision[],
        isLoading: true,
      };
    }

    // Build canonical facts from SubnetFacts + TaoFlute + Social
    const canonicalFacts = buildAllCanonicalFacts(
      subnetFacts,
      taoFluteStatuses,
      socialScores ?? null,
      socialIso,
    );

    // Build canonical decisions from existing SubnetDecisions + facts
    const rawDecisions = buildAllCanonicalDecisions(decisionsList, canonicalFacts);

    // Apply DATA SAFE MODE gating (freeze ENTRER/ADD when sources are stale)
    const canonicalDecisions = new Map<number, CanonicalSubnetDecision>();
    for (const [netuid, d] of rawDecisions) {
      canonicalDecisions.set(netuid, gateDecisionForSafeMode(d, dataTrust));
    }

    // Detect early pump candidates (existing detector)
    const earlyPumps = detectAllEarlyPumps(canonicalFacts, canonicalDecisions);

    // Detect raw pulses (Lot 1 — never filtered by risk)
    const pulses = detectAllPulses(canonicalFacts, canonicalDecisions, dataTrust);

    return {
      facts: canonicalFacts,
      canonicalDecisions,
      earlyPumps,
      pulses,
      dataTrust,
      decisions,
      decisionsList,
      isLoading: false,
    };
  }, [
    decisions, decisionsList, decisionsLoading,
    subnetFacts, scoreTimestamp, dataConfidence,
    taoFluteStatuses, delistLoading,
    socialScores, socialLoading,
  ]);

  return result;
}
