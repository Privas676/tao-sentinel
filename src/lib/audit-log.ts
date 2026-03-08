/* ═══════════════════════════════════════ */
/*   AUDIT LOG                              */
/*   Records every scoring cycle & alert    */
/*   for institutional traceability.        */
/*   Writes via Edge Function (service_role)*/
/* ═══════════════════════════════════════ */

import { supabase } from "@/integrations/supabase/client";
import type { UnifiedSubnetScore } from "@/hooks/use-subnet-scores";
import type { DataConfidenceScore } from "@/lib/data-confidence";
import type { KillSwitchResult } from "@/lib/push-kill-switch";
import type { FleetDistributionReport } from "@/lib/distribution-monitor";

/* ── Constants ── */

const ENGINE_VERSION = "v4.1";

/** Minimum interval between scoring cycle logs (ms) — avoid flooding */
const MIN_CYCLE_INTERVAL_MS = 55_000; // ~1 per minute

/** Max entries per batch insert */
const MAX_BATCH_SIZE = 50;

/* ── Types ── */

export type AuditEventType = "SCORING_CYCLE" | "ALERT_FIRED" | "STATE_CHANGE" | "KILL_SWITCH";

export type AuditEntry = {
  engine_version: string;
  event_type: AuditEventType;
  snapshot_ids: string[];
  subnet_count?: number;
  netuid?: number;
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown>;
  top_factors: Array<{ code: string; label: string; contribution: number }>;
  decision_reason?: string;
  data_confidence?: number;
  alignment_status?: string;
  kill_switch_active?: boolean;
  kill_switch_triggers?: string[];
};

/* ── Singleton throttle ── */

let lastCycleLogAt = 0;

/* ── Core write function via Edge Function ── */

async function writeEntries(entries: AuditEntry[]): Promise<void> {
  if (entries.length === 0) return;

  const batch = entries.slice(0, MAX_BATCH_SIZE);

  try {
    // Get current session for auth header
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) {
      console.warn("[AUDIT-LOG] No active session — skipping write");
      return;
    }

    const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
    const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

    const res = await fetch(
      `https://${projectId}.supabase.co/functions/v1/log-audit-event`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
          apikey: anonKey,
        },
        body: JSON.stringify({ entries: batch }),
      },
    );

    if (!res.ok) {
      const body = await res.text();
      console.warn("[AUDIT-LOG] Edge Function write failed:", res.status, body);
    }
  } catch (err) {
    // Silent fallback — never break the UI
    console.warn("[AUDIT-LOG] Write error:", err);
  }
}

/* ── Public API ── */

/**
 * Log a full scoring cycle (fleet-level summary + top movers).
 * Throttled to ~1 per minute.
 */
export function logScoringCycle(
  scoresList: UnifiedSubnetScore[],
  snapshotIds: string[],
  alignmentStatus: string,
  dataConfidence: DataConfidenceScore | null,
  killSwitch: KillSwitchResult | null,
  fleetDistribution: FleetDistributionReport | null,
): void {
  const now = Date.now();
  if (now - lastCycleLogAt < MIN_CYCLE_INTERVAL_MS) return;
  lastCycleLogAt = now;

  if (scoresList.length === 0) return;

  // Fleet summary
  const enterCount = scoresList.filter(s => s.action === "ENTER").length;
  const exitCount = scoresList.filter(s => s.action === "EXIT" || (s.action as string) === "EXIT_FAST").length;
  const overrideCount = scoresList.filter(s => s.isOverridden).length;
  const avgOpp = Math.round(scoresList.reduce((s, x) => s + x.opp, 0) / scoresList.length);
  const avgRisk = Math.round(scoresList.reduce((s, x) => s + x.risk, 0) / scoresList.length);

  const entries: AuditEntry[] = [{
    engine_version: ENGINE_VERSION,
    event_type: "SCORING_CYCLE",
    snapshot_ids: snapshotIds,
    subnet_count: scoresList.length,
    inputs: {
      alignmentStatus,
      dataConfidenceScore: dataConfidence?.score ?? null,
      dataConfidenceUnstable: dataConfidence?.isUnstable ?? false,
      fleetUnstable: fleetDistribution?.isFleetUnstable ?? false,
    },
    outputs: {
      enterCount,
      exitCount,
      overrideCount,
      avgOpp,
      avgRisk,
      top3Opp: scoresList
        .filter(s => !s.isOverridden)
        .sort((a, b) => b.opp - a.opp)
        .slice(0, 3)
        .map(s => ({ netuid: s.netuid, opp: s.opp, action: s.action })),
      top3Risk: scoresList
        .sort((a, b) => b.risk - a.risk)
        .slice(0, 3)
        .map(s => ({ netuid: s.netuid, risk: s.risk, action: s.action })),
    },
    top_factors: [],
    data_confidence: dataConfidence?.score,
    alignment_status: alignmentStatus,
    kill_switch_active: killSwitch?.active ?? false,
    kill_switch_triggers: killSwitch?.triggers ?? [],
  }];

  writeEntries(entries);
}

