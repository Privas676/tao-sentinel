/* ═══════════════════════════════════════════════════════════ */
/*   ALERT DEDUPLICATION (Lot 2 — normalized families)          */
/*                                                              */
/*   Règle :                                                    */
/*   alert_key = `${netuid}:${normalized_family}:${severity}`   */
/*                                                              */
/*   Plusieurs causes liées au même pump violent sont fusion-   */
/*   nées sous PUMP_MOVEMENT, en conservant pulse_type exact    */
/*   dans reasons[] et causes[].                                */
/*                                                              */
/*   Groupes :                                                  */
/*   - P0 : action immédiate (CRITICAL)                         */
/*   - P1 : surveillance active (HIGH)                          */
/*   - P2 : digest (MEDIUM/LOW/INFO)                            */
/* ═══════════════════════════════════════════════════════════ */

export type AlertSeverity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO";

export type AlertFamily =
  | "PUMP"
  | "RISK"
  | "DEPEG"
  | "DELIST"
  | "DEREG"
  | "LIQUIDITY"
  | "DATA_TRUST"
  | "SYSTEM"
  | "SOCIAL";

/**
 * Sub-causes that should collapse into a single PUMP_MOVEMENT alert
 * when they hit the same subnet around the same time.
 */
export type PumpMovementCause =
  | "PUMP_LIVE"
  | "EXTREME_PUMP"
  | "DAILY_BREAKOUT"
  | "WEEKLY_ROTATION"
  | "PUMP_TOXIC"
  | "TOXIC_PUMP"
  | "DEAD_CAT_BOUNCE"
  | "ILLIQUID_PUMP";

export type NormalizedAlertFamily =
  | "PUMP_MOVEMENT"   // any pump-flavoured signal
  | "EXTERNAL_RISK"   // depeg / delist / dereg
  | "LIQUIDITY"
  | "DATA_TRUST"
  | "SYSTEM"
  | "SOCIAL"
  | "RISK";

export type AlertPriority = "P0" | "P1" | "P2";

export type RawAlert = {
  netuid: number;
  family: AlertFamily;
  /** Optional refined cause (e.g. PUMP_LIVE, EXTREME_PUMP). Kept verbatim in reasons. */
  cause?: PumpMovementCause | string | null;
  severity: AlertSeverity;
  title: string;
  reason?: string | null;
  ts?: string;
};

export type DedupedAlert = {
  key: string;
  netuid: number;
  family: AlertFamily;                       // first-seen original family (for legacy display)
  normalized_family: NormalizedAlertFamily;  // group label used for dedup
  severity: AlertSeverity;
  priority: AlertPriority;
  title: string;
  count: number;                             // how many raw alerts collapsed
  reasons: string[];                         // human reasons + pulse_type tags
  causes: string[];                          // exact pulse_type / cause strings preserved
  firstSeen: string;
  lastSeen: string;
};

const PUMP_FAMILY_CAUSES = new Set<string>([
  "PUMP_LIVE",
  "EXTREME_PUMP",
  "DAILY_BREAKOUT",
  "WEEKLY_ROTATION",
  "PUMP_TOXIC",
  "TOXIC_PUMP",
  "DEAD_CAT_BOUNCE",
  "ILLIQUID_PUMP",
]);

export function normalizeFamily(
  family: AlertFamily,
  cause?: string | null,
): NormalizedAlertFamily {
  if (cause && PUMP_FAMILY_CAUSES.has(cause)) return "PUMP_MOVEMENT";
  switch (family) {
    case "PUMP": return "PUMP_MOVEMENT";
    case "DEPEG":
    case "DELIST":
    case "DEREG":
      return "EXTERNAL_RISK";
    case "LIQUIDITY": return "LIQUIDITY";
    case "DATA_TRUST": return "DATA_TRUST";
    case "SYSTEM": return "SYSTEM";
    case "SOCIAL": return "SOCIAL";
    case "RISK": return "RISK";
  }
}

export function alertKey(
  a: Pick<RawAlert, "netuid" | "family" | "severity" | "cause">,
): string {
  return `${a.netuid}:${normalizeFamily(a.family, a.cause ?? null)}:${a.severity}`;
}

export function severityToPriority(s: AlertSeverity): AlertPriority {
  if (s === "CRITICAL") return "P0";
  if (s === "HIGH") return "P1";
  return "P2";
}

const SEVERITY_RANK: Record<AlertSeverity, number> = {
  CRITICAL: 4,
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
  INFO: 0,
};

/**
 * Deduplicate alerts by (netuid, normalized_family, severity).
 * Sub-causes (pulse_type / cause strings) are preserved in `causes[]`
 * and human reasons are merged in `reasons[]`.
 */
export function dedupeAlerts(input: RawAlert[]): DedupedAlert[] {
  const map = new Map<string, DedupedAlert>();
  const nowIso = new Date().toISOString();
  for (const a of input) {
    const normalized = normalizeFamily(a.family, a.cause ?? null);
    const key = `${a.netuid}:${normalized}:${a.severity}`;
    const ts = a.ts ?? nowIso;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, {
        key,
        netuid: a.netuid,
        family: a.family,
        normalized_family: normalized,
        severity: a.severity,
        priority: severityToPriority(a.severity),
        title: a.title,
        count: 1,
        reasons: a.reason ? [a.reason] : [],
        causes: a.cause ? [a.cause] : [],
        firstSeen: ts,
        lastSeen: ts,
      });
    } else {
      existing.count += 1;
      if (a.reason && !existing.reasons.includes(a.reason)) {
        existing.reasons.push(a.reason);
      }
      if (a.cause && !existing.causes.includes(a.cause)) {
        existing.causes.push(a.cause);
      }
      if (ts < existing.firstSeen) existing.firstSeen = ts;
      if (ts > existing.lastSeen) existing.lastSeen = ts;
    }
  }
  const list = Array.from(map.values());
  list.sort((a, b) => {
    const pr = a.priority.localeCompare(b.priority); // P0 < P1 < P2
    if (pr !== 0) return pr;
    return SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
  });
  return list;
}

export function groupByPriority(
  alerts: DedupedAlert[],
): { P0: DedupedAlert[]; P1: DedupedAlert[]; P2: DedupedAlert[] } {
  const out = { P0: [] as DedupedAlert[], P1: [] as DedupedAlert[], P2: [] as DedupedAlert[] };
  for (const a of alerts) out[a.priority].push(a);
  return out;
}
