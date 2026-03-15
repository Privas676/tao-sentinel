/* ═══════════════════════════════════════════════════════ */
/*   TAOFLUTE RESOLVER — Canonical External Risk Status    */
/*   STRICT subnet_id matching ONLY.                       */
/*   No name matching, no heuristics, no fallbacks.        */
/*   If subnet_id not found → taoflute_match = false       */
/* ═══════════════════════════════════════════════════════ */

/* ── Canonical types ── */

export type TaoFluteExternalRisk = {
  subnet_id: number;
  subnet_name_raw: string | null;
  risk_list_type: "watch" | "priority";
  priority_rank: number | null;
  liq_price: number | null;
  liq_haircut: number | null;
  flags: string[];
  links: string[];
  source_snapshot_at: string;
  source_ref: string;
};

export type TaoFluteSeverity = "none" | "watch" | "priority";

export type TaoFluteResolvedStatus = {
  subnet_id: number;
  taoflute_match: boolean;
  taoflute_watch_risk: boolean;
  taoflute_priority_rank: number | null;
  taoflute_severity: TaoFluteSeverity;
  /** Full external risk data (null if no match) */
  externalRisk: TaoFluteExternalRisk | null;
};

/* ── Confirmed lists (updated from validated Taoflute screenshots 2026-03) ── */

export const TAOFLUTE_PRIORITY_CONFIRMED: ReadonlySet<number> = new Set([
  70,  // Vericore
  82,  // Hermes
  55,  // NIOME
  57,  // Sparket.AI
  102, // Vocence
  84,  // ChipForge (Tatsu)
  79,  // MVTRX
  66,  // AlphaCore
  78,  // Loosh
  128, // ByteLeap
]);

export const TAOFLUTE_WATCH_CONFIRMED: ReadonlySet<number> = new Set([
  126, // Poker44
  87,  // Luminar Network
  80,  // dogelayer
  91,  // Bitstarter #1
  94,  // Bitsota
  96,  // X
  109, // Reserved
  31,  // Halftime
  47,  // EvoIAI
  99,  // Leoma
  108, // TalkHead
  38,  // colosseum
  97,  // Constantinople
  114, // SOMA
  107, // Minos
  113, // TensorUSD
  92,  // LUCID
]);

/* ── Priority rank map (for confirmed priority subnets) ── */

const PRIORITY_RANK_MAP: ReadonlyMap<number, number> = new Map([
  [70, 1],   // Vericore
  [82, 2],   // Hermes
  [55, 3],   // NIOME
  [57, 4],   // Sparket.AI
  [102, 5],  // Vocence
  [84, 6],   // ChipForge
  [79, 7],   // MVTRX
  [66, 8],   // AlphaCore
  [78, 9],   // Loosh
  [128, 10], // ByteLeap
]);

/* ── Resolver ── */

/**
 * Resolve TaoFlute status for a single subnet.
 * Uses STRICT subnet_id matching:
 * - If subnet_id is in priority list → priority
 * - If subnet_id is in watch list → watch
 * - Otherwise → none (NO taoflute mention allowed)
 *
 * This function can use either:
 * 1. DB data (from external_delist_priority/watch tables)
 * 2. Confirmed hardcoded lists (fallback)
 */
