/* ═══════════════════════════════════════════════ */
/*   USE CANONICAL SUBNETS — Single unified hook           */
/*   Exposes CanonicalSubnetFacts + CanonicalSubnetDecision */
/*   + EarlyPumpResult for ALL subnets.                    */
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
import type { CanonicalSubnetFacts } from "@/lib/canonical-types";
import type { CanonicalSubnetDecision } from "@/lib/canonical-types";

export type { CanonicalSubnetFacts, CanonicalSubnetDecision } from "@/lib/canonical-types";
export type { EarlyPumpResult, EarlyPumpTag } from "@/lib/early-pump-detector";

export type CanonicalSubnetsResult = {
  /** Canonical facts per subnet (merged TaoStats + TaoFlute + Social) */
  facts: Map<number, CanonicalSubnetFacts>;
  /** Canonical decisions per subnet (single truth) */
  canonicalDecisions: Map<number, CanonicalSubnetDecision>;
  /** Early pump detection results per subnet */
  earlyPumps: Map<number, EarlyPumpResult>;
  /** Legacy SubnetDecision objects (for backward compat) */
  decisions: Map<number, SubnetDecision>;
  decisionsList: SubnetDecision[];
  isLoading: boolean;
};

export function useCanonicalSubnets(): CanonicalSubnetsResult {
  const { decisions, decisionsList, isLoading: decisionsLoading } = useSubnetDecisions();
  const { subnetFacts } = useSubnetScores();
  const { taoFluteStatuses, isLoading: delistLoading } = useExternalDelist();
  const { data: socialScores, isLoading: socialLoading } = useSocialSubnetScores();

  const result = useMemo(() => {
    if (decisionsLoading || !decisionsList.length) {
      return {
        facts: new Map<number, CanonicalSubnetFacts>(),
        canonicalDecisions: new Map<number, CanonicalSubnetDecision>(),
        earlyPumps: new Map<number, EarlyPumpResult>(),
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
      socialScores?.[0]?.created_at ?? null,
    );

    // Build canonical decisions from existing SubnetDecisions + facts
    const canonicalDecisions = buildAllCanonicalDecisions(
      decisionsList,
      canonicalFacts,
    );

    // Detect early pump candidates
    const earlyPumps = detectAllEarlyPumps(canonicalFacts, canonicalDecisions);

    return {
      facts: canonicalFacts,
      canonicalDecisions,
      earlyPumps,
      decisions,
      decisionsList,
      isLoading: false,
    };
  }, [
    decisions, decisionsList, decisionsLoading,
    subnetFacts, taoFluteStatuses, delistLoading,
    socialScores, socialLoading,
  ]);

  return result;
}
