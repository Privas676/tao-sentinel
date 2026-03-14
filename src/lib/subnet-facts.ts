/* ═══════════════════════════════════════════════════════ */
/*   SUBNET FACTS — Layer A: Raw Facts Extraction         */
/*   Normalizes raw_payload from TaoStats into typed,     */
/*   auditable facts. Every field has a source tag.       */
/*   NO scoring, NO interpretation — just facts.          */
/* ═══════════════════════════════════════════════════════ */

const RAO = 1e9;

/** Source provenance for each field */
export type FieldSource = "taostats" | "taostats:chain" | "computed" | "unavailable";

/** A fact with its source */
export type Sourced<T> = {
  value: T;
  source: FieldSource;
};

function s<T>(value: T, source: FieldSource = "taostats"): Sourced<T> {
  return { value, source };
}

function unavailable<T>(fallback: T): Sourced<T> {
  return { value: fallback, source: "unavailable" };
}

/** Convert RAO to TAO if value looks like it's in RAO (>1e6) */
function raoToTao(v: number): number {
  return v > 1e6 ? v / RAO : v;
}

/* ─── SubnetFacts: the complete typed fact sheet ─── */

export type SubnetFacts = {
  netuid: number;
  name: Sourced<string>;
  /** Category (not available from TaoStats, future TaoFlute field) */
  category: Sourced<string>;

  /* ── Price & Market ── */
  price: Sourced<number>;              // α price in TAO
  priceUsd: Sourced<number>;           // computed: price × taoUsd
  priceChange1h: Sourced<number>;      // %
  priceChange24h: Sourced<number>;     // %
  priceChange7d: Sourced<number>;      // %
  priceChange30d: Sourced<number>;     // %
  marketCap: Sourced<number>;          // in TAO
  marketCapUsd: Sourced<number>;       // computed
  fdv: Sourced<number>;               // computed from totalSupply × price
  vol24h: Sourced<number>;            // in TAO
  vol24hUsd: Sourced<number>;         // computed

  /* ── Trading Activity ── */
  buyCount: Sourced<number>;
  sellCount: Sourced<number>;
  buyerCount: Sourced<number>;
  sellerCount: Sourced<number>;

  /* ── Pool / AMM ── */
  taoInPool: Sourced<number>;
  alphaInPool: Sourced<number>;
  poolRatio: Sourced<number>;          // computed: taoInPool / alphaInPool
  poolPrice: Sourced<number>;          // computed: taoInPool / alphaInPool (implied)
  liqPrice: Sourced<number>;           // computed: poolPrice in USD
  liqHaircut: Sourced<number>;         // computed: (poolPrice - spotPrice) / spotPrice × 100
  spread: Sourced<number>;             // computed estimate from pool
  slippage1tau: Sourced<number>;       // computed: slippage for 1 TAO trade
  slippage10tau: Sourced<number>;      // computed: slippage for 10 TAO trade
  depth: Sourced<number>;              // = taoInPool (depth proxy)
  liquidity: Sourced<number>;          // raw liquidity value in TAO

  /* ── Emissions & Economics ── */
  emissionPerDay: Sourced<number>;     // in TAO
  burn: Sourced<number>;              // recycled_24_hours
  rootProportion: Sourced<number>;     // 0-1
  circulatingSupply: Sourced<number>;  // computed
  totalSupply: Sourced<number>;        // computed estimate
  alphaStaked: Sourced<number>;

  /* ── Structure ── */
  uidSaturation: Sourced<number>;      // 0-1 (active/max)
  activeUids: Sourced<number>;
  maxUids: Sourced<number>;
  validators: Sourced<number>;
  miners: Sourced<number>;
  registrations: Sourced<number>;

  /* ── Holders (not available from TaoStats) ── */
  holders: Sourced<number>;

  /* ── Meta ── */
  rank: Sourced<number>;
  lastSyncTs: Sourced<string>;
  taoUsd: number;
  /** Seven-day price history from TaoStats */
  sevenDayPrices: { price: number; timestamp: string }[];
};

/* ─── AMM slippage computation (x*y=k model) ─── */

