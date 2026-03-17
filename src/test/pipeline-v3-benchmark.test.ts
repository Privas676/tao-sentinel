/* ═══════════════════════════════════════════════════════════════ */
/*   V3 PIPELINE BENCHMARK — Performance tests                    */
/*   Measures execution time for batch processing 100-500 subnets */
/*   through the full analytical pipeline.                        */
/* ═══════════════════════════════════════════════════════════════ */

import { describe, it, expect } from "vitest";
import { extractSubnetFacts } from "@/lib/subnet-facts";
import { computeConcordance } from "@/lib/source-concordance";
import { computeDerivedScores } from "@/lib/derived-scores";
import { computeVerdictV3, computeAllVerdictsV3 } from "@/lib/verdict-engine-v3";
import { buildSubnetDecision } from "@/lib/subnet-decision";
import { resolveTaoFluteStatus } from "@/lib/taoflute-resolver";
import type { SubnetFacts } from "@/lib/subnet-facts";
import type { ScoringResult } from "@/lib/derived-scores";
import type { ConcordanceResult } from "@/lib/source-concordance";

const TAO_USD = 450;

/* ─── Payload generator with realistic variance ─── */

function generatePayload(netuid: number) {
  const seed = netuid * 17 + 3;
  const r = (min: number, max: number) => min + ((seed * 31 + netuid * 7) % 1000) / 1000 * (max - min);
  const ri = (min: number, max: number) => Math.floor(r(min, max));

  // Vary profiles: ~20% dead, ~15% risky, ~65% normal/healthy
  const profile = netuid % 10;
  const isDead = profile === 0 || profile === 9;
  const isRisky = profile === 1 || profile === 7;

  return {
    netuid,
    name: `BenchSubnet-${netuid}`,
    price: isDead ? r(0.001, 0.01) : r(0.05, 2.5),
    price_change_1_hour: r(-5, 5),
    price_change_1_day: isDead ? r(-30, -5) : r(-15, 30),
    price_change_1_week: isDead ? r(-50, -10) : r(-20, 50),
    price_change_1_month: isDead ? r(-80, -20) : r(-30, 80),
    market_cap: isDead ? ri(1e6, 1e8) : ri(1e9, 5e11),
    tao_volume_24_hr: isDead ? ri(0, 1e6) : ri(1e7, 1e11),
    buys_24_hr: isDead ? ri(0, 3) : ri(10, 100),
    sells_24_hr: isDead ? ri(0, 2) : ri(5, 60),
    buyers_24_hr: isDead ? ri(0, 2) : ri(5, 50),
    sellers_24_hr: isDead ? ri(0, 1) : ri(2, 30),
    protocol_provided_tao: ri(1e8, 5e11),
    protocol_provided_alpha: ri(2e8, 1e12),
    alpha_staked: isDead ? 0 : ri(1e7, 2e11),
    liquidity: isDead ? ri(0, 1e6) : isRisky ? ri(1e6, 1e8) : ri(1e8, 1e12),
    root_prop: isDead ? r(0.6, 0.95) : isRisky ? r(0.3, 0.6) : r(0.05, 0.3),
    rank: ri(1, 60),
    _chain: {
      active_validators: isDead ? ri(0, 2) : ri(5, 30),
      active_miners: isDead ? ri(0, 3) : ri(20, 200),
      active_uids: isDead ? ri(0, 10) : ri(50, 256),
      max_neurons: 256,
      emission: ri(1e4, 1e8),
      emission_per_day: ri(1e8, 5e11),
      recycled_24_hours: ri(0, 1e10),
      registrations: ri(0, 20),
    },
  };
}

/* ─── Run single pipeline ─── */

function runSinglePipeline(netuid: number, payload: any) {
  const facts = extractSubnetFacts(netuid, payload, TAO_USD);
  const concordance = computeConcordance(facts);
  const scoring = computeDerivedScores(facts, concordance);
  const v3 = computeVerdictV3(facts, scoring, concordance);
  return { facts, concordance, scoring, v3 };
}

/* ─── Timing helper ─── */

function measure(fn: () => void): number {
  const start = performance.now();
  fn();
  return performance.now() - start;
}

/* ════════════════════════════════════════════════ */
/*   BENCHMARKS                                     */
/* ════════════════════════════════════════════════ */

