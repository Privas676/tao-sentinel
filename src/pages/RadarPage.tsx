import React, { useMemo, useState, useCallback } from "react";
import { useStakeAnalytics, type SubnetRadarData } from "@/hooks/use-stake-analytics";
import {
  healthIndexColor,
  momentumColor as capitalMomentumColor,
  dumpRiskColor,
  radarScoreColor,
  narrativeScoreColor,
  smartMoneyColor,
  bubbleScoreColor,
  manipulationScoreColor,
  inefficiencyColor,
  ammEfficiencyColor,
} from "@/lib/stake-analytics";
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from "@/components/ui/table";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import Sparkline from "@/components/radar/Sparkline";
import TreemapHeatmap from "@/components/radar/TreemapHeatmap";
import AMMPricingTable from "@/components/radar/AMMPricingTable";

/* ─── Burn Ratio formatter: capped values flagged ─── */
function formatBurnRatio(ratio: number): React.ReactNode {
  if (ratio <= 0) return "—";
  if (ratio >= 10) return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="cursor-help" style={{ color: "rgba(255,193,7,0.9)" }}>
          ≥1000%<span className="ml-0.5">⚠</span>
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[220px] text-[10px] leading-snug">
        Valeur brute suspecte — probablement un artefact de données source (cumul ou erreur API). Capée à 1000% pour l'affichage.
      </TooltipContent>
    </Tooltip>
  );
  const pct = ratio * 100;
  if (pct < 0.01) return "<0.01%";
  if (pct < 0.1) return `${pct.toFixed(2)}%`;
  if (pct < 10) return `${pct.toFixed(1)}%`;
  return `${pct.toFixed(0)}%`;
}

const BURN_RATIO_TOOLTIP = "Burn Ratio = recyclePerDay ÷ emissionsPerDay\nMesure la part des émissions quotidiennes recyclée (brûlée) par le protocole. Plus le ratio est élevé, plus le subnet est déflationniste.";

/* ─── Score Badge ─── */
function ScoreBadge({ value, colorFn, label, suffix }: { value: number; colorFn: (v: number) => string; label: string; suffix?: string }) {
  return (
    <div className="rounded-lg p-3 text-center" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
      <div className="font-mono text-[9px] tracking-widest uppercase text-muted-foreground mb-1">{label}</div>
      <div className="font-mono text-xl font-bold" style={{ color: colorFn(value) }}>{value}{suffix}</div>
    </div>
  );
}

/* ─── Pct Change ─── */
function PctChange({ value }: { value: number }) {
  if (!isFinite(value)) return <span className="font-mono text-xs text-muted-foreground/40">—</span>;
  const color = value > 0 ? "rgba(76,175,80,0.8)" : value < 0 ? "rgba(229,57,53,0.7)" : "rgba(255,255,255,0.3)";
  return <span className="font-mono text-xs" style={{ color }}>{value > 0 ? "+" : ""}{value.toFixed(1)}%</span>;
}

/* ─── Alert Badge ─── */
function AlertBadge({ active, label, emoji, variant = "warn" }: { active: boolean; label: string; emoji: string; variant?: "warn" | "danger" | "info" | "success" }) {
  if (!active) return null;
  const colors = {
    warn: { bg: "rgba(255,193,7,0.15)", fg: "rgba(255,193,7,0.9)", border: "rgba(255,193,7,0.3)" },
    danger: { bg: "rgba(229,57,53,0.15)", fg: "rgba(229,57,53,0.9)", border: "rgba(229,57,53,0.3)" },
    info: { bg: "rgba(100,181,246,0.15)", fg: "rgba(100,181,246,0.9)", border: "rgba(100,181,246,0.3)" },
    success: { bg: "rgba(76,175,80,0.15)", fg: "rgba(76,175,80,0.9)", border: "rgba(76,175,80,0.3)" },
  }[variant];
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-mono text-[10px] font-semibold"
      style={{ background: colors.bg, color: colors.fg, border: `1px solid ${colors.border}` }}>
      {emoji} {label}
    </span>
  );
}

/* ─── Signal Chip ─── */
function SignalChip({ label, color }: { label: string; color: "red" | "orange" | "green" | "blue" | "purple" }) {
  const styles = {
    red: { bg: "rgba(229,57,53,0.15)", fg: "rgba(229,57,53,0.9)" },
    orange: { bg: "rgba(255,109,0,0.15)", fg: "rgba(255,109,0,0.9)" },
    green: { bg: "rgba(76,175,80,0.15)", fg: "rgba(76,175,80,0.9)" },
    blue: { bg: "rgba(100,181,246,0.15)", fg: "rgba(100,181,246,0.9)" },
    purple: { bg: "rgba(156,39,176,0.15)", fg: "rgba(156,39,176,0.9)" },
  }[color];
  return (
    <span className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: styles.bg, color: styles.fg }}>
      {label}
    </span>
  );
}

/* ─── Tabs ─── */
type TabKey = "capital" | "adoption" | "risk" | "amm" | "heatmap" | "smartmoney" | "validator" | "economics";
const TABS: { key: TabKey; label: string; icon: string }[] = [
  { key: "capital", label: "Capital Flow", icon: "💰" },
  { key: "adoption", label: "Adoption", icon: "🚀" },
  { key: "risk", label: "Risk Monitor", icon: "⚠️" },
  { key: "amm", label: "AMM / Pricing", icon: "💎" },
  { key: "validator", label: "Validators", icon: "🔍" },
  { key: "economics", label: "Economics", icon: "📊" },
  { key: "heatmap", label: "Heatmap", icon: "🔥" },
  { key: "smartmoney", label: "Smart Money", icon: "🐋" },
];

