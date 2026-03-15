/* ═══════════════════════════════════════════════════════════ */
/*   CANONICAL FACTS BUILDER                                   */
/*   Merges SubnetFacts (TaoStats) + TaoFlute + Social         */
/*   into a single CanonicalSubnetFacts per subnet.            */
/*   NO scoring, NO decision — just unified fact assembly.     */
/* ═══════════════════════════════════════════════════════════ */

import type { SubnetFacts } from "./subnet-facts";
import { val, isAvailable } from "./subnet-facts";
import type { TaoFluteResolvedStatus } from "./taoflute-resolver";
import type { SocialSubnetScore } from "@/hooks/use-social-signal";
import type {
  CanonicalSubnetFacts,
  ExternalStatus,
  SourceProvenance,
  SourceType,
} from "./canonical-types";

/* ── Helpers ── */

function prov(
  name: string,
  type: SourceType,
  ref: string | null,
  ts: string | null,
  confidence: number = 80,
): SourceProvenance {
  return {
    source_name: name,
    source_type: type,
    source_url_or_ref: ref,
    source_timestamp: ts,
    source_confidence: confidence,
  };
}

function taostatsProv(ts: string | null, netuid: number): SourceProvenance {
  return prov(
    "TaoStats",
    "taostats",
    `https://taostats.io/subnets/${netuid}`,
    ts,
    90,
  );
}

function computedProv(ts: string | null): SourceProvenance {
  return prov("Sentinel", "computed", null, ts, 85);
}

function tfSeverityToExternalStatus(
  severity: "priority" | "watch" | "none",
  rank: number | null,
): ExternalStatus {
  if (severity === "none") return "NONE";
  if (severity === "watch") return "WATCH";
  if (severity === "priority" && rank != null && rank >= 1 && rank <= 10) {
    return `P${rank}` as ExternalStatus;
  }
  return severity === "priority" ? "P1" : "NONE";
}

/* ── Main Builder ── */

/**
 * Build canonical facts for a single subnet.
 * Merges SubnetFacts (Layer A) + TaoFlute status + Social scores.
 */
