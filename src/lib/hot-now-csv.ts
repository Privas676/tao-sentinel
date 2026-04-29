/* ═══════════════════════════════════════════════════════════ */
/*   HOT NOW CSV EXPORT (Lot 2)                                 */
/*   Exports only the pulses currently visible in HOT NOW.      */
/*   UTF-8, comma separator, quoted strings (RFC 4180 style).   */
/* ═══════════════════════════════════════════════════════════ */

import type { PulseResult } from "./pulse-detector";
import type { CanonicalSubnetDecision, CanonicalSubnetFacts } from "./canonical-types";
import type { HotNowAction } from "./hot-now-action";

export type HotNowCsvRow = {
  pulse: PulseResult;
  decision?: CanonicalSubnetDecision;
  facts?: CanonicalSubnetFacts;
  action: HotNowAction;
};

const HEADER = [
  "timestamp",
  "netuid",
  "name",
  "pulse_type",
  "tradability",
  "action",
  "change_1h",
  "change_1d",
  "change_1w",
  "change_1m",
  "volume_24h",
  "liquidity",
  "risk_score",
  "opportunity_score",
  "confidence",
  "reasons",
  "data_freshness",
  "source_timestamp",
] as const;

function csvEscape(value: unknown): string {
  if (value == null) return "";
  let s = String(value);
  if (s.includes('"') || s.includes(",") || s.includes("\n") || s.includes(";")) {
    s = `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function fmtNum(n: number | null | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return "";
  return n.toFixed(digits);
}

export function buildHotNowCsv(rows: HotNowCsvRow[], generatedAt: Date = new Date()): string {
  const ts = generatedAt.toISOString();
  const lines: string[] = [HEADER.join(",")];
  for (const r of rows) {
    const p = r.pulse;
    const d = r.decision;
    const f = r.facts;
    const reasons = (p.reasons ?? []).join(" | ");
    const fields = [
      ts,
      p.netuid,
      p.name,
      p.pulse_type,
      p.tradability,
      r.action,
      fmtNum(p.price_change_1h, 2),
      fmtNum(p.price_change_24h, 2),
      fmtNum(p.price_change_7d, 2),
      fmtNum(p.price_change_30d, 2),
      fmtNum(p.volume_24h, 4),
      fmtNum(p.liquidity, 4),
      d ? d.risk_decision_score : "",
      d ? Math.max(0, 100 - d.risk_decision_score) : "", // opportunity proxy if not exposed
      d ? d.confidence_score : "",
      reasons,
      p.data_freshness_ok ? "OK" : "STALE",
      f?.taostats_timestamp ?? p.detected_at,
    ];
    lines.push(fields.map(csvEscape).join(","));
  }
  return lines.join("\n");
}

export function downloadCsv(filename: string, content: string): void {
  // BOM for Excel UTF-8 compatibility
  const blob = new Blob(["\ufeff" + content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