export function resolveTaoFluteStatus(
  subnetId: number,
  dbPriority?: Map<number, { rank: number; source: string; lastSeen: string }>,
  dbWatch?: Map<number, { source: string; lastSeen: string }>,
  dbMetrics?: Map<number, { liq_haircut: number | null; liq_price: number | null; is_stale: boolean; scraped_at: string }>,
): TaoFluteResolvedStatus {
  // 1. Check DB first (most up-to-date)
  const dbP = dbPriority?.get(subnetId);
  if (dbP) {
    const metrics = dbMetrics?.get(subnetId);
    return {
      subnet_id: subnetId,
      taoflute_match: true,
      taoflute_watch_risk: false,
      taoflute_priority_rank: dbP.rank,
      taoflute_severity: "priority",
      externalRisk: {
        subnet_id: subnetId,
        subnet_name_raw: null,
        risk_list_type: "priority",
        priority_rank: dbP.rank,
        liq_price: metrics?.liq_price ?? null,
        liq_haircut: metrics?.liq_haircut ?? null,
        flags: [],
        links: [],
        source_snapshot_at: metrics?.scraped_at ?? dbP.lastSeen,
        source_ref: dbP.source,
      },
    };
  }

  const dbW = dbWatch?.get(subnetId);
  if (dbW) {
    const metrics = dbMetrics?.get(subnetId);
    return {
      subnet_id: subnetId,
      taoflute_match: true,
      taoflute_watch_risk: true,
      taoflute_priority_rank: null,
      taoflute_severity: "watch",
      externalRisk: {
        subnet_id: subnetId,
        subnet_name_raw: null,
        risk_list_type: "watch",
        priority_rank: null,
        liq_price: metrics?.liq_price ?? null,
        liq_haircut: metrics?.liq_haircut ?? null,
        flags: [],
        links: [],
        source_snapshot_at: metrics?.scraped_at ?? dbW.lastSeen,
        source_ref: dbW.source,
      },
    };
  }

  // 2. Fallback to confirmed hardcoded lists
  if (TAOFLUTE_PRIORITY_CONFIRMED.has(subnetId)) {
    const rank = PRIORITY_RANK_MAP.get(subnetId) ?? null;
    return {
      subnet_id: subnetId,
      taoflute_match: true,
      taoflute_watch_risk: false,
      taoflute_priority_rank: rank,
      taoflute_severity: "priority",
      externalRisk: {
        subnet_id: subnetId,
        subnet_name_raw: null,
        risk_list_type: "priority",
        priority_rank: rank,
        liq_price: null,
        liq_haircut: null,
        flags: [],
        links: [],
        source_snapshot_at: new Date().toISOString(),
        source_ref: "confirmed_fallback",
      },
    };
  }

  if (TAOFLUTE_WATCH_CONFIRMED.has(subnetId)) {
    return {
      subnet_id: subnetId,
      taoflute_match: true,
      taoflute_watch_risk: true,
      taoflute_priority_rank: null,
      taoflute_severity: "watch",
      externalRisk: {
        subnet_id: subnetId,
        subnet_name_raw: null,
        risk_list_type: "watch",
        priority_rank: null,
        liq_price: null,
        liq_haircut: null,
        flags: [],
        links: [],
        source_snapshot_at: new Date().toISOString(),
        source_ref: "confirmed_fallback",
      },
    };
  }

  // 3. No match → NONE
  return {
    subnet_id: subnetId,
    taoflute_match: false,
    taoflute_watch_risk: false,
    taoflute_priority_rank: null,
    taoflute_severity: "none",
    externalRisk: null,
  };
}

/**
 * Resolve TaoFlute status for all subnets.
 */
export function resolveAllTaoFluteStatuses(
  subnetIds: number[],
  dbPriority?: Map<number, { rank: number; source: string; lastSeen: string }>,
  dbWatch?: Map<number, { source: string; lastSeen: string }>,
  dbMetrics?: Map<number, { liq_haircut: number | null; liq_price: number | null; is_stale: boolean; scraped_at: string }>,
): Map<number, TaoFluteResolvedStatus> {
  const map = new Map<number, TaoFluteResolvedStatus>();
  for (const id of subnetIds) {
    map.set(id, resolveTaoFluteStatus(id, dbPriority, dbWatch, dbMetrics));
  }
  return map;
}

/* ── Display helpers ── */

/**
 * Get the external column label for the subnets table.
 * Rules:
 * - No TaoFlute match → "—"
 * - Watch → "WATCH"
 * - Priority → "P1" to "P10"
 */
export function taoFluteColumnLabel(status: TaoFluteResolvedStatus): string {
  if (!status.taoflute_match) return "—";
  if (status.taoflute_severity === "priority" && status.taoflute_priority_rank != null) {
    return `P${status.taoflute_priority_rank}`;
  }
  if (status.taoflute_severity === "watch") return "WATCH";
  return "—";
}

/**
 * Get the localized label for TaoFlute status.
 */
export function taoFluteLabel(status: TaoFluteResolvedStatus, fr: boolean): string {
  if (!status.taoflute_match) return fr ? "Aucun signal TaoFlute confirmé" : "No confirmed TaoFlute signal";
  if (status.taoflute_severity === "priority") {
    return fr
      ? `Priorité externe TaoFlute #${status.taoflute_priority_rank ?? "?"}`
      : `TaoFlute external priority #${status.taoflute_priority_rank ?? "?"}`;
  }
  return fr ? "Sous surveillance externe TaoFlute" : "Under TaoFlute external watch";
}

/**
 * Get the label for blocked entry.
 */
export function taoFluteBlockedLabel(fr: boolean): string {
  return fr ? "Entrée bloquée par garde-fou externe" : "Entry blocked by external guardrail";
}

/**
 * Get the label for raw signal positive but blocked.
 */
export function taoFluteRawBlockedLabel(fr: boolean): string {
  return fr ? "Signal brut positif mais non exécutable" : "Raw signal positive but not actionable";
}
