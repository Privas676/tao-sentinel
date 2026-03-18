import React, { useMemo, useState, useCallback } from "react";
import { PageLoadingState } from "@/components/PageLoadingState";
import { useNavigate } from "react-router-dom";
import { useI18n } from "@/lib/i18n";
import { useLocalPortfolio } from "@/hooks/use-local-portfolio";
import { useSubnetScores, type UnifiedSubnetScore, SPECIAL_SUBNETS } from "@/hooks/use-subnet-scores";
import { useCanonicalSubnets } from "@/hooks/use-canonical-subnets";
import type { SubnetDecision } from "@/hooks/use-subnet-decisions";
import type { SubnetVerdictData } from "@/hooks/use-subnet-verdict";
import { useIsMobile } from "@/hooks/use-mobile";
import { taoFluteColumnLabel } from "@/lib/taoflute-resolver";
import { finalActionColor as canonicalFaColor, finalActionIcon as canonicalFaIcon, finalActionLabel as canonicalFaLabel } from "@/lib/subnet-decision";
import { PageHeader, SectionHeader, StatusBadge, ActionBadge, ConfidenceBar, SparklineMini, FilterChipGroup } from "@/components/sentinel";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import DataAlignmentBadge from "@/components/DataAlignmentBadge";
import SwipeHint from "@/components/SwipeHint";
import {
  opportunityColor, riskColor, stabilityColor,
  type SmartCapitalState,
} from "@/lib/gauge-engine";
import { confianceColor } from "@/lib/data-fusion";
import type { FinalAction } from "@/lib/subnet-decision";

/* ═══════════════════════════════════════════════ */
/*   SUBNET INTELLIGENCE — Unified Master Table   */
/* ═══════════════════════════════════════════════ */

/* ─── Filter types ─── */
type ActionFilter = "ALL" | "ENTRER" | "SURVEILLER" | "SORTIR" | "ÉVITER";
type StatusFilter = "ALL" | "OK" | "WATCH" | "DANGER";
type ConvictionFilter = "ALL" | "HIGH" | "MEDIUM" | "LOW";
type ScopeFilter = "ALL" | "PORTFOLIO" | "WATCHLIST";
type LiquidityFilter = "ALL" | "HIGH" | "MEDIUM" | "LOW";
type StructureFilter = "ALL" | "HEALTHY" | "FRAGILE" | "CONCENTRATED";
type ExternalFilter = "ALL" | "PRIORITY" | "WATCH" | "NONE";
type ViewMode = "compact" | "analytic";

type SortCol = "netuid" | "name" | "action" | "conviction" | "confidence" | "risk" | "momentum" | "opp" | "liquidity" | "stability" | null;

/* ─── Enriched row type — uses SubnetDecision as the source of truth ─── */
type TableRow = UnifiedSubnetScore & {
  owned: boolean;
  spark: number[];
  verdict?: SubnetVerdictData;
  decision: SubnetDecision;
  convictionLevel: "HIGH" | "MEDIUM" | "LOW";
  liquidityLevel: "HIGH" | "MEDIUM" | "LOW";
  structureLevel: "HEALTHY" | "FRAGILE" | "CONCENTRATED";
  statusLevel: "OK" | "WATCH" | "DANGER";
  signalPrincipal: string;
  extLabel: string;
};


/* ─── Saved views ─── */
const SAVED_VIEWS_KEY = "sentinel-subnet-views";
type SavedView = { name: string; filters: { scope: ScopeFilter; action: ActionFilter; status: StatusFilter; conviction: ConvictionFilter; liquidity: LiquidityFilter; structure: StructureFilter; external?: ExternalFilter } };

function loadSavedViews(): SavedView[] {
  try { return JSON.parse(localStorage.getItem(SAVED_VIEWS_KEY) || "[]"); } catch { return []; }
}

