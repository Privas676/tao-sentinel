import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { HotNowSection } from "@/components/sentinel/HotNowSection";
import { SystemAlertsPanel } from "@/components/sentinel/SystemAlertsPanel";
import { evaluateDataTrust } from "@/lib/data-trust";
import { detectAllPulses, type PulseResult } from "@/lib/pulse-detector";
import { dedupeAlerts, normalizeFamily } from "@/lib/alert-dedup";
import { buildHotNowCsv } from "@/lib/hot-now-csv";
import { deriveHotNowAction } from "@/lib/hot-now-action";
import type { CanonicalSubnetFacts } from "@/lib/canonical-types";

function mkFacts(over: Partial<CanonicalSubnetFacts> & { subnet_id: number }): CanonicalSubnetFacts {
  return {
    subnet_id: over.subnet_id,
    subnet_name: over.subnet_name ?? `SN-${over.subnet_id} Verathos`,
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
    liq_price: null, liq_haircut: null,
    taoflute_flags: [], taoflute_links: [],
    social_mentions_24h: null, social_mentions_delta: null,
    social_unique_accounts: null, social_kol_mentions: null, social_official_mentions: null,
    social_sentiment_score: null, social_hype_score: null,
    social_credibility_score: null, social_signal_strength: null,
    taostats_timestamp: new Date().toISOString(),
    taoflute_timestamp: null, social_timestamp: null,
    sentinel_timestamp: new Date().toISOString(),
    taostats_source_url: null, taoflute_source_ref: null, social_source_refs: [],
    provenance: {},
    ...over,
  };
}

function freshTrust() {
  return evaluateDataTrust(
    [{ name: "taostats", lastUpdate: new Date().toISOString(), required: true }],
    null,
  );
}
function staleTrust() {
  const stale = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  return evaluateDataTrust(
    [{ name: "taostats", lastUpdate: stale, required: true }],
    null,
  );
}

function renderHot(pulses: Map<number, PulseResult>, dataTrust = freshTrust(), heldNetuids?: Set<number>) {
  return render(
    <MemoryRouter>
      <HotNowSection
        pulses={pulses}
        dataTrust={dataTrust}
        fr={true}
        sourceTimestamp={new Date().toISOString()}
        heldNetuids={heldNetuids}
      />
    </MemoryRouter>,
  );
}

describe("HotNowSection — auto-refresh + Europe/Zurich indicator", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-04-29T12:00:00Z")); });
  afterEach(() => { vi.useRealTimers(); });

  it("affiche un indicateur Europe/Zurich avec horodatage", () => {
    const factsMap = new Map([[10, mkFacts({ subnet_id: 10, change_24h: 12, change_1h: 1 })]]);
    const pulses = detectAllPulses(factsMap);
    renderHot(pulses);
    const node = screen.getByTestId("hot-now-last-update");
    expect(node.textContent).toMatch(/Europe\/Zurich/);
    expect(node.textContent).toMatch(/Dernière mise à jour/);
  });

  it("met à jour l'âge relatif au tick (60s)", () => {
    const factsMap = new Map([[10, mkFacts({ subnet_id: 10, change_24h: 12 })]]);
    const pulses = detectAllPulses(factsMap);
    renderHot(pulses);
    expect(screen.getByTestId("hot-now-last-update").textContent).toMatch(/il y a 0 sec/);
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(screen.getByTestId("hot-now-last-update").textContent).toMatch(/il y a 1 min|il y a 60 sec/);
  });
});

describe("HotNowSection — badges + actions", () => {
  it("pulse TOXIC affiche badge TOXIC_PUMP + action ÉVITER", () => {
    const factsMap = new Map([
      [96, mkFacts({ subnet_id: 96, change_1h: 6, change_24h: 25, external_status: "P1", taoflute_match: true })],
    ]);
    const pulses = detectAllPulses(factsMap);
    renderHot(pulses);
    expect(screen.getByTestId("badge-type-96").getAttribute("data-pulse-type")).toBe("TOXIC_PUMP");
    expect(screen.getByTestId("badge-action-96").getAttribute("data-action")).toBe("AVOID");
    expect(screen.getByTestId("badge-action-96").textContent).toMatch(/ÉVITER/);
  });

  it("pulse DEAD_CAT affiche badge DEAD_CAT_BOUNCE + action ÉVITER", () => {
    const factsMap = new Map([
      [11, mkFacts({ subnet_id: 11, change_1h: 5, change_24h: 20, change_7d: -40, change_30d: -55 })],
    ]);
    const pulses = detectAllPulses(factsMap);
    renderHot(pulses);
    expect(screen.getByTestId("badge-type-11").getAttribute("data-pulse-type")).toBe("DEAD_CAT_BOUNCE");
    expect(screen.getByTestId("badge-action-11").getAttribute("data-action")).toBe("AVOID");
  });

  it("en stale data, pulse propre devient WATCH avec badge NEEDS CONFIRMATION", () => {
    const factsMap = new Map([
      [3, mkFacts({ subnet_id: 3, change_1h: 1, change_24h: 10 })],
    ]);
    const pulses = detectAllPulses(factsMap, undefined, staleTrust());
    renderHot(pulses, staleTrust());
    expect(screen.getByTestId("badge-needs-3")).toBeInTheDocument();
    expect(screen.getByTestId("badge-action-3").getAttribute("data-action")).not.toBe("GO");
  });

  it("EXIT_FAST déclenché si position détenue + risque critique", () => {
    const factsMap = new Map([
      [96, mkFacts({ subnet_id: 96, change_1h: 6, change_24h: 25, external_status: "P1", taoflute_match: true })],
    ]);
    const pulses = detectAllPulses(factsMap);
    renderHot(pulses, freshTrust(), new Set([96]));
    expect(screen.getByTestId("badge-action-96").getAttribute("data-action")).toBe("EXIT_FAST");
  });
});