export function buildCanonicalFacts(
  facts: SubnetFacts,
  tf: TaoFluteResolvedStatus | undefined,
  social: SocialSubnetScore | null | undefined,
  socialTimestamp: string | null = null,
): CanonicalSubnetFacts {
  const now = new Date().toISOString();
  const taostatsTs = val(facts.lastSyncTs);
  const taostatsUrl = `https://taostats.io/subnets/${facts.netuid}`;

  // Sentiment from buy/sell ratio
  const buys = val(facts.buyCount);
  const sells = val(facts.sellCount);
  const totalTrades = buys + sells;
  const sentimentRaw = totalTrades > 0 ? Math.round((buys / totalTrades) * 100) : null;

  // Emissions percentage (rough estimate from emission_per_day relative to supply)
  const emissionDay = val(facts.emissionPerDay);
  const circSupply = val(facts.circulatingSupply);
  const emissionsPct = circSupply > 0 ? (emissionDay / circSupply) * 100 : null;

  // Build provenance map (key fields only)
  const provenance: Record<string, SourceProvenance> = {
    price: taostatsProv(taostatsTs, facts.netuid),
    market_cap: taostatsProv(taostatsTs, facts.netuid),
    volume_24h: taostatsProv(taostatsTs, facts.netuid),
    buys_count: taostatsProv(taostatsTs, facts.netuid),
    tao_in_pool: taostatsProv(taostatsTs, facts.netuid),
    slippage_1tau: computedProv(taostatsTs),
    spread: computedProv(taostatsTs),
    emissions_day: prov("TaoStats", "taostats:chain", taostatsUrl, taostatsTs, 85),
    validators: prov("TaoStats", "taostats:chain", taostatsUrl, taostatsTs, 90),
    miners: prov("TaoStats", "taostats:chain", taostatsUrl, taostatsTs, 90),
  };

  const tfExt = tf?.externalRisk;
  if (tf?.taoflute_match && tfExt) {
    provenance.external_status = prov(
      "TaoFlute",
      "taoflute",
      tfExt.source_ref ?? null,
      tfExt.source_snapshot_at ?? null,
      70,
    );
    provenance.liq_haircut = prov(
      "TaoFlute",
      "taoflute",
      tfExt.source_ref ?? null,
      tfExt.source_snapshot_at ?? null,
      70,
    );
  }

  if (social) {
    provenance.social_signal = prov(
      "Social/X",
      "social",
      null,
      socialTimestamp,
      60,
    );
  }

  return {
    subnet_id: facts.netuid,
    subnet_name: val(facts.name),
    category: isAvailable(facts.category) ? val(facts.category) : null,

    // Price & Market
    price: val(facts.price) || null,
    price_usd: val(facts.priceUsd) || null,
    change_1h: val(facts.priceChange1h) || null,
    change_24h: val(facts.priceChange24h) || null,
    change_7d: val(facts.priceChange7d) || null,
    change_30d: val(facts.priceChange30d) || null,
    market_cap: val(facts.marketCap) || null,
    market_cap_usd: val(facts.marketCapUsd) || null,
    fdv: val(facts.fdv) || null,
    volume_24h: val(facts.vol24h) || null,
    volume_24h_usd: val(facts.vol24hUsd) || null,

    // Trading Activity
    buys_count: buys || null,
    sells_count: sells || null,
    buyers_count: val(facts.buyerCount) || null,
    sellers_count: val(facts.sellerCount) || null,
    sentiment_score_raw: sentimentRaw,

    // Pool / AMM
    tao_in_pool: val(facts.taoInPool) || null,
    alpha_in_pool: val(facts.alphaInPool) || null,
    tao_pool_ratio: val(facts.poolRatio) || null,
    spread: val(facts.spread) || null,
    slippage_1tau: val(facts.slippage1tau) || null,
    slippage_10tau: val(facts.slippage10tau) || null,
    depth: val(facts.depth) || null,

    // Emissions & Economics
    emissions_pct: emissionsPct,
    emissions_day: emissionDay || null,
    root_proportion: val(facts.rootProportion) || null,
    owner_day: null,        // Not available from TaoStats yet
    miner_day: null,        // Not available from TaoStats yet
    validator_day: null,     // Not available from TaoStats yet
    incentive_burn_pct: val(facts.burn) > 0 && emissionDay > 0
      ? Math.round((val(facts.burn) / emissionDay) * 100)
      : null,
    circulating_supply: val(facts.circulatingSupply) || null,
    total_supply: val(facts.totalSupply) || null,

    // Structure
    uid_saturation: val(facts.uidSaturation) || null,
    validators: val(facts.validators) || null,
    miners: val(facts.miners) || null,
    holders: isAvailable(facts.holders) ? val(facts.holders) : null,

    // TaoFlute External Risk
    taoflute_match: tf?.taoflute_match ?? false,
    external_status: tf
      ? tfSeverityToExternalStatus(tf.taoflute_severity, tf.taoflute_rank ?? null)
      : "NONE",
    liq_price: tf?.liq_price ?? null,
    liq_haircut: tf?.liq_haircut ?? null,
    taoflute_flags: tf?.taoflute_flags ?? [],
    taoflute_links: tf?.taoflute_source_ref ? [tf.taoflute_source_ref] : [],

    // Social Signal
    social_mentions_24h: social?.raw_mention_count ?? null,
    social_mentions_delta: null,  // requires previous period comparison
    social_unique_accounts: social?.unique_account_count ?? null,
    social_kol_mentions: social?.smart_kol_score != null
      ? Math.round(social.smart_kol_score * 10) // approximate from score
      : null,
    social_official_mentions: null, // requires post-level classification
    social_sentiment_score: social
      ? Math.round((social.weighted_bullish_score - social.weighted_bearish_score) * 100)
      : null,
    social_hype_score: social?.social_heat_score
      ? Math.round(social.social_heat_score * 100)
      : null,
    social_credibility_score: social?.smart_kol_score
      ? Math.round(social.smart_kol_score * 100)
      : null,
    social_signal_strength: social?.social_conviction_score
      ? Math.round(social.social_conviction_score * 100)
      : null,

    // Timestamps
    taostats_timestamp: taostatsTs,
    taoflute_timestamp: tf?.taoflute_timestamp ?? null,
    social_timestamp: socialTimestamp,
    sentinel_timestamp: now,

    // Source References
    taostats_source_url: taostatsUrl,
    taoflute_source_ref: tf?.taoflute_source_ref ?? null,
    social_source_refs: [],  // filled when real social post URLs are available

    // Provenance
    provenance,
  };
}

/* ── Batch builder ── */

export function buildAllCanonicalFacts(
  factsMap: Map<number, SubnetFacts>,
  tfMap: Map<number, TaoFluteResolvedStatus>,
  socialScores: SocialSubnetScore[] | null | undefined,
  socialTimestamp: string | null = null,
): Map<number, CanonicalSubnetFacts> {
  const socialBySubnet = new Map<number, SocialSubnetScore>();
  if (socialScores) {
    for (const s of socialScores) {
      socialBySubnet.set(s.subnet_uid, s);
    }
  }

  const result = new Map<number, CanonicalSubnetFacts>();
  for (const [netuid, facts] of factsMap) {
    result.set(netuid, buildCanonicalFacts(
      facts,
      tfMap.get(netuid),
      socialBySubnet.get(netuid),
      socialTimestamp,
    ));
  }
  return result;
}
