/* ═══════════════════════════════════════════════════════════ */
/*   HOT NOW — TaoStats Price Pulse Section (Lot 2)            */
/*                                                              */
/*   - Auto-refresh hint (parent re-fetches every 60s)          */
/*   - Visible "Last update" + Europe/Zurich time + age         */
/*   - Snapshot fallback when incoming pulses are empty         */
/*   - Per-row badges for pulse_type + GO/WATCH/AVOID/EXIT_FAST */
/*   - CSV export of the visible rows only                      */
/*                                                              */
/*   Pumps risqués restent visibles : leur badge explique pour- */
/*   quoi ne pas entrer. Aucun pump n'est masqué.               */
/* ═══════════════════════════════════════════════════════════ */

import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  selectHotNow,
  pulseTypeLabel,
  type PulseResult,
  type PulseType,
} from "@/lib/pulse-detector";
import type { DataTrustResult } from "@/lib/data-trust";
import type { CanonicalSubnetDecision, CanonicalSubnetFacts } from "@/lib/canonical-types";
import { GOLD, GO, WARN, BREAK, MUTED } from "@/components/sentinel/Atoms";
import {
  deriveHotNowAction,
  actionLabel,
  actionExplanation,
  type HotNowAction,
} from "@/lib/hot-now-action";
import { buildHotNowCsv, downloadCsv, type HotNowCsvRow } from "@/lib/hot-now-csv";

const ZURICH_TZ = "Europe/Zurich";

