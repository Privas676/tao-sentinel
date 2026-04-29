/* ═══════════════════════════════════════════════════════════ */
/*   Lot 3 — Faits Bruts / Layer A en source primaire           */
/*   Spec: les faits bruts déclenchent la détection,            */
/*         les scores n'effacent jamais un fait brut critique.  */
/* ═══════════════════════════════════════════════════════════ */

import { describe, it, expect } from "vitest";
import { detectPulse, detectAllPulses, selectHotNow } from "@/lib/pulse-detector";
import { buildHotNowCsv } from "@/lib/hot-now-csv";
import { evaluateDataTrust } from "@/lib/data-trust";
import { deriveHotNowAction } from "@/lib/hot-now-action";
import type { CanonicalSubnetFacts, CanonicalSubnetDecision } from "@/lib/canonical-types";

function mkFacts(over: Partial<CanonicalSubnetFacts> & { subnet_id: number }): CanonicalSubnetFacts {
  const now = new Date().toISOString();
  return {
    subnet_id: over.subnet_id,
    subnet_name: over.subnet_name ?? `SN-${over.subnet_id}`,
    category: null,
    price: 0.01, price_usd: 5,
    change_1h: null, change_24h: null, change_7d: null, change_30d: null,
    market_cap: 100_000, market_cap_usd: null, fdv: null,
    volume_24h: 50, volume_24h_usd: null,
    buys_count: 10, sells_count: 10, buyers_count: 5, sellers_count: 5,
    sentiment_score_raw: 0.5,
    tao_in_pool: 500, alpha_in_pool: 1000, tao_pool_ratio: 0.5,
    spread: null, slippage_1tau: null, slippage_10tau: null, depth: 500,
    emissions_pct: 0.01, emissions_day: 5,
    root_proportion: null, owner_day: null, miner_day: null, validator_day: null,
    incentive_burn_pct: null, circulating_supply: null, total_supply: null,
    uid_saturation: null, validators: 64, miners: 128, holders: null,
    taoflute_match: false, external_status: "NONE",
    liq_price: null, liq_haircut: null, taoflute_flags: [], taoflute_links: [],
    social_mentions_24h: null, social_mentions_delta: null,
    social_unique_accounts: null, social_kol_mentions: null,
    social_official_mentions: null, social_sentiment_score: null,
    social_hype_score: null, social_credibility_score: null, social_signal_strength: null,
    taostats_timestamp: now, taoflute_timestamp: null, social_timestamp: null,
    sentinel_timestamp: now,
    taostats_source_url: null, taoflute_source_ref: null, social_source_refs: [],
    provenance: {},
    ...over,
  };
}

function mkDecision(over: Partial<CanonicalSubnetDecision> & { subnet_id: number }): CanonicalSubnetDecision {
  return {
    subnet_id: over.subnet_id,
    final_action: "SURVEILLER",
    final_reason_primary: "test",
    final_reason_secondary: [],
    raw_signal: "NEUTRE",
    raw_signal_reason: [],
    guardrail_active: false,
    guardrail_reason: [],
    confidence_score: 80, conviction_score: 50, momentum_score: 50,
    risk_market_score: 30, risk_decision_score: 30,
    structural_fragility_score: 30, concentration_risk_score: 30,
    liquidity_quality_score: 70, execution_quality_score: 70,
    depeg_risk_score: 0, delist_risk_score: 0,
    social_signal_score: 0, social_confidence_score: 0,
    source_concordance_score: 80, data_confidence_score: 80,
    portfolio_action: "HOLD",
    updated_at: new Date().toISOString(),
    ...over,
  };
}

