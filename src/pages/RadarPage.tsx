import React, { useMemo, useState } from "react";
import { useStakeAnalytics, type SubnetRadarData } from "@/hooks/use-stake-analytics";
import {
  healthIndexColor,
  momentumColor as capitalMomentumColor,
  dumpRiskColor,
  radarScoreColor,
  narrativeScoreColor,
  smartMoneyColor,
} from "@/lib/stake-analytics";
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from "@/components/ui/table";
import Sparkline from "@/components/radar/Sparkline";
import TreemapHeatmap from "@/components/radar/TreemapHeatmap";

/* ─── Score Badge ─── */
function ScoreBadge({ value, colorFn, label }: { value: number; colorFn: (v: number) => string; label: string }) {
  return (
    <div className="rounded-lg p-4 text-center" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
      <div className="font-mono text-[10px] tracking-widest uppercase text-muted-foreground mb-1">{label}</div>
      <div className="font-mono text-2xl font-bold" style={{ color: colorFn(value) }}>{value}</div>
    </div>
  );
}

/* ─── Pct Change ─── */
function PctChange({ value }: { value: number }) {
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

/* ─── Tabs ─── */
type TabKey = "capital" | "adoption" | "risk" | "heatmap" | "smartmoney" | "narrative";
const TABS: { key: TabKey; label: string; icon: string }[] = [
  { key: "capital", label: "Capital Flow", icon: "💰" },
  { key: "adoption", label: "Adoption Radar", icon: "🚀" },
  { key: "narrative", label: "Narrative", icon: "📊" },
  { key: "risk", label: "Dump Risk", icon: "⚠️" },
  { key: "heatmap", label: "Heatmap", icon: "🔥" },
  { key: "smartmoney", label: "Smart Money", icon: "🐋" },
];

/* ═══════════════════════════════════════ */
/*        RADAR PAGE                       */
/* ═══════════════════════════════════════ */
export default function RadarPage() {
  const { data: radarData, isLoading, error } = useStakeAnalytics();
  const [activeTab, setActiveTab] = useState<TabKey>("capital");
  const [search, setSearch] = useState("");

  // Global averages
  const avgScores = useMemo(() => {
    if (!radarData?.length) return { health: 0, momentum: 0, dumpRisk: 0, radar: 0, narrative: 0, smartMoney: 0 };
    const n = radarData.length;
    return {
      health: Math.round(radarData.reduce((s, d) => s + d.scores.healthIndex, 0) / n),
      momentum: Math.round(radarData.reduce((s, d) => s + d.scores.capitalMomentum, 0) / n),
      dumpRisk: Math.round(radarData.reduce((s, d) => s + d.scores.dumpRisk, 0) / n),
      radar: Math.round(radarData.reduce((s, d) => s + d.scores.subnetRadarScore, 0) / n),
      narrative: Math.round(radarData.reduce((s, d) => s + d.scores.narrativeScore, 0) / n),
      smartMoney: Math.round(radarData.reduce((s, d) => s + d.scores.smartMoneyScore, 0) / n),
    };
  }, [radarData]);

  // Filter by search
  const filtered = useMemo(() => {
    if (!radarData?.length) return [];
    if (!search.trim()) return radarData;
    const q = search.trim().toLowerCase();
    return radarData.filter(
      (d) => d.subnetName.toLowerCase().includes(q) || String(d.netuid).includes(q)
    );
  }, [radarData, search]);

  // Sorted data for each tab
  const capitalFlow = useMemo(
    () => [...filtered].sort((a, b) => b.scores.capitalMomentum - a.scores.capitalMomentum),
    [filtered]
  );
  const adoptionRadar = useMemo(
    () => [...filtered].sort((a, b) => b.scores.subnetRadarScore - a.scores.subnetRadarScore),
    [filtered]
  );
  const dumpRiskSorted = useMemo(
    () => [...filtered].sort((a, b) => b.scores.dumpRisk - a.scores.dumpRisk),
    [filtered]
  );
  const narrativeSorted = useMemo(
    () => [...filtered].sort((a, b) => b.scores.narrativeScore - a.scores.narrativeScore),
    [filtered]
  );

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
          <div className="font-mono text-[10px] text-muted-foreground/60">
            Les données seront disponibles après la première synchronisation.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto scrollbar-thin">
      <div className="max-w-6xl mx-auto px-4 pt-16 pb-8 space-y-6">
        {/* Header */}
        <div className="space-y-1">
          <h1 className="font-mono text-xl font-bold text-foreground tracking-tight">
            📡 Radar Intelligence
          </h1>
          <p className="font-mono text-[11px] text-muted-foreground">
            Détection des flux de capital, narratives émergentes et risques de dump · {search ? `${filtered.length}/` : ""}{radarData.length} subnets analysés
          </p>
        </div>

        {/* Global Scores — 6 metrics */}
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
          <ScoreBadge value={avgScores.radar} colorFn={radarScoreColor} label="Radar Score" />
          <ScoreBadge value={avgScores.health} colorFn={healthIndexColor} label="Health" />
          <ScoreBadge value={avgScores.momentum} colorFn={capitalMomentumColor} label="Momentum" />
          <ScoreBadge value={avgScores.narrative} colorFn={narrativeScoreColor} label="Narrative" />
          <ScoreBadge value={avgScores.smartMoney} colorFn={smartMoneyColor} label="Smart Money" />
          <ScoreBadge value={avgScores.dumpRisk} colorFn={dumpRiskColor} label="Dump Risk" />
        </div>

        {/* Active Alerts */}
        {radarData.some((d) => d.alerts.earlyAdoption || d.alerts.narrativeStarting || d.alerts.narrativeForming || d.alerts.smartMoneySignal || d.alerts.dumpWarning || d.alerts.dumpExit) && (
          <div className="rounded-lg p-3 space-y-2" style={{ background: "rgba(255,193,7,0.05)", border: "1px solid rgba(255,193,7,0.15)" }}>
            <div className="font-mono text-[10px] tracking-widest uppercase text-muted-foreground">Alertes actives</div>
            <div className="flex flex-wrap gap-2">
              {radarData.filter((d) => d.alerts.narrativeStarting).map((d) => (
                <AlertBadge key={`ns-${d.netuid}`} active label={`SN-${d.netuid} Narrative Starting`} emoji="🔮" variant="info" />
              ))}
              {radarData.filter((d) => d.alerts.earlyAdoption && !d.alerts.narrativeStarting).map((d) => (
                <AlertBadge key={`ea-${d.netuid}`} active label={`SN-${d.netuid} Early Adoption`} emoji="🚀" variant="success" />
              ))}
              {radarData.filter((d) => d.alerts.narrativeForming).map((d) => (
                <AlertBadge key={`nf-${d.netuid}`} active label={`SN-${d.netuid} Narrative Forming`} emoji="📊" variant="info" />
              ))}
              {radarData.filter((d) => d.alerts.smartMoneySignal).map((d) => (
                <AlertBadge key={`sm-${d.netuid}`} active label={`SN-${d.netuid} Smart Money`} emoji="🐋" variant="success" />
              ))}
              {radarData.filter((d) => d.alerts.dumpExit).map((d) => (
                <AlertBadge key={`de-${d.netuid}`} active label={`SN-${d.netuid} EXIT`} emoji="🚨" variant="danger" />
              ))}
              {radarData.filter((d) => d.alerts.dumpWarning && !d.alerts.dumpExit).map((d) => (
                <AlertBadge key={`dw-${d.netuid}`} active label={`SN-${d.netuid} Warning`} emoji="⚠️" variant="warn" />
              ))}
            </div>
          </div>
        )}

        {/* Tab Navigation + Search */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-2">
          <div className="flex gap-1 overflow-x-auto pb-1 flex-1">
            {TABS.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg font-mono text-[11px] tracking-wider whitespace-nowrap transition-all"
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
              placeholder="Rechercher un subnet…"
              className="w-full sm:w-44 px-3 py-1.5 rounded-lg font-mono text-[11px] bg-secondary text-foreground placeholder:text-muted-foreground/50 border border-border focus:outline-none focus:ring-1 focus:ring-ring"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground text-xs"
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {/* Tab Content */}
        <div className="rounded-lg overflow-hidden" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
          {activeTab === "capital" && <CapitalFlowTable data={capitalFlow} />}
          {activeTab === "adoption" && <AdoptionTable data={adoptionRadar} />}
          {activeTab === "narrative" && <NarrativeTable data={narrativeSorted} />}
          {activeTab === "risk" && <DumpRiskTable data={dumpRiskSorted} />}
          {activeTab === "heatmap" && <TreemapHeatmap data={filtered} />}
          {activeTab === "smartmoney" && <SmartMoneyPanel data={filtered} />}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════ */
/*        CAPITAL FLOW TABLE               */
/* ═══════════════════════════════════════ */
function CapitalFlowTable({ data }: { data: SubnetRadarData[] }) {
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="font-mono text-[10px]">SN</TableHead>
            <TableHead className="font-mono text-[10px]">Nom</TableHead>
            <TableHead className="font-mono text-[10px] text-right">Stake τ</TableHead>
            <TableHead className="font-mono text-[10px] text-right">Δ7d</TableHead>
            <TableHead className="font-mono text-[10px] text-right">Momentum</TableHead>
            <TableHead className="font-mono text-[10px] text-right hidden sm:table-cell">Trend</TableHead>
            <TableHead className="font-mono text-[10px] text-right">🐋 In</TableHead>
            <TableHead className="font-mono text-[10px] text-right">🐋 Out</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.slice(0, 25).map((d) => (
            <TableRow key={d.netuid}>
              <TableCell className="font-mono text-xs font-semibold text-muted-foreground">{d.netuid}</TableCell>
              <TableCell className="font-mono text-xs truncate max-w-[120px]">{d.subnetName}</TableCell>
              <TableCell className="font-mono text-xs text-right">{formatTao(d.snapshot.stakeTotal)}</TableCell>
              <TableCell className="text-right"><PctChange value={d.stakeChange7dPct} /></TableCell>
              <TableCell className="text-right">
                <span className="font-mono text-xs font-bold" style={{ color: capitalMomentumColor(d.scores.capitalMomentum) }}>
                  {d.scores.capitalMomentum}
                </span>
              </TableCell>
              <TableCell className="text-right hidden sm:table-cell">
                <Sparkline data={(d.sparklineCapital?.length ?? 0) >= 2 ? d.sparklineCapital : generateCapitalSparkline(d)} />
              </TableCell>
              <TableCell className="font-mono text-xs text-right" style={{ color: "rgba(76,175,80,0.7)" }}>
                {d.snapshot.largeWalletInflow > 0 ? `+${d.snapshot.largeWalletInflow}τ` : "—"}
              </TableCell>
              <TableCell className="font-mono text-xs text-right" style={{ color: "rgba(229,57,53,0.7)" }}>
                {d.snapshot.largeWalletOutflow > 0 ? `-${d.snapshot.largeWalletOutflow}τ` : "—"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/* ═══════════════════════════════════════ */
/*        ADOPTION RADAR TABLE             */
/* ═══════════════════════════════════════ */
function AdoptionTable({ data }: { data: SubnetRadarData[] }) {
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="font-mono text-[10px]">SN</TableHead>
            <TableHead className="font-mono text-[10px]">Nom</TableHead>
            <TableHead className="font-mono text-[10px] text-right">Radar Score</TableHead>
            <TableHead className="font-mono text-[10px] text-right">Miners</TableHead>
            <TableHead className="font-mono text-[10px] text-right">Holders</TableHead>
            <TableHead className="font-mono text-[10px] text-right">UID%</TableHead>
            <TableHead className="font-mono text-[10px] text-right hidden sm:table-cell">Trend</TableHead>
            <TableHead className="font-mono text-[10px] text-right">Signal</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.slice(0, 25).map((d) => (
            <TableRow key={d.netuid}>
              <TableCell className="font-mono text-xs font-semibold text-muted-foreground">{d.netuid}</TableCell>
              <TableCell className="font-mono text-xs truncate max-w-[120px]">{d.subnetName}</TableCell>
              <TableCell className="text-right">
                <span className="font-mono text-xs font-bold" style={{ color: radarScoreColor(d.scores.subnetRadarScore) }}>
                  {d.scores.subnetRadarScore}
                </span>
              </TableCell>
              <TableCell className="font-mono text-xs text-right">
                {d.snapshot.minersActive} <PctChange value={d.deltas.minersGrowth7d * 100} />
              </TableCell>
              <TableCell className="font-mono text-xs text-right">
                {d.snapshot.holdersCount || "—"} <PctChange value={d.deltas.holdersGrowth7d * 100} />
              </TableCell>
              <TableCell className="font-mono text-xs text-right">{(d.snapshot.uidUsage * 100).toFixed(0)}%</TableCell>
              <TableCell className="text-right hidden sm:table-cell">
                <Sparkline data={(d.sparklineAdoption?.length ?? 0) >= 2 ? d.sparklineAdoption : generateAdoptionSparkline(d)} />
              </TableCell>
              <TableCell className="text-right">
                {d.alerts.narrativeStarting ? (
                  <span className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: "rgba(156,39,176,0.15)", color: "rgba(156,39,176,0.9)" }}>NARRATIVE</span>
                ) : d.alerts.earlyAdoption ? (
                  <span className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: "rgba(76,175,80,0.15)", color: "rgba(76,175,80,0.9)" }}>EARLY</span>
                ) : (
                  <span className="font-mono text-[10px] text-muted-foreground/40">—</span>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/* ═══════════════════════════════════════ */
/*        NARRATIVE TABLE (Module 3)       */
/* ═══════════════════════════════════════ */
function NarrativeTable({ data }: { data: SubnetRadarData[] }) {
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="font-mono text-[10px]">SN</TableHead>
            <TableHead className="font-mono text-[10px]">Nom</TableHead>
            <TableHead className="font-mono text-[10px] text-right">Narrative Score</TableHead>
            <TableHead className="font-mono text-[10px] text-right">Miners Δ7d</TableHead>
            <TableHead className="font-mono text-[10px] text-right">Holders Δ7d</TableHead>
            <TableHead className="font-mono text-[10px] text-right">Stake Δ7d</TableHead>
            <TableHead className="font-mono text-[10px] text-right">Signal</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.slice(0, 25).map((d) => (
            <TableRow key={d.netuid}>
              <TableCell className="font-mono text-xs font-semibold text-muted-foreground">{d.netuid}</TableCell>
              <TableCell className="font-mono text-xs truncate max-w-[120px]">{d.subnetName}</TableCell>
              <TableCell className="text-right">
                <span className="font-mono text-xs font-bold" style={{ color: narrativeScoreColor(d.scores.narrativeScore) }}>
                  {d.scores.narrativeScore}
                </span>
              </TableCell>
              <TableCell className="text-right"><PctChange value={d.deltas.minersGrowth7d * 100} /></TableCell>
              <TableCell className="text-right"><PctChange value={d.deltas.holdersGrowth7d * 100} /></TableCell>
              <TableCell className="text-right"><PctChange value={d.stakeChange7dPct} /></TableCell>
              <TableCell className="text-right">
                {d.alerts.narrativeForming ? (
                  <span className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: "rgba(156,39,176,0.15)", color: "rgba(156,39,176,0.9)" }}>FORMING</span>
                ) : d.scores.narrativeScore >= 50 ? (
                  <span className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: "rgba(100,181,246,0.15)", color: "rgba(100,181,246,0.9)" }}>WATCH</span>
                ) : (
                  <span className="font-mono text-[10px] text-muted-foreground/40">—</span>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/* ═══════════════════════════════════════ */
/*        DUMP RISK TABLE                  */
/* ═══════════════════════════════════════ */
function DumpRiskTable({ data }: { data: SubnetRadarData[] }) {
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="font-mono text-[10px]">SN</TableHead>
            <TableHead className="font-mono text-[10px]">Nom</TableHead>
            <TableHead className="font-mono text-[10px] text-right">Concentration</TableHead>
            <TableHead className="font-mono text-[10px] text-right">Stake Δ7d</TableHead>
            <TableHead className="font-mono text-[10px] text-right">Miners Δ7d</TableHead>
            <TableHead className="font-mono text-[10px] text-right">Validators</TableHead>
            <TableHead className="font-mono text-[10px] text-right">Risk</TableHead>
            <TableHead className="font-mono text-[10px] text-right">Signal</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.slice(0, 25).map((d) => (
            <TableRow key={d.netuid}>
              <TableCell className="font-mono text-xs font-semibold text-muted-foreground">{d.netuid}</TableCell>
              <TableCell className="font-mono text-xs truncate max-w-[120px]">{d.subnetName}</TableCell>
              <TableCell className="text-right">
                <span className="font-mono text-xs" style={{ color: d.snapshot.stakeConcentration > 60 ? "rgba(229,57,53,0.8)" : "rgba(255,255,255,0.5)" }}>
                  {d.snapshot.stakeConcentration.toFixed(0)}%
                </span>
              </TableCell>
              <TableCell className="text-right"><PctChange value={d.stakeChange7dPct} /></TableCell>
              <TableCell className="text-right"><PctChange value={d.deltas.minersGrowth7d * 100} /></TableCell>
              <TableCell className="font-mono text-xs text-right">{d.snapshot.validatorsActive || "—"}</TableCell>
              <TableCell className="text-right">
                <span className="font-mono text-xs font-bold" style={{ color: dumpRiskColor(d.scores.dumpRisk) }}>
                  {d.scores.dumpRisk}
                </span>
              </TableCell>
              <TableCell className="text-right">
                {d.alerts.dumpExit ? (
                  <span className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: "rgba(229,57,53,0.15)", color: "rgba(229,57,53,0.9)" }}>EXIT</span>
                ) : d.alerts.dumpWarning ? (
                  <span className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: "rgba(255,193,7,0.15)", color: "rgba(255,193,7,0.9)" }}>WARNING</span>
                ) : (
                  <span className="font-mono text-[10px] text-muted-foreground/40">—</span>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/* ─── Sparkline fallbacks ─── */
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

/* ═══════════════════════════════════════ */
/*        SMART MONEY PANEL                */
/* ═══════════════════════════════════════ */
function SmartMoneyPanel({ data }: { data: SubnetRadarData[] }) {
  const whaleActive = data
    .filter((d) => d.snapshot.largeWalletInflow > 0 || d.snapshot.largeWalletOutflow > 0)
    .sort((a, b) => (b.snapshot.largeWalletInflow - b.snapshot.largeWalletOutflow) - (a.snapshot.largeWalletInflow - a.snapshot.largeWalletOutflow));

  const smartMoneySignals = data
    .filter((d) => d.alerts.smartMoneySignal)
    .sort((a, b) => b.scores.smartMoneyScore - a.scores.smartMoneyScore);

  const topConcentrated = [...data]
    .filter((d) => d.snapshot.top10Stake?.length > 0)
    .sort((a, b) => b.snapshot.stakeConcentration - a.snapshot.stakeConcentration)
    .slice(0, 10);

  return (
    <div className="p-4 space-y-6">
      {/* Smart Money Signals */}
      {smartMoneySignals.length > 0 && (
        <div>
          <div className="font-mono text-[10px] tracking-widest uppercase text-muted-foreground mb-2">
            🎯 Smart Money Signals
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="font-mono text-[10px]">SN</TableHead>
                <TableHead className="font-mono text-[10px]">Nom</TableHead>
                <TableHead className="font-mono text-[10px] text-right">Score</TableHead>
                <TableHead className="font-mono text-[10px] text-right">Stake Inflow</TableHead>
                <TableHead className="font-mono text-[10px] text-right">Whale Activity</TableHead>
                <TableHead className="font-mono text-[10px] text-right">Signal</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {smartMoneySignals.map((d) => (
                <TableRow key={d.netuid}>
                  <TableCell className="font-mono text-xs font-semibold text-muted-foreground">{d.netuid}</TableCell>
                  <TableCell className="font-mono text-xs truncate max-w-[120px]">{d.subnetName}</TableCell>
                  <TableCell className="text-right">
                    <span className="font-mono text-xs font-bold" style={{ color: smartMoneyColor(d.scores.smartMoneyScore) }}>{d.scores.smartMoneyScore}</span>
                  </TableCell>
                  <TableCell className="text-right"><PctChange value={d.stakeChange7dPct} /></TableCell>
                  <TableCell className="font-mono text-xs text-right" style={{ color: "rgba(76,175,80,0.7)" }}>
                    +{d.snapshot.largeWalletInflow}τ / -{d.snapshot.largeWalletOutflow}τ
                  </TableCell>
                  <TableCell className="text-right">
                    <span className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: "rgba(76,175,80,0.15)", color: "rgba(76,175,80,0.9)" }}>SMART MONEY</span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Whale Activity */}
      <div>
        <div className="font-mono text-[10px] tracking-widest uppercase text-muted-foreground mb-2">
          🐋 Mouvements des gros wallets (24h)
        </div>
        {whaleActive.length === 0 ? (
          <div className="font-mono text-xs text-muted-foreground/50 py-4 text-center">Aucun mouvement détecté</div>
        ) : (
          <div className="space-y-1">
            {whaleActive.slice(0, 15).map((d) => {
              const net = d.snapshot.largeWalletInflow - d.snapshot.largeWalletOutflow;
              return (
                <div key={d.netuid} className="flex items-center gap-3 px-3 py-2 rounded-lg" style={{ background: "rgba(255,255,255,0.02)" }}>
                  <span className="font-mono text-xs text-muted-foreground w-8">SN-{d.netuid}</span>
                  <span className="font-mono text-xs truncate flex-1">{d.subnetName}</span>
                  <span className="font-mono text-xs" style={{ color: net > 0 ? "rgba(76,175,80,0.8)" : "rgba(229,57,53,0.7)" }}>
                    {net > 0 ? "↗" : "↘"} {Math.abs(net)}τ net
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Top Concentrated */}
      <div>
        <div className="font-mono text-[10px] tracking-widest uppercase text-muted-foreground mb-2">
          🏦 Top 10 Concentration de Stake
        </div>
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
                <div
                  key={i}
                  className="h-full"
                  style={{
                    width: `${Math.max(s.pct, 2)}%`,
                    background: `rgba(255,193,7,${0.3 + i * 0.07})`,
                  }}
                  title={`${s.address}: ${s.stake}τ (${s.pct}%)`}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── Helpers ─── */
function formatTao(v: number): string {
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}Mτ`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(0)}Kτ`;
  return `${Math.round(v)}τ`;
}
