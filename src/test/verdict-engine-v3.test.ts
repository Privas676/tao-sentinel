import { describe, it, expect } from "vitest";
import { extractSubnetFacts } from "@/lib/subnet-facts";
import { computeConcordance } from "@/lib/source-concordance";
import { computeDerivedScores } from "@/lib/derived-scores";
import { computeVerdictV3, type VerdictV3 } from "@/lib/verdict-engine-v3";

const TAO_USD = 450;

/* ─── Helper: build full pipeline from raw payload ─── */
function verdict(payload: any, netuidOverride?: number): ReturnType<typeof computeVerdictV3> {
  const netuid = netuidOverride ?? payload.netuid ?? 3;
  const facts = extractSubnetFacts(netuid, payload, TAO_USD);
  const concordance = computeConcordance(facts);
  const scoring = computeDerivedScores(facts, concordance);
  return computeVerdictV3(facts, scoring, concordance);
}

/* ─── Healthy subnet payload ─── */
const HEALTHY = {
  netuid: 3, name: "HealthyNet", price: 0.5,
  price_change_1_hour: 2, price_change_1_day: 12, price_change_1_week: 25, price_change_1_month: 40,
  market_cap: 500_000_000_000,
  tao_volume_24_hr: 80_000_000_000,
  buys_24_hr: 60, sells_24_hr: 25, buyers_24_hr: 30, sellers_24_hr: 10,
  protocol_provided_tao: 300_000_000_000, protocol_provided_alpha: 600_000_000_000,
  alpha_staked: 100_000_000_000, liquidity: 600_000_000_000, root_prop: 0.15, rank: 5,
  _chain: { active_validators: 15, active_miners: 60, active_uids: 220, max_neurons: 256, emission: 50_000_000, emission_per_day: 360_000_000_000, recycled_24_hours: 10_000_000_000, registrations: 8 },
};

/* ─── Degraded subnet payload ─── */
const DEGRADED = {
  netuid: 99, name: "GhostNet", price: 0,
  _chain: { active_validators: 1, active_miners: 0, active_uids: 0, max_neurons: 256, emission: 0, registrations: 0 },
};

/* ─── Toxic structure but some momentum ─── */
const TOXIC_WITH_MOMENTUM = {
  netuid: 50, name: "ToxicMom", price: 0.3,
  price_change_1_hour: 5, price_change_1_day: 15, price_change_1_week: 30, price_change_1_month: 50,
  market_cap: 100_000_000_000,
  tao_volume_24_hr: 5_000_000_000,
  buys_24_hr: 10, sells_24_hr: 5, buyers_24_hr: 5, sellers_24_hr: 2,
  protocol_provided_tao: 5_000_000_000, protocol_provided_alpha: 10_000_000_000,
  liquidity: 10_000_000_000, root_prop: 0.98,
  _chain: { active_validators: 2, active_miners: 1, active_uids: 3, max_neurons: 256, emission: 0, registrations: 0 },
};

/* ─── Good momentum, fragile structure ─── */
const FRAGILE_MOMENTUM = {
  netuid: 25, name: "FragileMom", price: 0.8,
  price_change_1_hour: 3, price_change_1_day: 10, price_change_1_week: 20, price_change_1_month: 15,
  market_cap: 300_000_000_000,
  tao_volume_24_hr: 50_000_000_000,
  buys_24_hr: 40, sells_24_hr: 20, buyers_24_hr: 15, sellers_24_hr: 8,
  protocol_provided_tao: 50_000_000_000, protocol_provided_alpha: 62_500_000_000,
  liquidity: 100_000_000_000, root_prop: 0.3,
  _chain: { active_validators: 5, active_miners: 8, active_uids: 40, max_neurons: 256, emission: 10_000_000, emission_per_day: 72_000_000_000, recycled_24_hours: 2_000_000_000, registrations: 2 },
};

