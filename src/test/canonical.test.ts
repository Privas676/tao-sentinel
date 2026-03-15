import { describe, it, expect } from "vitest";
import { buildCanonicalFacts } from "@/lib/canonical-facts";
import { buildCanonicalDecision } from "@/lib/canonical-decision";
import type { SubnetFacts, Sourced } from "@/lib/subnet-facts";
import type { TaoFluteResolvedStatus } from "@/lib/taoflute-resolver";
import type { SubnetDecision } from "@/lib/subnet-decision";

/* ── Helpers ── */

function s<T>(value: T, source: "taostats" | "computed" | "unavailable" = "taostats"): Sourced<T> {
  return { value, source };
}

function makeFacts(overrides: Partial<SubnetFacts> = {}): SubnetFacts {
  return {
    netuid: 1,
    name: s("TestNet"),
    category: { value: "unknown", source: "unavailable" },
    price: s(0.05),
    priceUsd: s(22.5, "computed"),
    priceChange1h: s(1.5),
    priceChange24h: s(-3.2),
    priceChange7d: s(12.0),
    priceChange30d: s(-5.0),
    marketCap: s(500),
    marketCapUsd: s(225000, "computed"),
    fdv: s(800, "computed"),
    vol24h: s(50),
    vol24hUsd: s(22500, "computed"),
    buyCount: s(120),
    sellCount: s(80),
    buyerCount: s(30),
    sellerCount: s(20),
    taoInPool: s(100),
    alphaInPool: s(2000),
    poolRatio: s(0.05, "computed"),
    poolPrice: s(0.05, "computed"),
    liqPrice: s(22.5, "computed"),
    liqHaircut: s(2.5, "computed"),
    spread: s(0.1, "computed"),
    slippage1tau: s(0.5, "computed"),
    slippage10tau: s(4.8, "computed"),
    depth: s(100, "computed"),
    liquidity: s(200),
    emissionPerDay: s(10),
    burn: s(2),
    rootProportion: s(0.1),
    circulatingSupply: s(10000, "computed"),
    totalSupply: s(15000, "computed"),
    alphaStaked: s(3000),
    uidSaturation: s(0.75, "computed"),
    activeUids: s(192),
    maxUids: s(256),
    validators: s(8),
    miners: s(45),
    registrations: s(5),
    holders: { value: 0, source: "unavailable" },
    rank: s(15),
    lastSyncTs: s("2026-03-15T10:00:00Z"),
    taoUsd: 450,
    sevenDayPrices: [],
    ...overrides,
  };
}

function makeTf(overrides: Partial<TaoFluteResolvedStatus> = {}): TaoFluteResolvedStatus {
  return {
    subnet_id: 1,
    taoflute_match: false,
    taoflute_watch_risk: false,
    taoflute_priority_rank: null,
    taoflute_severity: "none",
    externalRisk: null,
    ...overrides,
  };
}

/* ═══════════════════════════════ */
/*  Canonical Facts Tests          */
/* ═══════════════════════════════ */

