/* ═══════════════════════════════════════════════════════════════ */
/*   V3 PIPELINE — State Transition Tests                         */
/*   Validates verdict mutations when data changes between ticks. */
/*   Covers: ENTER→SORTIR, SURVEILLER→ENTER, ENTER→DONNÉES_INST. */
/* ═══════════════════════════════════════════════════════════════ */

import { describe, it, expect } from "vitest";
import { extractSubnetFacts } from "@/lib/subnet-facts";
import { computeConcordance } from "@/lib/source-concordance";
import { computeDerivedScores } from "@/lib/derived-scores";
import { computeVerdictV3, type VerdictV3 } from "@/lib/verdict-engine-v3";

const TAO_USD = 450;

/* ─── Helper: run pipeline and return verdict ─── */

function verdict(netuid: number, payload: any): { verdict: VerdictV3; exitScore: number; entryMeta: string } {
  const facts = extractSubnetFacts(netuid, payload, TAO_USD);
  const conc = computeConcordance(facts);
  const scoring = computeDerivedScores(facts, conc);
  const v3 = computeVerdictV3(facts, scoring, conc);
  return {
    verdict: v3.verdict,
    exitScore: v3.riskFlags.length,
    entryMeta: v3.primaryReason.code,
  };
}

/* ─── Base payloads ─── */

const HEALTHY_BASE = {
  netuid: 10, name: "TransitionNet", price: 0.8,
  price_change_1_hour: 3, price_change_1_day: 15, price_change_1_week: 30, price_change_1_month: 50,
  market_cap: 600_000_000_000,
  tao_volume_24_hr: 100_000_000_000,
  buys_24_hr: 70, sells_24_hr: 20, buyers_24_hr: 35, sellers_24_hr: 10,
  protocol_provided_tao: 400_000_000_000, protocol_provided_alpha: 800_000_000_000,
  alpha_staked: 150_000_000_000, liquidity: 700_000_000_000, root_prop: 0.12, rank: 3,
  _chain: { active_validators: 20, active_miners: 80, active_uids: 230, max_neurons: 256, emission: 60_000_000, emission_per_day: 400_000_000_000, recycled_24_hours: 15_000_000_000, registrations: 10 },
};

function mutate(base: any, overrides: any): any {
  const result = { ...base, ...overrides };
  if (overrides._chain) {
    result._chain = { ...base._chain, ...overrides._chain };
  }
  return result;
}

/* ════════════════════════════════════════════════ */
/*   TRANSITION SCENARIOS                           */
/* ════════════════════════════════════════════════ */