describe("Lot 3 — Faits bruts comme source primaire", () => {
  it("faits bruts +10% 24h => PUMP_LIVE détecté", () => {
    const p = detectPulse(mkFacts({ subnet_id: 1, change_24h: 10 }), undefined);
    expect(["PUMP_LIVE", "DAILY_BREAKOUT"]).toContain(p.pulse_type);
  });

  it("faits bruts +20% 24h et -40% 7J => DEAD_CAT détecté", () => {
    const p = detectPulse(
      mkFacts({ subnet_id: 96, change_24h: 20, change_7d: -40 }),
      undefined,
    );
    expect(p.pulse_type).toBe("DEAD_CAT_BOUNCE");
  });

  it("subnet Unknown (name=null) avec netuid valide => détecté avec fallback", () => {
    const p = detectPulse(mkFacts({ subnet_id: 250, subnet_name: null, change_24h: 12 }), undefined);
    expect(p.netuid).toBe(250);
    expect(p.name).toBe("SN-250 Unknown");
    expect(p.pulse_type).not.toBe("NONE");
  });

  it("faits bruts stale > 15 min => Data Trust SAFE MODE bloque ENTRER/RENFORCER", () => {
    const stale = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    const trust = evaluateDataTrust(
      [{ name: "taostats", lastUpdate: stale, required: true }],
      null,
    );
    expect(trust.isSafeMode).toBe(true);
    expect(trust.blockEntryActions).toBe(true);
  });

  it("pump + liquidité faible (pool < 50 TAO) => ILLIQUID_PUMP", () => {
    const p = detectPulse(
      mkFacts({ subnet_id: 7, change_24h: 15, tao_in_pool: 20, alpha_in_pool: 5000 }),
      undefined,
    );
    expect(p.pulse_type).toBe("ILLIQUID_PUMP");
  });

  it("pump + slippage 1 TAO élevé => ILLIQUID_PUMP via faits bruts", () => {
    const p = detectPulse(
      mkFacts({ subnet_id: 8, change_24h: 15, slippage_1tau: 3.0, tao_in_pool: 1000 }),
      undefined,
    );
    expect(p.pulse_type).toBe("ILLIQUID_PUMP");
  });

  it("pump + émission nulle => TOXIC_PUMP via faits bruts (pas de moteur requis)", () => {
    const p = detectPulse(
      mkFacts({ subnet_id: 9, change_24h: 18, emissions_pct: 0, emissions_day: 0 }),
      undefined,
    );
    expect(p.pulse_type).toBe("TOXIC_PUMP");
  });

  it("score moteur NEUTRE mais faits bruts pump => engineConflict + HOT NOW forcé", () => {
    const facts = mkFacts({ subnet_id: 42, change_1h: 5, change_24h: 12 });
    const decision = mkDecision({
      subnet_id: 42,
      final_action: "SURVEILLER",
      raw_signal: "NEUTRE",
    });
    const p = detectPulse(facts, decision);
    expect(p.pulse_type).not.toBe("NONE");
    expect(p.engineConflict).toBe(true);
    expect(p.conflict_reason).toMatch(/Moteur/);

    const map = new Map([[42, facts]]);
    const decMap = new Map([[42, decision]]);
    const pulses = detectAllPulses(map, decMap);
    const hot = selectHotNow(pulses);
    expect(hot.find((x) => x.netuid === 42)).toBeTruthy();
  });

  it("HOT NOW exporte les faits bruts (price, liquidity, slippage, emissions, timestamps)", () => {
    const facts = mkFacts({
      subnet_id: 96,
      change_1h: 6, change_24h: 25, change_7d: -40,
      price: 0.0042, volume_24h: 12.5,
      slippage_1tau: 0.8, slippage_10tau: 6.5, spread: 0.4,
      tao_in_pool: 800, alpha_in_pool: 2000,
      emissions_pct: 0.012,
    });
    const p = detectPulse(facts, undefined);
    const action = deriveHotNowAction(p, undefined, false);
    const csv = buildHotNowCsv([{ pulse: p, facts, action }]);
    const [header, row] = csv.split("\n");

    // Headers cover all required raw facts
    for (const col of [
      "price", "change_1h", "change_24h", "change_7d", "change_30d",
      "volume_24h", "buys_24h", "sells_24h", "buyers", "sellers",
      "liquidity", "tao_pool", "alpha_pool", "pool_ratio",
      "slippage_1t", "slippage_10t", "spread", "emission",
      "pulse_type", "tradability", "action", "reasons",
      "engine_conflict", "data_freshness",
      "taostats_timestamp", "sentinel_timestamp",
    ]) {
      expect(header).toContain(col);
    }
    // Row carries the raw values
    expect(row).toContain("96");
    expect(row).toContain("0.004200"); // price
    expect(row).toMatch(/0\.8000/);    // slippage_1t
    expect(row).toMatch(/6\.5000/);    // slippage_10t
  });

  it("Data Trust intègre TaoFlute et Sentinel comme sources additionnelles", () => {
    const fresh = new Date().toISOString();
    const stale = new Date(Date.now() - 90 * 60 * 1000).toISOString();
    const trust = evaluateDataTrust([
      { name: "taostats", lastUpdate: fresh, required: true },
      { name: "taoflute", lastUpdate: stale, required: false },
      { name: "sentinel", lastUpdate: fresh, required: false },
    ], null);
    // Non-required stale ne doit pas escalader le niveau global
    expect(trust.level).toBe("OK");
  });

  it("priorité faits bruts: pump détecté reste visible même avec scores défavorables", () => {
    // Decision avec risk_score haut, mais pump brut visible: pulse doit exister
    const facts = mkFacts({ subnet_id: 77, change_24h: 15 });
    const decision = mkDecision({
      subnet_id: 77,
      risk_decision_score: 85,
      final_action: "SURVEILLER",
      raw_signal: "NEUTRE",
    });
    const p = detectPulse(facts, decision);
    expect(p.pulse_type).not.toBe("NONE");
    // Le pump ne disparaît pas — l'action indique seulement la prudence
    const action = deriveHotNowAction(p, decision, false);
    expect(["WATCH", "AVOID"]).toContain(action);
  });
});
