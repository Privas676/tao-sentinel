import { describe, it, expect } from "vitest";
import {
  detectPulse,
  detectAllPulses,
  selectHotNow,
} from "@/lib/pulse-detector";
import { evaluateDataTrust } from "@/lib/data-trust";
import { dedupeAlerts, groupByPriority } from "@/lib/alert-dedup";
import type { CanonicalSubnetFacts } from "@/lib/canonical-types";

/* ── Minimal facts factory ── */
function mkFacts(over: Partial<CanonicalSubnetFacts> & { subnet_id: number }): CanonicalSubnetFacts {
  return {
    subnet_id: over.subnet_id,
    subnet_name: over.subnet_name ?? `SN-${over.subnet_id} Verathos`,
    category: null,
    price: 0.01,
    price_usd: 5,
    change_1h: null,
    change_24h: null,
    change_7d: null,
    change_30d: null,
    market_cap: 100_000,
    market_cap_usd: null,
    fdv: null,
    volume_24h: 50,
    volume_24h_usd: null,
    buys_count: 10,
    sells_count: 10,
    buyers_count: 5,
    sellers_count: 5,
    sentiment_score_raw: 0.5,
    tao_in_pool: 500,
    alpha_in_pool: 1000,
    tao_pool_ratio: 0.5,
    spread: null,
    slippage_1tau: null,
    slippage_10tau: null,
    depth: 500,
    emissions_pct: 0.01,
    emissions_day: 5,
    root_proportion: null,
    owner_day: null,
    miner_day: null,
    validator_day: null,
    incentive_burn_pct: null,
    circulating_supply: null,
    total_supply: null,
    uid_saturation: null,
    validators: 64,
    miners: 128,
    holders: null,
    taoflute_match: false,
    external_status: "NONE",
    liq_price: null,
    liq_haircut: null,
    taoflute_flags: [],
    taoflute_links: [],
    social_mentions_24h: null,
    social_mentions_delta: null,
    social_unique_accounts: null,
    social_kol_mentions: null,
    social_official_mentions: null,
    social_sentiment_score: null,
    social_hype_score: null,
    social_credibility_score: null,
    social_signal_strength: null,
    taostats_timestamp: new Date().toISOString(),
    taoflute_timestamp: null,
    social_timestamp: null,
    sentinel_timestamp: new Date().toISOString(),
    taostats_source_url: null,
    taoflute_source_ref: null,
    social_source_refs: [],
    provenance: {},
    ...over,
  };
}

describe("pulse-detector — detection brute", () => {
  it("pump +10% 1D => PUMP_LIVE détecté", () => {
    const facts = mkFacts({ subnet_id: 11, change_1h: 1, change_24h: 10, change_7d: 5 });
    const p = detectPulse(facts, undefined);
    expect(["PUMP_LIVE", "DAILY_BREAKOUT"]).toContain(p.pulse_type);
    expect(p.netuid).toBe(11);
  });

  it("+20% 1D et -40% 7J => DEAD_CAT_BOUNCE détecté", () => {
    const facts = mkFacts({
      subnet_id: 96,
      change_1h: 5,
      change_24h: 20,
      change_7d: -40,
      change_30d: -55,
    });
    const p = detectPulse(facts, undefined);
    expect(p.pulse_type).toBe("DEAD_CAT_BOUNCE");
    expect(p.tradability).toBe("DEAD_CAT");
  });

  it("subnet sans nom mais netuid valide => détecté avec fallback Unknown", () => {
    const facts = mkFacts({ subnet_id: 200, subnet_name: null, change_24h: 12 });
    const p = detectPulse(facts, undefined);
    expect(p.netuid).toBe(200);
    expect(p.name).toMatch(/SN-200 Unknown/);
    expect(p.pulse_type).not.toBe("NONE");
  });

  it("pump risqué (toxic) reste affiché dans HOT NOW avec tradability TOXIC", () => {
    const factsMap = new Map<number, CanonicalSubnetFacts>();
    factsMap.set(96, mkFacts({
      subnet_id: 96,
      change_1h: 6,
      change_24h: 25,
      external_status: "P1",
      taoflute_match: true,
    }));
    const pulses = detectAllPulses(factsMap);
    const hot = selectHotNow(pulses);
    expect(hot.length).toBe(1);
    expect(hot[0].pulse_type).toBe("TOXIC_PUMP");
    expect(hot[0].tradability).toBe("TOXIC");
  });

  it("HOT NOW trie par priorité brute (EXTREME > PUMP_LIVE > DAILY_BREAKOUT)", () => {
    const factsMap = new Map<number, CanonicalSubnetFacts>();
    factsMap.set(1, mkFacts({ subnet_id: 1, change_1h: 1, change_24h: 9 }));     // PUMP_LIVE/BREAKOUT
    factsMap.set(2, mkFacts({ subnet_id: 2, change_1h: 10, change_24h: 25 }));   // EXTREME
    factsMap.set(3, mkFacts({ subnet_id: 3, change_1h: 0, change_24h: 9 }));     // BREAKOUT
    const pulses = detectAllPulses(factsMap);
    const hot = selectHotNow(pulses, 3);
    expect(hot[0].netuid).toBe(2); // EXTREME en premier
  });
});