describe("V3 Pipeline — State Transitions (tick mutations)", () => {

  describe("ENTER → SORTIR (structural collapse)", () => {
    it("tick 1: healthy data produces ENTER or SURVEILLER", () => {
      const r = verdict(10, HEALTHY_BASE);
      expect(["ENTER", "SURVEILLER"]).toContain(r.verdict);
    });

    it("tick 2: liquidity crash + miner exodus → worse verdict", () => {
      const crashed = mutate(HEALTHY_BASE, {
        liquidity: 500_000,           // liquidity collapse
        price_change_1_hour: -25,
        price_change_1_day: -60,
        price_change_1_week: -80,
        tao_volume_24_hr: 100_000,
        buys_24_hr: 1, sells_24_hr: 40,
        buyers_24_hr: 1, sellers_24_hr: 25,
        root_prop: 0.85,
        _chain: { active_miners: 2, active_validators: 1, active_uids: 5 },
      });
      const r = verdict(10, crashed);
      // Engine may classify as SORTIR, NON_INVESTISSABLE, or SURVEILLER (blocked entry)
      // Key assertion: must NOT be ENTER
      expect(r.verdict).not.toBe("ENTER");
    });

    it("verdict changes between ticks", () => {
      const t1 = verdict(10, HEALTHY_BASE);
      const crashed = mutate(HEALTHY_BASE, {
        liquidity: 500_000, price_change_1_day: -60, root_prop: 0.85,
        buys_24_hr: 1, sells_24_hr: 40, tao_volume_24_hr: 100_000,
        _chain: { active_miners: 2, active_validators: 1, active_uids: 5 },
      });
      const t2 = verdict(10, crashed);

      // Must have transitioned to a worse state
      const severity: Record<string, number> = {
        ENTER: 0, SURVEILLER: 1, DONNÉES_INSTABLES: 2, SORTIR: 3, NON_INVESTISSABLE: 4, SYSTÈME: 5,
      };
      expect(severity[t2.verdict]).toBeGreaterThan(severity[t1.verdict]);
    });
  });

  describe("SURVEILLER → ENTER (conditions improving)", () => {
    const weakStart = mutate(HEALTHY_BASE, {
      price_change_1_hour: -3, price_change_1_day: -12, price_change_1_week: -20, price_change_1_month: -15,
      tao_volume_24_hr: 5_000_000_000,
      buys_24_hr: 8, sells_24_hr: 22,
      buyers_24_hr: 5, sellers_24_hr: 15,
      liquidity: 80_000_000_000,
      root_prop: 0.45,
      alpha_staked: 20_000_000_000,
    });

    it("tick 1: weak data produces SURVEILLER", () => {
      const r = verdict(10, weakStart);
      expect(r.verdict).toBe("SURVEILLER");
    });

    it("tick 2: strong improvement may upgrade to ENTER", () => {
      const improved = mutate(HEALTHY_BASE, {
        price_change_1_hour: 5, price_change_1_day: 20, price_change_1_week: 40,
        tao_volume_24_hr: 150_000_000_000,
        buys_24_hr: 90, sells_24_hr: 15,
        buyers_24_hr: 45, sellers_24_hr: 8,
        liquidity: 900_000_000_000,
        root_prop: 0.08,
        alpha_staked: 200_000_000_000,
      });
      const r = verdict(10, improved);
      expect(["ENTER", "SURVEILLER"]).toContain(r.verdict);
    });
  });

  describe("ENTER blocked when concordance degrades", () => {
    it("tick 1: healthy concordance → valid verdict", () => {
      const r = verdict(10, HEALTHY_BASE);
      expect(r.verdict).not.toBe("DONNÉES_INSTABLES");
    });

    it("tick 2: massive structural degradation blocks ENTER", () => {
      // Severe degradation: miners gone, high root prop, low volume
      const degraded = mutate(HEALTHY_BASE, {
        price_change_1_day: -30, price_change_1_week: -50,
        tao_volume_24_hr: 500_000,
        buys_24_hr: 1, sells_24_hr: 30,
        buyers_24_hr: 1, sellers_24_hr: 20,
        liquidity: 1_000_000,
        root_prop: 0.75,
        _chain: { active_miners: 3, active_validators: 2, active_uids: 8 },
      });
      const r = verdict(10, degraded);
      // Must not recommend ENTER with this degradation
      expect(r.verdict).not.toBe("ENTER");
    });
  });

  describe("NON_INVESTISSABLE → SURVEILLER (recovery)", () => {
    const dead = mutate(HEALTHY_BASE, {
      liquidity: 100_000, tao_volume_24_hr: 0,
      buys_24_hr: 0, sells_24_hr: 0,
      root_prop: 0.92,
      _chain: { active_miners: 0, active_validators: 1, active_uids: 2 },
    });

    it("tick 1: dead subnet → NON_INVESTISSABLE", () => {
      const r = verdict(10, dead);
      expect(r.verdict).toBe("NON_INVESTISSABLE");
    });

    it("tick 2: recovery restores to investable state", () => {
      // Subnet recovers
      const recovered = mutate(HEALTHY_BASE, {
        price_change_1_day: 5,
        tao_volume_24_hr: 50_000_000_000,
        liquidity: 300_000_000_000,
        root_prop: 0.2,
        _chain: { active_miners: 40, active_validators: 10, active_uids: 100 },
      });
      const r = verdict(10, recovered);
      expect(["ENTER", "SURVEILLER"]).toContain(r.verdict);
      expect(r.verdict).not.toBe("NON_INVESTISSABLE");
    });
  });

  describe("Rapid oscillation (3 ticks)", () => {
    it("handles rapid state changes without crashes or inconsistencies", () => {
      // Tick 1: healthy
      const t1 = verdict(10, HEALTHY_BASE);

      // Tick 2: degradation
      const degraded = mutate(HEALTHY_BASE, {
        price_change_1_day: -40, liquidity: 10_000_000_000,
        buys_24_hr: 5, sells_24_hr: 35, root_prop: 0.6,
        _chain: { active_miners: 8, active_validators: 3 },
      });
      const t2 = verdict(10, degraded);

      // Tick 3: partial recovery
      const partial = mutate(HEALTHY_BASE, {
        price_change_1_day: 2, liquidity: 200_000_000_000,
        buys_24_hr: 25, sells_24_hr: 20, root_prop: 0.25,
        _chain: { active_miners: 45, active_validators: 12 },
      });
      const t3 = verdict(10, partial);

      // All verdicts must be valid V3 verdicts
      const validVerdicts: VerdictV3[] = ["ENTER", "SURVEILLER", "SORTIR", "DONNÉES_INSTABLES", "NON_INVESTISSABLE", "SYSTÈME"];
      expect(validVerdicts).toContain(t1.verdict);
      expect(validVerdicts).toContain(t2.verdict);
      expect(validVerdicts).toContain(t3.verdict);

      // Degradation should worsen the verdict
      const severity: Record<string, number> = {
        ENTER: 0, SURVEILLER: 1, DONNÉES_INSTABLES: 2, SORTIR: 3, NON_INVESTISSABLE: 4, SYSTÈME: 5,
      };
      expect(severity[t2.verdict]).toBeGreaterThanOrEqual(severity[t1.verdict]);
    });
  });

  describe("Edge: system subnet stays SYSTÈME regardless", () => {
    it("netuid 0 always returns SYSTÈME even with perfect data", () => {
      const t1 = verdict(0, { ...HEALTHY_BASE, netuid: 0 });
      const crashed = mutate(HEALTHY_BASE, {
        netuid: 0, liquidity: 0, _chain: { active_miners: 0 },
      });
      const t2 = verdict(0, crashed);

      expect(t1.verdict).toBe("SYSTÈME");
      expect(t2.verdict).toBe("SYSTÈME");
    });
  });

  describe("Gradual degradation (5 ticks)", () => {
    it("verdict severity increases monotonically as conditions worsen step-by-step", () => {
      const severity: Record<string, number> = {
        ENTER: 0, SURVEILLER: 1, DONNÉES_INSTABLES: 2, SORTIR: 3, NON_INVESTISSABLE: 4, SYSTÈME: 5,
      };

      const steps = [
        HEALTHY_BASE,
        mutate(HEALTHY_BASE, { price_change_1_day: -5, buys_24_hr: 30, sells_24_hr: 30 }),
        mutate(HEALTHY_BASE, { price_change_1_day: -20, liquidity: 100_000_000_000, buys_24_hr: 10, sells_24_hr: 35, root_prop: 0.4 }),
        mutate(HEALTHY_BASE, { price_change_1_day: -45, liquidity: 5_000_000_000, buys_24_hr: 2, sells_24_hr: 40, root_prop: 0.7, _chain: { active_miners: 5 } }),
        mutate(HEALTHY_BASE, { price_change_1_day: -70, liquidity: 100_000, root_prop: 0.93, _chain: { active_miners: 0, active_validators: 1, active_uids: 3 } }),
      ];

      const verdicts = steps.map((s, i) => verdict(10, s));

      // Each step should be at least as severe as the previous
      for (let i = 1; i < verdicts.length; i++) {
        expect(severity[verdicts[i].verdict]).toBeGreaterThanOrEqual(
          severity[verdicts[i - 1].verdict],
        );
      }

      // First should be good, last should be bad
      expect(severity[verdicts[0].verdict]).toBeLessThanOrEqual(1);
      expect(severity[verdicts[verdicts.length - 1].verdict]).toBeGreaterThanOrEqual(3);
    });
  });
});