function fmtZurich(date: Date): string {
  try {
    return new Intl.DateTimeFormat("fr-CH", {
      timeZone: ZURICH_TZ,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(date);
  } catch {
    return date.toISOString();
  }
}

function relAge(seconds: number, fr: boolean): string {
  if (seconds < 60) return fr ? `il y a ${seconds} sec` : `${seconds} sec ago`;
  const min = Math.round(seconds / 60);
  return fr ? `il y a ${min} min` : `${min} min ago`;
}

function pulseTypeColor(t: PulseType): string {
  switch (t) {
    case "PUMP_LIVE":
    case "DAILY_BREAKOUT":
      return GO;
    case "EXTREME_PUMP":
    case "WEEKLY_ROTATION":
      return GOLD;
    case "DEAD_CAT_BOUNCE":
    case "TOXIC_PUMP":
      return BREAK;
    case "ILLIQUID_PUMP":
    case "OVEREXTENDED":
      return WARN;
    default:
      return MUTED;
  }
}

function actionColor(a: HotNowAction): string {
  switch (a) {
    case "GO": return GO;
    case "WATCH": return WARN;
    case "AVOID": return BREAK;
    case "EXIT_FAST": return BREAK;
  }
}

function fmtPct(n: number | null): string {
  if (n == null) return "—";
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(1)}%`;
}

function fmtNum(n: number | null, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return n.toFixed(digits);
}

export type HotNowSectionProps = {
  pulses: Map<number, PulseResult>;
  dataTrust: DataTrustResult;
  fr: boolean;
  limit?: number;
  decisions?: Map<number, CanonicalSubnetDecision>;
  facts?: Map<number, CanonicalSubnetFacts>;
  heldNetuids?: Set<number>;
  /** Source freshness timestamp from useSubnetScores (ISO). */
  sourceTimestamp?: string | null;
};

export function HotNowSection({
  pulses,
  dataTrust,
  fr,
  limit = 8,
  decisions,
  facts,
  heldNetuids,
  sourceTimestamp,
}: HotNowSectionProps) {
  // ── Snapshot fallback: if pulses transiently become empty, keep showing the last good list. ──
  const lastGoodRef = useRef<{ list: PulseResult[]; ts: Date } | null>(null);
  const lastFailRef = useRef<{ ts: Date } | null>(null);
  const live = useMemo(() => selectHotNow(pulses, limit), [pulses, limit]);
  const usingSnapshot = live.length === 0 && !!lastGoodRef.current;
  const hot = usingSnapshot ? lastGoodRef.current!.list : live;
  if (live.length > 0) {
    lastGoodRef.current = { list: live, ts: new Date() };
    lastFailRef.current = null;
  } else if (lastGoodRef.current) {
    lastFailRef.current = { ts: new Date() };
  }

  // ── Visible-update tick (recompute "X sec ago" every second) ──
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const refSnapshotTs = lastGoodRef.current?.ts ?? new Date();
  const refIso = sourceTimestamp ?? refSnapshotTs.toISOString();
  const refDate = new Date(refIso);
  const ageSec = Math.max(0, Math.round((Date.now() - refDate.getTime()) / 1000));

  // ── Build action per row ──
  const rows = useMemo(() => {
    return hot.map((p) => {
      const decision = decisions?.get(p.netuid);
      const isHeld = !!heldNetuids?.has(p.netuid);
      const inSafeMode = dataTrust.isSafeMode;
      // In SAFE MODE the pulse already carries NEEDS_CONFIRMATION; demote any GO accordingly.
      let action = deriveHotNowAction(p, decision, isHeld);
      if (inSafeMode && action === "GO") action = "WATCH";
      return { pulse: p, decision, facts: facts?.get(p.netuid), action, isHeld };
    });
  }, [hot, decisions, facts, heldNetuids, dataTrust.isSafeMode]);

  const handleExport = () => {
    const csvRows: HotNowCsvRow[] = rows.map((r) => ({
      pulse: r.pulse,
      decision: r.decision,
      facts: r.facts,
      action: r.action,
    }));
    const csv = buildHotNowCsv(csvRows);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    downloadCsv(`hot-now-${stamp}.csv`, csv);
  };

  return (
    <section
      className="rounded-lg border border-border bg-card overflow-hidden"
      aria-labelledby="hot-now-title"
      data-testid="hot-now-section"
    >
      <header className="px-4 py-2.5 flex items-center gap-2 border-b border-border flex-wrap">
        <span style={{ fontSize: 11 }}>🔥</span>
        <h2
          id="hot-now-title"
          className="font-mono text-[10px] tracking-[0.18em] uppercase text-foreground/80"
        >
          Hot now — TaoStats Price Pulse
        </h2>

        <span
          className="font-mono text-[9px] px-1.5 py-0.5 rounded uppercase tracking-wider"
          style={{
            color: dataTrust.isSafeMode ? BREAK : GO,
            background: `color-mix(in srgb, ${dataTrust.isSafeMode ? BREAK : GO} 8%, transparent)`,
            border: `1px solid color-mix(in srgb, ${dataTrust.isSafeMode ? BREAK : GO} 18%, transparent)`,
          }}
          title={dataTrust.reasons.join(" · ") || (fr ? "Données fraîches" : "Fresh data")}
        >
          {dataTrust.level}
        </span>

        <span
          data-testid="hot-now-last-update"
          className="font-mono text-[9px] text-muted-foreground"
          title={refDate.toISOString()}
        >
          {fr ? "Dernière mise à jour" : "Last update"} : {fmtZurich(refDate)} {ZURICH_TZ}
          {" · "}{relAge(ageSec, fr)}
        </span>

        {usingSnapshot && (
          <span
            data-testid="hot-now-snapshot-warn"
            className="font-mono text-[9px] px-1.5 py-0.5 rounded"
            style={{
              color: WARN,
              background: `color-mix(in srgb, ${WARN} 8%, transparent)`,
              border: `1px solid color-mix(in srgb, ${WARN} 18%, transparent)`,
            }}
          >
            {fr ? "Refresh échoué — snapshot conservé" : "Refresh failed — snapshot kept"}
          </span>
        )}

        <button
          type="button"
          onClick={handleExport}
          disabled={rows.length === 0}
          className="ml-auto font-mono text-[9px] px-2 py-1 rounded uppercase tracking-wider hover:opacity-80 disabled:opacity-40 disabled:cursor-not-allowed"
          style={{
            color: GOLD,
            background: `color-mix(in srgb, ${GOLD} 6%, transparent)`,
            border: `1px solid color-mix(in srgb, ${GOLD} 16%, transparent)`,
          }}
          data-testid="hot-now-csv-btn"
        >
          {fr ? "Exporter HOT NOW CSV" : "Export HOT NOW CSV"}
        </button>
      </header>

      {rows.length === 0 ? (
        <div className="px-4 py-6 font-mono text-[10px] text-muted-foreground text-center">
          {fr ? "Aucun pump détecté actuellement" : "No pump detected right now"}
        </div>
      ) : (
        <ul className="divide-y divide-border/60">
          {rows.map(({ pulse: p, action, isHeld }) => {
            const typeColor = pulseTypeColor(p.pulse_type);
            const actColor = actionColor(action);
            const inSafeMode =
              dataTrust.isSafeMode || p.tradability === "NEEDS_CONFIRMATION";
            return (
              <li key={p.netuid} className="px-4 py-2.5" data-testid={`hot-row-${p.netuid}`}>
                <div className="flex items-center gap-2 flex-wrap">
                  <Link
                    to={`/subnets/${p.netuid}`}
                    className="font-mono text-[11px] font-bold text-foreground hover:underline"
                  >
                    SN-{p.netuid}
                  </Link>
                  <span className="font-mono text-[10px] text-muted-foreground truncate max-w-[160px]">
                    {p.name}
                  </span>

                  {/* Pulse type badge (machine-readable label too) */}
                  <span
                    data-testid={`badge-type-${p.netuid}`}
                    data-pulse-type={p.pulse_type}
                    className="font-mono text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider"
                    style={{
                      color: typeColor,
                      background: `color-mix(in srgb, ${typeColor} 8%, transparent)`,
                      border: `1px solid color-mix(in srgb, ${typeColor} 18%, transparent)`,
                    }}
                    title={pulseTypeLabel(p.pulse_type, fr)}
                  >
                    {p.pulse_type.replace(/_/g, " ")}
                  </span>

                  {/* NEEDS_CONFIRMATION extra badge in safe mode */}
                  {inSafeMode && (
                    <span
                      data-testid={`badge-needs-${p.netuid}`}
                      className="font-mono text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider"
                      style={{
                        color: WARN,
                        background: `color-mix(in srgb, ${WARN} 8%, transparent)`,
                        border: `1px solid color-mix(in srgb, ${WARN} 18%, transparent)`,
                      }}
                    >
                      NEEDS CONFIRMATION
                    </span>
                  )}

                  {/* Action badge */}
                  <span
                    data-testid={`badge-action-${p.netuid}`}
                    data-action={action}
                    className="font-mono text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider"
                    style={{
                      color: actColor,
                      background: `color-mix(in srgb, ${actColor} 8%, transparent)`,
                      border: `1px solid color-mix(in srgb, ${actColor} 18%, transparent)`,
                    }}
                    title={actionExplanation(action, p, fr)}
                  >
                    {actionLabel(action, fr)}{isHeld && action === "EXIT_FAST" ? " ⚠" : ""}
                  </span>

                  <span className="ml-auto flex items-center gap-2 font-mono text-[10px] text-muted-foreground">
                    <span style={{ color: (p.price_change_1h ?? 0) >= 0 ? GO : BREAK }}>
                      1H {fmtPct(p.price_change_1h)}
                    </span>
                    <span style={{ color: (p.price_change_24h ?? 0) >= 0 ? GO : BREAK }}>
                      1D {fmtPct(p.price_change_24h)}
                    </span>
                    <span style={{ color: (p.price_change_7d ?? 0) >= 0 ? GO : BREAK }}>
                      7J {fmtPct(p.price_change_7d)}
                    </span>
                  </span>
                </div>

                {/* Layer A — Faits bruts essentiels */}
                <div className="mt-1 flex items-center gap-3 font-mono text-[9px] text-muted-foreground/90 flex-wrap">
                  <span title={fr ? "Volume 24h (TAO)" : "24h volume (TAO)"}>
                    VOL <span className="text-foreground/80">{fmtNum(p.volume_24h, 2)}</span>
                  </span>
                  <span title={fr ? "Liquidité TAO in pool" : "TAO in pool"}>
                    LIQ <span className="text-foreground/80">{fmtNum(p.liquidity, 1)}</span>
                  </span>
                  {p.slippage_1tau != null && (
                    <span title={fr ? "Slippage 1 TAO" : "Slippage 1 TAO"}>
                      SLIP1 <span style={{ color: (p.slippage_1tau ?? 0) > 1.5 ? WARN : "inherit" }}>
                        {fmtNum(p.slippage_1tau, 2)}%
                      </span>
                    </span>
                  )}
                  {p.slippage_10tau != null && (
                    <span title={fr ? "Slippage 10 TAO" : "Slippage 10 TAO"}>
                      SLIP10 <span style={{ color: (p.slippage_10tau ?? 0) > 8 ? WARN : "inherit" }}>
                        {fmtNum(p.slippage_10tau, 2)}%
                      </span>
                    </span>
                  )}
                  {p.spread != null && (
                    <span title={fr ? "Spread" : "Spread"}>
                      SPR <span className="text-foreground/80">{fmtNum(p.spread, 2)}%</span>
                    </span>
                  )}
                  {(p.buys_count != null || p.sells_count != null) && (
                    <span title={fr ? "Acheteurs / Vendeurs 24h" : "Buys / Sells 24h"}>
                      B/S <span className="text-foreground/80">
                        {p.buys_count ?? 0}/{p.sells_count ?? 0}
                      </span>
                    </span>
                  )}
                  {p.engineConflict && (
                    <span
                      data-testid={`badge-conflict-${p.netuid}`}
                      className="font-mono text-[9px] px-1.5 py-0.5 rounded uppercase tracking-wider"
                      style={{
                        color: WARN,
                        background: `color-mix(in srgb, ${WARN} 10%, transparent)`,
                        border: `1px solid color-mix(in srgb, ${WARN} 22%, transparent)`,
                      }}
                      title={p.conflict_reason ?? ""}
                    >
                      {fr ? "CONFLIT BRUT/MOTEUR" : "RAW vs ENGINE CONFLICT"}
                    </span>
                  )}
                </div>

                <div className="mt-1 font-mono text-[9px] text-muted-foreground/80 truncate">
                  {actionExplanation(action, p, fr)}
                  {p.reasons.length > 0 && " · " + p.reasons.slice(0, 2).join(" · ")}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
