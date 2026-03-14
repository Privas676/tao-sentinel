/* ═══════════════════════════════════════════════ */
/*   USE SUBNET DECISIONS — Single source of truth */
/*   Combines useSubnetScores + useSubnetVerdicts  */
/*   into unified SubnetDecision objects.           */
/*   V3 verdict engine is the PRIMARY driver.      */
/*   ALL PAGES must consume decisions from here.   */
/* ═══════════════════════════════════════════════ */

import { useMemo } from "react";
import { useSubnetScores } from "@/hooks/use-subnet-scores";
import { useSubnetVerdicts } from "@/hooks/use-subnet-verdict";
import { useI18n } from "@/lib/i18n";
import { buildAllDecisions, type SubnetDecision } from "@/lib/subnet-decision";

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

  const result = useMemo(() => {
    // Wait for BOTH scores AND verdicts to avoid race condition
    if (scoresLoading || verdictsLoading || !scoresList.length) {
      return {
        decisions: new Map<number, SubnetDecision>(),
        decisionsList: [] as SubnetDecision[],
        isLoading: true,
      };
    }

    const decisions = buildAllDecisions(scoresList, verdicts, verdictsV3, fr);
    const decisionsList = Array.from(decisions.values());

    return { decisions, decisionsList, isLoading: false };
  }, [scoresList, verdicts, verdictsV3, fr, scoresLoading, verdictsLoading]);

  return result;
}
