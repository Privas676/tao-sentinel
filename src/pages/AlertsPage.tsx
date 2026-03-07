import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { useMemo, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { useSubnetScores } from "@/hooks/use-subnet-scores";
import { useOverrideMode } from "@/hooks/use-override-mode";
import { useLocalPortfolio } from "@/hooks/use-local-portfolio";
import { SectionCard, SectionTitle } from "@/components/settings/SettingsShared";

/* ═══════════════════════════════════════════════════════ */
/*   RISK & ALERTS — Decision Vigilance Center             */
/* ═══════════════════════════════════════════════════════ */

/* ── Design tokens ── */
const GOLD = "hsl(var(--gold))";
const GO = "hsl(var(--signal-go))";
const WARN = "hsl(var(--signal-go-spec))";
const BREAK = "hsl(var(--signal-break))";
const MUTED = "hsl(var(--muted-foreground))";

/* ── KPI chip ── */
function KPIChip({ label, value, color, sub }: { label: string; value: string | number; color?: string; sub?: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg px-2 py-2.5 bg-muted/25 border border-border min-w-0">
      <span className="font-mono text-[7px] text-muted-foreground tracking-[0.18em] uppercase leading-none mb-1">{label}</span>
      <span className="font-mono text-[14px] font-bold leading-none" style={{ color }}>{value}</span>
      {sub && <span className="font-mono text-[8px] text-muted-foreground mt-0.5">{sub}</span>}
    </div>
  );
}

/* ── Types ── */
type EventRow = {
  id: number;
  netuid: number | null;
  type: string | null;
  severity: number | null;
  ts: string | null;
  evidence: any;
};

type GroupedEvent = {
  key: string;
  latest: EventRow;
  occurrences: EventRow[];
  count: number;
  firstTs: string;
  lastTs: string;
};

type TabType = "ALL" | "CRITICAL" | "WARNING" | "OVERRIDE" | "PORTFOLIO";

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
const DISMISSED_KEY = "alerts-dismissed";

/* ── Dismissed helpers ── */
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

function alertKey(g: GroupedEvent): string {
  return `${g.latest.type}::${g.latest.netuid}::${g.lastTs?.slice(0, 13) ?? ""}`;
}

/* ── Grouping logic ── */
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

/* ── Override gating ── */
function passesStrictGating(ev: EventRow, scores: Map<number, any> | undefined): boolean {
  if (ev.type !== "RISK_OVERRIDE") return true;
  if (!scores || ev.netuid == null) return false;
  const subnet = scores.get(ev.netuid);
  if (!subnet) return false;
  const risk = subnet.risk ?? 0;
  const confidence = subnet.confianceScore ?? 0;
  if (risk < 70 || confidence < 70) return false;
  const hardConditions = (ev.evidence?.hardConditions as string[]) || (ev.evidence?.reasons as string[]) || [];
  return hardConditions.length >= 2;
}

/* ── Classification ── */
const CRITICAL_TYPES = new Set(["BREAK", "EXIT_FAST", "DEPEG_CRITICAL", "RISK_OVERRIDE"]);
const WARNING_TYPES = new Set(["DEPEG_WARNING", "WHALE_MOVE", "GO_SPECULATIVE", "DATA_DIVERGENCE"]);

function alertSeverityClass(type: string | null): "critical" | "warning" | "info" {
  if (CRITICAL_TYPES.has(type || "")) return "critical";
  if (WARNING_TYPES.has(type || "")) return "warning";
  return "info";
}

function severityBadge(sev: "critical" | "warning" | "info"): { label: string; color: string } {
  if (sev === "critical") return { label: "CRITICAL", color: BREAK };
  if (sev === "warning") return { label: "WARNING", color: WARN };
  return { label: "INFO", color: MUTED };
}

/* ── Display helpers ── */
function typeDisplayInfo(type: string | null, fr: boolean): { label: string; icon: string; color: string } {
  switch (type) {
    case "BREAK":
    case "EXIT_FAST":
      return { label: fr ? "ZONE CRITIQUE" : "CRITICAL ZONE", icon: "⛔", color: BREAK };
    case "GO":
      return { label: "GO", icon: "🟢", color: GO };
    case "GO_SPECULATIVE":
      return { label: fr ? "SPÉCULATIF" : "SPECULATIVE", icon: "🔶", color: WARN };
    case "EARLY":
      return { label: "EARLY", icon: "🌱", color: GO };
    case "HOLD":
      return { label: "HOLD", icon: "⏸", color: MUTED };
    case "DEPEG_WARNING":
      return { label: fr ? "DÉPEG ⚠" : "DEPEG ⚠", icon: "⚠", color: WARN };
    case "DEPEG_CRITICAL":
      return { label: fr ? "DÉPEG CRITIQUE" : "DEPEG CRITICAL", icon: "🔴", color: BREAK };
    case "WHALE_MOVE":
      return { label: "WHALE", icon: "🐋", color: GOLD };
    case "RISK_OVERRIDE":
      return { label: "OVERRIDE", icon: "🛡", color: BREAK };
    case "PRE_HYPE":
    case "PRÉ-HYPE":
      return { label: "PRE-HYPE", icon: "🚀", color: "hsl(280, 65%, 55%)" };
    case "SMART_ACCUMULATION":
      return { label: "SMART ACCUM.", icon: "🧠", color: "hsl(187, 100%, 42%)" };
    case "CREATED":
      return { label: fr ? "NOUVEAU" : "NEW", icon: "✨", color: "hsl(210, 80%, 55%)" };
    default:
      return { label: type || "—", icon: "•", color: MUTED };
  }
}

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

function suggestedAction(type: string | null, evidence: any, fr: boolean): string {
  if (type === "BREAK" || type === "EXIT_FAST") return fr ? "Sortir immédiatement" : "Exit immediately";
  if (type === "DEPEG_CRITICAL") return fr ? "Sortir ou réduire" : "Exit or reduce";
  if (type === "DEPEG_WARNING") return fr ? "Surveiller / Réduire" : "Monitor / Reduce";
  if (type === "RISK_OVERRIDE") return fr ? "Ne pas entrer" : "Do not enter";
  if (type === "WHALE_MOVE") {
    const dir = evidence?.direction;
    if (dir === "OUT") return fr ? "Prudence — sortie whale" : "Caution — whale exit";
    return fr ? "Observer — entrée whale" : "Watch — whale entry";
  }
  if (type === "GO" || type === "EARLY") return fr ? "Opportunité" : "Opportunity";
  if (type === "GO_SPECULATIVE") return fr ? "Évaluer le risque" : "Evaluate risk";
  if (type === "PRE_HYPE" || type === "PRÉ-HYPE" || type === "SMART_ACCUMULATION") return fr ? "Surveiller de près" : "Watch closely";
  return fr ? "Aucune action" : "No action";
}

function alertImpact(type: string | null, fr: boolean): string {
  if (type === "BREAK" || type === "EXIT_FAST") return fr ? "Perte potentielle majeure" : "Major potential loss";
  if (type === "DEPEG_CRITICAL") return fr ? "Risque de perte totale" : "Total loss risk";
  if (type === "DEPEG_WARNING") return fr ? "Dégradation structure" : "Structure degradation";
  if (type === "RISK_OVERRIDE") return fr ? "Blocage engine" : "Engine block";
  if (type === "WHALE_MOVE") return fr ? "Pression prix" : "Price pressure";
  if (type === "GO" || type === "EARLY") return fr ? "Signal d'entrée" : "Entry signal";
  return "—";
}

/* ── Override chips ── */
const OVERRIDE_CHIP_MAP: Record<string, { label: string; labelFr: string }> = {
  "EMISSION_ZERO": { label: "Emission drop", labelFr: "Émission nulle" },
  "TAO_POOL_CRITICAL": { label: "Pool thin", labelFr: "Pool faible" },
  "LIQUIDITY_USD_CRITICAL": { label: "Low liquidity", labelFr: "Liquidité basse" },
  "VOL_MC_LOW": { label: "Volume/MC abnormal", labelFr: "Volume/MC anormal" },
  "SLIPPAGE_HIGH": { label: "Slippage high", labelFr: "Slippage élevé" },
  "DEPEG": { label: "Depeg", labelFr: "Dépeg" },
  "DEREGISTRATION": { label: "Deregistration", labelFr: "Désenregistrement" },
  "BREAK_STATE": { label: "Critical zone", labelFr: "Zone critique" },
  "DATA_MISMATCH": { label: "Data mismatch", labelFr: "Divergence data" },
  "UID_LOW": { label: "UID low", labelFr: "UID faible" },
  "SPREAD_HIGH": { label: "Spread high", labelFr: "Spread élevé" },
};

function getReasonChips(evidence: any, fr: boolean): string[] {
  const hardConditions = (evidence?.hardConditions as string[]) || [];
  const reasons = (evidence?.reasons as string[]) || [];
  const chips: string[] = [];
  for (const hc of hardConditions) {
    const chip = OVERRIDE_CHIP_MAP[hc];
    if (chip) chips.push(fr ? chip.labelFr : chip.label);
  }
  if (chips.length === 0) {
    for (const r of reasons.slice(0, 3)) {
      chips.push(r.length > 30 ? r.slice(0, 27) + "…" : r);
    }
  }
  return chips;
}

function alertSummary(ev: EventRow, fr: boolean): string {
  const e = ev.evidence as any;
  if (ev.type === "WHALE_MOVE") {
    const dir = e?.direction === "OUT" ? "↗" : "↙";
    const amount = e?.amount_tao ? `${Number(e.amount_tao).toLocaleString()} τ` : "";
    return `${dir} ${amount} ${e?.label || ""}`.trim();
  }
  if (ev.type === "RISK_OVERRIDE") {
    const chips = getReasonChips(e, fr);
    return chips.join(" · ") || `MPI ${e?.mpi ?? "—"} Q ${e?.quality ?? "—"}`;
  }
  const reasons = (e?.reasons as string[]) || [];
  if (reasons.length) return reasons.slice(0, 3).join(" · ");
  const psi = e?.mpi ?? e?.psi;
  if (psi != null) return `PSI ${psi}`;
  return "—";
}

/* ═══════════════════════════════════════════ */
/*   ALERT CARD COMPONENT                      */
/* ═══════════════════════════════════════════ */
function AlertCard({ group, fr, scores, onDismiss }: {
  group: GroupedEvent;
  fr: boolean;
  scores: Map<number, any>;
  onDismiss?: (key: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const ev = group.latest;
  const info = typeDisplayInfo(ev.type, fr);
  const sev = alertSeverityClass(ev.type);
  const sevBadge = severityBadge(sev);
  const subnet = ev.netuid != null ? scores.get(ev.netuid) : null;
  const confidence = subnet?.confianceScore ?? null;

  const borderStyle = sev === "critical" ? { borderLeftColor: BREAK } : sev === "warning" ? { borderLeftColor: WARN } : {};

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden border-l-[3px]" style={borderStyle}>
      <div
        className={`px-4 py-3 ${group.count > 1 ? "cursor-pointer" : ""}`}
        onClick={() => group.count > 1 && setExpanded(!expanded)}
      >
        {/* Row 1: severity + type + subnet + time */}
        <div className="flex items-center gap-2 flex-wrap mb-2">
          <span className="font-mono text-[8px] font-bold tracking-wider px-1.5 py-0.5 rounded" style={{
            color: sevBadge.color,
            background: `color-mix(in srgb, ${sevBadge.color} 8%, transparent)`,
            border: `1px solid color-mix(in srgb, ${sevBadge.color} 15%, transparent)`,
          }}>
            {sevBadge.label}
          </span>
          <span className="font-mono text-[10px] font-bold" style={{ color: info.color }}>
            {info.icon} {info.label}
          </span>
          {ev.netuid != null && (
            <Link to={`/subnets/${ev.netuid}`} onClick={e => e.stopPropagation()} className="font-mono text-[11px] text-foreground/70 hover:text-foreground transition-colors">
              SN-{ev.netuid}
              {subnet?.name && <span className="text-muted-foreground ml-1 text-[9px]">{subnet.name}</span>}
            </Link>
          )}
          <div className="ml-auto flex items-center gap-2">
            {group.count > 1 && (
              <span className="font-mono text-[9px] font-bold px-1.5 py-0.5 rounded-full" style={{
                color: info.color, background: `color-mix(in srgb, ${info.color} 10%, transparent)`,
              }}>×{group.count}</span>
            )}
            <span className="font-mono text-[9px] text-muted-foreground">{formatTimeAgo(group.lastTs, fr)}</span>
            {onDismiss && (
              <button onClick={e => { e.stopPropagation(); onDismiss(alertKey(group)); }}
                className="font-mono text-[8px] px-1.5 py-0.5 rounded border border-border text-muted-foreground hover:text-foreground transition-colors"
                title={fr ? "Masquer 24h" : "Dismiss 24h"}>✓</button>
            )}
          </div>
        </div>

        {/* Row 2: summary + confidence + impact + action */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="font-mono text-[11px] text-foreground/70 flex-1 min-w-[200px]">{alertSummary(ev, fr)}</span>
          {confidence != null && (
            <span className="font-mono text-[9px] text-muted-foreground">
              {fr ? "Conf." : "Conf."} <span className="font-bold" style={{ color: confidence >= 70 ? GO : confidence >= 45 ? WARN : BREAK }}>{confidence}%</span>
            </span>
          )}
          <span className="font-mono text-[9px] text-muted-foreground">{alertImpact(ev.type, fr)}</span>
          <span className="font-mono text-[9px] font-bold px-2 py-0.5 rounded" style={{
            color: sev === "critical" ? BREAK : sev === "warning" ? WARN : GO,
            background: `color-mix(in srgb, ${sev === "critical" ? BREAK : sev === "warning" ? WARN : GO} 6%, transparent)`,
            border: `1px solid color-mix(in srgb, ${sev === "critical" ? BREAK : sev === "warning" ? WARN : GO} 12%, transparent)`,
          }}>
            {suggestedAction(ev.type, ev.evidence, fr)}
          </span>
        </div>
      </div>

      {/* Expanded occurrences */}
      {expanded && group.count > 1 && (
        <div className="border-t border-border px-4 py-2 bg-muted/10">
          <div className="font-mono text-[8px] text-muted-foreground tracking-widest mb-1.5">
            {fr ? "OCCURRENCES" : "OCCURRENCES"} ({group.count}) — 6h
          </div>
          {group.occurrences.map((occ, idx) => (
            <div key={occ.id} className="flex items-center gap-3 py-1 font-mono text-[10px] border-b border-border last:border-0">
              <span className="text-muted-foreground w-4">{idx + 1}</span>
              <span className="text-muted-foreground min-w-[120px]">{occ.ts ? new Date(occ.ts).toLocaleString() : "—"}</span>
              <span className="text-muted-foreground flex-1 truncate">{alertSummary(occ, fr)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════ */
/*   GROUPED BY SUBNET VIEW                    */
/* ═══════════════════════════════════════════ */
function SubnetGroupedView({ groups, fr, scores, onDismiss }: {
  groups: GroupedEvent[];
  fr: boolean;
  scores: Map<number, any>;
  onDismiss: (key: string) => void;
}) {
  const bySubnet = useMemo(() => {
    const map = new Map<number, GroupedEvent[]>();
    for (const g of groups) {
      const nid = g.latest.netuid ?? -1;
      if (!map.has(nid)) map.set(nid, []);
      map.get(nid)!.push(g);
    }
    const entries = Array.from(map.entries()).sort((a, b) => {
      const critA = a[1].filter(g => alertSeverityClass(g.latest.type) === "critical").length;
      const critB = b[1].filter(g => alertSeverityClass(g.latest.type) === "critical").length;
      return critB - critA;
    });
    return entries;
  }, [groups]);

  if (bySubnet.length === 0) {
    return <div className="py-12 text-center font-mono text-[11px] text-muted-foreground">{fr ? "Aucune alerte" : "No alerts"}</div>;
  }

  return (
    <div className="space-y-4">
      {bySubnet.map(([netuid, alerts]) => {
        const subnet = scores.get(netuid);
        const critCount = alerts.filter(g => alertSeverityClass(g.latest.type) === "critical").length;
        const warnCount = alerts.filter(g => alertSeverityClass(g.latest.type) === "warning").length;
        return (
          <SectionCard key={netuid}>
            <div className="flex items-center gap-3 px-5 py-3 border-b border-border">
              {netuid >= 0 ? (
                <Link to={`/subnets/${netuid}`} className="font-mono text-[12px] text-foreground/70 hover:text-foreground transition-colors font-bold">
                  SN-{netuid}
                  {subnet?.name && <span className="text-muted-foreground ml-1.5 font-normal text-[10px]">{subnet.name}</span>}
                </Link>
              ) : (
                <span className="font-mono text-[12px] text-muted-foreground">{fr ? "Système" : "System"}</span>
              )}
              <div className="flex gap-1.5 ml-auto">
                {critCount > 0 && <span className="font-mono text-[8px] font-bold px-1.5 py-0.5 rounded bg-destructive/10 text-destructive border border-destructive/20">{critCount} crit.</span>}
                {warnCount > 0 && <span className="font-mono text-[8px] font-bold px-1.5 py-0.5 rounded" style={{ background: `color-mix(in srgb, ${WARN} 10%, transparent)`, color: WARN, border: `1px solid color-mix(in srgb, ${WARN} 20%, transparent)` }}>{warnCount} warn.</span>}
                <span className="font-mono text-[9px] text-muted-foreground">{alerts.length} total</span>
              </div>
            </div>
            <div className="px-3 py-2 space-y-1.5">
              {alerts.map(g => (
                <AlertCard key={g.key} group={g} fr={fr} scores={scores} onDismiss={onDismiss} />
              ))}
            </div>
          </SectionCard>
        );
      })}
    </div>
  );
}

/* ═══════════════════════════════════════════ */
/*   WHY IT MATTERS BLOCK                      */
/* ═══════════════════════════════════════════ */
function WhyItMatters({ fr }: { fr: boolean }) {
  const items = fr ? [
    { icon: "⛔", title: "Critiques", desc: "Les alertes critiques signalent un risque immédiat de perte. Structure cassée, depeg confirmé ou override engine — chaque minute compte." },
    { icon: "⚠", title: "Warnings", desc: "Les warnings signalent une dégradation en cours. Depeg en approche, flux suspects ou pression anormale — surveiller et préparer." },
    { icon: "🛡", title: "Overrides", desc: "Quand l'engine bloque un subnet, c'est que plusieurs conditions structurelles sont réunies. Ne pas forcer l'entrée." },
    { icon: "🐋", title: "Whales", desc: "Les mouvements de plus de 100τ par des entités identifiées (exchanges, fonds) créent une pression directionnelle mesurable." },
  ] : [
    { icon: "⛔", title: "Critical", desc: "Critical alerts signal immediate loss risk. Broken structure, confirmed depeg or engine override — every minute counts." },
    { icon: "⚠", title: "Warnings", desc: "Warnings signal ongoing degradation. Approaching depeg, suspicious flows or abnormal pressure — monitor and prepare." },
    { icon: "🛡", title: "Overrides", desc: "When the engine blocks a subnet, multiple structural conditions are met. Do not force entry." },
    { icon: "🐋", title: "Whales", desc: "Movements over 100τ by identified entities (exchanges, funds) create measurable directional pressure." },
  ];

  return (
    <SectionCard>
      <SectionTitle icon="💡" title={fr ? "Pourquoi c'est important" : "Why it matters"} />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 px-5 py-4">
        {items.map((item, i) => (
          <div key={i} className="flex gap-3">
            <span className="text-lg shrink-0 mt-0.5">{item.icon}</span>
            <div>
              <div className="font-mono text-[10px] font-bold text-foreground/70 tracking-wider mb-0.5">{item.title}</div>
              <p className="text-[11px] text-muted-foreground leading-relaxed">{item.desc}</p>
            </div>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}

/* ═══════════════════════════════════════════ */
/*   MAIN PAGE                                  */
/* ═══════════════════════════════════════════ */
export default function AlertsPage() {
  const { lang } = useI18n();
  const fr = lang === "fr";
  const [tab, setTab] = useState<TabType>("ALL");
  const [viewMode, setViewMode] = useState<"feed" | "grouped">("feed");
  const [dismissed, setDismissed] = useState<Map<string, number>>(() => getDismissedAlerts());

  const { mode: overrideMode } = useOverrideMode();
  const { scores } = useSubnetScores();
  const portfolio = useLocalPortfolio();

  const handleDismiss = useCallback((key: string) => {
    dismissAlert(key);
    setDismissed(getDismissedAlerts());
  }, []);

  /* ── Data fetch ── */
  const { data: events } = useQuery({
    queryKey: ["events-log"],
    queryFn: async () => {
      const { data, error } = await supabase.from("events").select("*").order("ts", { ascending: false }).limit(500);
      if (error) throw error;
      return (data || []) as EventRow[];
    },
    refetchInterval: 60_000,
  });

  const grouped = useMemo(() => events ? groupEvents(events) : [], [events]);

  /* ── Apply gating for overrides ── */
  const processedGroups = useMemo(() => {
    return grouped.filter(g => {
      if (g.latest.type === "DATA_DIVERGENCE") return false;
      if (g.latest.type === "RISK_OVERRIDE" && overrideMode === "strict") {
        return passesStrictGating(g.latest, scores);
      }
      return true;
    });
  }, [grouped, overrideMode, scores]);

  /* ── Filter dismissed ── */
  const undismissed = useMemo(() =>
    processedGroups.filter(g => !dismissed.has(alertKey(g))),
  [processedGroups, dismissed]);

  /* ── Stats ── */
  const stats = useMemo(() => {
    const criticals = undismissed.filter(g => alertSeverityClass(g.latest.type) === "critical");
    const warnings = undismissed.filter(g => alertSeverityClass(g.latest.type) === "warning");
    const overrides = undismissed.filter(g => g.latest.type === "RISK_OVERRIDE");
    const invalidations = undismissed.filter(g =>
      g.latest.type === "DEPEG_CRITICAL" || g.latest.type === "DEPEG_WARNING" || g.latest.type === "BREAK"
    );
    const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
    const recent = undismissed.filter(g => new Date(g.lastTs).getTime() > twoHoursAgo);
    return { criticals: criticals.length, warnings: warnings.length, overrides: overrides.length, invalidations: invalidations.length, recent: recent.length };
  }, [undismissed]);

  /* ── Tab filter ── */
  const filteredByTab = useMemo(() => {
    if (tab === "CRITICAL") return undismissed.filter(g => alertSeverityClass(g.latest.type) === "critical");
    if (tab === "WARNING") return undismissed.filter(g => alertSeverityClass(g.latest.type) === "warning");
    if (tab === "OVERRIDE") return undismissed.filter(g => g.latest.type === "RISK_OVERRIDE");
    if (tab === "PORTFOLIO") {
      const ownedNetuids = portfolio.ownedNetuids;
      return undismissed.filter(g => g.latest.netuid != null && ownedNetuids.has(g.latest.netuid));
    }
    return undismissed;
  }, [tab, undismissed, portfolio.ownedNetuids]);

  /* ── Tabs config ── */
  const tabs: { value: TabType; label: string; count: number }[] = [
    { value: "ALL", label: fr ? "Toutes" : "All", count: undismissed.length },
    { value: "CRITICAL", label: fr ? "Critiques" : "Critical", count: stats.criticals },
    { value: "WARNING", label: "Warnings", count: stats.warnings },
    { value: "OVERRIDE", label: "Overrides", count: stats.overrides },
    { value: "PORTFOLIO", label: "Portfolio", count: undismissed.filter(g => g.latest.netuid != null && portfolio.ownedNetuids.has(g.latest.netuid)).length },
  ];

  return (
    <div className="h-full w-full bg-background text-foreground overflow-auto pb-8">
      <div className="px-4 sm:px-6 py-5 max-w-[1200px] mx-auto space-y-6">

        {/* ── 1. HEADER ── */}
        <div>
          <h1 className="font-mono text-lg sm:text-xl tracking-wider text-gold">Risk & Alerts</h1>
          <p className="font-mono text-[10px] text-muted-foreground mt-1 max-w-md leading-relaxed">
            {fr ? "Overrides, anomalies, invalidations et subnets sous surveillance." : "Overrides, anomalies, invalidations and subnets under watch."}
          </p>
        </div>

        {/* ── 2. KPI BAR ── */}
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-2.5">
          <KPIChip label={fr ? "CRITIQUES" : "CRITICAL"} value={stats.criticals} color={stats.criticals > 0 ? BREAK : MUTED} />
          <KPIChip label="WARNINGS" value={stats.warnings} color={stats.warnings > 0 ? WARN : MUTED} />
          <KPIChip label="OVERRIDES" value={stats.overrides} color={stats.overrides > 0 ? BREAK : MUTED} />
          <KPIChip label="INVALIDATIONS" value={stats.invalidations} color={stats.invalidations > 0 ? WARN : MUTED} />
          <KPIChip label={fr ? "RÉCENTS" : "RECENT"} value={stats.recent} color={stats.recent > 0 ? GO : MUTED} sub="< 2h" />
        </div>

        {/* ── 3. TABS + VIEW TOGGLE ── */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex rounded-lg overflow-hidden border border-border">
            {tabs.map(t => (
              <button key={t.value} onClick={() => setTab(t.value)}
                className="font-mono text-[10px] tracking-wider px-3 py-2 transition-all"
                style={{
                  background: tab === t.value ? "hsl(var(--muted) / 0.4)" : "transparent",
                  color: tab === t.value ? GOLD : MUTED,
                  fontWeight: tab === t.value ? 700 : 400,
                  opacity: tab === t.value ? 1 : 0.65,
                }}>
                {t.label}
                <span className="ml-1 text-[8px] opacity-60">({t.count})</span>
              </button>
            ))}
          </div>
          <div className="flex rounded-lg overflow-hidden border border-border ml-auto">
            <button onClick={() => setViewMode("feed")}
              className="font-mono text-[9px] px-2.5 py-1.5 transition-all"
              style={{
                background: viewMode === "feed" ? "hsl(var(--muted) / 0.4)" : "transparent",
                color: viewMode === "feed" ? "hsl(var(--foreground) / 0.7)" : MUTED,
                opacity: viewMode === "feed" ? 1 : 0.65,
              }}>
              {fr ? "Flux" : "Feed"}
            </button>
            <button onClick={() => setViewMode("grouped")}
              className="font-mono text-[9px] px-2.5 py-1.5 transition-all"
              style={{
                background: viewMode === "grouped" ? "hsl(var(--muted) / 0.4)" : "transparent",
                color: viewMode === "grouped" ? "hsl(var(--foreground) / 0.7)" : MUTED,
                opacity: viewMode === "grouped" ? 1 : 0.65,
              }}>
              {fr ? "Par subnet" : "By subnet"}
            </button>
          </div>
        </div>

        {/* ── 4. FEED / GROUPED VIEW ── */}
        {viewMode === "grouped" ? (
          <SubnetGroupedView groups={filteredByTab} fr={fr} scores={scores} onDismiss={handleDismiss} />
        ) : (
          filteredByTab.length === 0 ? (
            <div className="py-16 text-center space-y-3">
              <span className="text-3xl opacity-30">🔕</span>
              <p className="font-mono text-[11px] text-muted-foreground">{fr ? "Aucune alerte dans cette catégorie" : "No alerts in this category"}</p>
            </div>
          ) : (
            <div className="space-y-2">
              {filteredByTab.map(group => (
                <AlertCard key={group.key} group={group} fr={fr} scores={scores} onDismiss={handleDismiss} />
              ))}
            </div>
          )
        )}

        {/* ── 5. DISMISSED COUNT ── */}
        {dismissed.size > 0 && (
          <div className="text-center">
            <span className="font-mono text-[9px] text-muted-foreground">
              {dismissed.size} {fr ? "alertes traitées (masquées 24h)" : "alerts dismissed (hidden 24h)"}
            </span>
          </div>
        )}

        {/* ── 6. WHY IT MATTERS ── */}
        <WhyItMatters fr={fr} />
      </div>
    </div>
  );
}
