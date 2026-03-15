/* ═══════════════════════════════════════════════ */
/*   USE SUBNET DECISIONS — Single source of truth */
/*   Combines useSubnetScores + useSubnetVerdicts  */
/*   into unified SubnetDecision objects.           */
/*   V3 verdict engine is the PRIMARY driver.      */
/*   TaoFlute: strict subnet_id matching.          */
/*   ALL PAGES must consume decisions from here.   */
/* ═══════════════════════════════════════════════ */

import { useMemo } from "react";
import { useSubnetScores } from "@/hooks/use-subnet-scores";
import { useSubnetVerdicts } from "@/hooks/use-subnet-verdict";
import { useExternalDelist } from "@/hooks/use-external-delist";
import { useI18n } from "@/lib/i18n";
import { buildAllDecisions, type SubnetDecision } from "@/lib/subnet-decision";
import { resolveAllTaoFluteStatuses } from "@/lib/taoflute-resolver";

export type { SubnetDecision } from "@/lib/subnet-decision";

export type SubnetDecisionsResult = {
  decisions: Map<number, SubnetDecision>;
  decisionsList: SubnetDecision[];
  isLoading: boolean;
};

export function useSubnetDecisions(): SubnetDecisionsResult {
  const { lang } = useI18n();
  const fr = lang === "fr";
  const { scoresList, verdictsV3, isLoading: scoresLoading } = useSubnetScores();
  const { verdicts, isLoading: verdictsLoading } = useSubnetVerdicts();
  const { taoFluteStatuses, isLoading: delistLoading } = useExternalDelist();

  const result = useMemo(() => {
    // Wait for BOTH scores AND verdicts to avoid race condition
    if (scoresLoading || verdictsLoading || !scoresList.length) {
      return {
        decisions: new Map<number, SubnetDecision>(),
        decisionsList: [] as SubnetDecision[],
        isLoading: true,
      };
    }

    // Resolve TaoFlute statuses for ALL subnets (strict subnet_id matching)
    const allIds = scoresList.map(s => s.netuid);
    const allTfStatuses = resolveAllTaoFluteStatuses(allIds,
      // Pass DB maps from the hook (already resolved inside taoFluteStatuses)
      undefined, undefined, undefined,
    );
    // Merge DB-resolved statuses (from hook) with fallback-resolved statuses
    for (const [id, status] of taoFluteStatuses) {
      allTfStatuses.set(id, status); // DB data takes precedence
    }

    const decisions = buildAllDecisions(scoresList, verdicts, verdictsV3, fr, allTfStatuses);
    const decisionsList = Array.from(decisions.values());

    return { decisions, decisionsList, isLoading: false };
  }, [scoresList, verdicts, verdictsV3, fr, scoresLoading, verdictsLoading, taoFluteStatuses]);

  return result;
}
