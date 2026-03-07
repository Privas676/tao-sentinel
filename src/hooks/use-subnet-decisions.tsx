/* ═══════════════════════════════════════════════ */
/*   USE SUBNET DECISIONS — Single source of truth */
/*   Combines useSubnetScores + useSubnetVerdicts  */
/*   into unified SubnetDecision objects.           */
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
  const { scoresList, isLoading: scoresLoading } = useSubnetScores();
  const { verdicts, isLoading: verdictsLoading } = useSubnetVerdicts();

  const result = useMemo(() => {
    if (scoresLoading || !scoresList.length) {
      return {
        decisions: new Map<number, SubnetDecision>(),
        decisionsList: [] as SubnetDecision[],
        isLoading: true,
      };
    }

    const decisions = buildAllDecisions(scoresList, verdicts, fr);
    const decisionsList = Array.from(decisions.values());

    return { decisions, decisionsList, isLoading: false };
  }, [scoresList, verdicts, fr, scoresLoading]);

  return result;
}
