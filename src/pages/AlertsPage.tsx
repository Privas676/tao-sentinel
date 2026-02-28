import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { useMemo, useState } from "react";
import { useSubnetScores } from "@/hooks/use-subnet-scores";
import { useOverrideMode } from "@/hooks/use-override-mode";

type EventRow = {
  id: number;
  netuid: number | null;
  type: string | null;
  severity: number | null;
  ts: string | null;
  evidence: any;
};

type FilterType = "ALL" | "UNIQUE" | "OVERRIDE" | "DATA" | "WHALE" | "STATE" | "SMART";

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
const OVERRIDE_QUOTA = 10;

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

/** Classify event type into filter category */
function eventCategory(type: string | null): FilterType {
  if (type === "WHALE_MOVE") return "WHALE";
  if (type === "DATA_DIVERGENCE") return "DATA";
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

/**
 * Group events by (type, netuid) within 6h sliding windows.
 * Events are already sorted desc by ts from the query.
 */
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
        if (evTs > latestTs) {
          bucket.latest = ev;
          bucket.lastTs = ev.ts!;
        }
        if (evTs < firstTs) {
          bucket.firstTs = ev.ts!;
        }
        placed = true;
        break;
      }
    }

    if (!placed) {
      buckets.push({
        key: `${key}::${ev.id}`,
        latest: ev,
        occurrences: [ev],
        count: 1,
        firstTs: ev.ts || new Date().toISOString(),
        lastTs: ev.ts || new Date().toISOString(),
      });
    }
  }

  const all: GroupedEvent[] = [];
  for (const buckets of groups.values()) {
    all.push(...buckets);
  }
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

/* ─── Strict gating check for OVERRIDE alerts ─── */
function passesStrictGating(
  ev: EventRow,
  scores: Map<number, any> | undefined,
): boolean {
  if (ev.type !== "RISK_OVERRIDE") return true; // non-override always passes
  if (!scores || ev.netuid == null) return false;

  const subnet = scores.get(ev.netuid);
  if (!subnet) return false;

  const evidence = ev.evidence as any;
  const risk = subnet.risk ?? 0;
  const confidence = subnet.confianceScore ?? 0;

  // Gate (a): Risk ≥ 70
  if (risk < 70) return false;
  // Gate (b): Confidence ≥ 70%
  if (confidence < 70) return false;
  // Gate (c): ≥ 2 critical signals from evidence
  const hardConditions = (evidence?.hardConditions as string[]) || (evidence?.reasons as string[]) || [];
  if (hardConditions.length < 2) return false;

  return true;
}