describe("HotNowSection — CSV export", () => {
  it("buildHotNowCsv contient netuid, pulse_type, tradability, reasons et timestamp", () => {
    const factsMap = new Map([
      [11, mkFacts({ subnet_id: 11, change_1h: 5, change_24h: 20, change_7d: -40, change_30d: -55 })],
    ]);
    const pulses = detectAllPulses(factsMap);
    const p = pulses.get(11)!;
    const action = deriveHotNowAction(p, undefined, false);
    const csv = buildHotNowCsv([{ pulse: p, action }]);
    const [header, row] = csv.split("\n");
    expect(header).toContain("netuid");
    expect(header).toContain("pulse_type");
    expect(header).toContain("tradability");
    expect(header).toContain("reasons");
    expect(header).toContain("timestamp");
    expect(row).toContain("11");
    expect(row).toContain("DEAD_CAT_BOUNCE");
    expect(row).toContain("DEAD_CAT");
  });
});

describe("alert-dedup — PUMP_MOVEMENT normalization", () => {
  it("plusieurs causes pump sur le même subnet => 1 seule alerte groupée", () => {
    const out = dedupeAlerts([
      { netuid: 96, family: "PUMP", cause: "EXTREME_PUMP", severity: "CRITICAL", title: "pump", reason: "+25% 1D" },
      { netuid: 96, family: "PUMP", cause: "DEAD_CAT_BOUNCE", severity: "CRITICAL", title: "pump", reason: "-40% 7J" },
      { netuid: 96, family: "PUMP", cause: "ILLIQUID_PUMP", severity: "CRITICAL", title: "pump", reason: "pool faible" },
      { netuid: 96, family: "PUMP", cause: "TOXIC_PUMP", severity: "CRITICAL", title: "pump", reason: "P1 TaoFlute" },
    ]);
    expect(out.length).toBe(1);
    expect(out[0].normalized_family).toBe("PUMP_MOVEMENT");
    expect(out[0].count).toBe(4);
    expect(out[0].causes.sort()).toEqual([
      "DEAD_CAT_BOUNCE", "EXTREME_PUMP", "ILLIQUID_PUMP", "TOXIC_PUMP",
    ]);
    expect(out[0].priority).toBe("P0");
  });

  it("normalizeFamily mappe les sous-familles pump en PUMP_MOVEMENT", () => {
    expect(normalizeFamily("PUMP", "EXTREME_PUMP")).toBe("PUMP_MOVEMENT");
    expect(normalizeFamily("PUMP", null)).toBe("PUMP_MOVEMENT");
    expect(normalizeFamily("DEPEG", null)).toBe("EXTERNAL_RISK");
    expect(normalizeFamily("DELIST", null)).toBe("EXTERNAL_RISK");
  });
});

describe("SystemAlertsPanel — Data Safe Mode visibility", () => {
  it("affiche source stale, âge exact et seuil quand SAFE MODE actif", () => {
    render(<SystemAlertsPanel dataTrust={staleTrust()} fr={true} />);
    expect(screen.getByTestId("row-source").textContent).toMatch(/taostats/);
    expect(screen.getByTestId("row-age").textContent).toMatch(/min|s/);
    expect(screen.getByTestId("row-threshold").textContent).toMatch(/60 min/);
    expect(screen.getByTestId("row-impact").textContent).toMatch(/ENTRER \/ RENFORCER/);
  });

  it("ne bloque pas HOT NOW : pulses restent affichés en SAFE MODE", () => {
    const factsMap = new Map([[5, mkFacts({ subnet_id: 5, change_24h: 12, change_1h: 1 })]]);
    const pulses = detectAllPulses(factsMap, undefined, staleTrust());
    renderHot(pulses, staleTrust());
    expect(screen.getByTestId("hot-row-5")).toBeInTheDocument();
  });
});
