import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { useMemo, useState, useCallback } from "react";
import { useSubnetScores } from "@/hooks/use-subnet-scores";
import { useOverrideMode } from "@/hooks/use-override-mode";
import { useDelistMode } from "@/hooks/use-delist-mode";
import { usePushNotifications } from "@/hooks/use-push-notifications";
import {
  evaluateAllDelistRisks,
  delistCategoryColor,
  delistCategoryLabel,
  type DelistRiskResult,
  type SubnetMetricsForDelist,
} from "@/lib/delist-risk";

type EventRow = {
  id: number;
  netuid: number | null;
  type: string | null;
  severity: number | null;
  ts: string | null;
  evidence: any;
};

type FilterType = "ALL" | "UNIQUE" | "OVERRIDE" | "WHALE" | "STATE" | "SMART" | "STRATEGIC";

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
const OVERRIDE_QUOTA = 10;
const DISMISSED_KEY = "alerts-dismissed";

/* ─── Dismissed alerts helpers (localStorage, 24h TTL) ─── */
function getDismissedAlerts(): Map<string, number> {
  try {
    const raw = localStorage.getItem(DISMISSED_KEY);
    if (!raw) return new Map();
    const parsed = JSON.parse(raw) as Record<string, number>;
    const now = Date.now();
    const valid = new Map<string, number>();
    for (const [key, ts] of Object.entries(parsed)) {
      if (now - ts < TWENTY_FOUR_HOURS_MS) valid.set(key, ts);
    }
    return valid;
  } catch { return new Map(); }
}

function dismissAlert(key: string) {
  const map = getDismissedAlerts();
  map.set(key, Date.now());
  const obj: Record<string, number> = {};
  map.forEach((v, k) => { obj[k] = v; });
  try { localStorage.setItem(DISMISSED_KEY, JSON.stringify(obj)); } catch {}
}

function isDismissed(key: string, dismissed: Map<string, number>): boolean {
  return dismissed.has(key);
}

function alertKey(g: GroupedEvent): string {
  return `${g.latest.type}::${g.latest.netuid}::${g.lastTs?.slice(0, 13) ?? ""}`;
}

/* ─── Essential mode: classify events ─── */
function isEssentialEvent(g: GroupedEvent, scores: Map<number, any> | undefined): boolean {
  const ev = g.latest;
  // State transitions: BREAK, EXIT_FAST, DEPEG_CRITICAL always essential
  if (ev.type === "BREAK" || ev.type === "EXIT_FAST" || ev.type === "DEPEG_CRITICAL") return true;
  // DEPEG_WARNING is essential
  if (ev.type === "DEPEG_WARNING") return true;
  // Overrides: only if passes strict gating
  if (ev.type === "RISK_OVERRIDE") return passesStrictGating(ev, scores);
  // DATA_DIVERGENCE: no longer essential — TMC decoupled
  if (ev.type === "DATA_DIVERGENCE") return false;
  // Whale moves with large amounts
  if (ev.type === "WHALE_MOVE") {
    const e = ev.evidence as any;
    const amount = e?.amount_tao as number | undefined;
    return amount != null && amount >= 1000;
  }
  // Smart signals always essential
  if (ev.type === "PRE_HYPE" || ev.type === "SMART_ACCUMULATION") return true;
  // Other state events: GO, EARLY are not essential noise
  return false;
}

/** Grouped event: one line per (type, netuid) within a 6h window */
type GroupedEvent = {
  key: string;
  latest: EventRow;
  occurrences: EventRow[];
  count: number;
  firstTs: string;
  lastTs: string;
};

/* ─── STRUCTURED OVERRIDE REASON CHIPS ─── */
const OVERRIDE_CHIP_MAP: Record<string, { label: string; labelFr: string; color: string }> = {
  "EMISSION_ZERO":          { label: "Emission drop",     labelFr: "Émission nulle",     color: "rgba(229,57,53,0.7)" },
  "TAO_POOL_CRITICAL":      { label: "Pool thin",         labelFr: "Pool faible",         color: "rgba(255,152,0,0.8)" },
  "LIQUIDITY_USD_CRITICAL":  { label: "Low liquidity",     labelFr: "Liquidité basse",     color: "rgba(255,152,0,0.8)" },
  "VOL_MC_LOW":             { label: "Volume/MC abnormal", labelFr: "Volume/MC anormal",   color: "rgba(255,193,7,0.8)" },
  "SLIPPAGE_HIGH":          { label: "Slippage high",      labelFr: "Slippage élevé",      color: "rgba(229,57,53,0.7)" },
  "DEPEG":                  { label: "Depeg",              labelFr: "Dépeg",               color: "rgba(229,57,53,0.9)" },
  "DEREGISTRATION":         { label: "Deregistration",     labelFr: "Désenregistrement",   color: "rgba(229,57,53,0.9)" },
  "BREAK_STATE":            { label: "Critical zone",      labelFr: "Zone critique",       color: "rgba(229,57,53,0.8)" },
  "DATA_MISMATCH":          { label: "Data mismatch",      labelFr: "Divergence data",     color: "rgba(255,152,0,0.7)" },
  "UID_LOW":                { label: "UID low",            labelFr: "UID faible",           color: "rgba(255,193,7,0.7)" },
  "SPREAD_HIGH":            { label: "Spread high",        labelFr: "Spread élevé",         color: "rgba(255,152,0,0.7)" },
};

/** Map raw event type to display label */
function typeDisplayLabel(type: string | null, lang: string): { label: string; icon: string; color: string } {
  const fr = lang === "fr";
  switch (type) {
    case "BREAK":
    case "EXIT_FAST":
      return { label: fr ? "ZONE CRITIQUE" : "CRITICAL ZONE", icon: "⛔", color: "rgba(229,57,53,0.9)" };
    case "GO":
      return { label: "GO", icon: "🟢", color: "rgba(76,175,80,0.9)" };
    case "GO_SPECULATIVE":
      return { label: fr ? "SPÉCULATIF" : "SPECULATIVE", icon: "🔶", color: "rgba(255,152,0,0.85)" };
    case "EARLY":
      return { label: "EARLY", icon: "🌱", color: "rgba(139,195,74,0.85)" };
    case "HOLD":
      return { label: "HOLD", icon: "⏸", color: "rgba(255,193,7,0.7)" };
    case "WATCH":
      return { label: "WATCH", icon: "👁", color: "rgba(158,158,158,0.7)" };
    case "CREATED":
      return { label: fr ? "NOUVEAU" : "NEW", icon: "✨", color: "rgba(100,181,246,0.8)" };
    case "DEPEG_WARNING":
      return { label: fr ? "DÉPEG ⚠" : "DEPEG ⚠", icon: "⚠", color: "rgba(255,152,0,0.85)" };
    case "DEPEG_CRITICAL":
      return { label: fr ? "DÉPEG CRITIQUE" : "DEPEG CRITICAL", icon: "🔴", color: "rgba(229,57,53,0.9)" };
    case "WHALE_MOVE":
      return { label: "WHALE", icon: "🐋", color: "rgba(255,215,0,0.8)" };
    case "DATA_DIVERGENCE":
      return { label: fr ? "DIVERGENCE DATA" : "DATA DIVERGENCE", icon: "⚠", color: "rgba(255,152,0,0.8)" };
    case "RISK_OVERRIDE":
      return { label: fr ? "⛔ OVERRIDE RISQUE" : "⛔ RISK OVERRIDE", icon: "🛡", color: "rgba(229,57,53,0.9)" };
    case "PRE_HYPE":
      return { label: fr ? "PRÉ-HYPE" : "PRE-HYPE", icon: "🚀", color: "rgba(156,39,176,0.9)" };
    case "SMART_ACCUMULATION":
      return { label: fr ? "SMART ACCUM." : "SMART ACCUM.", icon: "🧠", color: "rgba(0,188,212,0.85)" };
    default:
      return { label: type || "—", icon: "•", color: "rgba(255,255,255,0.4)" };
  }
}

