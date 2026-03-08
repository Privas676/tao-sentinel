/* ═══════════════════════════════════════ */
/*   USE-AUDIT-LOG HOOK                     */
/*   Read-only audit log access.            */
/*   All writes are server-side only.       */
/* ═══════════════════════════════════════ */

import { useCallback, useState } from "react";
import {
  fetchAuditLog,
  auditToCsv,
  auditToJson,
  downloadFile,
  type AuditEventType,
} from "@/lib/audit-log";

/**
 * No-op hook — audit writes are now server-side only.
 * Kept as a stable API so callers don't need to change.
 */
export function useAuditLogger(
  ..._args: unknown[]
): void {
  // Intentional no-op: all audit writes happen server-side via Edge Functions.
}

/* ── Export hook for Settings page ── */

export function useAuditExport() {
  const [isExporting, setIsExporting] = useState(false);

  const exportAudit = useCallback(async (
    format: "csv" | "json",
    hours = 24,
    eventType?: AuditEventType,
  ) => {
    setIsExporting(true);
    try {
      const to = new Date();
      const from = new Date(to.getTime() - hours * 60 * 60 * 1000);
      const entries = await fetchAuditLog(from, to, eventType);

      if (entries.length === 0) {
        console.warn("[AUDIT-EXPORT] No entries found for the selected period");
        setIsExporting(false);
        return;
      }

      const timestamp = to.toISOString().slice(0, 16).replace(/[:-]/g, "");
      if (format === "csv") {
        downloadFile(auditToCsv(entries), `audit_log_${timestamp}.csv`, "text/csv");
      } else {
        downloadFile(auditToJson(entries), `audit_log_${timestamp}.json`, "application/json");
      }
    } catch (err) {
      console.error("[AUDIT-EXPORT] Failed:", err);
    } finally {
      setIsExporting(false);
    }
  }, []);

  return { exportAudit, isExporting };
}

/* ── Replay hook ── */

export type ReplayEntry = {
  ts: string;
  event_type: string;
  netuid?: number;
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown>;
  decision_reason?: string;
  data_confidence?: number;
  kill_switch_active?: boolean;
};

export function useAuditReplay() {
  const [entries, setEntries] = useState<ReplayEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [cursor, setCursor] = useState(0);

  const loadReplay = useCallback(async (from: Date, to: Date, netuid?: number) => {
    setIsLoading(true);
    try {
      const data = await fetchAuditLog(from, to, undefined, netuid);
      setEntries(data as unknown as ReplayEntry[]);
      setCursor(0);
    } catch (err) {
      console.error("[REPLAY] Load failed:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const step = useCallback((delta: number) => {
    setCursor(prev => Math.max(0, Math.min(entries.length - 1, prev + delta)));
  }, [entries.length]);

  const current = entries[cursor] ?? null;

  return { entries, isLoading, cursor, current, loadReplay, step, setCursor, total: entries.length };
}