/* ─── Helpers ─── */
function formatTao(v: number): string {
  if (!isFinite(v) || v < 0) return "—";
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}Mτ`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(0)}Kτ`;
  return `${Math.round(v)}τ`;
}

function formatMcap(v: number): string {
  if (!isFinite(v) || v < 0) return "—";
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
  if (v > 0) return v.toFixed(0);
  return "—";
}

function formatHolders(v: number): string {
  if (v <= 0) return "N/A";
  return String(v);
}

function generateCapitalSparkline(d: SubnetRadarData): number[] {
  const base = 50;
  const delta = d.stakeChange7dPct / 7;
  return Array.from({ length: 7 }, (_, i) => base + delta * (i - 3) + (Math.sin(i * 1.2) * 2));
}

function generateAdoptionSparkline(d: SubnetRadarData): number[] {
  const base = d.scores.healthIndex;
  const trend = (d.deltas.holdersGrowth7d + d.deltas.minersGrowth7d) * 50;
  const step = trend / 7;
  return Array.from({ length: 7 }, (_, i) => base - trend / 2 + step * i + (Math.cos(i * 0.8) * 1.5));
}

/* ─── SORTABLE COLUMN HEADER ─── */
type SortDir = "asc" | "desc";
type SortState<K extends string> = { key: K; dir: SortDir } | null;

function SortableHead<K extends string>({
  label, sortKey, sort, onSort, className = "",
}: { label: React.ReactNode; sortKey: K; sort: SortState<K>; onSort: (k: K) => void; className?: string }) {
  const active = sort?.key === sortKey;
  return (
    <TableHead
      className={`font-mono text-[10px] cursor-pointer select-none hover:text-foreground transition-colors ${className}`}
      onClick={() => onSort(sortKey)}
    >
      <span className="inline-flex items-center gap-0.5">
        {label}
        <span className="text-[8px]" style={{ opacity: active ? 1 : 0.25 }}>
          {active ? (sort!.dir === "desc" ? "▼" : "▲") : "⇅"}
        </span>
      </span>
    </TableHead>
  );
}

function useSortState<K extends string>(defaultKey: K, defaultDir: SortDir = "desc") {
  const [sort, setSort] = useState<SortState<K>>({ key: defaultKey, dir: defaultDir });
  const toggle = useCallback((key: K) => {
    setSort(prev => {
      if (prev?.key === key) return { key, dir: prev.dir === "desc" ? "asc" : "desc" };
      return { key, dir: "desc" };
    });
  }, []);
  return { sort, toggle };
}

function sortData<K extends string>(
  data: SubnetRadarData[],
  sort: SortState<K>,
  accessor: Record<K, (d: SubnetRadarData) => number>,
): SubnetRadarData[] {
  if (!sort) return data;
  const fn = accessor[sort.key];
  if (!fn) return data;
  const dir = sort.dir === "desc" ? -1 : 1;
  return [...data].sort((a, b) => (fn(a) - fn(b)) * dir);
}

