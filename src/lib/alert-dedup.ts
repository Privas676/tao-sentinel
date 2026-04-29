/* ═══════════════════════════════════════════════════════════ */
/*   ALERT DEDUPLICATION (Lot 1 — préparation refonte Alerts)   */
/*                                                              */
/*   Règle :                                                    */
/*   alert_key = `${netuid}:${alert_family}:${severity}`        */
/*                                                              */
/*   Groupes :                                                  */
/*   - P0 : action immédiate (CRITICAL)                         */
/*   - P1 : surveillance active (HIGH)                          */
/*   - P2 : digest (MEDIUM/LOW/INFO)                            */
/*                                                              */
/*   La vraie refonte UI viendra au lot suivant.                */
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

export type AlertPriority = "P0" | "P1" | "P2";

export type RawAlert = {
  netuid: number;
  family: AlertFamily;
  severity: AlertSeverity;
  title: string;
  reason?: string | null;
  ts?: string;
};

export type DedupedAlert = RawAlert & {
  key: string;
  priority: AlertPriority;
  count: number;            // how many raw alerts collapsed into this one
  reasons: string[];        // collected reasons across duplicates
  firstSeen: string;
  lastSeen: string;
};

export function alertKey(a: Pick<RawAlert, "netuid" | "family" | "severity">): string {
  return `${a.netuid}:${a.family}:${a.severity}`;
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
 * Deduplicate alerts by (netuid, family, severity).
 * For the same key, count is incremented and reasons are merged.
 * Output is sorted by priority (P0 → P2) then by severity rank desc.
 */
export function dedupeAlerts(input: RawAlert[]): DedupedAlert[] {
  const map = new Map<string, DedupedAlert>();
  const nowIso = new Date().toISOString();
  for (const a of input) {
    const key = alertKey(a);
    const ts = a.ts ?? nowIso;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, {
        ...a,
        key,
        priority: severityToPriority(a.severity),
        count: 1,
        reasons: a.reason ? [a.reason] : [],
        firstSeen: ts,
        lastSeen: ts,
      });
    } else {
      existing.count += 1;
      if (a.reason && !existing.reasons.includes(a.reason)) {
        existing.reasons.push(a.reason);
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
