import React, { useMemo, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useI18n } from "@/lib/i18n";
import { useLocalPortfolio } from "@/hooks/use-local-portfolio";
import { useSubnetScores, type UnifiedSubnetScore, SPECIAL_SUBNETS } from "@/hooks/use-subnet-scores";
import { useSubnetVerdicts, type SubnetVerdictData } from "@/hooks/use-subnet-verdict";
import { useIsMobile } from "@/hooks/use-mobile";
import { PageHeader, SectionHeader, StatusBadge, ActionBadge, ConfidenceBar, SparklineMini, FilterChipGroup } from "@/components/sentinel";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import DataAlignmentBadge from "@/components/DataAlignmentBadge";
import SwipeHint from "@/components/SwipeHint";
import {
  opportunityColor, riskColor, stabilityColor,
  type SmartCapitalState,
} from "@/lib/gauge-engine";
import {
  actionColor, actionIcon,
} from "@/lib/strategy-engine";
import { confianceColor } from "@/lib/data-fusion";

/* ═══════════════════════════════════════════════ */
/*   SUBNET INTELLIGENCE — Unified Master Table   */
/* ═══════════════════════════════════════════════ */

/* ─── Filter types ─── */
type ActionFilter = "ALL" | "ENTER" | "HOLD" | "EXIT";
type StatusFilter = "ALL" | "OK" | "WATCH" | "DANGER";
type ConvictionFilter = "ALL" | "HIGH" | "MEDIUM" | "LOW";
type ScopeFilter = "ALL" | "PORTFOLIO" | "WATCHLIST";
type LiquidityFilter = "ALL" | "HIGH" | "MEDIUM" | "LOW";
type StructureFilter = "ALL" | "HEALTHY" | "FRAGILE" | "CONCENTRATED";

type SortCol = "netuid" | "name" | "action" | "conviction" | "confidence" | "risk" | "momentum" | "opp" | "liquidity" | "stability" | null;

/* ─── Enriched row type ─── */
type TableRow = UnifiedSubnetScore & {
  owned: boolean;
  spark: number[];
  verdict?: SubnetVerdictData;
  convictionLevel: "HIGH" | "MEDIUM" | "LOW";
  liquidityLevel: "HIGH" | "MEDIUM" | "LOW";
  structureLevel: "HEALTHY" | "FRAGILE" | "CONCENTRATED";
  statusLevel: "OK" | "WATCH" | "DANGER";
  signalPrincipal: string;
};

/* ─── Helpers ─── */
function convictionFromScore(score: number): "HIGH" | "MEDIUM" | "LOW" {
  return score >= 70 ? "HIGH" : score >= 40 ? "MEDIUM" : "LOW";
}
function liquidityFromHealth(health: number): "HIGH" | "MEDIUM" | "LOW" {
  return health >= 60 ? "HIGH" : health >= 30 ? "MEDIUM" : "LOW";
}
function structureFromStability(stability: number, isOverridden: boolean): "HEALTHY" | "FRAGILE" | "CONCENTRATED" {
  if (isOverridden) return "CONCENTRATED";
  return stability >= 60 ? "HEALTHY" : stability >= 35 ? "FRAGILE" : "CONCENTRATED";
}
function statusFromSystem(s: UnifiedSubnetScore): "OK" | "WATCH" | "DANGER" {
  if (s.isOverridden || s.systemStatus === "ZONE_CRITIQUE" || s.systemStatus === "DEPEG" || s.systemStatus === "DEREGISTRATION") return "DANGER";
  if (s.isWarning || s.systemStatus === "SURVEILLANCE") return "WATCH";
  return "OK";
}
function mainSignal(s: UnifiedSubnetScore, fr: boolean): string {
  if (s.isOverridden) return s.overrideReasons[0] || (fr ? "Zone critique" : "Critical zone");
  if (s.depegProbability >= 50) return fr ? `Depeg ${s.depegProbability}%` : `Depeg ${s.depegProbability}%`;
  if (s.delistCategory !== "NORMAL") return fr ? "Risque delist" : "Delist risk";
  if (s.action === "ENTER" && s.opp > 60) return fr ? "Forte opportunité" : "Strong opportunity";
  if (s.action === "EXIT") return fr ? "Signal de sortie" : "Exit signal";
  if (s.momentumScore >= 70) return fr ? "Momentum haussier" : "Bullish momentum";
  if (s.risk > 60) return fr ? "Risque élevé" : "High risk";
  return fr ? "Stable" : "Stable";
}