/* ═══════════════════════════════════════ */
/*   QUICK VIEW DRAWER — Premium                */
/* ═══════════════════════════════════════ */
function QuickViewDrawer({ row, open, onClose, fr, onAddWatchlist }: {
  row: TableRow | null; open: boolean; onClose: () => void; fr: boolean;
  onAddWatchlist?: (netuid: number) => void;
}) {
  const navigate = useNavigate();
  if (!row) return null;

  const verdict = row.verdict;
  const decision = row.decision;
  const isSystemSubnet = decision.isSystem;
  const thesis = decision.thesis;
  const invalidation = decision.invalidation;

  /* Alerts */
  const alerts: { icon: string; text: string; color: string }[] = [];
  if (!isSystemSubnet) {
    if (row.isOverridden) alerts.push({ icon: "⛔", text: fr ? "Override actif — sortie forcée" : "Active override — forced exit", color: "hsl(var(--destructive))" });
    if (row.depegProbability >= 50) alerts.push({ icon: "⚠", text: `Depeg ${row.depegProbability}%`, color: "hsl(var(--signal-go-spec))" });
    if (row.delistCategory !== "NORMAL") alerts.push({ icon: "🔴", text: fr ? `Risque delist (${row.delistCategory})` : `Delist risk (${row.delistCategory})`, color: "hsl(var(--destructive))" });
    const tf = decision.taoFluteStatus;
    if (tf?.taoflute_severity === "priority") alerts.push({ icon: "💀", text: fr ? `TaoFlute priorité #${tf.taoflute_priority_rank}` : `TaoFlute priority #${tf.taoflute_priority_rank}`, color: "hsl(var(--destructive))" });
    else if (tf?.taoflute_severity === "watch") alerts.push({ icon: "⚠️", text: fr ? "Sous surveillance TaoFlute" : "TaoFlute watch", color: "hsl(var(--signal-go-spec))" });
    if (row.dataUncertain) alerts.push({ icon: "❓", text: fr ? "Données incertaines" : "Uncertain data", color: "hsl(var(--muted-foreground))" });
    if (decision.conflictExplanation) alerts.push({ icon: "⚖️", text: decision.conflictExplanation, color: "hsl(var(--signal-go-spec))" });
  }

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full sm:w-[420px] border-l border-border bg-background text-foreground overflow-y-auto p-0">
        {/* ── Header: SN + Action + Signal ── */}
        <div className="px-5 pt-5 pb-4 border-b border-border">
          <SheetHeader>
            <div className="flex items-center justify-between">
              <SheetTitle className="font-mono tracking-wider text-sm text-foreground/90">
                <span className="text-muted-foreground mr-1.5">SN-{row.netuid}</span>
                {row.name}
              </SheetTitle>
              <StatusBadge type={row.statusLevel === "DANGER" ? "danger" : row.statusLevel === "WATCH" ? "warning" : "success"} label={row.statusLevel} />
            </div>
          </SheetHeader>
          <div className="flex items-center justify-between mt-3">
            <ActionBadge action={decision.badgeAction} />
            <span className="font-mono text-[11px] font-bold text-foreground/80">{decision.signalPrincipal}</span>
          </div>
        </div>

        {/* ── Body ── */}
        <div className="px-5 py-4 space-y-4">

          {/* System subnet info */}
          {isSystemSubnet && (
            <div className="rounded-lg p-3 border border-border" style={{ background: "hsla(var(--signal-system), 0.03)", borderColor: "hsla(var(--signal-system), 0.15)" }}>
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-sm">🔷</span>
                <span className="font-mono text-[8px] tracking-widest uppercase font-bold" style={{ color: "hsl(var(--signal-system))" }}>
                  {fr ? "SUBNET SYSTÈME" : "SYSTEM SUBNET"}
                </span>
              </div>
              <p className="font-mono text-[10px] text-foreground/60 leading-relaxed">
                {fr
                  ? "Infrastructure réseau — pas une opportunité d'investissement classique. Métriques plafonnées."
                  : "Network infrastructure — not a standard investment opportunity. Metrics capped."}
              </p>
            </div>
          )}

          {/* Decision transparency block — NEW */}
          {!isSystemSubnet && decision.isBlocked && (
            <div className="rounded-lg p-3 border border-border bg-accent/10">
              <div className="font-mono text-[7px] tracking-widest uppercase text-muted-foreground mb-1.5">{fr ? "ARBITRAGE MOTEUR" : "ENGINE ARBITRAGE"}</div>
              <div className="font-mono text-[10px] text-foreground/75 leading-relaxed mb-1">
                {fr ? "Signal brut :" : "Raw signal:"} <span className="font-bold text-foreground/90">{decision.rawSignal === "opportunity" ? (fr ? "Opportunité" : "Opportunity") : decision.rawSignal === "exit" ? (fr ? "Sortie" : "Exit") : (fr ? "Neutre" : "Neutral")}</span>
              </div>
              <div className="font-mono text-[10px] text-foreground/75 leading-relaxed">
                {fr ? "Non actionnable :" : "Not actionable:"} {decision.blockReasons.slice(0, 3).map((r, i) => <span key={i} className="text-foreground/60">• {r} </span>)}
              </div>
            </div>
          )}

          {/* Primary decision metrics — 2x2 */}
          <div className="grid grid-cols-2 gap-2">
            <MetricMini label="CONVICTION" value={row.convictionLevel} color={row.convictionLevel === "HIGH" ? "hsl(var(--signal-go))" : row.convictionLevel === "MEDIUM" ? "hsl(var(--signal-go-spec))" : "hsl(var(--muted-foreground))"} />
            <MetricMini label="RISK" value={row.risk} color={riskColor(row.risk)} />
          </div>

          {/* Secondary metrics — 2x2 */}
          <div className="grid grid-cols-4 gap-2">
            <MetricMini label="MOM." value={Math.round(row.momentumScore)} color={row.momentumScore >= 55 ? "hsl(var(--signal-go))" : row.momentumScore >= 35 ? "hsl(var(--signal-go-spec))" : "hsl(var(--signal-break))"} />
            <MetricMini label="OPP" value={row.opp} color={opportunityColor(row.opp)} />
            <MetricMini label="CONF" value={`${row.confianceScore}%`} color={confianceColor(row.confianceScore)} />
            <MetricMini label="LIQ." value={row.liquidityLevel === "HIGH" ? "●" : row.liquidityLevel === "MEDIUM" ? "◐" : "○"} color={row.liquidityLevel === "HIGH" ? "hsl(var(--signal-go))" : row.liquidityLevel === "MEDIUM" ? "hsl(var(--signal-go-spec))" : "hsl(var(--signal-break))"} />
          </div>

          {/* Sparkline */}
          {row.spark.length > 0 && (
            <div className="rounded-lg px-3 py-2 bg-muted/20 border border-border flex items-center gap-3">
              <span className="font-mono text-[7px] text-muted-foreground tracking-widest uppercase">7D</span>
              <SparklineMini data={row.spark} width={120} height={24} />
            </div>
          )}

          {/* Thesis */}
          {thesis.length > 0 && (
            <div className="rounded-lg p-3 bg-primary/[0.03] border border-primary/10">
              <div className="font-mono text-[7px] text-muted-foreground tracking-widest uppercase mb-2">
                {fr ? "THÈSE" : "THESIS"}
              </div>
              {thesis.map((r, i) => <div key={i} className="font-mono text-[11px] text-foreground/75 mb-1">+ {r}</div>)}
            </div>
          )}

          {/* Invalidation */}
          {invalidation.length > 0 && (
            <div className="rounded-lg p-3 bg-destructive/[0.03] border border-destructive/10">
              <div className="font-mono text-[7px] text-muted-foreground tracking-widest uppercase mb-2">
                INVALIDATION
              </div>
              {invalidation.map((r, i) => <div key={i} className="font-mono text-[11px] text-foreground/75 mb-1">− {r}</div>)}
            </div>
          )}

          {/* Active alerts */}
          {alerts.length > 0 && (
            <div className="rounded-lg p-3 border border-destructive/15 bg-destructive/[0.03]">
              <div className="font-mono text-[7px] text-muted-foreground tracking-widest uppercase mb-2">
                {fr ? "ALERTES ACTIVES" : "ACTIVE ALERTS"}
              </div>
              {alerts.map((a, i) => (
                <div key={i} className="flex items-center gap-2 mb-1.5 last:mb-0">
                  <span className="text-[10px]">{a.icon}</span>
                  <span className="font-mono text-[11px]" style={{ color: a.color }}>{a.text}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Footer CTAs ── */}
        <div className="px-5 pb-5 pt-2 border-t border-border space-y-2">
          <button
            onClick={() => { onClose(); navigate(`/subnets/${row.netuid}`); }}
            className="w-full text-center font-mono text-[10px] tracking-wider py-2.5 rounded-lg transition-all hover:brightness-110"
            style={{ background: "hsla(var(--gold), 0.08)", color: "hsl(var(--gold))", border: "1px solid hsla(var(--gold), 0.15)" }}
          >
            {fr ? "Ouvrir le subnet →" : "Open subnet →"}
          </button>
          {!row.owned && onAddWatchlist && (
            <button
              onClick={() => { onAddWatchlist(row.netuid); onClose(); }}
              className="w-full text-center font-mono text-[10px] tracking-wider py-2.5 rounded-lg transition-all text-muted-foreground/70 hover:text-foreground border border-border hover:border-foreground/20"
            >
              {fr ? "＋ Ajouter à la watchlist" : "＋ Add to watchlist"}
            </button>
          )}
          {row.owned && (
            <div className="text-center font-mono text-[9px] text-muted-foreground py-1">
              ★ {fr ? "Dans votre portefeuille" : "In your portfolio"}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function MetricMini({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <div className="rounded-lg px-2.5 py-2 text-center bg-muted/30 border border-border">
      <div className="font-mono text-[8px] text-muted-foreground tracking-wider uppercase">{label}</div>
      <div className="font-mono text-sm font-bold mt-0.5" style={{ color }}>{value}</div>
    </div>
  );
}

/* ─── Final action color/icon helpers ─── */
/* ─── Use canonical helpers from subnet-decision.ts ─── */
const finalActionColor = canonicalFaColor;
const finalActionBg = (fa: FinalAction): string => {
  switch (fa) {
    case "ENTRER": return "hsla(145,65%,48%,0.08)";
    case "SURVEILLER": return "hsla(38,60%,50%,0.06)";
    case "SORTIR": return "hsla(4,80%,50%,0.08)";
    case "ÉVITER": return "hsla(4,80%,40%,0.10)";
    case "SYSTÈME": return "hsla(210,60%,55%,0.08)";
  }
};
const finalActionIcon = canonicalFaIcon;
const finalActionLabel = canonicalFaLabel;

/* ─── Filter label helpers ─── */
function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="font-mono text-[7px] tracking-widest uppercase text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}
function FilterSep() {
  return <div className="w-px self-stretch" style={{ background: "hsla(0,0%,100%,0.06)", minHeight: 28 }} />;
}

/* ═══════════════════════════════════════ */
/*   MAIN PAGE                              */
/* ═══════════════════════════════════════ */
export default function SubnetsPage() {
  const navigate = useNavigate();
  const { t, lang } = useI18n();
  const fr = lang === "fr";
  const isMobile = useIsMobile();
  const { ownedNetuids, addPosition } = useLocalPortfolio();

  // ── Data sources ──
  const { scoresList, sparklines, scoreTimestamp, dataAlignment, dataAgeDebug, isLoading } = useSubnetScores();
  const { decisions, decisionsList, isLoading: decisionsLoading } = useCanonicalSubnets();
  

  // ── Action counts from DECISIONS (single source of truth) ──
  // Exclude system subnets from counts (same as Compass)
  const actionCounts = useMemo(() => {
    let enter = 0, monitor = 0, exit = 0, avoid = 0;
    for (const d of decisionsList) {
      if (d.isSystem) continue;
      if (d.finalAction === "ENTRER") enter++;
      else if (d.finalAction === "ÉVITER") avoid++;
      else if (d.finalAction === "SORTIR") exit++;
      else monitor++;
    }
    return { enter, monitor, exit, avoid };
  }, [decisionsList]);

  // ── Filters ──
  const [scope, setScope] = useState<ScopeFilter>("ALL");
  const [actionFilter, setActionFilter] = useState<ActionFilter>("ALL");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [convictionFilter, setConvictionFilter] = useState<ConvictionFilter>("ALL");
  const [liquidityFilter, setLiquidityFilter] = useState<LiquidityFilter>("ALL");
  const [structureFilter, setStructureFilter] = useState<StructureFilter>("ALL");
  const [externalFilter, setExternalFilter] = useState<ExternalFilter>("ALL");
  const [search, setSearch] = useState("");
  const [sortCol, setSortCol] = useState<SortCol>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [drawerRow, setDrawerRow] = useState<TableRow | null>(null);
  const [savedViews, setSavedViews] = useState<SavedView[]>(() => loadSavedViews());
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    try { return (localStorage.getItem("subnet-view-mode") as ViewMode) || "compact"; } catch { return "compact"; }
  });

  const hasActiveFilters = scope !== "ALL" || actionFilter !== "ALL" || statusFilter !== "ALL" || convictionFilter !== "ALL" || liquidityFilter !== "ALL" || structureFilter !== "ALL" || externalFilter !== "ALL" || search.length > 0;

  const resetFilters = useCallback(() => {
    setScope("ALL"); setActionFilter("ALL"); setStatusFilter("ALL");
    setConvictionFilter("ALL"); setLiquidityFilter("ALL"); setStructureFilter("ALL");
    setExternalFilter("ALL"); setSearch("");
  }, []);

  const saveCurrentView = useCallback(() => {
    const name = prompt(fr ? "Nom de la vue :" : "View name:");
    if (!name) return;
    const view: SavedView = { name, filters: { scope, action: actionFilter, status: statusFilter, conviction: convictionFilter, liquidity: liquidityFilter, structure: structureFilter, external: externalFilter } };
    const updated = [...savedViews, view];
    setSavedViews(updated);
    localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify(updated));
  }, [scope, actionFilter, statusFilter, convictionFilter, liquidityFilter, structureFilter, externalFilter, savedViews, fr]);

  const loadView = useCallback((view: SavedView) => {
    setScope(view.filters.scope); setActionFilter(view.filters.action as ActionFilter); setStatusFilter(view.filters.status);
    setConvictionFilter(view.filters.conviction); setLiquidityFilter(view.filters.liquidity); setStructureFilter(view.filters.structure);
    setExternalFilter((view.filters.external || "ALL") as ExternalFilter);
  }, []);

  const toggleSort = useCallback((col: SortCol) => {
    if (sortCol === col) {
      if (sortDir === "desc") setSortDir("asc");
      else { setSortCol(null); setSortDir("desc"); }
    } else { setSortCol(col); setSortDir("desc"); }
  }, [sortCol, sortDir]);

  const handleViewMode = useCallback((mode: ViewMode) => {
    setViewMode(mode);
    localStorage.setItem("subnet-view-mode", mode);
  }, []);

  // ── Build enriched rows — ALL derived from decision, never raw action ──
  const rows = useMemo<TableRow[]>(() => {
    const searchLower = search.toLowerCase();
    return scoresList
      .map(s => {
        const decision = decisions.get(s.netuid) ?? null;
        const verdict = decision?.verdict;
        if (!decision) return null;
        return {
          ...s,
          owned: ownedNetuids.has(s.netuid),
          spark: sparklines?.get(s.netuid) || [],
          verdict,
          decision,
          convictionLevel: decision.conviction,
          liquidityLevel: decision.liquidityLevel,
          structureLevel: decision.structureLevel,
          statusLevel: decision.statusLevel,
          signalPrincipal: decision.signalPrincipal,
          extLabel: taoFluteColumnLabel(decision.taoFluteStatus),
        } as TableRow;
      })
      .filter((r): r is TableRow => r !== null)
      .filter(r => {
        if (search && !r.name.toLowerCase().includes(searchLower) && !String(r.netuid).includes(searchLower)) return false;
        if (scope === "PORTFOLIO" && !r.owned) return false;
        // ── ACTION FILTER: uses decision.finalAction (single source of truth) ──
        if (actionFilter === "ENTRER" && r.decision.finalAction !== "ENTRER") return false;
        if (actionFilter === "SURVEILLER" && r.decision.finalAction !== "SURVEILLER" && r.decision.finalAction !== "SYSTÈME") return false;
        if (actionFilter === "SORTIR" && r.decision.finalAction !== "SORTIR") return false;
        if (actionFilter === "ÉVITER" && r.decision.finalAction !== "ÉVITER") return false;
        if (statusFilter === "OK" && r.statusLevel !== "OK") return false;
        if (statusFilter === "WATCH" && r.statusLevel !== "WATCH") return false;
        if (statusFilter === "DANGER" && r.statusLevel !== "DANGER") return false;
        if (convictionFilter !== "ALL" && r.convictionLevel !== convictionFilter) return false;
        if (liquidityFilter !== "ALL" && r.liquidityLevel !== liquidityFilter) return false;
        if (structureFilter !== "ALL" && r.structureLevel !== structureFilter) return false;
        if (externalFilter === "PRIORITY" && r.decision.taoFluteStatus?.taoflute_severity !== "priority") return false;
        if (externalFilter === "WATCH" && r.decision.taoFluteStatus?.taoflute_severity !== "watch") return false;
        if (externalFilter === "NONE" && r.decision.taoFluteStatus?.taoflute_match) return false;
        return true;
      })
      .sort((a, b) => {
        if (sortCol) {
          let av = 0, bv = 0;
          switch (sortCol) {
            case "netuid": av = a.netuid; bv = b.netuid; break;
            case "name": return sortDir === "desc" ? b.name.localeCompare(a.name) : a.name.localeCompare(b.name);
            case "action": {
              const rank = (fa: FinalAction) => ({ "ÉVITER": 0, "SORTIR": 0, "SURVEILLER": 1, "SYSTÈME": 1, "ENTRER": 2 }[fa] ?? 1);
              av = rank(a.decision.finalAction); bv = rank(b.decision.finalAction); break;
            }
            case "conviction": {
              const rank = (x: string) => x === "HIGH" ? 3 : x === "MEDIUM" ? 2 : 1;
              av = rank(a.convictionLevel); bv = rank(b.convictionLevel); break;
            }
            case "confidence": av = a.confianceScore; bv = b.confianceScore; break;
            case "risk": av = a.risk; bv = b.risk; break;
            case "momentum": av = a.momentumScore; bv = b.momentumScore; break;
            case "opp": av = a.opp; bv = b.opp; break;
            case "liquidity": av = a.healthScores.liquidityHealth; bv = b.healthScores.liquidityHealth; break;
            case "stability": av = a.stability; bv = b.stability; break;
          }
          return sortDir === "desc" ? bv - av : av - bv;
        }
        return b.asymmetry - a.asymmetry;
      });
  }, [scoresList, sparklines, decisions, ownedNetuids, search, scope, actionFilter, statusFilter, convictionFilter, liquidityFilter, structureFilter, externalFilter, sortCol, sortDir, fr]);

  // ── Column header helper ──
  const SortHeader = ({ col, label, align = "left" }: { col: SortCol; label: string; align?: "left" | "center" | "right" }) => (
    <th
      className={`py-2.5 px-2.5 font-mono text-[8px] tracking-wider uppercase cursor-pointer select-none transition-colors hover:text-foreground/80 whitespace-nowrap ${align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left"}`}
      style={{ color: sortCol === col ? "hsl(var(--gold))" : undefined }}
      onClick={() => toggleSort(col)}
    >
      {label} {sortCol === col ? (sortDir === "desc" ? "▼" : "▲") : ""}
    </th>
  );

  const isCompact = viewMode === "compact";

  if (isLoading || decisionsLoading || !scoresList.length) return <PageLoadingState label={fr ? "Chargement subnets..." : "Loading subnets..."} />;

  // Count non-system subnets
  const specSubnets = scoresList.filter(s => SPECIAL_SUBNETS[s.netuid]?.isSystem).length;
  const exploitableCount = scoresList.length - specSubnets;

  return (
    <div className="h-full w-full bg-background text-foreground overflow-y-auto overflow-x-hidden">
      <div className="px-4 sm:px-6 py-5 max-w-[1400px] mx-auto space-y-5">

        {/* ═══ HEADER ═══ */}
        <PageHeader
          title="Subnet Intelligence"
          subtitle={fr
            ? "Vue maître de tous les subnets — filtrable par action, risque, conviction et portefeuille."
            : "Master view of all subnets — filterable by action, risk, conviction, and portfolio."}
          icon="📋"
          badge={<DataAlignmentBadge dataAlignment={dataAlignment} dataAgeDebug={dataAgeDebug} className="text-[7px] px-1.5" />}
          actions={
            <div className="flex items-center gap-3">
              {/* View mode toggle */}
              <div className="inline-flex items-center rounded-lg overflow-hidden border border-border">
                <button onClick={() => handleViewMode("compact")}
                  className={`font-mono text-[9px] tracking-wider px-2.5 py-1.5 transition-all ${isCompact ? "bg-muted/40 text-gold font-bold" : "text-muted-foreground hover:text-foreground"}`}>
                  {fr ? "Compact" : "Compact"}
                </button>
                <button onClick={() => handleViewMode("analytic")}
                  className={`font-mono text-[9px] tracking-wider px-2.5 py-1.5 transition-all ${!isCompact ? "bg-muted/40 text-gold font-bold" : "text-muted-foreground hover:text-foreground"}`}>
                  {fr ? "Analytique" : "Analytic"}
                </button>
              </div>
              <span className="font-mono text-[8px] text-muted-foreground">
                {exploitableCount} subnets{specSubnets > 0 ? ` + ${specSubnets} sys.` : ""} · {new Date(scoreTimestamp).toLocaleTimeString()}
              </span>
            </div>
          }
        />

        {/* ═══ FILTER BAR ═══ */}
        <div className="rounded-xl p-3.5 space-y-3 bg-muted/10 border border-border" style={{ boxShadow: "var(--shadow-card)" }}>
          {/* Search + controls row */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative flex-1" style={{ minWidth: 180, maxWidth: 300 }}>
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder={fr ? "Rechercher un subnet…" : "Search subnet…"}
                className="w-full font-mono text-[11px] px-3 py-1.5 rounded-lg bg-background text-foreground placeholder:text-muted-foreground border border-border"
              />
            </div>
            {hasActiveFilters && (
              <button onClick={resetFilters} className="font-mono text-[9px] px-2.5 py-1 rounded-lg transition-colors hover:bg-accent" style={{ color: "hsl(var(--destructive))", border: "1px solid hsla(var(--destructive), 0.15)" }}>
                ✕ Reset
              </button>
            )}
            <button onClick={saveCurrentView} className="font-mono text-[9px] px-2.5 py-1 rounded-lg text-muted-foreground hover:text-foreground transition-colors border border-border">
              💾 {fr ? "Sauvegarder" : "Save view"}
            </button>
            {savedViews.length > 0 && savedViews.map((v, i) => (
              <button key={i} onClick={() => loadView(v)} className="font-mono text-[8px] px-2 py-1 rounded text-muted-foreground hover:text-foreground transition-colors" style={{ background: "hsla(var(--gold), 0.04)", border: "1px solid hsla(var(--gold), 0.08)" }}>
                {v.name}
              </button>
            ))}
          </div>

          {/* Filter chips — labeled groups — NOW uses finalAction values */}
          <div className="flex items-start gap-4 flex-wrap">
            <FilterGroup label="SCOPE">
              <FilterChipGroup
                chips={[
                  { key: "ALL", label: fr ? "Tous" : "All" },
                  { key: "PORTFOLIO", label: "Portfolio" },
                ]}
                active={scope}
                onChange={v => setScope(v as ScopeFilter)}
              />
            </FilterGroup>
            <FilterSep />
            <FilterGroup label="ACTION">
              <FilterChipGroup
                 chips={[
                   { key: "ALL", label: fr ? "Toutes" : "All" },
                   { key: "ENTRER", label: fr ? "Entrer" : "Enter", count: actionCounts.enter || undefined },
                   { key: "SURVEILLER", label: fr ? "Surveiller" : "Monitor", count: actionCounts.monitor || undefined },
                   { key: "SORTIR", label: fr ? "Sortir" : "Exit", count: actionCounts.exit || undefined },
                   { key: "ÉVITER", label: fr ? "Éviter" : "Avoid", count: actionCounts.avoid || undefined },
                 ]}
                active={actionFilter}
                onChange={v => setActionFilter(v as ActionFilter)}
              />
            </FilterGroup>
            <FilterSep />
            <FilterGroup label={fr ? "STATUT" : "STATUS"}>
              <FilterChipGroup
                chips={[
                  { key: "ALL", label: fr ? "Tous" : "All" },
                  { key: "OK", label: "OK" },
                  { key: "WATCH", label: "⚠" },
                  { key: "DANGER", label: "🔴" },
                ]}
                active={statusFilter}
                onChange={v => setStatusFilter(v as StatusFilter)}
              />
            </FilterGroup>
            <FilterSep />
            <FilterGroup label="CONVICTION">
              <FilterChipGroup
                chips={[
                  { key: "ALL", label: fr ? "Toutes" : "All" },
                  { key: "HIGH", label: fr ? "Haute" : "High" },
                  { key: "MEDIUM", label: fr ? "Moy." : "Med" },
                  { key: "LOW", label: fr ? "Faible" : "Low" },
                ]}
                active={convictionFilter}
                onChange={v => setConvictionFilter(v as ConvictionFilter)}
              />
            </FilterGroup>
            <FilterSep />
            <FilterGroup label={fr ? "EXTERNE" : "EXTERNAL"}>
              <FilterChipGroup
                chips={[
                  { key: "ALL", label: fr ? "Tous" : "All" },
                  { key: "PRIORITY", label: "🔴 Top 10" },
                  { key: "WATCH", label: "🟠 Watch" },
                  { key: "NONE", label: fr ? "Aucun" : "None" },
                ]}
                active={externalFilter}
                onChange={v => setExternalFilter(v as ExternalFilter)}
              />
            </FilterGroup>
          </div>
          {/* Second row — advanced filters (analytic mode only) */}
          {!isCompact && (
            <div className="flex items-start gap-4 flex-wrap">
              <FilterGroup label={fr ? "LIQUIDITÉ" : "LIQUIDITY"}>
                <FilterChipGroup
                  chips={[
                    { key: "ALL", label: fr ? "Toutes" : "All" },
                    { key: "HIGH", label: fr ? "Haute" : "High" },
                    { key: "MEDIUM", label: fr ? "Moy." : "Med" },
                    { key: "LOW", label: fr ? "Faible" : "Low" },
                  ]}
                  active={liquidityFilter}
                  onChange={v => setLiquidityFilter(v as LiquidityFilter)}
                />
              </FilterGroup>
              <FilterSep />
              <FilterGroup label="STRUCTURE">
                <FilterChipGroup
                  chips={[
                    { key: "ALL", label: fr ? "Toutes" : "All" },
                    { key: "HEALTHY", label: fr ? "Saine" : "Healthy" },
                    { key: "FRAGILE", label: fr ? "Fragile" : "Fragile" },
                    { key: "CONCENTRATED", label: fr ? "Concentrée" : "Conc." },
                  ]}
                  active={structureFilter}
                  onChange={v => setStructureFilter(v as StructureFilter)}
                />
              </FilterGroup>
            </div>
          )}
          <span className="font-mono text-[9px] text-muted-foreground">
            {rows.filter(r => !SPECIAL_SUBNETS[r.netuid]?.isSystem).length} / {exploitableCount} {fr ? "résultats" : "results"}
          </span>
        </div>

        {/* ═══ MASTER TABLE / CARD VIEW ═══ */}
        {!isMobile && <SwipeHint storageKey="swipe-subnets-v4" />}

        {isMobile ? (
          /* ── Mobile: stacked card view ── */
          <div className="space-y-2">
            {rows.length === 0 ? (
              <div className="py-12 text-center text-muted-foreground text-[11px] rounded-xl border border-border bg-card" style={{ boxShadow: "var(--shadow-card)" }}>
                {fr ? "Aucun subnet ne correspond aux filtres actifs." : "No subnets match active filters."}
              </div>
            ) : rows.map((r) => {
              const fa = r.decision.finalAction;
              const isSystemRow = r.decision.isSystem;
              const convColor = r.convictionLevel === "HIGH" ? "hsl(var(--signal-go))" : r.convictionLevel === "MEDIUM" ? "hsl(var(--signal-go-spec))" : "hsl(var(--muted-foreground))";
              const liqColor = r.liquidityLevel === "HIGH" ? "hsl(var(--signal-go))" : r.liquidityLevel === "MEDIUM" ? "hsl(var(--signal-go-spec))" : "hsl(var(--signal-break))";
              const structColor = r.structureLevel === "HEALTHY" ? "hsl(var(--signal-go))" : r.structureLevel === "FRAGILE" ? "hsl(var(--signal-go-spec))" : "hsl(var(--signal-break))";
              return (
                <div
                  key={r.netuid}
                  className="rounded-xl border border-border bg-card p-3 cursor-pointer transition-colors hover:bg-accent/30"
                  style={{
                    boxShadow: "var(--shadow-card)",
                    ...(r.isOverridden ? { borderLeftWidth: 3, borderLeftColor: "hsl(var(--signal-break))" } : {}),
                    ...(isSystemRow && !r.isOverridden ? { borderLeftWidth: 3, borderLeftColor: "hsl(var(--signal-system))" } : {}),
                  }}
                  onClick={() => setDrawerRow(r)}
                >
                  {/* Row 1: SN + Name + Action badge */}
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div className="flex items-center gap-1.5 min-w-0 flex-1">
                      <span className="font-mono text-[10px] text-muted-foreground shrink-0">{r.netuid}</span>
                      <span className="font-mono text-[11px] text-foreground/85 font-medium truncate">{r.name}</span>
                      {SPECIAL_SUBNETS[r.netuid]?.isSystem && (
                        <span className="text-[7px] px-1 py-0.5 rounded font-bold shrink-0" style={{ background: "hsla(var(--signal-system), 0.08)", color: "hsl(var(--signal-system))", border: "1px solid hsla(var(--signal-system), 0.2)" }}>🔷</span>
                      )}
                      {r.isOverridden && (
                        <span className="text-[7px] px-1 py-0.5 rounded font-bold shrink-0" style={{ background: "hsla(var(--signal-break), 0.08)", color: "hsl(var(--signal-break))", border: "1px solid hsla(var(--signal-break), 0.2)" }}>⛔</span>
                      )}
                    </div>
                    <span className="font-mono text-[9px] font-bold px-2 py-0.5 rounded shrink-0" style={{
                      color: finalActionColor(fa),
                      background: finalActionBg(fa),
                    }}>
                      {finalActionIcon(fa)} {finalActionLabel(fa, fr)}
                    </span>
                  </div>

                  {/* Row 2: Key metrics grid */}
                  <div className="grid grid-cols-4 gap-1.5 mb-2">
                    <div className="text-center rounded bg-muted/20 py-1">
                      <div className="font-mono text-[7px] text-muted-foreground tracking-wider">CONV</div>
                      <div className="font-mono text-[10px] font-bold" style={{ color: convColor }}>{r.convictionLevel}</div>
                    </div>
                    <div className="text-center rounded bg-muted/20 py-1">
                      <div className="font-mono text-[7px] text-muted-foreground tracking-wider">RISK</div>
                      <div className="font-mono text-[10px] font-bold" style={{ color: riskColor(r.risk) }}>{r.risk}</div>
                    </div>
                    <div className="text-center rounded bg-muted/20 py-1">
                      <div className="font-mono text-[7px] text-muted-foreground tracking-wider">OPP</div>
                      <div className="font-mono text-[10px] font-bold" style={{ color: opportunityColor(r.opp) }}>{r.opp}</div>
                    </div>
                    <div className="text-center rounded bg-muted/20 py-1">
                      <div className="font-mono text-[7px] text-muted-foreground tracking-wider">MOM</div>
                      <div className="font-mono text-[10px] font-bold" style={{ color: r.momentumScore >= 55 ? "hsl(var(--signal-go))" : r.momentumScore >= 35 ? "hsl(var(--signal-go-spec))" : "hsl(var(--signal-break))" }}>{Math.round(r.momentumScore)}</div>
                    </div>
                  </div>

                  {/* Row 3: Secondary metrics + sparkline */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-[8px] text-muted-foreground" style={{ color: confianceColor(r.confianceScore) }}>Conf {r.confianceScore}%</span>
                      <span className="font-mono text-[8px]" style={{ color: liqColor }}>Liq {r.liquidityLevel === "HIGH" ? "●" : r.liquidityLevel === "MEDIUM" ? "◐" : "○"}</span>
                      <span className="font-mono text-[8px]" style={{ color: structColor }}>Str {r.structureLevel === "HEALTHY" ? "✓" : r.structureLevel === "FRAGILE" ? "~" : "✕"}</span>
                      {r.owned && <span className="text-[8px]" style={{ color: "hsl(var(--gold))" }}>★</span>}
                      {r.extLabel.startsWith("P") ? (
                        <span className="font-mono text-[7px] font-black px-1 py-0.5 rounded" style={{ background: "hsla(var(--signal-break), 0.12)", color: "hsl(var(--signal-break))", border: "1px solid hsla(var(--signal-break), 0.25)" }}>{r.extLabel}</span>
                      ) : r.extLabel === "WATCH" ? (
                        <span className="font-mono text-[7px] font-bold px-1 py-0.5 rounded" style={{ background: "hsla(var(--signal-go-spec), 0.1)", color: "hsl(var(--signal-go-spec))", border: "1px solid hsla(var(--signal-go-spec), 0.2)" }}>WATCH</span>
                      ) : null}
                    </div>
                    <SparklineMini data={r.spark} width={44} height={14} />
                  </div>

                  {/* Row 4: Signal */}
                  <div className="font-mono text-[9px] text-muted-foreground mt-1.5 truncate">{r.signalPrincipal}</div>
                </div>
              );
            })}
          </div>
        ) : (
          /* ── Desktop: classic table ── */
          <div className="rounded-xl overflow-hidden border border-border" style={{ boxShadow: "var(--shadow-card)" }}>
            <div className="overflow-x-auto" style={{ WebkitOverflowScrolling: "touch" }}>
              <table className="w-full font-mono" style={{ minWidth: isCompact ? 680 : 1100 }}>
                <thead>
                  <tr className="bg-muted/20 border-b border-border">
                    <th className="py-2.5 px-2.5 text-left font-mono text-[8px] tracking-wider uppercase text-muted-foreground sticky left-0 z-10 bg-background cursor-pointer" onClick={() => toggleSort("netuid")}>
                      SN {sortCol === "netuid" ? (sortDir === "desc" ? "▼" : "▲") : ""}
                    </th>
                    <th className="py-2.5 px-2.5 text-left font-mono text-[8px] tracking-wider uppercase text-muted-foreground sticky left-[44px] z-10 bg-background cursor-pointer" style={{ boxShadow: "4px 0 6px -2px hsla(0,0%,0%,0.3)" }} onClick={() => toggleSort("name")}>
                      Subnet {sortCol === "name" ? (sortDir === "desc" ? "▼" : "▲") : ""}
                    </th>
                    <SortHeader col="action" label="Action" align="center" />
                    <SortHeader col="conviction" label="Conv." align="center" />
                    <SortHeader col="risk" label="Risk" align="right" />
                    <SortHeader col="opp" label="Opp." align="right" />
                    <th className="py-2.5 px-2.5 text-left font-mono text-[8px] tracking-wider uppercase text-muted-foreground whitespace-nowrap">Signal</th>
                    <th className="py-2.5 px-2.5 text-center font-mono text-[8px] tracking-wider uppercase text-muted-foreground whitespace-nowrap">{fr ? "Ext." : "Ext."}</th>
                    {!isCompact && (
                      <>
                        <SortHeader col="confidence" label="Conf." align="right" />
                        <SortHeader col="momentum" label="Mom." align="right" />
                        <SortHeader col="liquidity" label="Liq." align="center" />
                        <SortHeader col="stability" label="Struct." align="center" />
                        <th className="py-2.5 px-2.5 text-center font-mono text-[8px] tracking-wider uppercase text-muted-foreground whitespace-nowrap">PF</th>
                      </>
                    )}
                    <th className="py-2.5 px-2.5 text-center font-mono text-[8px] tracking-wider uppercase text-muted-foreground">7d</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr>
                      <td colSpan={isCompact ? 8 : 13} className="py-12 text-center text-muted-foreground text-[11px]">
                        {fr ? "Aucun subnet ne correspond aux filtres actifs." : "No subnets match active filters."}
                      </td>
                    </tr>
                  ) : rows.map((r) => {
                    const fa = r.decision.finalAction;
                    const isSystemRow = r.decision.isSystem;
                    const convColor = r.convictionLevel === "HIGH" ? "hsl(var(--signal-go))" : r.convictionLevel === "MEDIUM" ? "hsl(var(--signal-go-spec))" : "hsl(var(--muted-foreground))";
                    const liqColor = r.liquidityLevel === "HIGH" ? "hsl(var(--signal-go))" : r.liquidityLevel === "MEDIUM" ? "hsl(var(--signal-go-spec))" : "hsl(var(--signal-break))";
                    const structColor = r.structureLevel === "HEALTHY" ? "hsl(var(--signal-go))" : r.structureLevel === "FRAGILE" ? "hsl(var(--signal-go-spec))" : "hsl(var(--signal-break))";
                    return (
                      <tr
                        key={r.netuid}
                        className="transition-colors cursor-pointer hover:bg-accent/30"
                        style={{
                          borderBottom: "1px solid hsl(var(--border))",
                          ...(r.isOverridden ? { background: "hsla(var(--signal-break), 0.03)", borderLeft: "2px solid hsla(var(--signal-break), 0.4)" } : {}),
                          ...(isSystemRow && !r.isOverridden ? { background: "hsla(var(--signal-system), 0.02)", borderLeft: "2px solid hsla(var(--signal-system), 0.25)" } : {}),
                        }}
                        onClick={() => setDrawerRow(r)}
                      >
                        <td className="py-2 px-2.5 text-[10px] text-muted-foreground sticky left-0 z-[5] bg-background">{r.netuid}</td>
                        <td className="py-2 px-2.5 text-[10px] sticky left-[44px] z-[5] bg-background" style={{ boxShadow: "4px 0 6px -2px hsla(0,0%,0%,0.3)" }}>
                          <span className="text-foreground/85 font-medium">{r.name}</span>
                          {SPECIAL_SUBNETS[r.netuid]?.isSystem && (
                            <span className="ml-1.5 text-[7px] px-1 py-0.5 rounded font-bold" style={{ background: "hsla(var(--signal-system), 0.08)", color: "hsl(var(--signal-system))", border: "1px solid hsla(var(--signal-system), 0.2)" }}>
                              🔷 {fr ? SPECIAL_SUBNETS[r.netuid].label : SPECIAL_SUBNETS[r.netuid].labelEn}
                            </span>
                          )}
                          {!SPECIAL_SUBNETS[r.netuid]?.isSystem && SPECIAL_SUBNETS[r.netuid] && (
                            <span className="ml-1.5 text-[7px] px-1 py-0.5 rounded font-bold" style={{ background: "hsla(var(--signal-hold), 0.08)", color: "hsl(var(--signal-hold))", border: "1px solid hsla(var(--signal-hold), 0.2)" }}>
                              {fr ? SPECIAL_SUBNETS[r.netuid].label : SPECIAL_SUBNETS[r.netuid].labelEn}
                            </span>
                          )}
                          {r.isOverridden && (
                            <span className="ml-1.5 text-[7px] px-1 py-0.5 rounded font-bold" style={{ background: "hsla(var(--signal-break), 0.08)", color: "hsl(var(--signal-break))", border: "1px solid hsla(var(--signal-break), 0.2)" }}>⛔</span>
                          )}
                        </td>
                        <td className="py-2 px-2.5 text-center">
                          <span className="font-mono text-[9px] font-bold px-2 py-0.5 rounded" style={{
                            color: finalActionColor(fa),
                            background: finalActionBg(fa),
                          }}>
                            {finalActionIcon(fa)} {finalActionLabel(fa, fr)}
                          </span>
                        </td>
                        <td className="py-2 px-2.5 text-center">
                          <span className="font-mono text-[9px] font-bold" style={{ color: convColor }}>{r.convictionLevel}</span>
                        </td>
                        <td className="py-2 px-2.5 text-right font-mono text-[10px] font-bold" style={{ color: riskColor(r.risk) }}>{r.risk}</td>
                        <td className="py-2 px-2.5 text-right font-mono text-[10px]" style={{ color: opportunityColor(r.opp) }}>{r.opp}</td>
                        <td className="py-2 px-2.5 text-left font-mono text-[9px] text-muted-foreground truncate" style={{ maxWidth: 140 }}>{r.signalPrincipal}</td>
                        <td className="py-2 px-2.5 text-center">
                          {r.extLabel.startsWith("P") ? (
                            <span className="font-mono text-[8px] font-black px-1.5 py-0.5 rounded" style={{ background: "hsla(var(--signal-break), 0.12)", color: "hsl(var(--signal-break))", border: "1px solid hsla(var(--signal-break), 0.25)" }}>
                              {r.extLabel}
                            </span>
                          ) : r.extLabel === "WATCH" ? (
                            <span className="font-mono text-[7px] font-bold px-1.5 py-0.5 rounded" style={{ background: "hsla(var(--signal-go-spec), 0.1)", color: "hsl(var(--signal-go-spec))", border: "1px solid hsla(var(--signal-go-spec), 0.2)" }}>
                              WATCH
                            </span>
                          ) : (
                            <span className="text-muted-foreground text-[9px]">—</span>
                          )}
                        </td>
                        {!isCompact && (
                          <>
                            <td className="py-2 px-2.5 text-right font-mono text-[10px]" style={{ color: confianceColor(r.confianceScore) }}>{r.confianceScore}%</td>
                            <td className="py-2 px-2.5 text-right font-mono text-[10px]" style={{ color: r.momentumScore >= 55 ? "hsl(var(--signal-go))" : r.momentumScore >= 35 ? "hsl(var(--signal-go-spec))" : "hsl(var(--signal-break))" }}>{Math.round(r.momentumScore)}</td>
                            <td className="py-2 px-2.5 text-center">
                              <span className="font-mono text-[9px]" style={{ color: liqColor }}>{r.liquidityLevel === "HIGH" ? "●" : r.liquidityLevel === "MEDIUM" ? "◐" : "○"}</span>
                            </td>
                            <td className="py-2 px-2.5 text-center">
                              <span className="font-mono text-[9px]" style={{ color: structColor }}>{r.structureLevel === "HEALTHY" ? "✓" : r.structureLevel === "FRAGILE" ? "~" : "✕"}</span>
                            </td>
                            <td className="py-2 px-2.5 text-center">
                              {r.owned ? <span className="text-[9px]" style={{ color: "hsl(var(--gold))" }}>★</span> : <span className="text-muted-foreground">—</span>}
                            </td>
                          </>
                        )}
                        <td className="py-2 px-2.5 text-center">
                          <SparklineMini data={r.spark} width={44} height={14} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      <QuickViewDrawer row={drawerRow} open={!!drawerRow} onClose={() => setDrawerRow(null)} fr={fr} onAddWatchlist={(netuid) => addPosition(netuid, 0)} />
    </div>
  );
}