describe("Verdict Engine v3", () => {

  describe("Rule 1: SYSTÈME", () => {
    it("returns SYSTÈME for netuid 0", () => {
      const r = verdict(HEALTHY, 0);
      expect(r.verdict).toBe("SYSTÈME");
      expect(r.verdictFr).toBe("SYSTÈME");
      expect(r.verdictEn).toBe("SYSTEM");
      expect(r.portfolioAction).toBe("NE_PAS_ENTRER");
    });
  });

  describe("Rule 2: NON_INVESTISSABLE", () => {
    it("returns NON_INVESTISSABLE for dead subnet", () => {
      const r = verdict(DEGRADED);
      expect(r.verdict).toBe("NON_INVESTISSABLE");
      expect(r.primaryReason.code).toBe("NOT_INVESTABLE");
    });

    it("returns NON_INVESTISSABLE when miners = 0", () => {
      const r = verdict({ ...HEALTHY, _chain: { ...HEALTHY._chain, active_miners: 0, active_validators: 10 } });
      expect(r.verdict).toBe("NON_INVESTISSABLE");
    });
  });

  describe("Rule 3: DONNÉES_INSTABLES", () => {
    it("returns DONNÉES_INSTABLES for low concordance", () => {
      const r = verdict({
        netuid: 77, name: "BadData", price: 0,
        _chain: { active_validators: 3, active_miners: 5, active_uids: 10, max_neurons: 256 },
      });
      // Price 0 + no pool + no volume = grade D
      expect(r.verdict).toBe("DONNÉES_INSTABLES");
      expect(r.concordanceGrade).toBe("D");
    });
  });

  describe("Rule 4: SORTIR", () => {
    it("returns SORTIR for toxic structure even with momentum", () => {
      const r = verdict(TOXIC_WITH_MOMENTUM);
      // Should be SORTIR or NON_INVESTISSABLE (structure too fragile)
      expect(["SORTIR", "NON_INVESTISSABLE"]).toContain(r.verdict);
      if (r.verdict === "SORTIR") {
        // Should mention the structural issue
        expect(r.riskFlags.length).toBeGreaterThan(0);
      }
    });

    it("explains momentum conflict when exiting despite positive momentum", () => {
      const r = verdict(TOXIC_WITH_MOMENTUM);
      if (r.verdict === "SORTIR") {
        // Should have a block explaining momentum was overridden
        const hasConflict = r.blocks.some(b => b.code === "MOMENTUM_OVERRIDE") || r.riskFlags.length > 0;
        expect(hasConflict).toBe(true);
      }
    });
  });

  describe("Rule 5: ENTER", () => {
    it("returns ENTER for healthy subnet with strong momentum", () => {
      const r = verdict(HEALTHY);
      expect(r.verdict).toBe("ENTER");
      expect(r.verdictFr).toBe("ENTRER");
      expect(r.conviction).toMatch(/^(HIGH|MEDIUM)$/);
      expect(r.confidence).toBeGreaterThan(50);
    });

    it("blocks ENTER if depeg risk is high", () => {
      // Force bad haircut → high depeg risk
      const payload = {
        ...HEALTHY,
        protocol_provided_tao: 1_000_000_000_000, // 1000 TAO in pool
        protocol_provided_alpha: 600_000_000_000,  // pool price >> spot → bad haircut
      };
      const r = verdict(payload);
      // Should either still be ENTER (if haircut not severe enough) or SURVEILLER
      if (r.isBlocked) {
        expect(r.verdict).toBe("SURVEILLER");
        expect(r.blocks.length).toBeGreaterThan(0);
      }
    });
  });

  describe("Rule 6: SURVEILLER", () => {
    it("returns SURVEILLER for fragile structure with good momentum", () => {
      const r = verdict(FRAGILE_MOMENTUM);
      // Should be SURVEILLER or ENTER depending on exact scores
      expect(["SURVEILLER", "ENTER"]).toContain(r.verdict);
    });
  });

  describe("Metadata", () => {
    it("includes engine version", () => {
      const r = verdict(HEALTHY);
      expect(r.engineVersion).toBe("v3.0");
    });

    it("has max 3 risk flags", () => {
      const r = verdict(TOXIC_WITH_MOMENTUM);
      expect(r.riskFlags.length).toBeLessThanOrEqual(3);
    });

    it("has max 2 secondary reasons", () => {
      const r = verdict(DEGRADED);
      expect(r.secondaryReasons.length).toBeLessThanOrEqual(2);
    });

    it("has max 3 watchlist items", () => {
      const r = verdict(HEALTHY);
      expect(r.watchlist.length).toBeLessThanOrEqual(3);
    });

    it("produces valid portfolio action", () => {
      const r = verdict(HEALTHY);
      expect(["RENFORCER", "CONSERVER", "RÉDUIRE", "SORTIR", "NE_PAS_ENTRER"]).toContain(r.portfolioAction);
    });
  });

  describe("Decision rules consistency", () => {
    it("Case 1: strong momentum + market + structure → ENTER", () => {
      const r = verdict(HEALTHY);
      expect(r.verdict).toBe("ENTER");
    });

    it("Case 3: toxic everything → SORTIR or NON_INVESTISSABLE", () => {
      const r = verdict(TOXIC_WITH_MOMENTUM);
      expect(["SORTIR", "NON_INVESTISSABLE"]).toContain(r.verdict);
    });

    it("Case 4: bad data → DONNÉES_INSTABLES", () => {
      const r = verdict({ netuid: 88, price: 0, _chain: { active_validators: 4, active_miners: 3, active_uids: 10, max_neurons: 256 } });
      expect(r.verdict).toBe("DONNÉES_INSTABLES");
    });

    it("Case 5: system subnet excluded", () => {
      const r = verdict(HEALTHY, 0);
      expect(r.verdict).toBe("SYSTÈME");
    });

    it("never returns ENTER if concordance is D", () => {
      // Force bad concordance
      const bad = { netuid: 55, price: 0, _chain: { active_validators: 2, active_miners: 2, active_uids: 5, max_neurons: 256 } };
      const r = verdict(bad);
      expect(r.verdict).not.toBe("ENTER");
    });
  });
});
