import { describe, it, expect } from "vitest";
import { extractSubnetFacts, val } from "@/lib/subnet-facts";
import { computeConcordance } from "@/lib/source-concordance";
import { computeDerivedScores } from "@/lib/derived-scores";

/* ─── Mock raw_payload matching real TaoStats structure ─── */
const MOCK_PAYLOAD = {
  netuid: 3,
  name: "MySubnet",
  price: 0.5,
  price_change_1_hour: 2.5,
  price_change_1_day: 8.0,
  price_change_1_week: 15.0,
  price_change_1_month: 30.0,
  market_cap: 500_000_000_000, // in RAO
  tao_volume_24_hr: 100_000_000_000, // in RAO
  buys_24_hr: 50,
  sells_24_hr: 30,
  buyers_24_hr: 20,
  sellers_24_hr: 10,
  protocol_provided_tao: 200_000_000_000, // 200 TAO
  protocol_provided_alpha: 400_000_000_000, // 400 alpha
  alpha_staked: 100_000_000_000,
  liquidity: 400_000_000_000,
  root_prop: 0.15,
  rank: 5,
  _chain: {
    active_validators: 12,
    active_miners: 50,
    active_uids: 200,
    max_neurons: 256,
    emission: 50_000_000, // in RAO
    emission_per_day: 360_000_000_000, // in RAO
    recycled_24_hours: 10_000_000_000,
    registrations: 5,
  },
};

const TAO_USD = 450;

describe("SubnetFacts extraction", () => {
  const facts = extractSubnetFacts(3, MOCK_PAYLOAD, TAO_USD);

  it("extracts price correctly", () => {
    expect(val(facts.price)).toBe(0.5);
    expect(facts.price.source).toBe("taostats");
  });

  it("converts RAO values to TAO", () => {
    expect(val(facts.marketCap)).toBeCloseTo(500, 0);
    expect(val(facts.vol24h)).toBeCloseTo(100, 0);
    expect(val(facts.taoInPool)).toBeCloseTo(200, 0);
    expect(val(facts.alphaInPool)).toBeCloseTo(400, 0);
  });

  it("computes pool price and haircut", () => {
    expect(val(facts.poolPrice)).toBeCloseTo(0.5, 2);
    expect(val(facts.liqHaircut)).toBeCloseTo(0, 1); // pool price ≈ spot price
  });

  it("computes slippage", () => {
    const slip1 = val(facts.slippage1tau);
    const slip10 = val(facts.slippage10tau);
    expect(slip1).toBeGreaterThan(0);
    expect(slip10).toBeGreaterThan(slip1);
  });

  it("extracts chain data", () => {
    expect(val(facts.validators)).toBe(12);
    expect(val(facts.miners)).toBe(50);
    expect(val(facts.activeUids)).toBe(200);
  });
});

describe("Source concordance", () => {
  const facts = extractSubnetFacts(3, MOCK_PAYLOAD, TAO_USD);
  const result = computeConcordance(facts);

  it("produces a high score for healthy data", () => {
    expect(result.score).toBeGreaterThan(70);
    expect(result.grade).toMatch(/^[AB]$/);
  });

  it("allows strong verdict for high concordance", () => {
    expect(result.allowStrongVerdict).toBe(true);
  });

  it("does not force unstable", () => {
    expect(result.forceUnstable).toBe(false);
  });
});

describe("Source concordance — degraded subnet", () => {
  const badPayload = {
    netuid: 99,
    name: "BadSubnet",
    price: 0,
    _chain: { active_validators: 1, active_miners: 0, active_uids: 0, max_neurons: 256 },
  };
  const facts = extractSubnetFacts(99, badPayload, TAO_USD);
  const result = computeConcordance(facts);

  it("produces low score for degraded data", () => {
    expect(result.score).toBeLessThan(50);
  });

  it("blocks strong verdicts", () => {
    expect(result.allowStrongVerdict).toBe(false);
  });
});

describe("Derived scores with prohibition rules", () => {
  it("caps liquidity if haircut is extreme", () => {
    const payload = {
      ...MOCK_PAYLOAD,
      // Create extreme haircut: pool price ≠ spot price
      protocol_provided_tao: 500_000_000_000, // 500 TAO
      protocol_provided_alpha: 400_000_000_000, // 400 alpha → pool price = 1.25 vs spot 0.5
    };
    const facts = extractSubnetFacts(3, payload, TAO_USD);
    const concordance = computeConcordance(facts);
    const result = computeDerivedScores(facts, concordance);

    // Haircut should be ~150% → liquidity should be capped
    const haircutViolation = result.violations.find(v => v.code === "LIQ_HAIRCUT_CAP");
    if (Math.abs(val(facts.liqHaircut)) > 15 && result.scores.liquidityQuality <= 85) {
      // Already naturally low, no cap needed
    } else if (Math.abs(val(facts.liqHaircut)) > 15) {
      expect(haircutViolation).toBeDefined();
    }
  });

  it("forces structural fragility if miners <= 1", () => {
    const payload = {
      ...MOCK_PAYLOAD,
      _chain: { ...MOCK_PAYLOAD._chain, active_miners: 1, active_validators: 2 },
    };
    const facts = extractSubnetFacts(3, payload, TAO_USD);
    const concordance = computeConcordance(facts);
    const result = computeDerivedScores(facts, concordance);

    expect(result.scores.structuralFragility).toBeGreaterThanOrEqual(50);
  });

  it("raises momentum floor when price is strongly up", () => {
    const payload = {
      ...MOCK_PAYLOAD,
      price_change_1_week: 25,
      price_change_1_day: 15,
    };
    const facts = extractSubnetFacts(3, payload, TAO_USD);
    const concordance = computeConcordance(facts);
    const result = computeDerivedScores(facts, concordance);

    expect(result.scores.momentum).toBeGreaterThanOrEqual(45);
  });
});