function computeSlippage(taoInPool: number, alphaInPool: number, tradeSizeTao: number): number {
  if (taoInPool <= 0 || alphaInPool <= 0 || tradeSizeTao <= 0) return 100;
  // Buy alpha: send TAO, receive alpha
  // k = x * y
  const k = taoInPool * alphaInPool;
  const newTaoInPool = taoInPool + tradeSizeTao;
  const newAlphaInPool = k / newTaoInPool;
  const alphaReceived = alphaInPool - newAlphaInPool;
  if (alphaReceived <= 0) return 100;
  // Effective price vs spot price
  const spotPrice = taoInPool / alphaInPool; // TAO per alpha
  const effectivePrice = tradeSizeTao / alphaReceived;
  const slippagePct = ((effectivePrice - spotPrice) / spotPrice) * 100;
  return Math.max(0, slippagePct);
}

function computeSpread(taoInPool: number, alphaInPool: number): number {
  if (taoInPool <= 0 || alphaInPool <= 0) return 100;
  // Spread estimate: slippage for a very small trade (0.01 TAO) × 2 (buy+sell)
  const smallSlippage = computeSlippage(taoInPool, alphaInPool, 0.01);
  return smallSlippage * 2;
}

/* ─── Main extraction function ─── */

export function extractSubnetFacts(
  netuid: number,
  rawPayload: any,
  taoUsd: number,
  syncTs?: string,
): SubnetFacts {
  const p = rawPayload || {};
  const c = p._chain || {};

  // ── Price
  const price = Number(p.price ?? p.last_price) || 0;
  const priceUsd = price * taoUsd;

  // ── Price changes (directly from TaoStats)
  const priceChange1h = Number(p.price_change_1_hour) || 0;
  const priceChange24h = Number(p.price_change_1_day) || 0;
  // 7d: from seven_day_prices array if available
  let priceChange7d = Number(p.price_change_1_week) || 0;
  let priceChange30d = Number(p.price_change_1_month) || 0;

  // ── Market cap
  const marketCapRaw = Number(p.market_cap ?? 0);
  const marketCap = raoToTao(marketCapRaw);
  const marketCapUsd = marketCap * taoUsd;

  // ── Supply derivations
  const circulatingSupply = price > 0 ? marketCap / price : 0;
  const alphaStakedRaw = Number(p.alpha_staked ?? c.alpha_staked ?? 0);
  const alphaStaked = raoToTao(alphaStakedRaw);

  // ── Pool data
  const taoInPool = raoToTao(Number(p.protocol_provided_tao ?? p.tao_in_pool ?? 0));
  const alphaInPool = raoToTao(Number(p.protocol_provided_alpha ?? p.alpha_in_pool ?? 0));
  const poolRatio = alphaInPool > 0 ? taoInPool / alphaInPool : 0;
  const poolPrice = poolRatio; // same as taoInPool / alphaInPool
  const liqHaircut = price > 0 && poolPrice > 0
    ? ((poolPrice - price) / price) * 100
    : 0;
  const liqPrice = poolPrice * taoUsd;

  const totalSupply = circulatingSupply + alphaStaked + alphaInPool;
  const fdv = totalSupply > 0 ? totalSupply * price : marketCap;

  // ── Liquidity
  const liquidityRaw = Number(p.liquidity ?? 0);
  const liquidity = raoToTao(liquidityRaw);

  // ── Volume
  const vol24hRaw = Number(p.tao_volume_24_hr ?? p.alpha_volume_24_hr ?? 0);
  const vol24h = raoToTao(vol24hRaw);
  const vol24hUsd = vol24h * taoUsd;

  // ── Trading activity
  const buyCount = Number(p.buys_24_hr ?? 0);
  const sellCount = Number(p.sells_24_hr ?? 0);
  const buyerCount = Number(p.buyers_24_hr ?? 0);
  const sellerCount = Number(p.sellers_24_hr ?? 0);

  // ── AMM computations
  const slippage1tau = computeSlippage(taoInPool, alphaInPool, 1);
  const slippage10tau = computeSlippage(taoInPool, alphaInPool, 10);
  const spread = computeSpread(taoInPool, alphaInPool);

  // ── Chain data
  const emissionRaw = Number(c.emission ?? 0);
  const emission = raoToTao(emissionRaw);
  const emissionPerDayRaw = Number(c.emission_per_day) || (emission > 0 ? emission * 7200 : 0);
  const emissionPerDay = raoToTao(emissionPerDayRaw);
  const burnRaw = Number(c.recycled_24_hours ?? 0);
  const burn = raoToTao(burnRaw);
  const rootProportion = Number(p.root_prop ?? 0);

  // ── Structure
  const activeUids = Number(c.active_uids ?? c.active_keys ?? 0);
  const maxUids = Number(c.max_neurons ?? c.max_n ?? 256);
  const uidSaturation = maxUids > 0 ? activeUids / maxUids : 0;
  const validators = Number(c.active_validators ?? 0);
  const miners = Number(c.active_miners ?? 0);
  const registrations = Number(c.registrations ?? 0);

  // ── Seven day prices
  const sevenDayPrices: { price: number; timestamp: string }[] = [];
  if (Array.isArray(p.seven_day_prices)) {
    for (const sp of p.seven_day_prices) {
      if (sp?.price != null) {
        sevenDayPrices.push({ price: Number(sp.price), timestamp: String(sp.timestamp ?? "") });
      }
    }
  }

  // ── Use seven_day_prices to compute more accurate 7d change if available
  if (sevenDayPrices.length >= 2 && price > 0) {
    const oldest = sevenDayPrices[0].price;
    if (oldest > 0) {
      priceChange7d = ((price - oldest) / oldest) * 100;
    }
  }

  const rank = Number(p.rank ?? 0);

  return {
    netuid,
    name: s(String(p.name ?? `SN-${netuid}`)),
    category: unavailable("unknown"),

    price: s(price),
    priceUsd: s(priceUsd, "computed"),
    priceChange1h: s(priceChange1h),
    priceChange24h: s(priceChange24h),
    priceChange7d: s(priceChange7d),
    priceChange30d: s(priceChange30d),
    marketCap: s(marketCap),
    marketCapUsd: s(marketCapUsd, "computed"),
    fdv: s(fdv, "computed"),
    vol24h: s(vol24h),
    vol24hUsd: s(vol24hUsd, "computed"),

    buyCount: s(buyCount),
    sellCount: s(sellCount),
    buyerCount: s(buyerCount),
    sellerCount: s(sellerCount),

    taoInPool: s(taoInPool),
    alphaInPool: s(alphaInPool),
    poolRatio: s(poolRatio, "computed"),
    poolPrice: s(poolPrice, "computed"),
    liqPrice: s(liqPrice, "computed"),
    liqHaircut: s(liqHaircut, "computed"),
    spread: s(spread, "computed"),
    slippage1tau: s(slippage1tau, "computed"),
    slippage10tau: s(slippage10tau, "computed"),
    depth: s(taoInPool, "computed"),
    liquidity: s(liquidity),

    emissionPerDay: s(emissionPerDay, "taostats:chain"),
    burn: s(burn, "taostats:chain"),
    rootProportion: s(rootProportion),
    circulatingSupply: s(circulatingSupply, "computed"),
    totalSupply: s(totalSupply, "computed"),
    alphaStaked: s(alphaStaked),

    uidSaturation: s(uidSaturation, "computed"),
    activeUids: s(activeUids, "taostats:chain"),
    maxUids: s(maxUids, "taostats:chain"),
    validators: s(validators, "taostats:chain"),
    miners: s(miners, "taostats:chain"),
    registrations: s(registrations, "taostats:chain"),

    holders: unavailable(0),

    rank: s(rank),
    lastSyncTs: s(syncTs ?? new Date().toISOString()),
    taoUsd,
    sevenDayPrices,
  };
}

/* ─── Batch extraction ─── */

export function extractAllSubnetFacts(
  rawPayloads: Map<number, any>,
  taoUsd: number,
  syncTs?: string,
): Map<number, SubnetFacts> {
  const result = new Map<number, SubnetFacts>();
  for (const [netuid, payload] of rawPayloads) {
    result.set(netuid, extractSubnetFacts(netuid, payload, taoUsd, syncTs));
  }
  return result;
}

/* ─── Utility: get raw value from Sourced ─── */
export function val<T>(sourced: Sourced<T>): T {
  return sourced.value;
}

export function isAvailable<T>(sourced: Sourced<T>): boolean {
  return sourced.source !== "unavailable";
}