describe("V3 Pipeline — Performance Benchmarks", () => {

  /* ── 128 subnets (realistic Bittensor network size) ── */
  it("processes 128 subnets in < 500ms", () => {
    const payloads = Array.from({ length: 128 }, (_, i) => generatePayload(i + 1));

    const elapsed = measure(() => {
      for (const p of payloads) {
        runSinglePipeline(p.netuid, p);
      }
    });

    console.log(`[BENCH] 128 subnets sequential: ${elapsed.toFixed(1)}ms (${(elapsed / 128).toFixed(2)}ms/subnet)`);
    expect(elapsed).toBeLessThan(500);
  });

  /* ── 256 subnets (2x network) ── */
  it("processes 256 subnets in < 1000ms", () => {
    const payloads = Array.from({ length: 256 }, (_, i) => generatePayload(i + 1));

    const elapsed = measure(() => {
      for (const p of payloads) {
        runSinglePipeline(p.netuid, p);
      }
    });

    console.log(`[BENCH] 256 subnets sequential: ${elapsed.toFixed(1)}ms (${(elapsed / 256).toFixed(2)}ms/subnet)`);
    expect(elapsed).toBeLessThan(1000);
  });

  /* ── 512 subnets (stress test) ── */
  it("processes 512 subnets in < 2000ms", () => {
    const payloads = Array.from({ length: 512 }, (_, i) => generatePayload(i + 1));

    const elapsed = measure(() => {
      for (const p of payloads) {
        runSinglePipeline(p.netuid, p);
      }
    });

    console.log(`[BENCH] 512 subnets sequential: ${elapsed.toFixed(1)}ms (${(elapsed / 512).toFixed(2)}ms/subnet)`);
    expect(elapsed).toBeLessThan(2000);
  });

  /* ── Individual layer benchmarks ── */
  describe("Layer-level breakdown (128 subnets)", () => {
    const payloads = Array.from({ length: 128 }, (_, i) => generatePayload(i + 1));

    it("Layer A: extractSubnetFacts — < 50ms for 128", () => {
      const elapsed = measure(() => {
        for (const p of payloads) {
          extractSubnetFacts(p.netuid, p, TAO_USD);
        }
      });
      console.log(`[BENCH] Layer A (Facts):       ${elapsed.toFixed(1)}ms`);
      expect(elapsed).toBeLessThan(50);
    });

    it("Layer A→B: computeConcordance — < 100ms for 128", () => {
      const factsArr = payloads.map(p => extractSubnetFacts(p.netuid, p, TAO_USD));
      const elapsed = measure(() => {
        for (const f of factsArr) {
          computeConcordance(f);
        }
      });
      console.log(`[BENCH] Layer A→B (Concordance): ${elapsed.toFixed(1)}ms`);
      expect(elapsed).toBeLessThan(100);
    });

    it("Layer B: computeDerivedScores — < 100ms for 128", () => {
      const factsArr = payloads.map(p => extractSubnetFacts(p.netuid, p, TAO_USD));
      const concArr = factsArr.map(f => computeConcordance(f));
      const elapsed = measure(() => {
        for (let i = 0; i < factsArr.length; i++) {
          computeDerivedScores(factsArr[i], concArr[i]);
        }
      });
      console.log(`[BENCH] Layer B (Scores):      ${elapsed.toFixed(1)}ms`);
      expect(elapsed).toBeLessThan(100);
    });

    it("Layer C: computeVerdictV3 — < 100ms for 128", () => {
      const factsArr = payloads.map(p => extractSubnetFacts(p.netuid, p, TAO_USD));
      const concArr = factsArr.map(f => computeConcordance(f));
      const scorArr = factsArr.map((f, i) => computeDerivedScores(f, concArr[i]));
      const elapsed = measure(() => {
        for (let i = 0; i < factsArr.length; i++) {
          computeVerdictV3(factsArr[i], scorArr[i], concArr[i]);
        }
      });
      console.log(`[BENCH] Layer C (Verdict):     ${elapsed.toFixed(1)}ms`);
      expect(elapsed).toBeLessThan(100);
    });
  });

  /* ── Batch API (computeAllVerdictsV3) ── */
  describe("Batch API", () => {
    it("computeAllVerdictsV3 processes 128 subnets in < 200ms", () => {
      const factsMap = new Map<number, SubnetFacts>();
      const scoringMap = new Map<number, ScoringResult>();
      const concMap = new Map<number, ConcordanceResult>();

      for (let i = 1; i <= 128; i++) {
        const p = generatePayload(i);
        const facts = extractSubnetFacts(i, p, TAO_USD);
        const conc = computeConcordance(facts);
        const scoring = computeDerivedScores(facts, conc);
        factsMap.set(i, facts);
        concMap.set(i, conc);
        scoringMap.set(i, scoring);
      }

      const elapsed = measure(() => {
        computeAllVerdictsV3(factsMap, scoringMap, concMap);
      });

      console.log(`[BENCH] Batch API (128):       ${elapsed.toFixed(1)}ms`);
      expect(elapsed).toBeLessThan(200);
    });
  });

  /* ── Decision layer benchmark ── */
  describe("Decision layer (SubnetDecision)", () => {
    it("builds 128 decisions in < 100ms", () => {
      const pipelines = Array.from({ length: 128 }, (_, i) => {
        const p = generatePayload(i + 1);
        return runSinglePipeline(p.netuid, p);
      });

      const elapsed = measure(() => {
        for (const { facts, v3 } of pipelines) {
          const tf = resolveTaoFluteStatus(v3.netuid);
          const price = v3.netuid * 0.1;
          const mockUnified = {
            netuid: v3.netuid, name: v3.name, assetType: "SPECULATIVE",
            state: null, psi: 50, conf: 50, quality: 50, opp: 35, risk: 45,
            asymmetry: 0, momentum: 50, momentumLabel: "NEUTRE", momentumScore: 50,
            action: "WATCH", sc: "NEUTRAL", confianceScore: v3.confidence,
            dataUncertain: false, isOverridden: false, isWarning: false,
            systemStatus: "OK", overrideReasons: [],
            healthScores: { liquidityHealth: 50, volumeHealth: 50, emissionPressure: 30, dilutionRisk: 20, activityHealth: 50 },
            recalc: { mcRecalc: 1e5, fdvRecalc: 1.5e5, dilutionRatio: 1.5, volumeToMc: 0.05, emissionToMc: 0.01, liquidityRecalc: 5e4, liquidityToMc: 0.1, liqHaircut: 0, poolPrice: price },
            displayedCap: 100000, displayedLiq: 50000, stability: 50,
            consensusPrice: price, alphaPrice: price, priceVar30d: null,
            delistCategory: "NORMAL", delistScore: 10, depegProbability: 5,
            depegState: "STABLE", depegSignals: [],
          } as any;
          buildSubnetDecision(mockUnified, undefined, v3, true, tf);
        }
      });

      console.log(`[BENCH] Decision layer (128):  ${elapsed.toFixed(1)}ms`);
      expect(elapsed).toBeLessThan(100);
    });
  });

  /* ── Verdict distribution sanity check ── */
  it("produces a realistic verdict distribution across 128 subnets", () => {
    const distribution: Record<string, number> = {};

    for (let i = 1; i <= 128; i++) {
      const p = generatePayload(i);
      const { v3 } = runSinglePipeline(p.netuid, p);
      distribution[v3.verdict] = (distribution[v3.verdict] || 0) + 1;
    }

    console.log("[BENCH] Verdict distribution:", distribution);

    // Should have at least 2 different verdicts (not everything the same)
    const verdictTypes = Object.keys(distribution);
    expect(verdictTypes.length).toBeGreaterThanOrEqual(2);

    // No single verdict should dominate > 90%
    for (const count of Object.values(distribution)) {
      expect(count / 128).toBeLessThan(0.9);
    }
  });

  /* ── Memory: no crashes on repeated runs ── */
  it("handles 5 consecutive full runs (640 total) without error", () => {
    const elapsed = measure(() => {
      for (let run = 0; run < 5; run++) {
        for (let i = 1; i <= 128; i++) {
          runSinglePipeline(i, generatePayload(i));
        }
      }
    });

    console.log(`[BENCH] 5×128 runs (640 total): ${elapsed.toFixed(1)}ms`);
    expect(elapsed).toBeLessThan(3000);
  });
});