describe("buildCanonicalFacts", () => {
  it("maps basic TaoStats fields correctly", () => {
    const cf = buildCanonicalFacts(makeFacts(), undefined, null);
    expect(cf.subnet_id).toBe(1);
    expect(cf.subnet_name).toBe("TestNet");
    expect(cf.price).toBe(0.05);
    expect(cf.market_cap).toBe(500);
    expect(cf.volume_24h).toBe(50);
    expect(cf.buys_count).toBe(120);
    expect(cf.sells_count).toBe(80);
    expect(cf.tao_in_pool).toBe(100);
    expect(cf.slippage_1tau).toBe(0.5);
    expect(cf.validators).toBe(8);
    expect(cf.miners).toBe(45);
  });

  it("computes sentiment from buy/sell ratio", () => {
    const cf = buildCanonicalFacts(makeFacts(), undefined, null);
    expect(cf.sentiment_score_raw).toBe(60); // 120/(120+80) = 60%
  });

  it("sets TaoFlute to NONE when no match", () => {
    const cf = buildCanonicalFacts(makeFacts(), makeTf(), null);
    expect(cf.taoflute_match).toBe(false);
    expect(cf.external_status).toBe("NONE");
    expect(cf.liq_price).toBeNull();
  });

  it("maps TaoFlute priority correctly", () => {
    const tf = makeTf({
      taoflute_match: true,
      taoflute_severity: "priority",
      taoflute_priority_rank: 3,
      externalRisk: {
        subnet_id: 1,
        subnet_name_raw: "TestNet",
        risk_list_type: "priority",
        priority_rank: 3,
        liq_price: 20.0,
        liq_haircut: 15.0,
        flags: ["LOW_LIQ"],
        links: [],
        source_snapshot_at: "2026-03-15T08:00:00Z",
        source_ref: "taoflute-screenshot-2026-03-15",
      },
    });
    const cf = buildCanonicalFacts(makeFacts(), tf, null);
    expect(cf.taoflute_match).toBe(true);
    expect(cf.external_status).toBe("P3");
    expect(cf.liq_price).toBe(20.0);
    expect(cf.liq_haircut).toBe(15.0);
    expect(cf.taoflute_flags).toEqual(["LOW_LIQ"]);
  });

  it("maps social scores when available", () => {
    const social = {
      id: "s1",
      subnet_uid: 1,
      score_date: "2026-03-15",
      raw_mention_count: 25,
      unique_account_count: 8,
      weighted_bullish_score: 0.7,
      weighted_bearish_score: 0.1,
      social_conviction_score: 0.65,
      social_heat_score: 0.4,
      pump_risk_score: 0.1,
      smart_kol_score: 0.8,
      narrative_strength: 0.5,
      final_social_signal: "bullish",
      created_at: "2026-03-15T09:00:00Z",
    };
    const cf = buildCanonicalFacts(makeFacts(), undefined, social);
    expect(cf.social_mentions_24h).toBe(25);
    expect(cf.social_unique_accounts).toBe(8);
    expect(cf.social_sentiment_score).toBe(60); // (0.7 - 0.1) * 100
    expect(cf.social_credibility_score).toBe(80); // 0.8 * 100
  });

  it("sets unavailable social fields to null", () => {
    const cf = buildCanonicalFacts(makeFacts(), undefined, null);
    expect(cf.social_mentions_24h).toBeNull();
    expect(cf.social_sentiment_score).toBeNull();
    expect(cf.social_signal_strength).toBeNull();
  });

  it("includes provenance for key fields", () => {
    const cf = buildCanonicalFacts(makeFacts(), undefined, null);
    expect(cf.provenance.price.source_type).toBe("taostats");
    expect(cf.provenance.price.source_confidence).toBe(90);
    expect(cf.provenance.slippage_1tau.source_type).toBe("computed");
    expect(cf.taostats_source_url).toContain("taostats.io/subnets/1");
  });

  it("produces unique sentinel_timestamp", () => {
    const cf = buildCanonicalFacts(makeFacts(), undefined, null);
    expect(cf.sentinel_timestamp).toBeTruthy();
    expect(new Date(cf.sentinel_timestamp).getTime()).toBeGreaterThan(0);
  });
});

/* ═══════════════════════════════ */
/*  Canonical Decision Tests       */
/* ═══════════════════════════════ */

