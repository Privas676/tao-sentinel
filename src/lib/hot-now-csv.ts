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
  "price",
  "change_1h",
  "change_24h",
  "change_7d",
  "change_30d",
  "volume_24h",
  "buys_24h",
  "sells_24h",
  "buyers",
  "sellers",
  "liquidity",
  "tao_pool",
  "alpha_pool",
  "pool_ratio",
  "slippage_1t",
  "slippage_10t",
  "spread",
  "emission",
  "pulse_type",
  "tradability",
  "action",
  "reasons",
  "confidence",
  "risk_score",
  "engine_conflict",
  "data_freshness",
  "taostats_timestamp",
  "taoflute_timestamp",
  "sentinel_timestamp",
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
      fmtNum(f?.price ?? null, 6),
      fmtNum(p.price_change_1h, 2),
      fmtNum(p.price_change_24h, 2),
      fmtNum(p.price_change_7d, 2),
      fmtNum(p.price_change_30d, 2),
      fmtNum(p.volume_24h, 4),
      p.buys_count ?? "",
      p.sells_count ?? "",
      f?.buyers_count ?? "",
      f?.sellers_count ?? "",
      fmtNum(p.liquidity, 4),
      fmtNum(f?.tao_in_pool ?? p.liquidity, 4),
      fmtNum(p.alpha_in_pool, 4),
      fmtNum(p.pool_ratio, 4),
      fmtNum(p.slippage_1tau, 4),
      fmtNum(p.slippage_10tau, 4),
      fmtNum(p.spread, 4),
      fmtNum(p.emissions_pct, 6),
      p.pulse_type,
      p.tradability,
      r.action,
      reasons,
      d ? d.confidence_score : "",
      d ? d.risk_decision_score : "",
      p.engineConflict ? "1" : "0",
      p.data_freshness_ok ? "OK" : "STALE",
      f?.taostats_timestamp ?? "",
      f?.taoflute_timestamp ?? "",
      f?.sentinel_timestamp ?? p.detected_at,
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
