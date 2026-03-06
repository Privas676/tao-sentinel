import React, { useMemo, useState } from "react";
import { useStakeAnalytics, type SubnetRadarData } from "@/hooks/use-stake-analytics";
import {
  healthIndexColor,
  momentumColor as capitalMomentumColor,
  dumpRiskColor,
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
function AlertBadge({ active, label, emoji }: { active: boolean; label: string; emoji: string }) {
  if (!active) return null;
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-mono text-[10px] font-semibold"
      style={{ background: "rgba(255,193,7,0.15)", color: "rgba(255,193,7,0.9)", border: "1px solid rgba(255,193,7,0.3)" }}>
      {emoji} {label}
    </span>
  );
}

/* ─── Tabs ─── */
type TabKey = "capital" | "adoption" | "risk" | "heatmap" | "smartmoney";
const TABS: { key: TabKey; label: string; icon: string }[] = [
  { key: "capital", label: "Capital Flow", icon: "💰" },
  { key: "adoption", label: "Adoption Radar", icon: "🚀" },
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

  // Global averages
  const avgScores = useMemo(() => {
    if (!radarData?.length) return { health: 0, momentum: 0, dumpRisk: 0 };
    const n = radarData.length;
    return {
      health: Math.round(radarData.reduce((s, d) => s + d.scores.healthIndex, 0) / n),
      momentum: Math.round(radarData.reduce((s, d) => s + d.scores.capitalMomentum, 0) / n),
      dumpRisk: Math.round(radarData.reduce((s, d) => s + d.scores.dumpRisk, 0) / n),
    };
  }, [radarData]);

  // Sorted data for each tab
  const capitalFlow = useMemo(
    () => [...(radarData || [])].sort((a, b) => b.scores.capitalMomentum - a.scores.capitalMomentum),
    [radarData]
  );
  const adoptionRadar = useMemo(
    () => [...(radarData || [])].sort((a, b) => b.scores.healthIndex - a.scores.healthIndex),
    [radarData]
  );
  const dumpRiskSorted = useMemo(
    () => [...(radarData || [])].sort((a, b) => b.scores.dumpRisk - a.scores.dumpRisk),
    [radarData]
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
            Détection des flux de capital et narratives émergentes · {radarData.length} subnets analysés
          </p>
        </div>

        {/* Global Scores */}
        <div className="grid grid-cols-3 gap-3">
          <ScoreBadge value={avgScores.health} colorFn={healthIndexColor} label="Health Index" />
          <ScoreBadge value={avgScores.momentum} colorFn={capitalMomentumColor} label="Capital Momentum" />
          <ScoreBadge value={avgScores.dumpRisk} colorFn={dumpRiskColor} label="Dump Risk" />
        </div>

        {/* Active Alerts */}
        {radarData.some((d) => d.alerts.earlyAdoption || d.alerts.whaleAccumulation || d.alerts.dumpRiskAlert) && (
          <div className="rounded-lg p-3 space-y-2" style={{ background: "rgba(255,193,7,0.05)", border: "1px solid rgba(255,193,7,0.15)" }}>
            <div className="font-mono text-[10px] tracking-widest uppercase text-muted-foreground">Alertes actives</div>
            <div className="flex flex-wrap gap-2">
              {radarData.filter((d) => d.alerts.earlyAdoption).map((d) => (
                <AlertBadge key={`ea-${d.netuid}`} active label={`SN-${d.netuid} Early Adoption`} emoji="🚀" />
              ))}
              {radarData.filter((d) => d.alerts.whaleAccumulation).map((d) => (
                <AlertBadge key={`wa-${d.netuid}`} active label={`SN-${d.netuid} Whale Accumulation`} emoji="🐋" />
              ))}
              {radarData.filter((d) => d.alerts.dumpRiskAlert).map((d) => (
                <AlertBadge key={`dr-${d.netuid}`} active label={`SN-${d.netuid} Dump Risk`} emoji="⚠️" />
              ))}
            </div>
          </div>
        )}

        {/* Tab Navigation */}
        <div className="flex gap-1 overflow-x-auto pb-1">
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

        {/* Tab Content */}
        <div className="rounded-lg overflow-hidden" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
          {activeTab === "capital" && <CapitalFlowTable data={capitalFlow} />}
          {activeTab === "adoption" && <AdoptionTable data={adoptionRadar} />}
          {activeTab === "risk" && <DumpRiskTable data={dumpRiskSorted} />}
          {activeTab === "heatmap" && <TreemapHeatmap data={radarData} />}
          {activeTab === "smartmoney" && <SmartMoneyPanel data={radarData} />}
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
            <TableHead className="font-mono text-[10px] text-right">Holders</TableHead>
            <TableHead className="font-mono text-[10px] text-right">Δ7d</TableHead>
            <TableHead className="font-mono text-[10px] text-right">Miners</TableHead>
            <TableHead className="font-mono text-[10px] text-right">UID%</TableHead>
            <TableHead className="font-mono text-[10px] text-right">Health</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.slice(0, 25).map((d) => (
            <TableRow key={d.netuid}>
              <TableCell className="font-mono text-xs font-semibold text-muted-foreground">{d.netuid}</TableCell>
              <TableCell className="font-mono text-xs truncate max-w-[120px]">{d.subnetName}</TableCell>
              <TableCell className="font-mono text-xs text-right">{d.snapshot.holdersCount || "—"}</TableCell>
              <TableCell className="text-right"><PctChange value={d.deltas.holdersGrowth7d * 100} /></TableCell>
              <TableCell className="font-mono text-xs text-right">
                {d.snapshot.minersActive}/{d.snapshot.minersTotal || "?"}
              </TableCell>
              <TableCell className="font-mono text-xs text-right">{(d.snapshot.uidUsage * 100).toFixed(0)}%</TableCell>
              <TableCell className="text-right">
                <span className="font-mono text-xs font-bold" style={{ color: healthIndexColor(d.scores.healthIndex) }}>
                  {d.scores.healthIndex}
                </span>
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
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/* ═══════════════════════════════════════ */
/*        HEATMAP GRID                     */
/* ═══════════════════════════════════════ */
function HeatmapGrid({ data }: { data: SubnetRadarData[] }) {
  const metrics = [
    { key: "adoption", label: "Adoption", getValue: (d: SubnetRadarData) => d.scores.healthIndex },
    { key: "capital", label: "Capital", getValue: (d: SubnetRadarData) => d.scores.capitalMomentum },
    { key: "risk", label: "Risk", getValue: (d: SubnetRadarData) => d.scores.dumpRisk },
    { key: "uid", label: "UID Usage", getValue: (d: SubnetRadarData) => d.snapshot.uidUsage * 100 },
  ];

  const sorted = [...data].sort((a, b) => a.netuid - b.netuid);

  return (
    <div className="overflow-x-auto p-4">
      <div className="font-mono text-[10px] tracking-widest uppercase text-muted-foreground mb-3">
        Carte de chaleur — {data.length} subnets × 4 axes
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs font-mono">
          <thead>
            <tr>
              <th className="text-left px-2 py-1 text-muted-foreground text-[10px]">SN</th>
              {metrics.map((m) => (
                <th key={m.key} className="text-center px-2 py-1 text-muted-foreground text-[10px]">{m.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.slice(0, 40).map((d) => (
              <tr key={d.netuid}>
                <td className="px-2 py-0.5 text-muted-foreground font-semibold">{d.netuid}</td>
                {metrics.map((m) => {
                  const v = Math.round(m.getValue(d));
                  return (
                    <td key={m.key} className="px-1 py-0.5 text-center">
                      <div
                        className="rounded px-2 py-0.5 inline-block min-w-[36px]"
                        style={{ background: heatmapColor(v), color: "rgba(255,255,255,0.9)" }}
                      >
                        {v}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════ */
/*        SMART MONEY PANEL                */
/* ═══════════════════════════════════════ */
function SmartMoneyPanel({ data }: { data: SubnetRadarData[] }) {
  // Show subnets with significant whale activity
  const whaleActive = data
    .filter((d) => d.snapshot.largeWalletInflow > 0 || d.snapshot.largeWalletOutflow > 0)
    .sort((a, b) => (b.snapshot.largeWalletInflow - b.snapshot.largeWalletOutflow) - (a.snapshot.largeWalletInflow - a.snapshot.largeWalletOutflow));

  // Show top 10 stake concentrations
  const topConcentrated = [...data]
    .filter((d) => d.snapshot.top10Stake?.length > 0)
    .sort((a, b) => b.snapshot.stakeConcentration - a.snapshot.stakeConcentration)
    .slice(0, 10);

  return (
    <div className="p-4 space-y-6">
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
            {/* Mini bar chart */}
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