describe("buildCanonicalDecision", () => {
  // Minimal SubnetDecision mock
  function makeDecision(overrides: Partial<SubnetDecision> = {}): SubnetDecision {
    return {
      netuid: 1,
      name: "TestNet",
      finalAction: "SURVEILLER",
      engineAction: "WATCH",
      actionFr: "SURVEILLER",
      actionEn: "MONITOR",
      badgeAction: "SURVEILLER",
      isSystem: false,
      rawSignal: "neutral",
      isBlocked: false,
      blockReasons: [],
      primaryReason: "Stable",
      portfolioAction: "CONSERVER",
      portfolioActionFr: "CONSERVER",
      portfolioActionEn: "HOLD",
      conviction: "MEDIUM",
      convictionScore: 55,
      opp: 45,
      risk: 35,
      asymmetry: 10,
      confidence: 70,
      momentumScore: 50,
      momentumLabel: "STABLE",
      stability: 60,
      liquidityLevel: "MEDIUM",
      structureLevel: "HEALTHY",
      statusLevel: "OK",
      signalPrincipal: "Stable",
      thesis: ["Momentum neutre"],
      invalidation: ["Liquidité limitée"],
      conflictExplanation: null,
      isOverridden: false,
      dataUncertain: false,
      depegProbability: 5,
      delistCategory: "NORMAL",
      delistScore: 10,
      taoFluteStatus: makeTf(),
      score: {
        netuid: 1, name: "TestNet", assetType: "SPECULATIVE",
        state: null, psi: 50, conf: 70, quality: 60,
        opp: 45, risk: 35, asymmetry: 10,
        momentum: 50, momentumLabel: "STABLE", momentumScore: 50,
        action: "WATCH", sc: "NEUTRAL", confianceScore: 70,
        dataUncertain: false, isOverridden: false, isWarning: false,
        systemStatus: "OK", overrideReasons: [],
        healthScores: { liquidityHealth: 60, volumeHealth: 50, emissionPressure: 20, dilutionRisk: 15, activityHealth: 60 },
        recalc: { mcRecalc: 1e5, fdvRecalc: 1.5e5, dilutionRatio: 1.5, volumeToMc: 0.05, emissionToMc: 0.001, liquidityRecalc: 5e4, liquidityToMc: 0.5, liqHaircut: 2, poolPrice: 0.05 },
        displayedCap: 1e5, displayedLiq: 5e4,
        stability: 60, consensusPrice: 0.05, alphaPrice: 0.05,
        priceVar30d: -5, delistCategory: "NORMAL", delistScore: 10,
        depegProbability: 5, depegState: "NORMAL", depegSignals: [],
      } as any,
      ...overrides,
    } as SubnetDecision;
  }

  it("maps final action correctly", () => {
    const cd = buildCanonicalDecision(makeDecision({ finalAction: "ENTRER" }));
    expect(cd.final_action).toBe("ENTRER");
    expect(cd.portfolio_action).toBe("ADD");
  });

  it("maps SURVEILLER to HOLD portfolio", () => {
    const cd = buildCanonicalDecision(makeDecision());
    expect(cd.final_action).toBe("SURVEILLER");
    expect(cd.portfolio_action).toBe("HOLD");
  });

  it("maps ÉVITER to EXIT portfolio", () => {
    const cd = buildCanonicalDecision(makeDecision({ finalAction: "ÉVITER", portfolioAction: "SORTIR" }));
    expect(cd.final_action).toBe("ÉVITER");
    expect(cd.portfolio_action).toBe("EXIT");
  });

  it("maps raw signal correctly", () => {
    expect(buildCanonicalDecision(makeDecision({ rawSignal: "opportunity" })).raw_signal).toBe("OPPORTUNITE");
    expect(buildCanonicalDecision(makeDecision({ rawSignal: "exit" })).raw_signal).toBe("RISQUE");
    expect(buildCanonicalDecision(makeDecision({ rawSignal: "neutral" })).raw_signal).toBe("NEUTRE");
  });

  it("sets guardrail info when blocked", () => {
    const cd = buildCanonicalDecision(makeDecision({
      isBlocked: true,
      blockReasons: ["Risque depeg 75%", "Liquidité critique"],
    }));
    expect(cd.guardrail_active).toBe(true);
    expect(cd.guardrail_reason).toHaveLength(2);
    expect(cd.guardrail_reason[0]).toContain("depeg");
  });

  it("preserves core scores", () => {
    const cd = buildCanonicalDecision(makeDecision());
    expect(cd.confidence_score).toBe(70);
    expect(cd.conviction_score).toBe(55);
    expect(cd.momentum_score).toBe(50);
    expect(cd.risk_market_score).toBe(35);
  });

  it("includes updated_at timestamp", () => {
    const cd = buildCanonicalDecision(makeDecision());
    expect(cd.updated_at).toBeTruthy();
    expect(new Date(cd.updated_at).getTime()).toBeGreaterThan(0);
  });
});
