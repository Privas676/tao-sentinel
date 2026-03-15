/* ═══════════════════════════════════════════════════════ */
/*   USE CANONICAL SUBNETS — Single unified hook           */
/*   Exposes CanonicalSubnetFacts + CanonicalSubnetDecision */
/*   for ALL subnets. Every page MUST consume from here.   */
/*   NO local re-derivation. ONE truth. ZERO doublons.     */
/* ═══════════════════════════════════════════════════════ */

import { useMemo } from "react";
import { useSubnetDecisions, type SubnetDecision } from "@/hooks/use-subnet-decisions";
import { useExternalDelist } from "@/hooks/use-external-delist";
import { useSocialSubnetScores } from "@/hooks/use-social-signal";
import { useSubnetScores } from "@/hooks/use-subnet-scores";
import { buildAllCanonicalFacts } from "@/lib/canonical-facts";
import { buildAllCanonicalDecisions } from "@/lib/canonical-decision";
import type { CanonicalSubnetFacts } from "@/lib/canonical-types";
import type { CanonicalSubnetDecision } from "@/lib/canonical-types";

export type { CanonicalSubnetFacts, CanonicalSubnetDecision } from "@/lib/canonical-types";

export type CanonicalSubnetsResult = {
  /** Canonical facts per subnet (merged TaoStats + TaoFlute + Social) */
  facts: Map<number, CanonicalSubnetFacts>;
  /** Canonical decisions per subnet (single truth) */
  canonicalDecisions: Map<number, CanonicalSubnetDecision>;
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

    return {
      facts: canonicalFacts,
      canonicalDecisions,
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