describe("data-trust — kill switch", () => {
  it("données fraîches => OK, pas de blocage", () => {
    const r = evaluateDataTrust(
      [{ name: "taostats", lastUpdate: new Date().toISOString(), required: true }],
      null,
    );
    expect(r.level).toBe("OK");
    expect(r.isSafeMode).toBe(false);
    expect(r.blockEntryActions).toBe(false);
  });

  it("données stale (>15min) => SAFE MODE, bloque ENTRER/RENFORCER", () => {
    const stale = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const r = evaluateDataTrust(
      [{ name: "taostats", lastUpdate: stale, required: true }],
      null,
    );
    expect(r.isSafeMode).toBe(true);
    expect(r.blockEntryActions).toBe(true);
    expect(r.level).toBe("STALE");
  });

  it("source non requise stale => n'escalade pas le niveau global", () => {
    const stale = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const r = evaluateDataTrust([
      { name: "taostats", lastUpdate: new Date().toISOString(), required: true },
      { name: "social", lastUpdate: stale, required: false },
    ], null);
    expect(r.level).toBe("OK");
    expect(r.blockEntryActions).toBe(false);
  });
});

describe("alert-dedup — préparation Lot suivant", () => {
  it("plusieurs alertes même subnet/famille/severity => une seule dédupliquée", () => {
    const out = dedupeAlerts([
      { netuid: 64, family: "PUMP", severity: "HIGH", title: "pump", reason: "+25% 1D" },
      { netuid: 64, family: "PUMP", severity: "HIGH", title: "pump", reason: "vol x3" },
      { netuid: 64, family: "PUMP", severity: "HIGH", title: "pump", reason: "+25% 1D" }, // raison dupe
    ]);
    expect(out.length).toBe(1);
    expect(out[0].count).toBe(3);
    expect(out[0].reasons.sort()).toEqual(["+25% 1D", "vol x3"].sort());
    expect(out[0].priority).toBe("P1");
  });

  it("groupes P0/P1/P2 séparés par sévérité", () => {
    const out = dedupeAlerts([
      { netuid: 1, family: "DEPEG", severity: "CRITICAL", title: "depeg" },
      { netuid: 2, family: "PUMP", severity: "HIGH", title: "pump" },
      { netuid: 3, family: "SOCIAL", severity: "LOW", title: "buzz" },
    ]);
    const g = groupByPriority(out);
    expect(g.P0).toHaveLength(1);
    expect(g.P1).toHaveLength(1);
    expect(g.P2).toHaveLength(1);
    expect(g.P0[0].family).toBe("DEPEG");
  });

  it("alertes différentes severities sur même famille NE sont PAS fusionnées", () => {
    const out = dedupeAlerts([
      { netuid: 5, family: "RISK", severity: "HIGH", title: "risk" },
      { netuid: 5, family: "RISK", severity: "MEDIUM", title: "risk" },
    ]);
    expect(out.length).toBe(2);
  });
});