/**
 * Log a per-subnet alert or state change.
 */
export function logSubnetEvent(
  eventType: "ALERT_FIRED" | "STATE_CHANGE",
  subnet: UnifiedSubnetScore,
  reason: string,
  snapshotIds: string[],
  alignmentStatus: string,
  dataConfidence: DataConfidenceScore | null,
): void {
  const entry: AuditEntry = {
    engine_version: ENGINE_VERSION,
    event_type: eventType,
    snapshot_ids: snapshotIds,
    netuid: subnet.netuid,
    inputs: {
      psi: subnet.psi,
      conf: subnet.conf,
      quality: subnet.quality,
      state: subnet.state,
      confianceScore: subnet.confianceScore,
      opp: subnet.opp,
      risk: subnet.risk,
    },
    outputs: {
      action: subnet.action,
      sc: subnet.sc,
      momentum: subnet.momentum,
      momentumLabel: subnet.momentumLabel,
      asymmetry: subnet.asymmetry,
      stability: subnet.stability,
      isOverridden: subnet.isOverridden,
      systemStatus: subnet.systemStatus,
    },
    top_factors: [], // Could be populated if score-factors are exposed on UnifiedSubnetScore
    decision_reason: reason,
    data_confidence: dataConfidence?.score,
    alignment_status: alignmentStatus,
  };

  writeEntries([entry]);
}

/**
 * Log a kill switch activation/deactivation.
 */
export function logKillSwitchEvent(
  killSwitch: KillSwitchResult,
  snapshotIds: string[],
  dataConfidence: DataConfidenceScore | null,
): void {
  const entry: AuditEntry = {
    engine_version: ENGINE_VERSION,
    event_type: "KILL_SWITCH",
    snapshot_ids: snapshotIds,
    inputs: {
      triggers: killSwitch.triggers,
      reasons: killSwitch.reasons,
    },
    outputs: {
      active: killSwitch.active,
      triggerCount: killSwitch.triggers.length,
    },
    top_factors: [],
    decision_reason: killSwitch.active
      ? `SAFE MODE activated: ${killSwitch.reasons.join("; ")}`
      : "SAFE MODE deactivated",
    data_confidence: dataConfidence?.score,
    kill_switch_active: killSwitch.active,
    kill_switch_triggers: killSwitch.triggers,
  };

  writeEntries([entry]);
}

/* ── Export / Replay helpers ── */

/**
 * Fetch audit log entries for a time range.
 */
export async function fetchAuditLog(
  from: Date,
  to: Date,
  eventType?: AuditEventType,
  netuid?: number,
  limit = 1000,
): Promise<AuditEntry[]> {
  let query = supabase
    .from("audit_log" as any)
    .select("*")
    .gte("ts", from.toISOString())
    .lte("ts", to.toISOString())
    .order("ts", { ascending: true })
    .limit(limit);

  if (eventType) {
    query = query.eq("event_type", eventType);
  }
  if (netuid !== undefined) {
    query = query.eq("netuid", netuid);
  }

  const { data, error } = await query;
  if (error) {
    console.error("[AUDIT-LOG] Fetch failed:", error.message);
    return [];
  }
  return (data ?? []) as unknown as AuditEntry[];
}

/**
 * Export audit log entries as CSV string.
 */
export function auditToCsv(entries: any[]): string {
  if (entries.length === 0) return "";

  const headers = [
    "ts", "engine_version", "event_type", "netuid", "subnet_count",
    "data_confidence", "alignment_status", "kill_switch_active",
    "decision_reason", "inputs", "outputs", "top_factors",
    "snapshot_ids", "kill_switch_triggers",
  ];

  const rows = entries.map(e =>
    headers.map(h => {
      const val = e[h];
      if (val === null || val === undefined) return "";
      if (typeof val === "object") return `"${JSON.stringify(val).replace(/"/g, '""')}"`;
      return `"${String(val).replace(/"/g, '""')}"`;
    }).join(",")
  );

  return [headers.join(","), ...rows].join("\n");
}

/**
 * Export audit log entries as JSON string.
 */
export function auditToJson(entries: any[]): string {
  return JSON.stringify(entries, null, 2);
}

/**
 * Trigger browser download of a string as a file.
 */
export function downloadFile(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
