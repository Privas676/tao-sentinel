/* ═══════════════════════════════════════ */
/*   USE-AUDIT-LOG HOOK                     */
/*   Integrates audit logging into the      */
/*   scoring pipeline + provides replay.    */
/* ═══════════════════════════════════════ */

import { useEffect, useRef, useCallback, useState } from "react";
import type { UnifiedSubnetScore, UnifiedScoresResult } from "@/hooks/use-subnet-scores";
import {
  logScoringCycle,
  logKillSwitchEvent,
  logSubnetEvent,
  fetchAuditLog,
  auditToCsv,
  auditToJson,
  downloadFile,
  type AuditEventType,
} from "@/lib/audit-log";
import type { DataConfidenceScore } from "@/lib/data-confidence";
import type { KillSwitchResult } from "@/lib/push-kill-switch";
import type { FleetDistributionReport } from "@/lib/distribution-monitor";

/* ── Audit integration for scoring cycles ── */

export function useAuditLogger(
  scoresList: UnifiedSubnetScore[],
  scoreTimestamp: string,
  alignmentStatus: string,
  dataConfidence: DataConfidenceScore | null,
  killSwitch: KillSwitchResult | null,
  fleetDistribution: FleetDistributionReport | null,
) {
  const prevKillSwitchRef = useRef<boolean>(false);
  const prevActionsRef = useRef<Map<number, string>>(new Map());

  useEffect(() => {
    if (scoresList.length === 0) return;

    const snapshotIds = [`unified:${scoreTimestamp}`];

    // 1. Log scoring cycle (throttled internally)
    logScoringCycle(
      scoresList,
      snapshotIds,
      alignmentStatus,
      dataConfidence,
      killSwitch,
      fleetDistribution,
    );

    // 2. Detect kill switch state changes
    if (killSwitch) {
      const wasActive = prevKillSwitchRef.current;
      if (killSwitch.active !== wasActive) {
        logKillSwitchEvent(killSwitch, snapshotIds, dataConfidence);
        prevKillSwitchRef.current = killSwitch.active;
      }
    }

    // 3. Detect action changes (state transitions)
    const prevActions = prevActionsRef.current;
    for (const s of scoresList) {
      const prev = prevActions.get(s.netuid);
      if (prev && prev !== s.action) {
        logSubnetEvent(
          "STATE_CHANGE",
          s,
          `Action changed: ${prev} → ${s.action}`,
          snapshotIds,
          alignmentStatus,
          dataConfidence,
        );
      }
    }

    // Update prev state
    const newMap = new Map<number, string>();
    for (const s of scoresList) newMap.set(s.netuid, s.action);
    prevActionsRef.current = newMap;
  }, [scoresList, scoreTimestamp, alignmentStatus, dataConfidence, killSwitch, fleetDistribution]);
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