function eventCategory(type: string | null): FilterType {
  if (type === "WHALE_MOVE") return "WHALE";
  if (type === "DATA_DIVERGENCE") return "ALL"; // No longer a dedicated filter category
  if (type === "PRE_HYPE" || type === "SMART_ACCUMULATION") return "SMART";
  if (type === "RISK_OVERRIDE") return "OVERRIDE";
  return "STATE";
}

function subnetLinks(netuid: number | null) {
  if (netuid == null) return null;
  return (
    <span className="inline-flex gap-1.5 ml-1">
      <a href={`https://taostats.io/subnets/${netuid}`} target="_blank" rel="noopener noreferrer"
        onClick={e => e.stopPropagation()}
        className="font-mono text-[9px] px-1.5 py-0.5 rounded transition-all hover:scale-105"
        style={{ background: "rgba(255,215,0,0.06)", color: "rgba(255,215,0,0.6)", border: "1px solid rgba(255,215,0,0.12)" }}>
        TaoStats
      </a>
      <a href={`https://taomarketcap.com/subnets/${netuid}`} target="_blank" rel="noopener noreferrer"
        onClick={e => e.stopPropagation()}
        className="font-mono text-[9px] px-1.5 py-0.5 rounded transition-all hover:scale-105"
        style={{ background: "rgba(100,181,246,0.06)", color: "rgba(100,181,246,0.6)", border: "1px solid rgba(100,181,246,0.12)" }}>
        TMC
      </a>
    </span>
  );
}

function groupEvents(events: EventRow[]): GroupedEvent[] {
  const groups = new Map<string, GroupedEvent[]>();
  for (const ev of events) {
    const key = `${ev.type ?? "null"}::${ev.netuid ?? "null"}`;
    const evTs = ev.ts ? new Date(ev.ts).getTime() : 0;
    if (!groups.has(key)) groups.set(key, []);
    const buckets = groups.get(key)!;
    let placed = false;
    for (const bucket of buckets) {
      const latestTs = new Date(bucket.lastTs).getTime();
      const firstTs = new Date(bucket.firstTs).getTime();
      if (Math.abs(latestTs - evTs) <= SIX_HOURS_MS || Math.abs(firstTs - evTs) <= SIX_HOURS_MS) {
        bucket.occurrences.push(ev);
        bucket.count++;
        if (evTs > latestTs) { bucket.latest = ev; bucket.lastTs = ev.ts!; }
        if (evTs < firstTs) { bucket.firstTs = ev.ts!; }
        placed = true;
        break;
      }
    }
    if (!placed) {
      buckets.push({
        key: `${key}::${ev.id}`, latest: ev, occurrences: [ev], count: 1,
        firstTs: ev.ts || new Date().toISOString(), lastTs: ev.ts || new Date().toISOString(),
      });
    }
  }
  const all: GroupedEvent[] = [];
  for (const buckets of groups.values()) all.push(...buckets);
  all.sort((a, b) => new Date(b.lastTs).getTime() - new Date(a.lastTs).getTime());
  return all;
}

const severityColor = (sev: number | null) => {
  if (!sev || sev <= 1) return "rgba(84,110,122,0.7)";
  if (sev === 2) return "rgba(251,192,45,0.7)";
  if (sev === 3) return "rgba(255,109,0,0.8)";
  return "rgba(229,57,53,0.8)";
};

function formatTimeAgo(ts: string, fr: boolean): string {
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return fr ? "à l'instant" : "just now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}${fr ? "j" : "d"}`;
}

function passesStrictGating(ev: EventRow, scores: Map<number, any> | undefined): boolean {
  if (ev.type !== "RISK_OVERRIDE") return true;
  if (!scores || ev.netuid == null) return false;
  const subnet = scores.get(ev.netuid);
  if (!subnet) return false;
  const evidence = ev.evidence as any;
  const risk = subnet.risk ?? 0;
  const confidence = subnet.confianceScore ?? 0;
  if (risk < 70) return false;
  if (confidence < 70) return false;
  const hardConditions = (evidence?.hardConditions as string[]) || (evidence?.reasons as string[]) || [];
  if (hardConditions.length < 2) return false;
  return true;
}

function OverrideChips({ evidence, fr }: { evidence: any; fr: boolean }) {
  const hardConditions = (evidence?.hardConditions as string[]) || [];
  const reasons = (evidence?.reasons as string[]) || [];
  const chips: { label: string; color: string }[] = [];
  for (const hc of hardConditions) {
    const chip = OVERRIDE_CHIP_MAP[hc];
    if (chip) chips.push({ label: fr ? chip.labelFr : chip.label, color: chip.color });
  }
  if (chips.length === 0) {
    for (const r of reasons.slice(0, 4)) {
      const lower = r.toLowerCase();
      if (lower.includes("émission") || lower.includes("emission")) {
        chips.push({ label: fr ? "Émission nulle" : "Emission drop", color: "rgba(229,57,53,0.7)" });
      } else if (lower.includes("pool") || lower.includes("tao")) {
        chips.push({ label: fr ? "Pool faible" : "Pool thin", color: "rgba(255,152,0,0.8)" });
      } else if (lower.includes("liquidité") || lower.includes("liquidity")) {
        chips.push({ label: fr ? "Liquidité basse" : "Low liquidity", color: "rgba(255,152,0,0.8)" });
      } else if (lower.includes("vol") || lower.includes("mc")) {
        chips.push({ label: fr ? "Volume/MC anormal" : "Volume/MC abnormal", color: "rgba(255,193,7,0.8)" });
      } else if (lower.includes("slippage")) {
        chips.push({ label: fr ? "Slippage élevé" : "Slippage high", color: "rgba(229,57,53,0.7)" });
      } else if (lower.includes("depeg")) {
        chips.push({ label: "Depeg", color: "rgba(229,57,53,0.9)" });
      } else {
        chips.push({ label: r.length > 25 ? r.slice(0, 22) + "…" : r, color: "rgba(255,255,255,0.4)" });
      }
    }
  }
  if (chips.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {chips.map((c, i) => (
        <span key={i} className="font-mono text-[9px] font-bold px-1.5 py-0.5 rounded"
          style={{ color: c.color, background: `${c.color.replace(/[\d.]+\)$/, '0.08)')}`, border: `1px solid ${c.color.replace(/[\d.]+\)$/, '0.2)')}` }}>
          {c.label}
        </span>
      ))}
    </div>
  );
}