/* ═══════════════════════════════════════ */
/*   OVERRIDE REASON CHIPS COMPONENT       */
/* ═══════════════════════════════════════ */
function OverrideChips({ evidence, fr }: { evidence: any; fr: boolean }) {
  const hardConditions = (evidence?.hardConditions as string[]) || [];
  const reasons = (evidence?.reasons as string[]) || [];

  // Try to map hardConditions to structured chips first
  const chips: { label: string; color: string }[] = [];
  for (const hc of hardConditions) {
    const chip = OVERRIDE_CHIP_MAP[hc];
    if (chip) {
      chips.push({ label: fr ? chip.labelFr : chip.label, color: chip.color });
    }
  }

  // If no hardConditions mapped, fall back to reasons as text chips
  if (chips.length === 0) {
    for (const r of reasons.slice(0, 4)) {
      // Try to detect known patterns
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

/* ═══════════════════════════════════════ */
/*   EXPANDABLE EVENT ROW                   */
/* ═══════════════════════════════════════ */
function ExpandableEventRow({ group, lang }: { group: GroupedEvent; lang: string }) {
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
        
        <div className="font-mono text-xs tracking-wider font-bold min-w-[120px]" style={{ color }}>
          {icon} {label}
        </div>

        <div className="font-mono text-xs text-white/50 min-w-[60px]">
          SN-{ev.netuid} {subnetLinks(ev.netuid)}
        </div>

        {renderMainContent()}

        <div className="flex items-center gap-2 ml-auto flex-shrink-0">
          {isMultiple && (
            <span className="font-mono text-[10px] px-2 py-0.5 rounded-full font-bold"
              style={{ background: `${color}18`, color, border: `1px solid ${color}30` }}>
              ×{group.count}
            </span>
          )}
          <span className="font-mono text-[10px] text-white/25">
            {formatTimeAgo(group.lastTs, fr)}
          </span>
          {isMultiple && (
            <span className="font-mono text-[9px] text-white/20 transition-transform" style={{ transform: expanded ? "rotate(180deg)" : "rotate(0deg)" }}>
              ▼
            </span>
          )}
        </div>
      </div>

      {expanded && isMultiple && (
        <div className="border-t px-4 py-2 space-y-1" style={{ borderColor: `${color}15`, background: `${color}05` }}>
          <div className="font-mono text-[9px] text-white/30 tracking-widest mb-1.5">
            {fr ? "OCCURRENCES" : "OCCURRENCES"} ({group.count}) — {fr ? "fenêtre" : "window"} 6h
          </div>
          {group.occurrences.map((occ, idx) => (
            <div key={occ.id} className="flex items-center gap-3 py-1 font-mono text-[10px]"
              style={{ borderBottom: idx < group.occurrences.length - 1 ? "1px solid rgba(255,255,255,0.03)" : "none" }}>
              <span className="text-white/15 w-5">{idx + 1}</span>
              <span className="text-white/25 min-w-[130px]">
                {occ.ts ? new Date(occ.ts).toLocaleString() : "—"}
              </span>
              <span className="text-white/40 flex-1 truncate">
                {renderOccurrenceDetail(occ)}
              </span>
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
  const divs = e?.divergences as { field: string; pct_diff: number }[] || [];
  return (
    <div className="font-mono text-[10px] text-white/40 flex-1 flex flex-wrap gap-1">
      {divs.slice(0, 3).map((d, i) => (
        <span key={i} className="px-1.5 py-0.5 rounded"
          style={{ background: "rgba(255,152,0,0.08)", border: "1px solid rgba(255,152,0,0.15)" }}>
          {d.field}: {d.pct_diff}%
        </span>
      ))}
      {divs.length > 3 && <span className="text-white/20">+{divs.length - 3}</span>}
    </div>
  );
}

/** V2: Override content with structured chips */
function renderOverrideContentV2(ev: EventRow, fr: boolean) {
  const e = ev.evidence as any;
  const mpi = e?.mpi ?? "—";
  const quality = e?.quality ?? "—";
  return (
    <>
      <div className="font-mono text-[10px] text-white/40">MPI {mpi} · Q {quality}</div>
      <div className="flex-1">
        <OverrideChips evidence={e} fr={fr} />
      </div>
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
      <div className="font-mono text-[10px] text-white/30 flex-1 truncate">
        {e?.reasons?.join(" · ") || e?.detail || "—"}
      </div>
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
/*   MAIN PAGE                              */
/* ═══════════════════════════════════════ */
export default function AlertsPage() {
  const { t, lang } = useI18n();
  const [filter, setFilter] = useState<FilterType>("UNIQUE");
  const [showOverrideNoise, setShowOverrideNoise] = useState(false);
  const fr = lang === "fr";
  const { mode: overrideMode } = useOverrideMode();
  const { scores } = useSubnetScores();

  const { data: events } = useQuery({
    queryKey: ["events-log"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("events")
        .select("*")
        .order("ts", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data || []) as EventRow[];
    },
    refetchInterval: 60_000,
  });

  // Group events by (type, netuid) within 6h sliding windows
  const grouped = useMemo(() => {
    if (!events) return [];
    return groupEvents(events);
  }, [events]);

  // Separate OVERRIDE alerts into gated vs noise (strict mode only)
  const { gatedOverrides, noiseOverrides, otherGrouped } = useMemo(() => {
    if (overrideMode === "permissive") {
      return { gatedOverrides: grouped.filter(g => g.latest.type === "RISK_OVERRIDE"), noiseOverrides: [] as GroupedEvent[], otherGrouped: grouped.filter(g => g.latest.type !== "RISK_OVERRIDE") };
    }

    const overrides: GroupedEvent[] = [];
    const others: GroupedEvent[] = [];
    for (const g of grouped) {
      if (g.latest.type === "RISK_OVERRIDE") {
        overrides.push(g);
      } else {
        others.push(g);
      }
    }

    // Apply strict gating
    const gated: GroupedEvent[] = [];
    const noise: GroupedEvent[] = [];
    for (const g of overrides) {
      if (passesStrictGating(g.latest, scores)) {
        gated.push(g);
      } else {
        noise.push(g);
      }
    }

    return { gatedOverrides: gated, noiseOverrides: noise, otherGrouped: others };
  }, [grouped, overrideMode, scores]);

  // Apply filters with quota
  const filtered = useMemo(() => {
    if (filter === "ALL") {
      return (events || []).map(ev => ({
        key: `single-${ev.id}`,
        latest: ev,
        occurrences: [ev],
        count: 1,
        firstTs: ev.ts || "",
        lastTs: ev.ts || "",
      } as GroupedEvent));
    }

    if (filter === "OVERRIDE") {
      const visible = overrideMode === "strict"
        ? gatedOverrides.slice(0, showOverrideNoise ? Infinity : OVERRIDE_QUOTA)
        : gatedOverrides;
      if (showOverrideNoise && overrideMode === "strict") {
        return [...visible, ...noiseOverrides];
      }
      return visible;
    }

    if (filter === "UNIQUE") {
      // Merge gated overrides (up to quota) + others
      const visibleOverrides = overrideMode === "strict"
        ? gatedOverrides.slice(0, OVERRIDE_QUOTA)
        : gatedOverrides;
      const merged = [...visibleOverrides, ...otherGrouped];
      merged.sort((a, b) => new Date(b.lastTs).getTime() - new Date(a.lastTs).getTime());
      return merged;
    }

    // Other category filters
    return grouped.filter(g => eventCategory(g.latest.type) === filter);
  }, [grouped, events, filter, gatedOverrides, noiseOverrides, otherGrouped, overrideMode, showOverrideNoise]);

  // Stats
  const stats = useMemo(() => {
    const total = events?.length || 0;
    const uniqueGroups = grouped.length;
    const overrides = gatedOverrides.length;
    const noiseCount = noiseOverrides.length;
    const compressionPct = total > 0 ? Math.round((1 - uniqueGroups / total) * 100) : 0;
    return { total, uniqueGroups, overrides, noiseCount, compressionPct };
  }, [events, grouped, gatedOverrides, noiseOverrides]);

  const filterOptions: { value: FilterType; label: string; count?: number }[] = [
    { value: "UNIQUE", label: fr ? "Groupés" : "Grouped", count: stats.uniqueGroups },
    { value: "ALL", label: fr ? "Tout" : "All", count: stats.total },
    { value: "OVERRIDE", label: "⛔ Overrides", count: stats.overrides },
    { value: "DATA", label: "⚠ Data" },
    { value: "WHALE", label: "🐋 Whales" },
    { value: "STATE", label: fr ? "États" : "States" },
    { value: "SMART", label: "🧠 Smart" },
  ];

  return (
    <div className="h-full w-full bg-[#000] text-white p-4 sm:p-6 overflow-auto pt-14">
      <div className="flex items-center gap-3 mb-4 sm:mb-6">
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
            🛡 {fr ? "Strict" : "Strict"} · {stats.noiseCount} {fr ? "filtrés" : "filtered"}
          </span>
        )}
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-2 mb-5 flex-wrap">
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
              {opt.count != null && (
                <span className="ml-1 text-[8px]" style={{ opacity: 0.5 }}>({opt.count})</span>
              )}
            </button>
          ))}
        </div>
        <span className="font-mono text-[10px] text-white/20 ml-2">
          {filtered.length} {fr ? "lignes" : "rows"}
        </span>
      </div>

      {(!filtered || filtered.length === 0) ? (
        <div className="text-center text-white/20 font-mono mt-20">{t("alerts.empty")}</div>
      ) : (
        <div className="space-y-1.5">
          {filtered.map(group => (
            <ExpandableEventRow key={group.key} group={group} lang={lang} />
          ))}
        </div>
      )}

      {/* "See all noise" button for OVERRIDE filter in strict mode */}
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