/* ═══════════════════════════════════════ */
/*        RADAR PAGE                       */
/* ═══════════════════════════════════════ */
export default function RadarPage() {
  const { data: radarData, isLoading, error } = useStakeAnalytics();
  const [activeTab, setActiveTab] = useState<TabKey>("capital");
  const [search, setSearch] = useState("");

  // Filter out SN-0 from speculative radar
  const specData = useMemo(() => {
    if (!radarData?.length) return [];
    return radarData.filter(d => d.netuid !== 0);
  }, [radarData]);

  const avgScores = useMemo(() => {
    if (!specData.length) return { health: 0, momentum: 0, dumpRisk: 0, radar: 0, narrative: 0, smartMoney: 0, bubble: 0, manipulation: 0 };
    const n = specData.length;
    return {
      health: Math.round(specData.reduce((s, d) => s + d.scores.healthIndex, 0) / n),
      momentum: Math.round(specData.reduce((s, d) => s + d.scores.capitalMomentum, 0) / n),
      dumpRisk: Math.round(specData.reduce((s, d) => s + d.scores.dumpRisk, 0) / n),
      radar: Math.round(specData.reduce((s, d) => s + d.scores.subnetRadarScore, 0) / n),
      narrative: Math.round(specData.reduce((s, d) => s + d.scores.narrativeScore, 0) / n),
      smartMoney: Math.round(specData.reduce((s, d) => s + d.scores.smartMoneyScore, 0) / n),
      bubble: Math.round(specData.reduce((s, d) => s + d.scores.bubbleScore, 0) / n),
      manipulation: Math.round(specData.reduce((s, d) => s + d.scores.manipulationScore, 0) / n),
    };
  }, [specData]);

  const filtered = useMemo(() => {
    if (!specData.length) return [];
    if (!search.trim()) return specData;
    const q = search.trim().toLowerCase();
    return specData.filter(
      (d) => d.subnetName.toLowerCase().includes(q) || String(d.netuid).includes(q)
    );
  }, [specData, search]);

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="font-mono text-xs text-muted-foreground animate-pulse">Chargement du radar…</div>
      </div>
    );
  }

  if (error || !radarData?.length) {
    return (
      <div className="h-full flex items-center justify-center px-6">
        <div className="text-center space-y-2">
          <div className="font-mono text-lg">📡</div>
          <div className="font-mono text-xs text-muted-foreground">
            {error ? "Erreur de chargement" : "Aucune donnée de stake analytics disponible"}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto scrollbar-thin">
      <div className="max-w-7xl mx-auto px-4 pt-16 pb-8 space-y-6">
        {/* Header */}
        <div className="space-y-1">
          <h1 className="font-mono text-xl font-bold text-foreground tracking-tight">📡 Radar Intelligence</h1>
          <p className="font-mono text-[11px] text-muted-foreground">
            Capital · Risk · AMM · Economics · Smart Money · {search ? `${filtered.length}/` : ""}{specData.length} subnets
          </p>
        </div>

        {/* Global Scores */}
        <div className="grid grid-cols-4 sm:grid-cols-8 gap-2">
          <ScoreBadge value={avgScores.radar} colorFn={radarScoreColor} label="Radar" />
          <ScoreBadge value={avgScores.health} colorFn={healthIndexColor} label="Health" />
          <ScoreBadge value={avgScores.momentum} colorFn={capitalMomentumColor} label="Momentum" />
          <ScoreBadge value={avgScores.narrative} colorFn={narrativeScoreColor} label="Narrative" />
          <ScoreBadge value={avgScores.smartMoney} colorFn={smartMoneyColor} label="Smart $" />
          <ScoreBadge value={avgScores.dumpRisk} colorFn={dumpRiskColor} label="Dump Risk" />
          <ScoreBadge value={avgScores.bubble} colorFn={bubbleScoreColor} label="Bubble" />
          <ScoreBadge value={avgScores.manipulation} colorFn={manipulationScoreColor} label="Manip." />
        </div>

        {/* Active Alerts */}
        <ActiveAlerts data={specData} />

        {/* Tab Navigation + Search */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-2">
          <div className="flex gap-1 overflow-x-auto pb-1 flex-1">
            {TABS.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className="flex items-center gap-1 px-2.5 py-2 rounded-lg font-mono text-[10px] tracking-wider whitespace-nowrap transition-all"
                style={{
                  background: activeTab === tab.key ? "rgba(255,255,255,0.08)" : "transparent",
                  color: activeTab === tab.key ? "rgba(255,255,255,0.85)" : "rgba(255,255,255,0.35)",
                  border: activeTab === tab.key ? "1px solid rgba(255,255,255,0.12)" : "1px solid transparent",
                }}
              >
                <span>{tab.icon}</span>
                <span>{tab.label}</span>
              </button>
            ))}
          </div>
          <div className="relative">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher…"
              className="w-full sm:w-40 px-3 py-1.5 rounded-lg font-mono text-[11px] bg-secondary text-foreground placeholder:text-muted-foreground/50 border border-border focus:outline-none focus:ring-1 focus:ring-ring"
            />
            {search && (
              <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground text-xs">✕</button>
            )}
          </div>
        </div>

        {/* Tab Content */}
        <div className="rounded-lg overflow-hidden" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
          {activeTab === "capital" && <CapitalFlowTable data={filtered} />}
          {activeTab === "adoption" && <AdoptionTable data={filtered} />}
          {activeTab === "risk" && <RiskMonitorTable data={filtered} />}
          {activeTab === "amm" && <AMMPricingTable data={filtered} />}
          {activeTab === "validator" && <ValidatorTable data={filtered} />}
          {activeTab === "economics" && <EconomicsTable data={filtered} />}
          {activeTab === "heatmap" && <TreemapHeatmap data={filtered} />}
          {activeTab === "smartmoney" && <SmartMoneyPanel data={filtered} />}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════ */
/*        ACTIVE ALERTS                    */
/* ═══════════════════════════════════════ */
function ActiveAlerts({ data }: { data: SubnetRadarData[] }) {
  const hasAlerts = data.some((d) =>
    d.alerts.earlyAdoption || d.alerts.narrativeStarting || d.alerts.narrativeForming ||
    d.alerts.smartMoneySignal || d.alerts.dumpWarning || d.alerts.dumpExit ||
    d.alerts.bubbleOverheat || d.alerts.bubbleAlert || d.alerts.bubbleDump ||
    d.alerts.manipSuspicious || d.alerts.manipRisk ||
    d.alerts.alphaUndervalued || d.alerts.alphaOverpriced
  );
  if (!hasAlerts) return null;

  return (
    <div className="rounded-lg p-3 space-y-2" style={{ background: "rgba(255,193,7,0.05)", border: "1px solid rgba(255,193,7,0.15)" }}>
      <div className="font-mono text-[10px] tracking-widest uppercase text-muted-foreground">Alertes actives</div>
      <div className="flex flex-wrap gap-2 max-h-40 overflow-y-auto scrollbar-thin">
        {data.filter((d) => d.alerts.bubbleDump).map((d) => (
          <AlertBadge key={`bd-${d.netuid}`} active label={`SN-${d.netuid} Probable Dump`} emoji="🫧" variant="danger" />
        ))}
        {data.filter((d) => d.alerts.bubbleAlert && !d.alerts.bubbleDump).map((d) => (
          <AlertBadge key={`ba-${d.netuid}`} active label={`SN-${d.netuid} Bubble`} emoji="🫧" variant="danger" />
        ))}
        {data.filter((d) => d.alerts.bubbleOverheat && !d.alerts.bubbleAlert).map((d) => (
          <AlertBadge key={`bo-${d.netuid}`} active label={`SN-${d.netuid} Surchauffe`} emoji="🫧" variant="warn" />
        ))}
        {data.filter((d) => d.alerts.manipRisk).map((d) => (
          <AlertBadge key={`mr-${d.netuid}`} active label={`SN-${d.netuid} Manip. Risk`} emoji="🔍" variant="danger" />
        ))}
        {data.filter((d) => d.alerts.manipSuspicious && !d.alerts.manipRisk).map((d) => (
          <AlertBadge key={`ms-${d.netuid}`} active label={`SN-${d.netuid} Suspicious`} emoji="🔍" variant="warn" />
        ))}
        {data.filter((d) => d.alerts.alphaUndervalued).map((d) => (
          <AlertBadge key={`au-${d.netuid}`} active label={`SN-${d.netuid} Undervalued`} emoji="💎" variant="success" />
        ))}
        {data.filter((d) => d.alerts.alphaOverpriced).map((d) => (
          <AlertBadge key={`ao-${d.netuid}`} active label={`SN-${d.netuid} Overpriced`} emoji="💎" variant="danger" />
        ))}
        {data.filter((d) => d.alerts.narrativeStarting).map((d) => (
          <AlertBadge key={`ns-${d.netuid}`} active label={`SN-${d.netuid} Narrative Starting`} emoji="🔮" variant="info" />
        ))}
        {data.filter((d) => d.alerts.earlyAdoption && !d.alerts.narrativeStarting).map((d) => (
          <AlertBadge key={`ea-${d.netuid}`} active label={`SN-${d.netuid} Early Adoption`} emoji="🚀" variant="success" />
        ))}
        {data.filter((d) => d.alerts.smartMoneySignal).map((d) => (
          <AlertBadge key={`sm-${d.netuid}`} active label={`SN-${d.netuid} Smart Money`} emoji="🐋" variant="success" />
        ))}
        {data.filter((d) => d.alerts.dumpExit).map((d) => (
          <AlertBadge key={`de-${d.netuid}`} active label={`SN-${d.netuid} EXIT`} emoji="🚨" variant="danger" />
        ))}
        {data.filter((d) => d.alerts.dumpWarning && !d.alerts.dumpExit).map((d) => (
          <AlertBadge key={`dw-${d.netuid}`} active label={`SN-${d.netuid} Warning`} emoji="⚠️" variant="warn" />
        ))}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════ */
/*        CAPITAL FLOW TABLE               */
/* ═══════════════════════════════════════ */
type CapitalSortKey = "sn" | "mcap" | "momentum" | "narrative" | "stakeFlow";
const CAPITAL_ACCESSORS: Record<CapitalSortKey, (d: SubnetRadarData) => number> = {
  sn: d => d.netuid,
  mcap: d => d.priceContext.marketCap,
  momentum: d => d.scores.capitalMomentum,
  narrative: d => d.scores.narrativeScore,
  stakeFlow: d => d.stakeChange7dPct,
};

function CapitalFlowTable({ data }: { data: SubnetRadarData[] }) {
  const { sort, toggle } = useSortState<CapitalSortKey>("momentum");
  const sorted = useMemo(() => sortData(data, sort, CAPITAL_ACCESSORS), [data, sort]);
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <SortableHead label="SN" sortKey="sn" sort={sort} onSort={toggle} />
            <TableHead className="font-mono text-[10px]">Nom</TableHead>
            <SortableHead label="MCap τ" sortKey="mcap" sort={sort} onSort={toggle} className="text-right" />
            <TableHead className="font-mono text-[10px] text-right">Buy/Sell</TableHead>
            <SortableHead label="Stake Flow" sortKey="stakeFlow" sort={sort} onSort={toggle} className="text-right" />
            <SortableHead label="Momentum" sortKey="momentum" sort={sort} onSort={toggle} className="text-right" />
            <TableHead className="font-mono text-[10px] text-right hidden sm:table-cell">Trend</TableHead>
            <SortableHead label="Narrative" sortKey="narrative" sort={sort} onSort={toggle} className="text-right" />
            <TableHead className="font-mono text-[10px] text-right">Signal</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.slice(0, 30).map((d) => {
            const eco = d.economicContext;
            const totalVol = eco.buyVolume + eco.sellVolume;
            const buyPct = totalVol > 0 ? (eco.buyVolume / totalVol * 100).toFixed(0) : "—";
            const sellPct = totalVol > 0 ? (eco.sellVolume / totalVol * 100).toFixed(0) : "—";
            return (
              <TableRow key={d.netuid}>
                <TableCell className="font-mono text-xs font-semibold text-muted-foreground">{d.netuid}</TableCell>
                <TableCell className="font-mono text-xs truncate max-w-[120px]">{d.subnetName}</TableCell>
                <TableCell className="font-mono text-xs text-right">{formatMcap(d.priceContext.marketCap)}</TableCell>
                <TableCell className="font-mono text-xs text-right">
                  {totalVol > 0 ? (
                    <span>
                      <span style={{ color: "rgba(76,175,80,0.8)" }}>{buyPct}%</span>
                      <span className="text-muted-foreground/40">/</span>
                      <span style={{ color: "rgba(229,57,53,0.7)" }}>{sellPct}%</span>
                    </span>
                  ) : "—"}
                </TableCell>
                <TableCell className="text-right"><PctChange value={d.stakeChange7dPct} /></TableCell>
                <TableCell className="text-right">
                  <span className="font-mono text-xs font-bold" style={{ color: capitalMomentumColor(d.scores.capitalMomentum) }}>{d.scores.capitalMomentum}</span>
                </TableCell>
                <TableCell className="text-right hidden sm:table-cell">
                  <Sparkline data={(d.sparklineCapital?.length ?? 0) >= 2 ? d.sparklineCapital : generateCapitalSparkline(d)} />
                </TableCell>
                <TableCell className="text-right">
                  <span className="font-mono text-xs" style={{ color: narrativeScoreColor(d.scores.narrativeScore) }}>{d.scores.narrativeScore}</span>
                </TableCell>
                <TableCell className="text-right">
                  {d.alerts.narrativeStarting ? <SignalChip label="NARRATIVE" color="purple" /> :
                   d.alerts.earlyAdoption ? <SignalChip label="EARLY" color="green" /> :
                   d.alerts.smartMoneySignal ? <SignalChip label="SMART $" color="blue" /> :
                   <span className="font-mono text-[10px] text-muted-foreground/40">—</span>}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

/* ═══════════════════════════════════════ */
/*        ADOPTION RADAR TABLE             */
/* ═══════════════════════════════════════ */
type AdoptionSortKey = "sn" | "radar" | "validators" | "holders" | "uidSat" | "burn";
const ADOPTION_ACCESSORS: Record<AdoptionSortKey, (d: SubnetRadarData) => number> = {
  sn: d => d.netuid,
  radar: d => d.scores.subnetRadarScore,
  validators: d => d.snapshot.validatorsActive,
  holders: d => d.snapshot.holdersCount,
  uidSat: d => d.derivedMetrics.uidSaturation,
  burn: d => d.derivedMetrics.burnRatio,
};

function AdoptionTable({ data }: { data: SubnetRadarData[] }) {
  const { sort, toggle } = useSortState<AdoptionSortKey>("radar");
  const sorted = useMemo(() => sortData(data, sort, ADOPTION_ACCESSORS), [data, sort]);
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <SortableHead label="SN" sortKey="sn" sort={sort} onSort={toggle} />
            <TableHead className="font-mono text-[10px]">Nom</TableHead>
            <SortableHead label="Radar" sortKey="radar" sort={sort} onSort={toggle} className="text-right" />
            <TableHead className="font-mono text-[10px] text-right">Miners</TableHead>
            <SortableHead label="Validators" sortKey="validators" sort={sort} onSort={toggle} className="text-right" />
            <SortableHead label="UID Sat." sortKey="uidSat" sort={sort} onSort={toggle} className="text-right" />
            <SortableHead
              label={
                <Tooltip>
                  <TooltipTrigger asChild><span className="cursor-help border-b border-dotted border-muted-foreground/30">Burn Ratio</span></TooltipTrigger>
                  <TooltipContent side="top" className="max-w-[260px] whitespace-pre-line text-[10px]">{BURN_RATIO_TOOLTIP}</TooltipContent>
                </Tooltip>
              }
              sortKey="burn" sort={sort} onSort={toggle} className="text-right"
            />
            <TableHead className="font-mono text-[10px] text-right hidden sm:table-cell">Trend</TableHead>
            <TableHead className="font-mono text-[10px] text-right">Signal</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.slice(0, 30).map((d) => {
            const dm = d.derivedMetrics;
            return (
              <TableRow key={d.netuid}>
                <TableCell className="font-mono text-xs font-semibold text-muted-foreground">{d.netuid}</TableCell>
                <TableCell className="font-mono text-xs truncate max-w-[120px]">{d.subnetName}</TableCell>
                <TableCell className="text-right">
                  <span className="font-mono text-xs font-bold" style={{ color: radarScoreColor(d.scores.subnetRadarScore) }}>{d.scores.subnetRadarScore}</span>
                </TableCell>
                <TableCell className="font-mono text-xs text-right">{d.snapshot.minersActive} <PctChange value={d.deltas.minersGrowth7d * 100} /></TableCell>
                <TableCell className="font-mono text-xs text-right">{d.snapshot.validatorsActive || "—"}</TableCell>
                <TableCell className="font-mono text-xs text-right">
                  <span style={{ color: dm.uidSaturation > 0.9 ? "rgba(229,57,53,0.8)" : dm.uidSaturation > 0.7 ? "rgba(255,193,7,0.8)" : "rgba(76,175,80,0.8)" }}>
                    {d.snapshot.uidMax > 0 ? `${(dm.uidSaturation * 100).toFixed(0)}%` : `${(d.snapshot.uidUsage * 100).toFixed(0)}%`}
                  </span>
                  {d.snapshot.uidMax > 0 && <span className="text-muted-foreground/40 text-[9px] ml-0.5">{d.snapshot.uidUsed}/{d.snapshot.uidMax}</span>}
                </TableCell>
                <TableCell className="font-mono text-xs text-right text-muted-foreground">
                  {formatBurnRatio(dm.burnRatio)}
                </TableCell>
                <TableCell className="text-right hidden sm:table-cell">
                  <Sparkline data={(d.sparklineAdoption?.length ?? 0) >= 2 ? d.sparklineAdoption : generateAdoptionSparkline(d)} />
                </TableCell>
                <TableCell className="text-right">
                  {d.alerts.narrativeStarting ? (
                    <SignalChip label="NARRATIVE" color="purple" />
                  ) : d.alerts.earlyAdoption ? (
                    <SignalChip label="EARLY" color="green" />
                  ) : <span className="font-mono text-[10px] text-muted-foreground/40">—</span>}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

/* ═══════════════════════════════════════ */
/*        RISK MONITOR (Dump + Bubble)     */
/* ═══════════════════════════════════════ */
type RiskSortKey = "sn" | "dumpRisk" | "bubble" | "concentration" | "price7d";
const RISK_ACCESSORS: Record<RiskSortKey, (d: SubnetRadarData) => number> = {
  sn: d => d.netuid,
  dumpRisk: d => d.scores.dumpRisk,
  bubble: d => d.scores.bubbleScore,
  concentration: d => d.snapshot.stakeConcentration,
  price7d: d => d.priceContext.priceChange7d,
};

function RiskMonitorTable({ data }: { data: SubnetRadarData[] }) {
  const { sort, toggle } = useSortState<RiskSortKey>("dumpRisk");
  const sorted = useMemo(() => sortData(data, sort, RISK_ACCESSORS), [data, sort]);
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <SortableHead label="SN" sortKey="sn" sort={sort} onSort={toggle} />
            <TableHead className="font-mono text-[10px]">Nom</TableHead>
            <SortableHead label="Dump Risk" sortKey="dumpRisk" sort={sort} onSort={toggle} className="text-right" />
            <SortableHead label="Bubble" sortKey="bubble" sort={sort} onSort={toggle} className="text-right" />
            <TableHead className="font-mono text-[10px] text-right">Sell Press.</TableHead>
            <SortableHead label="Conc." sortKey="concentration" sort={sort} onSort={toggle} className="text-right" />
            <SortableHead label="Price Δ7d" sortKey="price7d" sort={sort} onSort={toggle} className="text-right" />
            <TableHead className="font-mono text-[10px] text-right">Vol/MCap</TableHead>
            <TableHead className="font-mono text-[10px] text-right">Signal</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.slice(0, 30).map((d) => {
            const eco = d.economicContext;
            const totalVol = eco.buyVolume + eco.sellVolume;
            const sellPressure = totalVol > 0 ? (eco.sellVolume / totalVol * 100) : 0;
            const volMcap = d.priceContext.marketCap > 0 ? (d.priceContext.vol24h / d.priceContext.marketCap * 100) : 0;
            return (
              <TableRow key={d.netuid}>
                <TableCell className="font-mono text-xs font-semibold text-muted-foreground">{d.netuid}</TableCell>
                <TableCell className="font-mono text-xs truncate max-w-[120px]">{d.subnetName}</TableCell>
                <TableCell className="text-right">
                  <span className="font-mono text-xs font-bold" style={{ color: dumpRiskColor(d.scores.dumpRisk) }}>{d.scores.dumpRisk}</span>
                </TableCell>
                <TableCell className="text-right">
                  <span className="font-mono text-xs font-bold" style={{ color: bubbleScoreColor(d.scores.bubbleScore) }}>{d.scores.bubbleScore}</span>
                </TableCell>
                <TableCell className="font-mono text-xs text-right">
                  {totalVol > 0 ? (
                    <span style={{ color: sellPressure > 55 ? "rgba(229,57,53,0.8)" : "rgba(255,255,255,0.5)" }}>
                      {sellPressure.toFixed(0)}%
                    </span>
                  ) : "—"}
                </TableCell>
                <TableCell className="text-right">
                  <span className="font-mono text-xs" style={{ color: d.snapshot.stakeConcentration > 60 ? "rgba(229,57,53,0.8)" : "rgba(255,255,255,0.5)" }}>
                    {d.snapshot.stakeConcentration > 0 ? `${d.snapshot.stakeConcentration.toFixed(0)}%` : "—"}
                  </span>
                </TableCell>
                <TableCell className="text-right"><PctChange value={d.priceContext.priceChange7d} /></TableCell>
                <TableCell className="font-mono text-xs text-right text-muted-foreground">{volMcap > 0 ? `${volMcap.toFixed(1)}%` : "—"}</TableCell>
                <TableCell className="text-right">
                  {d.alerts.bubbleDump ? <SignalChip label="BUBBLE DUMP" color="red" /> :
                   d.alerts.dumpExit ? <SignalChip label="EXIT" color="red" /> :
                   d.alerts.bubbleAlert ? <SignalChip label="BUBBLE" color="red" /> :
                   d.alerts.dumpWarning ? <SignalChip label="WARNING" color="orange" /> :
                   d.alerts.bubbleOverheat ? <SignalChip label="SURCHAUFFE" color="orange" /> :
                   <span className="font-mono text-[10px] text-muted-foreground/40">—</span>}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

/* ═══════════════════════════════════════ */
/*        ECONOMICS TABLE                  */
/* ═══════════════════════════════════════ */
type EcoSortKey = "sn" | "emDay" | "emPct" | "burn" | "supply" | "uidSat" | "deviation";
const ECO_ACCESSORS: Record<EcoSortKey, (d: SubnetRadarData) => number> = {
  sn: d => d.netuid,
  emDay: d => d.economicContext.emissionsPerDay,
  emPct: d => d.priceContext.emissionShare,
  burn: d => d.derivedMetrics.burnRatio,
  supply: d => d.economicContext.circulatingSupply,
  uidSat: d => d.derivedMetrics.uidSaturation,
  deviation: d => d.scores.alphaInefficiency,
};

function EconomicsTable({ data }: { data: SubnetRadarData[] }) {
  const { sort, toggle } = useSortState<EcoSortKey>("emDay");
  const sorted = useMemo(() => sortData(data, sort, ECO_ACCESSORS), [data, sort]);
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <SortableHead label="SN" sortKey="sn" sort={sort} onSort={toggle} />
            <TableHead className="font-mono text-[10px]">Nom</TableHead>
            <SortableHead label="Em./day" sortKey="emDay" sort={sort} onSort={toggle} className="text-right" />
            <SortableHead label="Em.%" sortKey="emPct" sort={sort} onSort={toggle} className="text-right" />
            <SortableHead
              label={
                <Tooltip>
                  <TooltipTrigger asChild><span className="cursor-help border-b border-dotted border-muted-foreground/30">Burn Ratio</span></TooltipTrigger>
                  <TooltipContent side="top" className="max-w-[260px] whitespace-pre-line text-[10px]">{BURN_RATIO_TOOLTIP}</TooltipContent>
                </Tooltip>
              }
              sortKey="burn" sort={sort} onSort={toggle} className="text-right"
            />
            <SortableHead label="Circ. Supply" sortKey="supply" sort={sort} onSort={toggle} className="text-right" />
            <SortableHead label="UID Sat." sortKey="uidSat" sort={sort} onSort={toggle} className="text-right" />
            <SortableHead label="Deviation" sortKey="deviation" sort={sort} onSort={toggle} className="text-right" />
            <TableHead className="font-mono text-[10px] text-right">Signal</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.slice(0, 30).map((d) => {
            const eco = d.economicContext;
            const dm = d.derivedMetrics;
            const deviation = d.scores.alphaInefficiency;
            return (
              <TableRow key={d.netuid}>
                <TableCell className="font-mono text-xs font-semibold text-muted-foreground">{d.netuid}</TableCell>
                <TableCell className="font-mono text-xs truncate max-w-[120px]">{d.subnetName}</TableCell>
                <TableCell className="font-mono text-xs text-right text-muted-foreground">
                  {eco.emissionsPerDay > 0 ? formatTao(eco.emissionsPerDay) : "—"}
                </TableCell>
                <TableCell className="font-mono text-xs text-right text-muted-foreground">
                  {d.priceContext.emissionShare > 0 ? `${d.priceContext.emissionShare.toFixed(1)}%` : "—"}
                </TableCell>
                <TableCell className="font-mono text-xs text-right text-muted-foreground">
                  {formatBurnRatio(dm.burnRatio)}
                </TableCell>
                <TableCell className="font-mono text-xs text-right text-muted-foreground">
                  {eco.circulatingSupply > 0 ? formatTao(eco.circulatingSupply) : "—"}
                </TableCell>
                <TableCell className="font-mono text-xs text-right">
                  <span style={{ color: dm.uidSaturation > 0.9 ? "rgba(229,57,53,0.8)" : dm.uidSaturation > 0.7 ? "rgba(255,193,7,0.8)" : "rgba(76,175,80,0.8)" }}>
                    {d.snapshot.uidMax > 0 ? `${(dm.uidSaturation * 100).toFixed(0)}%` : "—"}
                  </span>
                </TableCell>
                <TableCell className="text-right">
                  <span className="font-mono text-xs font-bold" style={{ color: inefficiencyColor(deviation) }}>
                    {d.scores.fairAlphaPrice > 0 ? `${deviation > 0 ? "+" : ""}${deviation.toFixed(0)}%` : "—"}
                  </span>
                </TableCell>
                <TableCell className="text-right">
                  {d.alerts.alphaUndervalued ? <SignalChip label="UNDERVALUED" color="green" /> :
                   d.alerts.alphaOverpriced ? <SignalChip label="OVERPRICED" color="red" /> :
                   <span className="font-mono text-[10px] text-muted-foreground/40">—</span>}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

/* ═══════════════════════════════════════ */
/*        VALIDATOR TABLE                  */
/* ═══════════════════════════════════════ */
type ValSortKey = "sn" | "validators" | "miners" | "concentration" | "emPct" | "manipulation";
const VAL_ACCESSORS: Record<ValSortKey, (d: SubnetRadarData) => number> = {
  sn: d => d.netuid,
  validators: d => d.snapshot.validatorsActive,
  miners: d => d.snapshot.minersActive,
  concentration: d => d.snapshot.stakeConcentration,
  emPct: d => d.priceContext.emissionShare,
  manipulation: d => d.scores.manipulationScore,
};

function ValidatorTable({ data }: { data: SubnetRadarData[] }) {
  const { sort, toggle } = useSortState<ValSortKey>("manipulation");
  const sorted = useMemo(() => sortData(data, sort, VAL_ACCESSORS), [data, sort]);
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <SortableHead label="SN" sortKey="sn" sort={sort} onSort={toggle} />
            <TableHead className="font-mono text-[10px]">Nom</TableHead>
            <SortableHead label="Validators" sortKey="validators" sort={sort} onSort={toggle} className="text-right" />
            <SortableHead label="Miners" sortKey="miners" sort={sort} onSort={toggle} className="text-right" />
            <SortableHead label="Conc. %" sortKey="concentration" sort={sort} onSort={toggle} className="text-right" />
            <SortableHead label="Em.%" sortKey="emPct" sort={sort} onSort={toggle} className="text-right" />
            <SortableHead label="Manip. Score" sortKey="manipulation" sort={sort} onSort={toggle} className="text-right" />
            <TableHead className="font-mono text-[10px] text-right">Signal</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.slice(0, 30).map((d) => (
            <TableRow key={d.netuid}>
              <TableCell className="font-mono text-xs font-semibold text-muted-foreground">{d.netuid}</TableCell>
              <TableCell className="font-mono text-xs truncate max-w-[120px]">{d.subnetName}</TableCell>
              <TableCell className="font-mono text-xs text-right">{d.snapshot.validatorsActive || "—"}</TableCell>
              <TableCell className="font-mono text-xs text-right">{d.snapshot.minersActive}</TableCell>
              <TableCell className="text-right">
                <span className="font-mono text-xs" style={{ color: d.snapshot.stakeConcentration > 60 ? "rgba(229,57,53,0.8)" : "rgba(255,255,255,0.5)" }}>
                  {d.snapshot.stakeConcentration > 0 ? `${d.snapshot.stakeConcentration.toFixed(0)}%` : "—"}
                </span>
              </TableCell>
              <TableCell className="font-mono text-xs text-right text-muted-foreground">
                {d.priceContext.emissionShare > 0 ? `${d.priceContext.emissionShare.toFixed(1)}%` : "—"}
              </TableCell>
              <TableCell className="text-right">
                <span className="font-mono text-xs font-bold" style={{ color: manipulationScoreColor(d.scores.manipulationScore) }}>{d.scores.manipulationScore}</span>
              </TableCell>
              <TableCell className="text-right">
                {d.alerts.manipRisk ? <SignalChip label="MANIP. RISK" color="red" /> :
                 d.alerts.manipSuspicious ? <SignalChip label="SUSPICIOUS" color="orange" /> :
                 <span className="font-mono text-[10px] text-muted-foreground/40">—</span>}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/* ═══════════════════════════════════════ */
/*        SMART MONEY PANEL                */
/* ═══════════════════════════════════════ */
type SmartSortKey = "sn" | "score" | "buyers" | "sellers" | "emPct";
const SMART_ACCESSORS: Record<SmartSortKey, (d: SubnetRadarData) => number> = {
  sn: d => d.netuid,
  score: d => d.scores.smartMoneyScore,
  buyers: d => d.economicContext.buyersCount,
  sellers: d => d.economicContext.sellersCount,
  emPct: d => d.priceContext.emissionShare,
};

function SmartMoneyPanel({ data }: { data: SubnetRadarData[] }) {
  const { sort, toggle } = useSortState<SmartSortKey>("score");
  const sorted = useMemo(() => sortData(data, sort, SMART_ACCESSORS), [data, sort]);

  const topConcentrated = [...data]
    .filter((d) => d.snapshot.top10Stake?.length > 0)
    .sort((a, b) => b.snapshot.stakeConcentration - a.snapshot.stakeConcentration)
    .slice(0, 10);

  return (
    <div className="p-4 space-y-6">
      <div>
        <div className="font-mono text-[10px] tracking-widest uppercase text-muted-foreground mb-2">🐋 Smart Money Rankings</div>
        <Table>
          <TableHeader>
            <TableRow>
              <SortableHead label="SN" sortKey="sn" sort={sort} onSort={toggle} />
              <TableHead className="font-mono text-[10px]">Nom</TableHead>
              <SortableHead label="Score" sortKey="score" sort={sort} onSort={toggle} className="text-right" />
              <TableHead className="font-mono text-[10px] text-right">Buy/Sell</TableHead>
              <SortableHead label="Buyers" sortKey="buyers" sort={sort} onSort={toggle} className="text-right" />
              <SortableHead label="Sellers" sortKey="sellers" sort={sort} onSort={toggle} className="text-right" />
              <SortableHead label="Em.%" sortKey="emPct" sort={sort} onSort={toggle} className="text-right" />
              <TableHead className="font-mono text-[10px] text-right">Signal</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.slice(0, 20).map((d) => {
              const eco = d.economicContext;
              const totalVol = eco.buyVolume + eco.sellVolume;
              return (
                <TableRow key={d.netuid}>
                  <TableCell className="font-mono text-xs font-semibold text-muted-foreground">{d.netuid}</TableCell>
                  <TableCell className="font-mono text-xs truncate max-w-[120px]">{d.subnetName}</TableCell>
                  <TableCell className="text-right">
                    <span className="font-mono text-xs font-bold" style={{ color: smartMoneyColor(d.scores.smartMoneyScore) }}>{d.scores.smartMoneyScore}</span>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-right">
                    {totalVol > 0 ? (
                      <span>
                        <span style={{ color: "rgba(76,175,80,0.8)" }}>{formatTao(eco.buyVolume)}</span>
                        <span className="text-muted-foreground/40">/</span>
                        <span style={{ color: "rgba(229,57,53,0.7)" }}>{formatTao(eco.sellVolume)}</span>
                      </span>
                    ) : "—"}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-right">{eco.buyersCount > 0 ? eco.buyersCount : "—"}</TableCell>
                  <TableCell className="font-mono text-xs text-right">{eco.sellersCount > 0 ? eco.sellersCount : "—"}</TableCell>
                  <TableCell className="font-mono text-xs text-right text-muted-foreground">
                    {d.priceContext.emissionShare > 0 ? `${d.priceContext.emissionShare.toFixed(1)}%` : "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    {d.alerts.smartMoneySignal ? <SignalChip label="SMART MONEY" color="green" /> :
                     d.scores.smartMoneyScore >= 40 ? <SignalChip label="WATCH" color="blue" /> :
                     <span className="font-mono text-[10px] text-muted-foreground/40">—</span>}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {topConcentrated.length > 0 && (
        <div>
          <div className="font-mono text-[10px] tracking-widest uppercase text-muted-foreground mb-2">🏦 Top 10 Concentration de Stake</div>
          {topConcentrated.map((d) => (
            <div key={d.netuid} className="mb-3">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-mono text-xs font-semibold text-muted-foreground">SN-{d.netuid}</span>
                <span className="font-mono text-[10px] text-muted-foreground/60">{d.subnetName}</span>
                <span className="ml-auto font-mono text-xs font-bold" style={{ color: dumpRiskColor(d.snapshot.stakeConcentration) }}>
                  {d.snapshot.stakeConcentration.toFixed(0)}%
                </span>
              </div>
              <div className="flex gap-px h-3 rounded overflow-hidden">
                {d.snapshot.top10Stake.slice(0, 10).map((s: any, i: number) => (
                  <div key={i} className="h-full" style={{ width: `${Math.max(s.pct, 2)}%`, background: `rgba(255,193,7,${0.3 + i * 0.07})` }} title={`${s.address}: ${s.stake}τ (${s.pct}%)`} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
