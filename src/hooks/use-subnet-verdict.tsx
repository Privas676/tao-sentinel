/* ═══════════════════════════════════════ */
/*   USE SUBNET VERDICT HOOK                 */
/*   Combines useSubnetScores + stake data   */
/*   to produce per-subnet verdicts          */
/* ═══════════════════════════════════════ */

import { useMemo } from "react";
import { useSubnetScores, SPECIAL_SUBNETS } from "@/hooks/use-subnet-scores";
import { useStakeAnalytics, type SubnetRadarData } from "@/hooks/use-stake-analytics";
import {
  computeVerdict,
  type VerdictInput,
  type VerdictResult,
} from "@/lib/verdict-engine";

export type SubnetVerdictData = VerdictResult & {
  name: string;
};

export type VerdictSummary = {
  verdicts: Map<number, SubnetVerdictData>;
  verdictList: SubnetVerdictData[];
  topRentre: SubnetVerdictData[];
  topHold: SubnetVerdictData[];
  topSors: SubnetVerdictData[];
  isLoading: boolean;
  /** Counts */
  countRentre: number;
  countHold: number;
  countSors: number;
};

export function useSubnetVerdicts(): VerdictSummary {
  const { scores, scoresList, isLoading: scoresLoading } = useSubnetScores();
  const { data: radarData, isLoading: radarLoading } = useStakeAnalytics();

  const result = useMemo<VerdictSummary>(() => {
    const empty: VerdictSummary = {
      verdicts: new Map(),
      verdictList: [],
      topRentre: [],
      topHold: [],
      topSors: [],
      isLoading: true,
      countRentre: 0,
      countHold: 0,
      countSors: 0,
    };

    if (!radarData || radarData.length === 0) {
      return { ...empty, isLoading: scoresLoading || radarLoading };
    }

    // Build radar lookup
    const radarMap = new Map<number, SubnetRadarData>();
    for (const r of radarData) radarMap.set(r.netuid, r);

    const verdictList: SubnetVerdictData[] = [];
    const verdicts = new Map<number, SubnetVerdictData>();

    for (const rd of radarData) {
      const unifiedScore = scores.get(rd.netuid);
      const isWhitelisted = !!SPECIAL_SUBNETS[rd.netuid];

      const input: VerdictInput = {
        netuid: rd.netuid,
        snapshot: rd.snapshot,
        deltas: rd.deltas,
        priceContext: rd.priceContext,
        economicContext: rd.economicContext,
        derivedMetrics: rd.derivedMetrics,
        radarScores: rd.scores,
        momentum: unifiedScore?.momentum,
        stability: unifiedScore?.stability,
        dataConfidence: unifiedScore?.confianceScore,
        isWhitelisted,
      };

      const result = computeVerdict(input);
      const data: SubnetVerdictData = {
        ...result,
        name: rd.subnetName,
      };

      verdicts.set(rd.netuid, data);
      verdictList.push(data);
    }

    // Sort by entry score desc for RENTRE, hold score for HOLD, exit risk for SORS
    const topRentre = verdictList
      .filter(v => v.verdict === "RENTRE")
      .sort((a, b) => b.entryScore - a.entryScore)
      .slice(0, 5);

    const topHold = verdictList
      .filter(v => v.verdict === "HOLD")
      .sort((a, b) => b.holdScore - a.holdScore)
      .slice(0, 5);

    const topSors = verdictList
      .filter(v => v.verdict === "SORS")
      .sort((a, b) => b.exitRisk - a.exitRisk)
      .slice(0, 5);

    return {
      verdicts,
      verdictList,
      topRentre,
      topHold,
      topSors,
      isLoading: false,
      countRentre: verdictList.filter(v => v.verdict === "RENTRE").length,
      countHold: verdictList.filter(v => v.verdict === "HOLD").length,
      countSors: verdictList.filter(v => v.verdict === "SORS").length,
    };
  }, [scores, radarData, scoresLoading, radarLoading]);

  return result;
}