function ExpandableEventRow({ group, lang, onDismiss }: { group: GroupedEvent; lang: string; onDismiss?: (key: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const fr = lang === "fr";
  const ev = group.latest;
  const { label, icon, color } = typeDisplayLabel(ev.type, lang);
  const isMultiple = group.count > 1;

  const renderMainContent = () => {
    if (ev.type === "WHALE_MOVE") return renderWhaleContent(ev, fr);
    if (ev.type === "DATA_DIVERGENCE") return renderDivergenceContent(ev, fr);
    if (ev.type === "RISK_OVERRIDE") return renderOverrideContentV2(ev, fr);
    if (ev.type === "PRE_HYPE" || ev.type === "SMART_ACCUMULATION") return renderSmartContent(ev, fr);
    return renderStandardContent(ev, fr);
  };

  return (
    <div className="rounded-lg overflow-hidden" style={{ border: `1px solid ${color}15` }}>
      <div
        className={`flex flex-wrap sm:flex-nowrap items-start sm:items-center gap-2 sm:gap-3 px-3 sm:px-4 py-3 transition-colors ${isMultiple ? "cursor-pointer" : ""}`}
        style={{ background: expanded ? `${color}08` : "transparent" }}
        onClick={() => isMultiple && setExpanded(!expanded)}
      >
        <div className="w-2 h-2 rounded-full flex-shrink-0 mt-1 sm:mt-0" style={{ background: severityColor(ev.severity) }} />
        <div className="font-mono text-xs tracking-wider font-bold min-w-[120px]" style={{ color }}>{icon} {label}</div>
        <div className="font-mono text-xs text-white/50 min-w-[60px]">SN-{ev.netuid} {subnetLinks(ev.netuid)}</div>
        {renderMainContent()}
        <div className="flex items-center gap-2 ml-auto flex-shrink-0">
          {onDismiss && (
            <button
              onClick={e => { e.stopPropagation(); onDismiss(alertKey(group)); }}
              className="font-mono text-[8px] px-1.5 py-0.5 rounded transition-all hover:bg-white/10"
              style={{ color: "rgba(255,255,255,0.2)", border: "1px solid rgba(255,255,255,0.06)" }}
              title={fr ? "Masquer 24h" : "Dismiss 24h"}>
              ✓ {fr ? "Traité" : "Done"}
            </button>
          )}
          {isMultiple && (
            <span className="font-mono text-[10px] px-2 py-0.5 rounded-full font-bold"
              style={{ background: `${color}18`, color, border: `1px solid ${color}30` }}>×{group.count}</span>
          )}
          <span className="font-mono text-[10px] text-white/25">{formatTimeAgo(group.lastTs, fr)}</span>
          {isMultiple && (
            <span className="font-mono text-[9px] text-white/20 transition-transform" style={{ transform: expanded ? "rotate(180deg)" : "rotate(0deg)" }}>▼</span>
          )}
        </div>
      </div>
      {expanded && isMultiple && (
        <div className="border-t px-4 py-2 space-y-1" style={{ borderColor: `${color}15`, background: `${color}05` }}>
          <div className="font-mono text-[9px] text-white/30 tracking-widest mb-1.5">OCCURRENCES ({group.count}) — {fr ? "fenêtre" : "window"} 6h</div>
          {group.occurrences.map((occ, idx) => (
            <div key={occ.id} className="flex items-center gap-3 py-1 font-mono text-[10px]"
              style={{ borderBottom: idx < group.occurrences.length - 1 ? "1px solid rgba(255,255,255,0.03)" : "none" }}>
              <span className="text-white/15 w-5">{idx + 1}</span>
              <span className="text-white/25 min-w-[130px]">{occ.ts ? new Date(occ.ts).toLocaleString() : "—"}</span>
              <span className="text-white/40 flex-1 truncate">{renderOccurrenceDetail(occ)}</span>
              <span className="text-white/15">{occ.severity ? `sev:${occ.severity}` : ""}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function renderOccurrenceDetail(ev: EventRow): string {
  const e = ev.evidence as any;
  if (ev.type === "WHALE_MOVE") {
    const dir = e?.direction === "OUT" ? "↗" : "↙";
    const amount = e?.amount_tao ? `${Number(e.amount_tao).toLocaleString()} τ` : "";
    return `${dir} ${amount} ${e?.label || ""}`.trim();
  }
  if (ev.type === "DATA_DIVERGENCE") {
    const divs = e?.divergences as any[] || [];
    return divs.map((d: any) => `${d.field}: ${d.pct_diff}%`).join(", ");
  }
  if (ev.type === "RISK_OVERRIDE") {
    const reasons = (e?.reasons as string[]) || [];
    return reasons.join(" · ") || `MPI ${e?.mpi ?? "—"} Q ${e?.quality ?? "—"}`;
  }
  const reasons = (e?.reasons as string[]) || [];
  if (reasons.length) return reasons.join(" · ");
  const psi = e?.mpi ?? e?.psi;
  if (psi != null) return `PSI ${psi}`;
  return "—";
}

function renderWhaleContent(ev: EventRow, fr: boolean) {
  const e = ev.evidence as any;
  const dirLabel = e?.direction === "OUT" ? (fr ? "SORTIE" : "OUT") : (fr ? "ENTRÉE" : "IN");
  const dirColor = e?.direction === "OUT" ? "rgba(229,57,53,0.8)" : "rgba(76,175,80,0.8)";
  const amount = e?.amount_tao ? `${Number(e.amount_tao).toLocaleString()} τ` : "—";
  return (
    <div className="font-mono text-xs font-bold flex-1 truncate" style={{ color: dirColor }}>
      {dirLabel} {amount} {e?.label ? `— ${e.label}` : ""}
    </div>
  );
}

function renderDivergenceContent(ev: EventRow, fr: boolean) {
  const e = ev.evidence as any;
  const chips = e?.chips as { metric: string; diff_pct: number; severity: string }[] | undefined;
  const gravity = e?.gravity as number | undefined;
  const confidenceData = e?.confidence_data as number | undefined;

  if (chips && chips.length > 0) {
    const metricColors: Record<string, string> = {
      price: "rgba(229,57,53,0.8)", mc: "rgba(255,152,0,0.8)", fdv: "rgba(255,152,0,0.7)",
      liq: "rgba(255,193,7,0.8)", vol: "rgba(158,158,158,0.7)", supply: "rgba(100,181,246,0.7)",
    };
    return (
      <div className="font-mono text-[10px] flex-1 flex flex-wrap items-center gap-1">
        {chips.map((c, i) => {
          const col = metricColors[c.metric] || "rgba(255,255,255,0.4)";
          return (
            <span key={i} className="px-1.5 py-0.5 rounded font-bold"
              style={{ color: col, background: col.replace(/[\d.]+\)$/, "0.08)"), border: `1px solid ${col.replace(/[\d.]+\)$/, "0.2)")}` }}>
              {c.metric} {c.diff_pct}%
            </span>
          );
        })}
        {gravity != null && <span className="text-white/25 ml-1" title={fr ? "Score de gravité" : "Gravity score"}>G:{gravity}</span>}
        {confidenceData != null && <span className="text-white/20 ml-0.5" title={fr ? "Confiance données" : "Data confidence"}>C:{confidenceData}%</span>}
      </div>
    );
  }

  const divs = e?.divergences as { field: string; pct_diff: number }[] || [];
  return (
    <div className="font-mono text-[10px] text-white/40 flex-1 flex flex-wrap gap-1">
      {divs.slice(0, 3).map((d, i) => (
        <span key={i} className="px-1.5 py-0.5 rounded" style={{ background: "rgba(255,152,0,0.08)", border: "1px solid rgba(255,152,0,0.15)" }}>
          {d.field}: {d.pct_diff}%
        </span>
      ))}
      {divs.length > 3 && <span className="text-white/20">+{divs.length - 3}</span>}
    </div>
  );
}

function renderOverrideContentV2(ev: EventRow, fr: boolean) {
  const e = ev.evidence as any;
  const mpi = e?.mpi ?? "—";
  const quality = e?.quality ?? "—";
  return (
    <>
      <div className="font-mono text-[10px] text-white/40">MPI {mpi} · Q {quality}</div>
      <div className="flex-1"><OverrideChips evidence={e} fr={fr} /></div>
    </>
  );
}

function renderSmartContent(ev: EventRow, fr: boolean) {
  const e = ev.evidence as any;
  const intensity = e?.intensity ?? e?.score ?? null;
  return (
    <>
      {intensity != null && (
        <div className="font-mono text-[10px] font-bold" style={{ color: typeDisplayLabel(ev.type, fr ? "fr" : "en").color }}>
          {fr ? "Intensité" : "Intensity"}: {intensity}%
        </div>
      )}
      <div className="font-mono text-[10px] text-white/30 flex-1 truncate">{e?.reasons?.join(" · ") || e?.detail || "—"}</div>
    </>
  );
}

function renderStandardContent(ev: EventRow, fr: boolean) {
  const e = ev.evidence as any;
  const reasons = e?.reasons as string[] | undefined;
  const psi = e?.mpi ?? e?.psi ?? null;
  return (
    <>
      {psi != null && <div className="font-mono text-xs text-white/40">PSI {psi}</div>}
      <div className="font-mono text-[10px] text-white/30 flex-1 truncate">{reasons?.join(" · ") || "—"}</div>
    </>
  );
}

/* ═══════════════════════════════════════ */
/*   DELIST WATCHLIST VIEW                   */
/* ═══════════════════════════════════════ */

function DelistWatchlistView({ fr }: { fr: boolean }) {
  const { scores, scoresList, sparklines, taoUsd } = useSubnetScores();
  const { delistMode } = useDelistMode();
  const [compareMode, setCompareMode] = useState(false);

  const metricsForDelist: SubnetMetricsForDelist[] = useMemo(() => {
    if (!scoresList.length) return [];
    return scoresList.map(s => ({
      netuid: s.netuid,
      minersActive: 10,
      liqTao: s.displayedLiq > 0 && taoUsd > 0 ? s.displayedLiq / taoUsd : 0,
      liqUsd: s.displayedLiq,
      capTao: s.displayedCap > 0 && taoUsd > 0 ? s.displayedCap / taoUsd : 0,
      alphaPrice: s.alphaPrice ?? 0,
      volMcRatio: s.healthScores?.volumeHealth != null ? s.healthScores.volumeHealth / 1000 : 0.01,
      psi: s.psi,
      quality: s.quality,
      state: s.state,
      priceChange7d: (() => {
        const sp = sparklines?.get(s.netuid);
        if (!sp || sp.length < 2) return null;
        return ((sp[sp.length - 1] - sp[0]) / sp[0]) * 100;
      })(),
      confianceData: s.confianceScore,
      liqHaircut: s.recalc?.liqHaircut ?? 0,
    }));
  }, [scoresList, sparklines, taoUsd]);

  const delistResults = useMemo(() => {
    if (!metricsForDelist.length) return [];
    return evaluateAllDelistRisks(delistMode, metricsForDelist);
  }, [metricsForDelist, delistMode]);

  // Comparison data: Manual vs Auto side by side
  const comparisonData = useMemo(() => {
    if (!compareMode || !metricsForDelist.length) return [];
    const manualResults = evaluateAllDelistRisks("manual", metricsForDelist);
    const autoResults = evaluateAllDelistRisks("auto_taostats", metricsForDelist);

    const manualMap = new Map(manualResults.map(r => [r.netuid, r]));
    const autoMap = new Map(autoResults.map(r => [r.netuid, r]));

    // Union of all netuids flagged by either mode
    const allNetuids = new Set([...manualMap.keys(), ...autoMap.keys()]);
    const rows = Array.from(allNetuids).map(netuid => ({
      netuid,
      manual: manualMap.get(netuid) ?? null,
      auto: autoMap.get(netuid) ?? null,
    }));
    // Sort by max score descending
    rows.sort((a, b) => {
      const maxA = Math.max(a.manual?.score ?? 0, a.auto?.score ?? 0);
      const maxB = Math.max(b.manual?.score ?? 0, b.auto?.score ?? 0);
      return maxB - maxA;
    });
    return rows;
  }, [compareMode, metricsForDelist]);

  const depegPriority = delistResults.filter(r => r.category === "DEPEG_PRIORITY");
  const nearDelist = delistResults.filter(r => r.category === "HIGH_RISK_NEAR_DELIST");

  const modeLabel = delistMode === "manual"
    ? "Manual (Taoflute)"
    : delistMode === "auto_taostats" ? "Auto (Taostats)" : "Auto (TMC)";

  if (!compareMode && depegPriority.length === 0 && nearDelist.length === 0) {
    return (
      <div>
        <CompareToggle compareMode={compareMode} setCompareMode={setCompareMode} fr={fr} />
        <div className="text-center text-white/20 font-mono mt-10">
          {fr ? "Aucun subnet en risque de delist détecté." : "No delist risk detected."}
        </div>
      </div>
    );
  }

  if (compareMode) {
    return (
      <div className="space-y-4">
        <CompareToggle compareMode={compareMode} setCompareMode={setCompareMode} fr={fr} />
        <ComparisonTable data={comparisonData} fr={fr} scores={scores} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Source badge + Compare toggle */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-mono text-[9px] px-2 py-0.5 rounded"
          style={{ background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.4)", border: "1px solid rgba(255,255,255,0.08)" }}>
          {fr ? "Source" : "Source"}: {modeLabel}
        </span>
        <span className="font-mono text-[9px] text-white/20">
          {depegPriority.length + nearDelist.length} subnets
        </span>
        <CompareToggle compareMode={compareMode} setCompareMode={setCompareMode} fr={fr} />
      </div>

      {/* DEPEG PRIORITAIRE */}
      {depegPriority.length > 0 && (
        <div>
          <h3 className="font-mono text-xs tracking-widest mb-3 font-bold" style={{ color: "rgba(229,57,53,0.9)" }}>
            🔴 {fr ? "RISQUE DEREG" : "DEREG RISK"} ({depegPriority.length})
          </h3>
          <div className="space-y-1.5">
            {depegPriority.map(r => (
              <DelistRow key={r.netuid} result={r} fr={fr} scores={scores} />
            ))}
          </div>
        </div>
      )}

      {/* PROCHE DELIST */}
      {nearDelist.length > 0 && (
        <div>
          <h3 className="font-mono text-xs tracking-widest mb-3 font-bold" style={{ color: "rgba(255,152,0,0.85)" }}>
            🟠 {fr ? "PROCHE DELIST" : "NEAR DELIST"} ({nearDelist.length})
          </h3>
          <div className="space-y-1.5">
            {nearDelist.map(r => (
              <DelistRow key={r.netuid} result={r} fr={fr} scores={scores} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Compare Toggle Button ─── */
function CompareToggle({ compareMode, setCompareMode, fr }: { compareMode: boolean; setCompareMode: (v: boolean) => void; fr: boolean }) {
  return (
    <button
      onClick={() => setCompareMode(!compareMode)}
      className="font-mono text-[9px] px-2.5 py-1 rounded-md transition-all tracking-wider"
      style={{
        background: compareMode ? "rgba(156,39,176,0.12)" : "rgba(255,255,255,0.04)",
        color: compareMode ? "rgba(156,39,176,0.9)" : "rgba(255,255,255,0.35)",
        border: `1px solid ${compareMode ? "rgba(156,39,176,0.3)" : "rgba(255,255,255,0.08)"}`,
      }}>
      {compareMode ? "✕" : "⚖"} {fr ? "Comparaison" : "Compare"}
    </button>
  );
}

/* ─── Comparison Table ─── */
function ComparisonTable({ data, fr, scores }: {
  data: { netuid: number; manual: DelistRiskResult | null; auto: DelistRiskResult | null }[];
  fr: boolean;
  scores: Map<number, any>;
}) {
  const catBadge = (r: DelistRiskResult | null) => {
    if (!r) return <span className="font-mono text-[9px] text-white/15">—</span>;
    const col = delistCategoryColor(r.category);
    return (
      <span className="font-mono text-[9px] font-bold px-1.5 py-0.5 rounded"
        style={{ color: col, background: col.replace(/[\d.]+\)$/, "0.1)"), border: `1px solid ${col.replace(/[\d.]+\)$/, "0.2)")}` }}>
        {r.category === "DEPEG_PRIORITY" ? "DEREG" : r.category === "HIGH_RISK_NEAR_DELIST" ? (fr ? "PROCHE" : "NEAR") : "OK"}
      </span>
    );
  };

  const scoreBadge = (r: DelistRiskResult | null) => {
    if (!r) return <span className="font-mono text-sm text-white/10">—</span>;
    const col = delistCategoryColor(r.category);
    return <span className="font-mono text-sm font-bold" style={{ color: col }}>{r.score}</span>;
  };

  const matchIcon = (m: DelistRiskResult | null, a: DelistRiskResult | null) => {
    if (!m && !a) return null;
    if (m && a && m.category === a.category) return <span className="text-[10px]" title="Match">✅</span>;
    if (m && !a) return <span className="text-[10px]" title={fr ? "Manuel uniquement" : "Manual only"}>📋</span>;
    if (!m && a) return <span className="text-[10px]" title={fr ? "Auto uniquement" : "Auto only"}>🤖</span>;
    return <span className="text-[10px]" title={fr ? "Différent" : "Mismatch"}>⚠️</span>;
  };

  // Stats
  const matchCount = data.filter(d => d.manual && d.auto && d.manual.category === d.auto.category).length;
  const manualOnly = data.filter(d => d.manual && !d.auto).length;
  const autoOnly = data.filter(d => !d.manual && d.auto).length;
  const mismatch = data.filter(d => d.manual && d.auto && d.manual.category !== d.auto.category).length;

  return (
    <div className="space-y-4">
      {/* Stats bar */}
      <div className="flex flex-wrap gap-2 font-mono text-[9px]">
        <span className="px-2 py-0.5 rounded" style={{ background: "rgba(76,175,80,0.08)", color: "rgba(76,175,80,0.7)", border: "1px solid rgba(76,175,80,0.15)" }}>
          ✅ {fr ? "Accord" : "Match"}: {matchCount}
        </span>
        <span className="px-2 py-0.5 rounded" style={{ background: "rgba(255,152,0,0.08)", color: "rgba(255,152,0,0.7)", border: "1px solid rgba(255,152,0,0.15)" }}>
          ⚠️ {fr ? "Différent" : "Mismatch"}: {mismatch}
        </span>
        <span className="px-2 py-0.5 rounded" style={{ background: "rgba(156,39,176,0.08)", color: "rgba(156,39,176,0.7)", border: "1px solid rgba(156,39,176,0.15)" }}>
          📋 {fr ? "Manuel seul" : "Manual only"}: {manualOnly}
        </span>
        <span className="px-2 py-0.5 rounded" style={{ background: "rgba(100,181,246,0.08)", color: "rgba(100,181,246,0.7)", border: "1px solid rgba(100,181,246,0.15)" }}>
          🤖 {fr ? "Auto seul" : "Auto only"}: {autoOnly}
        </span>
      </div>

      {/* Table header */}
      <div className="grid grid-cols-[30px_80px_1fr_60px_70px_60px_70px] gap-1 font-mono text-[8px] tracking-widest text-white/25 px-2 pb-1"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        <span></span>
        <span>SUBNET</span>
        <span>NAME</span>
        <span className="text-center" style={{ color: "rgba(156,39,176,0.6)" }}>📋 SCORE</span>
        <span className="text-center" style={{ color: "rgba(156,39,176,0.6)" }}>{fr ? "CATÉG." : "CATEG."}</span>
        <span className="text-center" style={{ color: "rgba(100,181,246,0.6)" }}>🤖 SCORE</span>
        <span className="text-center" style={{ color: "rgba(100,181,246,0.6)" }}>{fr ? "CATÉG." : "CATEG."}</span>
      </div>

      {/* Rows */}
      <div className="space-y-0.5 max-h-[60vh] overflow-auto">
        {data.map(({ netuid, manual, auto }) => {
          const subnet = scores.get(netuid);
          const name = subnet?.name || "";
          return (
            <div key={netuid}
              className="grid grid-cols-[30px_80px_1fr_60px_70px_60px_70px] gap-1 items-center px-2 py-1.5 rounded-md transition-colors hover:bg-white/[0.02]"
              style={{ borderBottom: "1px solid rgba(255,255,255,0.02)" }}>
              {matchIcon(manual, auto)}
              <span className="font-mono text-[11px] text-white/60 font-bold">SN-{netuid}</span>
              <span className="font-mono text-[9px] text-white/25 truncate">{name}</span>
              <div className="text-center">{scoreBadge(manual)}</div>
              <div className="text-center">{catBadge(manual)}</div>
              <div className="text-center">{scoreBadge(auto)}</div>
              <div className="text-center">{catBadge(auto)}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DelistRow({ result, fr, scores }: { result: DelistRiskResult; fr: boolean; scores: Map<number, any> }) {
  const subnet = scores.get(result.netuid);
  const name = subnet?.name || `SN-${result.netuid}`;
  const catColor = delistCategoryColor(result.category);

  return (
    <div className="flex flex-wrap sm:flex-nowrap items-start sm:items-center gap-2 sm:gap-3 px-3 sm:px-4 py-3 rounded-lg"
      style={{ border: `1px solid ${catColor}20`, background: `${catColor}05` }}>

      {/* Score indicator */}
      <div className="font-mono text-lg font-bold min-w-[40px] text-center" style={{ color: catColor }}>
        {result.score}
      </div>

      {/* Subnet name */}
      <div className="font-mono text-xs min-w-[100px]">
        <span className="text-white/70 font-bold">SN-{result.netuid}</span>
        <span className="text-white/30 ml-1.5 text-[10px]">{name !== `SN-${result.netuid}` ? name : ""}</span>
        {subnetLinks(result.netuid)}
      </div>

      {/* Source badge */}
      <span className="font-mono text-[8px] px-1.5 py-0.5 rounded shrink-0"
        style={{
          background: result.source.includes("Manual") ? "rgba(156,39,176,0.08)" : "rgba(100,181,246,0.08)",
          color: result.source.includes("Manual") ? "rgba(156,39,176,0.7)" : "rgba(100,181,246,0.7)",
          border: `1px solid ${result.source.includes("Manual") ? "rgba(156,39,176,0.15)" : "rgba(100,181,246,0.15)"}`,
        }}>
        {result.source}
      </span>

      {/* Reason chips */}
      <div className="flex flex-wrap gap-1 flex-1">
        {result.reasons.slice(0, 5).map((reason, i) => (
          <span key={i} className="font-mono text-[9px] font-bold px-1.5 py-0.5 rounded"
            style={{
              color: reason.color,
              background: reason.color.replace(/[\d.]+\)$/, "0.08)"),
              border: `1px solid ${reason.color.replace(/[\d.]+\)$/, "0.2)")}`,
            }}>
            {fr ? reason.labelFr : reason.label}
            {reason.value != null && <span className="ml-0.5 opacity-60">({typeof reason.value === "number" ? (reason.value < 1 ? reason.value.toFixed(2) : Math.round(reason.value)) : reason.value})</span>}
          </span>
        ))}
      </div>

      {/* Action */}
      <div className="font-mono text-[10px] font-bold px-2 py-1 rounded shrink-0"
        style={{
          background: result.category === "DEPEG_PRIORITY" ? "rgba(229,57,53,0.1)" : "rgba(255,152,0,0.08)",
          color: result.category === "DEPEG_PRIORITY" ? "rgba(229,57,53,0.9)" : "rgba(255,152,0,0.8)",
          border: `1px solid ${result.category === "DEPEG_PRIORITY" ? "rgba(229,57,53,0.25)" : "rgba(255,152,0,0.2)"}`,
        }}>
        {result.category === "DEPEG_PRIORITY"
          ? (fr ? "🔴 SORTIR" : "🔴 EXIT")
          : (fr ? "🟡 ATTENDRE" : "🟡 WAIT")}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════ */
/*   MAIN PAGE                              */
/* ═══════════════════════════════════════ */
export default function AlertsPage() {
  const { t, lang } = useI18n();
  const [filter, setFilter] = useState<FilterType>("UNIQUE");
  const [showOverrideNoise, setShowOverrideNoise] = useState(false);
  const [showNoise, setShowNoise] = useState(false);
  const [confidenceFilter, setConfidenceFilter] = useState(false);
  const [dismissed, setDismissed] = useState<Map<string, number>>(() => getDismissedAlerts());
  const fr = lang === "fr";
  const { mode: overrideMode } = useOverrideMode();
  const { scores } = useSubnetScores();
  const { state: pushState, subscribe: pushSubscribe, unsubscribe: pushUnsubscribe, error: pushError } = usePushNotifications();

  const handleDismiss = useCallback((key: string) => {
    dismissAlert(key);
    setDismissed(getDismissedAlerts());
  }, []);

  const { data: events } = useQuery({
    queryKey: ["events-log"],
    queryFn: async () => {
      const { data, error } = await supabase.from("events").select("*").order("ts", { ascending: false }).limit(500);
      if (error) throw error;
      return (data || []) as EventRow[];
    },
    refetchInterval: 60_000,
  });

  const grouped = useMemo(() => {
    if (!events) return [];
    return groupEvents(events);
  }, [events]);

  const { gatedOverrides, noiseOverrides, otherGrouped } = useMemo(() => {
    // DATA_DIVERGENCE events are no longer filtered/displayed as alerts
    const filterOutDivergence = (g: GroupedEvent): boolean => {
      return g.latest.type !== "DATA_DIVERGENCE";
    };

    if (overrideMode === "permissive") {
      return {
        gatedOverrides: grouped.filter(g => g.latest.type === "RISK_OVERRIDE"),
        noiseOverrides: [] as GroupedEvent[],
        otherGrouped: grouped.filter(g => g.latest.type !== "RISK_OVERRIDE").filter(filterOutDivergence),
      };
    }

    const overrides: GroupedEvent[] = [];
    const others: GroupedEvent[] = [];
    for (const g of grouped) {
      if (g.latest.type === "RISK_OVERRIDE") overrides.push(g);
      else others.push(g);
    }

    const gated: GroupedEvent[] = [];
    const noise: GroupedEvent[] = [];
    for (const g of overrides) {
      if (passesStrictGating(g.latest, scores)) gated.push(g);
      else noise.push(g);
    }

    return { gatedOverrides: gated, noiseOverrides: noise, otherGrouped: others.filter(filterOutDivergence) };
  }, [grouped, overrideMode, scores]);

  const STRATEGIC_TYPES = useMemo(() => new Set(["GO", "GO_SPECULATIVE", "EARLY", "BREAK", "EXIT_FAST"]), []);

  // Apply confidence filter
  const applyConfidenceFilter = useCallback((g: GroupedEvent): boolean => {
    if (!confidenceFilter) return true;
    if (g.latest.netuid == null || !scores) return true;
    const subnet = scores.get(g.latest.netuid);
    if (!subnet) return true;
    return (subnet.confianceScore ?? 0) >= 70;
  }, [confidenceFilter, scores]);

  // Apply dismissed filter
  const applyDismissedFilter = useCallback((g: GroupedEvent): boolean => {
    return !isDismissed(alertKey(g), dismissed);
  }, [dismissed]);

  const filtered = useMemo(() => {
    let result: GroupedEvent[];

    if (filter === "ALL") {
      result = (events || []).map(ev => ({
        key: `single-${ev.id}`, latest: ev, occurrences: [ev], count: 1,
        firstTs: ev.ts || "", lastTs: ev.ts || "",
      } as GroupedEvent));
    } else if (filter === "OVERRIDE") {
      const visible = overrideMode === "strict"
        ? gatedOverrides.slice(0, showOverrideNoise ? Infinity : OVERRIDE_QUOTA)
        : gatedOverrides;
      result = showOverrideNoise && overrideMode === "strict" ? [...visible, ...noiseOverrides] : visible;
    } else if (filter === "UNIQUE") {
      const visibleOverrides = overrideMode === "strict" ? gatedOverrides.slice(0, OVERRIDE_QUOTA) : gatedOverrides;
      const merged = [...visibleOverrides, ...otherGrouped];
      merged.sort((a, b) => new Date(b.lastTs).getTime() - new Date(a.lastTs).getTime());
      result = merged;
    } else if (filter === "STRATEGIC") {
      result = grouped.filter(g => STRATEGIC_TYPES.has(g.latest.type || ""));
    } else if (filter === "STATE") {
      result = grouped.filter(g => eventCategory(g.latest.type) === "STATE");
    } else {
      result = grouped.filter(g => eventCategory(g.latest.type) === filter);
    }

    // Apply confidence + dismissed filters
    return result.filter(applyConfidenceFilter).filter(applyDismissedFilter);
  }, [grouped, events, filter, gatedOverrides, noiseOverrides, otherGrouped, overrideMode, showOverrideNoise, applyConfidenceFilter, applyDismissedFilter]);

  // Essential vs noise split
  const { essential, noise: noiseEvents } = useMemo(() => {
    const ess: GroupedEvent[] = [];
    const noi: GroupedEvent[] = [];
    for (const g of filtered) {
      if (isEssentialEvent(g, scores)) ess.push(g);
      else noi.push(g);
    }
    return { essential: ess, noise: noi };
  }, [filtered, scores]);

  const displayedEvents = showNoise ? filtered : essential;

  const stats = useMemo(() => {
    const total = events?.length || 0;
    const uniqueGroups = grouped.length;
    const overrides = gatedOverrides.length;
    const noiseCount = noiseOverrides.length;
    const compressionPct = total > 0 ? Math.round((1 - uniqueGroups / total) * 100) : 0;
    const dismissedCount = dismissed.size;
    const strategicCount = grouped.filter(g => STRATEGIC_TYPES.has(g.latest.type || "")).length;
    return { total, uniqueGroups, overrides, noiseCount, compressionPct, essentialCount: essential.length, noiseEventsCount: noiseEvents.length, dismissedCount, strategicCount };
  }, [events, grouped, gatedOverrides, noiseOverrides, essential, noiseEvents, dismissed, STRATEGIC_TYPES]);


  const filterOptions: { value: FilterType; label: string; count?: number }[] = [
    { value: "UNIQUE", label: fr ? "Groupés" : "Grouped", count: stats.uniqueGroups },
    { value: "ALL", label: fr ? "Tout" : "All", count: stats.total },
    { value: "STRATEGIC", label: fr ? "🎯 Stratégiques" : "🎯 Strategic", count: stats.strategicCount },
    { value: "OVERRIDE", label: "⛔ Overrides", count: stats.overrides },
    { value: "WHALE", label: "🐋 Whales" },
    { value: "STATE", label: fr ? "🔴 États" : "🔴 States" },
    { value: "SMART", label: "🧠 Smart" },
  ];

  return (
    <div className="h-full w-full bg-[#000] text-white p-4 sm:p-6 overflow-auto pt-14">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4 sm:mb-6 flex-wrap ml-28">
        <h1 className="font-mono text-base sm:text-lg tracking-widest text-white/80">{t("alerts.title")}</h1>
        {stats.compressionPct > 0 && (
          <span className="font-mono text-[9px] px-2 py-0.5 rounded"
            style={{ background: "rgba(76,175,80,0.08)", color: "rgba(76,175,80,0.7)", border: "1px solid rgba(76,175,80,0.15)" }}>
            −{stats.compressionPct}% {fr ? "bruit" : "noise"}
          </span>
        )}
        {overrideMode === "strict" && stats.noiseCount > 0 && (
          <span className="font-mono text-[9px] px-2 py-0.5 rounded"
            style={{ background: "rgba(255,152,0,0.08)", color: "rgba(255,152,0,0.6)", border: "1px solid rgba(255,152,0,0.15)" }}>
            🛡 Strict · {stats.noiseCount} {fr ? "filtrés" : "filtered"}
          </span>
        )}

        {/* Push notification toggle */}
        <div className="ml-auto">
          {pushState === "unsupported" ? (
            <span className="font-mono text-[9px] text-white/20">
              {fr ? "Push non supporté" : "Push not supported"}
            </span>
          ) : pushState === "denied" ? (
            <span className="font-mono text-[9px] px-2 py-1 rounded"
              style={{ color: "rgba(229,57,53,0.7)", background: "rgba(229,57,53,0.08)", border: "1px solid rgba(229,57,53,0.15)" }}>
              🔇 {fr ? "Notifications bloquées" : "Notifications blocked"}
            </span>
          ) : pushState === "subscribed" ? (
            <button onClick={pushUnsubscribe}
              className="font-mono text-[9px] px-2.5 py-1 rounded-md transition-all tracking-wider"
              style={{ background: "rgba(76,175,80,0.1)", color: "rgba(76,175,80,0.9)", border: "1px solid rgba(76,175,80,0.25)" }}>
              🔔 {fr ? "Push activé" : "Push enabled"} ✓
            </button>
          ) : pushState === "loading" ? (
            <span className="font-mono text-[9px] text-white/30 animate-pulse">
              {fr ? "Chargement…" : "Loading…"}
            </span>
          ) : (
            <button onClick={pushSubscribe}
              className="font-mono text-[9px] px-2.5 py-1 rounded-md transition-all tracking-wider hover:bg-white/5"
              style={{ color: "rgba(255,215,0,0.7)", border: "1px solid rgba(255,215,0,0.15)" }}>
              🔕 {fr ? "Activer les push" : "Enable push"}
            </button>
          )}
          {pushError && (
            <span className="font-mono text-[8px] text-red-400/60 ml-2">{pushError}</span>
          )}
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <div className="flex rounded-lg overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.08)" }}>
          {filterOptions.map(opt => (
            <button key={opt.value}
              onClick={() => { setFilter(opt.value); setShowOverrideNoise(false); }}
              className="font-mono text-[10px] sm:text-[11px] tracking-wider px-2.5 sm:px-3 py-2 transition-all"
              style={{
                background: filter === opt.value ? "rgba(255,215,0,0.1)" : "transparent",
                color: filter === opt.value ? "rgba(255,215,0,0.9)" : "rgba(255,255,255,0.35)",
                fontWeight: filter === opt.value ? 700 : 400,
              }}>
              {opt.label}
              {opt.count != null && <span className="ml-1 text-[8px]" style={{ opacity: 0.5 }}>({opt.count})</span>}
            </button>
          ))}
        </div>
      </div>

      {/* Essential controls bar */}
      <div className="flex items-center gap-2 mb-5 flex-wrap">
        {/* Essential / Total counters */}
        <span className="font-mono text-[9px] px-2 py-0.5 rounded font-bold"
          style={{ background: "rgba(76,175,80,0.08)", color: "rgba(76,175,80,0.8)", border: "1px solid rgba(76,175,80,0.15)" }}>
          {fr ? "Essentiel" : "Essential"} ({stats.essentialCount})
        </span>
        <span className="font-mono text-[9px] px-2 py-0.5 rounded"
          style={{ background: "rgba(255,255,255,0.03)", color: "rgba(255,255,255,0.3)", border: "1px solid rgba(255,255,255,0.06)" }}>
          Total ({filtered.length})
        </span>

        {/* Show noise toggle */}
        <button
          onClick={() => setShowNoise(!showNoise)}
          className="font-mono text-[9px] px-2.5 py-1 rounded-md transition-all tracking-wider"
          style={{
            background: showNoise ? "rgba(255,152,0,0.1)" : "rgba(255,255,255,0.03)",
            color: showNoise ? "rgba(255,152,0,0.8)" : "rgba(255,255,255,0.25)",
            border: `1px solid ${showNoise ? "rgba(255,152,0,0.25)" : "rgba(255,255,255,0.06)"}`,
          }}>
          {showNoise
            ? (fr ? `✕ Masquer bruit (${stats.noiseEventsCount})` : `✕ Hide noise (${stats.noiseEventsCount})`)
            : (fr ? `👁 Afficher le bruit (${stats.noiseEventsCount})` : `👁 Show noise (${stats.noiseEventsCount})`)}
        </button>

        {/* Confidence filter */}
        <button
          onClick={() => setConfidenceFilter(!confidenceFilter)}
          className="font-mono text-[9px] px-2.5 py-1 rounded-md transition-all tracking-wider"
          style={{
            background: confidenceFilter ? "rgba(100,181,246,0.1)" : "rgba(255,255,255,0.03)",
            color: confidenceFilter ? "rgba(100,181,246,0.8)" : "rgba(255,255,255,0.25)",
            border: `1px solid ${confidenceFilter ? "rgba(100,181,246,0.25)" : "rgba(255,255,255,0.06)"}`,
          }}>
          {fr ? "Confiance ≥ 70%" : "Confidence ≥ 70%"} {confidenceFilter ? "✓" : ""}
        </button>

        {/* Dismissed count */}
        {stats.dismissedCount > 0 && (
          <span className="font-mono text-[9px] text-white/20">
            {stats.dismissedCount} {fr ? "traités" : "dismissed"}
          </span>
        )}
      </div>

      {/* STATE filter: show DEPEG/DELIST WATCHLIST + state events */}
      {filter === "STATE" ? (
        <div className="space-y-8">
          <DelistWatchlistView fr={fr} />

          {/* Also show state-change events below */}
          <div>
            <h3 className="font-mono text-xs tracking-widest text-white/40 mb-3">
              {fr ? "CHANGEMENTS D'ÉTAT RÉCENTS" : "RECENT STATE CHANGES"}
            </h3>
            {displayedEvents.length === 0 ? (
              <div className="text-center text-white/20 font-mono mt-4">{t("alerts.empty")}</div>
            ) : (
              <div className="space-y-1.5">
                {displayedEvents.map(group => (
                  <ExpandableEventRow key={group.key} group={group} lang={lang} onDismiss={handleDismiss} />
                ))}
              </div>
            )}
          </div>
        </div>
      ) : (
        <>
          {(!displayedEvents || displayedEvents.length === 0) ? (
            <div className="text-center text-white/20 font-mono mt-20">{t("alerts.empty")}</div>
          ) : (
            <div className="space-y-1.5">
              {displayedEvents.map(group => (
                <ExpandableEventRow key={group.key} group={group} lang={lang} onDismiss={handleDismiss} />
              ))}
            </div>
          )}
        </>
      )}

      {filter === "OVERRIDE" && overrideMode === "strict" && !showOverrideNoise && noiseOverrides.length > 0 && (
        <div className="mt-4 text-center">
          <button
            onClick={() => setShowOverrideNoise(true)}
            className="font-mono text-[10px] px-4 py-2 rounded-lg transition-all hover:bg-white/5"
            style={{ color: "rgba(255,255,255,0.3)", border: "1px solid rgba(255,255,255,0.08)" }}>
            {fr ? `Voir tout (bruit) — ${noiseOverrides.length} alertes filtrées` : `Show all (noise) — ${noiseOverrides.length} filtered alerts`}
          </button>
        </div>
      )}
    </div>
  );
}