/* ─── Saved views ─── */
const SAVED_VIEWS_KEY = "sentinel-subnet-views";
type SavedView = { name: string; filters: { scope: ScopeFilter; action: ActionFilter; status: StatusFilter; conviction: ConvictionFilter; liquidity: LiquidityFilter; structure: StructureFilter } };

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
  const thesis = verdict?.positiveReasons?.slice(0, 3) || [];
  const invalidation = verdict?.negativeReasons?.slice(0, 3) || [];


  /* Alerts */
  const alerts: { icon: string; text: string; color: string }[] = [];
  if (row.isOverridden) alerts.push({ icon: "⛔", text: fr ? "Override actif — sortie forcée" : "Active override — forced exit", color: "hsl(var(--destructive))" });
  if (row.depegProbability >= 50) alerts.push({ icon: "⚠", text: `Depeg ${row.depegProbability}%`, color: "hsl(var(--signal-go-spec))" });
  if (row.delistCategory !== "NORMAL") alerts.push({ icon: "🔴", text: fr ? `Risque delist (${row.delistCategory})` : `Delist risk (${row.delistCategory})`, color: "hsl(var(--destructive))" });
  if (row.dataUncertain) alerts.push({ icon: "❓", text: fr ? "Données incertaines" : "Uncertain data", color: "hsl(var(--muted-foreground))" });

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full sm:w-[420px] border-l border-border bg-background text-foreground overflow-y-auto p-0">
        {/* ── Header: SN + Action + Signal ── */}
        <div className="px-5 pt-5 pb-4 border-b border-border">
          <SheetHeader>
            <div className="flex items-center justify-between">
              <SheetTitle className="font-mono tracking-wider text-sm text-foreground/90">
                <span className="text-muted-foreground/50 mr-1.5">SN-{row.netuid}</span>
                {row.name}
              </SheetTitle>
              <StatusBadge type={row.statusLevel === "DANGER" ? "danger" : row.statusLevel === "WATCH" ? "warning" : "success"} label={row.statusLevel} />
            </div>
          </SheetHeader>
          <div className="flex items-center justify-between mt-3">
            <ActionBadge action={row.action === "ENTER" ? "RENTRE" : row.action === "EXIT" ? "SORS" : row.action === "STAKE" ? "RENFORCER" : "HOLD"} />
            <span className="font-mono text-[11px] font-bold text-foreground/80">{row.signalPrincipal}</span>
          </div>
        </div>

        {/* ── Body ── */}
        <div className="px-5 py-4 space-y-4">

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
              <span className="font-mono text-[7px] text-muted-foreground/50 tracking-widest uppercase">7D</span>
              <SparklineMini data={row.spark} width={120} height={24} />
            </div>
          )}

          {/* Thesis */}
          {thesis.length > 0 && (
            <div className="rounded-lg p-3 bg-primary/[0.03] border border-primary/10">
              <div className="font-mono text-[7px] text-muted-foreground/50 tracking-widest uppercase mb-2">
                {fr ? "THÈSE" : "THESIS"}
              </div>
              {thesis.map((r, i) => <div key={i} className="font-mono text-[11px] text-foreground/75 mb-1">+ {r}</div>)}
            </div>
          )}

          {/* Invalidation */}
          {invalidation.length > 0 && (
            <div className="rounded-lg p-3 bg-destructive/[0.03] border border-destructive/10">
              <div className="font-mono text-[7px] text-muted-foreground/50 tracking-widest uppercase mb-2">
                INVALIDATION
              </div>
              {invalidation.map((r, i) => <div key={i} className="font-mono text-[11px] text-foreground/75 mb-1">− {r}</div>)}
            </div>
          )}

          {/* Active alerts */}
          {alerts.length > 0 && (
            <div className="rounded-lg p-3 border border-destructive/15 bg-destructive/[0.03]">
              <div className="font-mono text-[7px] text-muted-foreground/50 tracking-widest uppercase mb-2">
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
            <div className="text-center font-mono text-[9px] text-muted-foreground/50 py-1">
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
      <div className="font-mono text-[7px] text-muted-foreground/65 tracking-wider uppercase">{label}</div>
      <div className="font-mono text-sm font-bold mt-0.5" style={{ color }}>{value}</div>
    </div>
  );
}

