/* ═══════════════════════════════════════ */
/*   AUDIT LOG — READ-ONLY CLIENT MODULE    */
/*   All WRITE operations are restricted    */
/*   to server-side Edge Functions only.    */
/*   Client can only READ via RLS policy.   */
/* ═══════════════════════════════════════ */

import { supabase } from "@/integrations/supabase/client";

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

/* ── Read-only API ── */

/**
 * Fetch audit log entries for a time range.
 * Uses RLS: only authenticated users can SELECT.
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