/* ─── Filter label helpers ─── */
function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="font-mono text-[7px] tracking-widest uppercase text-muted-foreground/40">{label}</span>
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
  const { scoresList, sparklines, scoreTimestamp, dataAlignment, dataAgeDebug } = useSubnetScores();
  const { verdicts, countRentre, countHold, countSors, isLoading: verdictLoading } = useSubnetVerdicts();

  // ── Filters ──
  const [scope, setScope] = useState<ScopeFilter>("ALL");
  const [actionFilter, setActionFilter] = useState<ActionFilter>("ALL");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [convictionFilter, setConvictionFilter] = useState<ConvictionFilter>("ALL");
  const [liquidityFilter, setLiquidityFilter] = useState<LiquidityFilter>("ALL");
  const [structureFilter, setStructureFilter] = useState<StructureFilter>("ALL");
  const [search, setSearch] = useState("");
  const [sortCol, setSortCol] = useState<SortCol>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [drawerRow, setDrawerRow] = useState<TableRow | null>(null);
  const [savedViews, setSavedViews] = useState<SavedView[]>(() => loadSavedViews());

  const hasActiveFilters = scope !== "ALL" || actionFilter !== "ALL" || statusFilter !== "ALL" || convictionFilter !== "ALL" || liquidityFilter !== "ALL" || structureFilter !== "ALL" || search.length > 0;

  const resetFilters = useCallback(() => {
    setScope("ALL"); setActionFilter("ALL"); setStatusFilter("ALL");
    setConvictionFilter("ALL"); setLiquidityFilter("ALL"); setStructureFilter("ALL");
    setSearch("");
  }, []);

  const saveCurrentView = useCallback(() => {
    const name = prompt(fr ? "Nom de la vue :" : "View name:");
    if (!name) return;
    const view: SavedView = { name, filters: { scope, action: actionFilter, status: statusFilter, conviction: convictionFilter, liquidity: liquidityFilter, structure: structureFilter } };
    const updated = [...savedViews, view];
    setSavedViews(updated);
    localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify(updated));
  }, [scope, actionFilter, statusFilter, convictionFilter, liquidityFilter, structureFilter, savedViews, fr]);

  const loadView = useCallback((view: SavedView) => {
    setScope(view.filters.scope); setActionFilter(view.filters.action); setStatusFilter(view.filters.status);
    setConvictionFilter(view.filters.conviction); setLiquidityFilter(view.filters.liquidity); setStructureFilter(view.filters.structure);
  }, []);

  const toggleSort = useCallback((col: SortCol) => {
    if (sortCol === col) {
      if (sortDir === "desc") setSortDir("asc");
      else { setSortCol(null); setSortDir("desc"); }
    } else { setSortCol(col); setSortDir("desc"); }
  }, [sortCol, sortDir]);

  // ── Build enriched rows ──
  const rows = useMemo<TableRow[]>(() => {
    const searchLower = search.toLowerCase();
    return scoresList
      .map(s => {
        const verdict = verdicts.get(s.netuid);
        const convictionScore = verdict ? Math.max(verdict.entryScore, verdict.holdScore) : Math.abs(s.opp - s.risk) * (s.conf / 100);
        return {
          ...s,
          owned: ownedNetuids.has(s.netuid),
          spark: sparklines?.get(s.netuid) || [],
          verdict,
          convictionLevel: convictionFromScore(convictionScore),
          liquidityLevel: liquidityFromHealth(s.healthScores.liquidityHealth),
          structureLevel: structureFromStability(s.stability, s.isOverridden),
          statusLevel: statusFromSystem(s),
          signalPrincipal: mainSignal(s, fr),
        } as TableRow;
      })
      .filter(r => {
        if (search && !r.name.toLowerCase().includes(searchLower) && !String(r.netuid).includes(searchLower)) return false;
        if (scope === "PORTFOLIO" && !r.owned) return false;
        if (actionFilter === "ENTER" && r.action !== "ENTER") return false;
        if (actionFilter === "HOLD" && r.action !== "HOLD" && r.action !== "STAKE" && r.action !== "NEUTRAL" && r.action !== "WATCH") return false;
        if (actionFilter === "EXIT" && r.action !== "EXIT") return false;
        if (statusFilter === "OK" && r.statusLevel !== "OK") return false;
        if (statusFilter === "WATCH" && r.statusLevel !== "WATCH") return false;
        if (statusFilter === "DANGER" && r.statusLevel !== "DANGER") return false;
        if (convictionFilter !== "ALL" && r.convictionLevel !== convictionFilter) return false;
        if (liquidityFilter !== "ALL" && r.liquidityLevel !== liquidityFilter) return false;
        if (structureFilter !== "ALL" && r.structureLevel !== structureFilter) return false;
        return true;
      })
      .sort((a, b) => {
        if (sortCol) {
          let av = 0, bv = 0;
          switch (sortCol) {
            case "netuid": av = a.netuid; bv = b.netuid; break;
            case "name": return sortDir === "desc" ? b.name.localeCompare(a.name) : a.name.localeCompare(b.name);
            case "action": {
              const rank = (x: string) => ["EXIT","NEUTRAL","WATCH","HOLD","STAKE","ENTER"].indexOf(x);
              av = rank(a.action); bv = rank(b.action); break;
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
  }, [scoresList, sparklines, verdicts, ownedNetuids, search, scope, actionFilter, statusFilter, convictionFilter, liquidityFilter, structureFilter, sortCol, sortDir, fr]);

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

  

  return (
    <div className="h-full w-full bg-background text-foreground overflow-y-auto overflow-x-hidden">
      <div className="px-4 sm:px-6 py-4 max-w-[1400px] mx-auto space-y-4">

        {/* ═══ HEADER ═══ */}
        <PageHeader
          title="Subnet Intelligence"
          subtitle={fr
            ? "Vue maître de tous les subnets — filtrable par action, risque, conviction et portefeuille."
            : "Master view of all subnets — filterable by action, risk, conviction, and portfolio."}
          icon="📋"
          badge={<DataAlignmentBadge dataAlignment={dataAlignment} dataAgeDebug={dataAgeDebug} className="text-[7px] px-1.5" />}
          actions={
            <span className="font-mono text-[8px] text-muted-foreground/65">
              {scoresList.length} subnets · {new Date(scoreTimestamp).toLocaleTimeString()}
            </span>
          }
        />

        {/* Verdict counts integrated into filter bar below — no separate distribution bar */}

        {/* ═══ FILTER BAR ═══ */}
        <div className="rounded-xl p-3 space-y-2.5" style={{ background: "hsla(0,0%,100%,0.015)", border: "1px solid hsla(0,0%,100%,0.05)" }}>
          {/* Search + controls row */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative flex-1" style={{ minWidth: 180, maxWidth: 300 }}>
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder={fr ? "Rechercher un subnet…" : "Search subnet…"}
                className="w-full font-mono text-[11px] px-3 py-1.5 rounded-lg bg-background text-foreground placeholder:text-muted-foreground/40"
                style={{ border: "1px solid hsla(0,0%,100%,0.08)" }}
              />
            </div>
            {hasActiveFilters && (
              <button onClick={resetFilters} className="font-mono text-[9px] px-2.5 py-1 rounded-lg transition-colors hover:bg-accent" style={{ color: "hsl(var(--destructive))", border: "1px solid hsla(var(--destructive), 0.15)" }}>
                ✕ {fr ? "Reset" : "Reset"}
              </button>
            )}
            <button onClick={saveCurrentView} className="font-mono text-[9px] px-2.5 py-1 rounded-lg text-muted-foreground/65 hover:text-foreground transition-colors" style={{ border: "1px solid hsla(0,0%,100%,0.06)" }}>
              💾 {fr ? "Sauvegarder" : "Save view"}
            </button>
            {savedViews.length > 0 && savedViews.map((v, i) => (
              <button key={i} onClick={() => loadView(v)} className="font-mono text-[8px] px-2 py-1 rounded text-muted-foreground/65 hover:text-foreground transition-colors" style={{ background: "hsla(var(--gold), 0.04)", border: "1px solid hsla(var(--gold), 0.08)" }}>
                {v.name}
              </button>
            ))}
          </div>

          {/* Filter chips — labeled groups */}
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
                  { key: "ENTER", label: fr ? "Entrer" : "Enter", count: countRentre || undefined },
                  { key: "HOLD", label: fr ? "Attendre" : "Hold", count: countHold || undefined },
                  { key: "EXIT", label: fr ? "Sortir" : "Exit", count: countSors || undefined },
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
          </div>
          {/* Second row — advanced filters */}
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
            <span className="ml-auto font-mono text-[9px] text-muted-foreground/65 self-end pb-0.5">
              {rows.length} / {scoresList.length} {fr ? "résultats" : "results"}
            </span>
          </div>
        </div>

        {/* ═══ MASTER TABLE ═══ */}
        <SwipeHint storageKey="swipe-subnets-v4" />

        <div className="rounded-xl overflow-hidden" style={{ border: "1px solid hsla(0,0%,100%,0.05)" }}>
          <div className="overflow-x-auto" style={{ WebkitOverflowScrolling: "touch" }}>
            <table className="w-full font-mono" style={{ minWidth: 1100 }}>
              <thead>
                <tr style={{ background: "hsla(0,0%,100%,0.02)", borderBottom: "1px solid hsla(0,0%,100%,0.06)" }}>
                  <th className="py-2.5 px-2.5 text-left font-mono text-[8px] tracking-wider uppercase text-muted-foreground/65 sticky left-0 z-10 bg-background cursor-pointer" onClick={() => toggleSort("netuid")}>
                    SN {sortCol === "netuid" ? (sortDir === "desc" ? "▼" : "▲") : ""}
                  </th>
                  <th className="py-2.5 px-2.5 text-left font-mono text-[8px] tracking-wider uppercase text-muted-foreground/65 sticky left-[44px] z-10 bg-background cursor-pointer" style={{ boxShadow: "4px 0 6px -2px hsla(0,0%,0%,0.3)" }} onClick={() => toggleSort("name")}>
                    Subnet {sortCol === "name" ? (sortDir === "desc" ? "▼" : "▲") : ""}
                  </th>
                  <SortHeader col="action" label="Action" align="center" />
                  <SortHeader col="conviction" label="Conviction" align="center" />
                  <SortHeader col="confidence" label="Conf." align="right" />
                  <SortHeader col="risk" label="Risk" align="right" />
                  <SortHeader col="momentum" label="Mom." align="right" />
                  <SortHeader col="opp" label="Opp." align="right" />
                  <SortHeader col="liquidity" label={fr ? "Liq." : "Liq."} align="center" />
                  <SortHeader col="stability" label="Structure" align="center" />
                  <th className="py-2.5 px-2.5 text-center font-mono text-[8px] tracking-wider uppercase text-muted-foreground/65 whitespace-nowrap">Fit</th>
                  <th className="py-2.5 px-2.5 text-left font-mono text-[8px] tracking-wider uppercase text-muted-foreground/65 whitespace-nowrap">Signal</th>
                  <th className="py-2.5 px-2.5 text-center font-mono text-[8px] tracking-wider uppercase text-muted-foreground/65">7d</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={13} className="py-12 text-center text-muted-foreground/65 text-[11px]">
                      {fr ? "Aucun subnet ne correspond aux filtres actifs." : "No subnets match active filters."}
                    </td>
                  </tr>
                ) : rows.map((r, idx) => {
                  const actionLabel = r.action === "ENTER" ? (fr ? "Entrer" : "Enter") : r.action === "EXIT" ? (fr ? "Sortir" : "Exit") : r.action === "HOLD" ? "Hold" : r.action === "STAKE" ? "Stake" : r.action;
                  const convColor = r.convictionLevel === "HIGH" ? "hsl(var(--signal-go))" : r.convictionLevel === "MEDIUM" ? "hsl(var(--signal-go-spec))" : "hsl(var(--muted-foreground))";
                  const liqColor = r.liquidityLevel === "HIGH" ? "hsl(var(--signal-go))" : r.liquidityLevel === "MEDIUM" ? "hsl(var(--signal-go-spec))" : "hsl(var(--signal-break))";
                  const structColor = r.structureLevel === "HEALTHY" ? "hsl(var(--signal-go))" : r.structureLevel === "FRAGILE" ? "hsl(var(--signal-go-spec))" : "hsl(var(--signal-break))";
                  return (
                    <tr
                      key={r.netuid}
                      className="transition-colors cursor-pointer hover:bg-accent/30"
                      style={{
                        borderBottom: "1px solid hsla(0,0%,100%,0.03)",
                        ...(r.isOverridden ? { background: "hsla(var(--signal-break), 0.03)", borderLeft: "2px solid hsla(var(--signal-break), 0.4)" } : {}),
                      }}
                      onClick={() => setDrawerRow(r)}
                    >
                      <td className="py-2 px-2.5 text-[10px] text-muted-foreground/80 sticky left-0 z-[5] bg-background">{r.netuid}</td>
                      <td className="py-2 px-2.5 text-[10px] sticky left-[44px] z-[5] bg-background" style={{ boxShadow: "4px 0 6px -2px hsla(0,0%,0%,0.3)" }}>
                        <span className="text-foreground/85 font-medium">{r.name}</span>
                        {SPECIAL_SUBNETS[r.netuid] && (
                          <span className="ml-1.5 text-[7px] px-1 py-0.5 rounded font-bold" style={{ background: "hsla(var(--signal-hold), 0.08)", color: "hsl(var(--signal-hold))", border: "1px solid hsla(var(--signal-hold), 0.2)" }}>
                            {SPECIAL_SUBNETS[r.netuid].label}
                          </span>
                        )}
                        {r.isOverridden && (
                          <span className="ml-1.5 text-[7px] px-1 py-0.5 rounded font-bold" style={{ background: "hsla(var(--signal-break), 0.08)", color: "hsl(var(--signal-break))", border: "1px solid hsla(var(--signal-break), 0.2)" }}>⛔</span>
                        )}
                      </td>
                      <td className="py-2 px-2.5 text-center">
                        <span className="font-mono text-[9px] font-bold px-2 py-0.5 rounded" style={{ color: actionColor(r.action), background: `color-mix(in srgb, ${actionColor(r.action)} 8%, transparent)` }}>
                          {actionIcon(r.action)} {actionLabel}
                        </span>
                      </td>
                      <td className="py-2 px-2.5 text-center">
                        <span className="font-mono text-[9px] font-bold" style={{ color: convColor }}>{r.convictionLevel}</span>
                      </td>
                      <td className="py-2 px-2.5 text-right font-mono text-[10px]" style={{ color: confianceColor(r.confianceScore) }}>{r.confianceScore}%</td>
                      <td className="py-2 px-2.5 text-right font-mono text-[10px] font-bold" style={{ color: riskColor(r.risk) }}>{r.risk}</td>
                      <td className="py-2 px-2.5 text-right font-mono text-[10px]" style={{ color: r.momentumScore >= 55 ? "hsl(var(--signal-go))" : r.momentumScore >= 35 ? "hsl(var(--signal-go-spec))" : "hsl(var(--signal-break))" }}>{Math.round(r.momentumScore)}</td>
                      <td className="py-2 px-2.5 text-right font-mono text-[10px]" style={{ color: opportunityColor(r.opp) }}>{r.opp}</td>
                      <td className="py-2 px-2.5 text-center">
                        <span className="font-mono text-[9px]" style={{ color: liqColor }}>{r.liquidityLevel === "HIGH" ? "●" : r.liquidityLevel === "MEDIUM" ? "◐" : "○"}</span>
                      </td>
                      <td className="py-2 px-2.5 text-center">
                        <span className="font-mono text-[9px]" style={{ color: structColor }}>{r.structureLevel === "HEALTHY" ? "✓" : r.structureLevel === "FRAGILE" ? "~" : "✕"}</span>
                      </td>
                      <td className="py-2 px-2.5 text-center">
                        {r.owned ? <span className="text-[9px]" style={{ color: "hsl(var(--gold))" }}>★</span> : <span className="text-muted-foreground/30">—</span>}
                      </td>
                      <td className="py-2 px-2.5 text-left font-mono text-[9px] text-muted-foreground/70 truncate" style={{ maxWidth: 140 }}>{r.signalPrincipal}</td>
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
      </div>

      <QuickViewDrawer row={drawerRow} open={!!drawerRow} onClose={() => setDrawerRow(null)} fr={fr} onAddWatchlist={(netuid) => addPosition(netuid, 0)} />
    </div>
  );
}
