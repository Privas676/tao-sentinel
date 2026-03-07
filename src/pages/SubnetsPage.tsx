import React, { useMemo, useState } from "react";
import SwipeHint from "@/components/SwipeHint";
import DataAlignmentBadge from "@/components/DataAlignmentBadge";
import DistributionBadge from "@/components/DistributionBadge";
import { useI18n } from "@/lib/i18n";
import { useLocalPortfolio } from "@/hooks/use-local-portfolio";
import { useSubnetScores, type UnifiedSubnetScore, SPECIAL_SUBNETS } from "@/hooks/use-subnet-scores";
import MarketContextPanel from "@/components/MarketContextPanel";
import { type ScoreFactor, topFactors } from "@/lib/score-factors";
import { useSubnetVerdicts } from "@/hooks/use-subnet-verdict";
import { VerdictBadgeWithTooltip, verdictColor } from "@/components/VerdictBadge";
import {
  deriveMomentumLabel, momentumColor, computeMomentumScore,
  opportunityColor, riskColor, clamp,
  type SmartCapitalState,
  stabilityColor,
} from "@/lib/gauge-engine";
import {
  deriveSubnetAction, actionColor, actionBg, actionBorder, actionIcon,
} from "@/lib/strategy-engine";
import { confianceColor } from "@/lib/data-fusion";
import { type SourceMetrics } from "@/lib/data-fusion";
import {
  systemStatusColor, systemStatusLabel,
} from "@/lib/risk-override";
import {
  stateLabel, stateColor, stateSeverity,
  type DecisionState,
} from "@/lib/engine-decision-state";
import {
  healthColor, dilutionLabel, formatUsd,
  type HealthScores, type RecalculatedMetrics,
} from "@/lib/subnet-health";

/* ═══════════════════════════════════════ */
/*        SPARKLINE COMPONENT              */
/* ═══════════════════════════════════════ */
const Sparkline = React.forwardRef<HTMLDivElement, { data: number[]; width?: number; height?: number }>(function Sparkline({ data, width = 64, height = 20 }, ref) {
  if (data.length < 2) return <span className="text-white/10 text-[9px]">—</span>;
  const min = Math.min(...data), max = Math.max(...data);
  const range = max - min || 1;
  const first = data[0], last = data[data.length - 1];
  const trend = last - first;
  const pctChange = first > 0 ? ((last - first) / first) * 100 : 0;
  const color = trend > 0 ? "rgba(76,175,80,0.7)" : trend < 0 ? "rgba(229,57,53,0.7)" : "rgba(255,255,255,0.3)";
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - 1 - ((v - min) / range) * (height - 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  return (
    <div className="relative group inline-block">
      <svg width={width} height={height} className="inline-block">
        <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-150 z-50"
        style={{ width: 130 }}>
        <div className="rounded-lg px-3 py-2 font-mono text-[10px] space-y-1"
          style={{ background: "rgba(10,10,14,0.95)", border: "1px solid rgba(255,255,255,0.12)", boxShadow: "0 4px 20px rgba(0,0,0,0.6)" }}>
          <div className="flex justify-between"><span className="text-white/35">Min</span><span className="text-white/70">{min.toFixed(4)}</span></div>
          <div className="flex justify-between"><span className="text-white/35">Max</span><span className="text-white/70">{max.toFixed(4)}</span></div>
          <div className="flex justify-between"><span className="text-white/35">7j</span><span style={{ color }} className="font-bold">{pctChange > 0 ? "+" : ""}{pctChange.toFixed(1)}%</span></div>
        </div>
      </div>
    </div>
  );
});

/* ═══════════════════════════════════════ */
/*        HEALTH PANEL COMPONENT            */
/* ═══════════════════════════════════════ */
function HealthPanel({ health, onClose }: {
  health: { netuid: number; name: string; recalc: RecalculatedMetrics; scores: HealthScores; displayedCap: number; displayedLiq: number };
  onClose: () => void;
}) {
  const { recalc, scores } = health;
  const capDiv = health.displayedCap > 0 ? Math.abs(recalc.mcRecalc - health.displayedCap) / health.displayedCap * 100 : 0;
  const liqDiv = health.displayedLiq > 0 ? Math.abs(recalc.liquidityRecalc - health.displayedLiq) / health.displayedLiq * 100 : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/70" />
      <div className="relative rounded-xl p-5 font-mono text-[11px] max-w-md w-full mx-4 space-y-4"
        style={{ background: "rgba(10,10,14,0.98)", border: "1px solid rgba(255,215,0,0.15)", boxShadow: "0 8px 40px rgba(0,0,0,0.8)" }}
        onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-3">
          <h3 className="text-white/90 text-sm font-bold tracking-wider">🔬 HEALTH — SN-{health.netuid} {health.name}</h3>
          <button onClick={onClose} className="text-white/30 hover:text-white/60 text-lg">✕</button>
        </div>
        <div className="space-y-1.5">
          <div className="text-white/40 text-[9px] tracking-widest mb-1">RECALCULS</div>
          <Row label="MC recalc" value={formatUsd(recalc.mcRecalc)} sub={capDiv > 2 ? `△ ${capDiv.toFixed(1)}%` : "✓"} warn={capDiv > 5} />
          <Row label="FDV recalc" value={formatUsd(recalc.fdvRecalc)} />
          <Row label="Dilution" value={`${recalc.dilutionRatio.toFixed(2)}x — ${dilutionLabel(recalc.dilutionRatio)}`} warn={recalc.dilutionRatio > 3} />
          <Row label="Volume/MC" value={`${(recalc.volumeToMc * 100).toFixed(2)}%`} />
          <Row label="Emission/MC" value={`${(recalc.emissionToMc * 100).toFixed(3)}%/j`} warn={recalc.emissionToMc > 0.005} />
          <Row label="Liq/MC" value={`${(recalc.liquidityToMc * 100).toFixed(2)}%`} warn={recalc.liquidityToMc < 0.003} />
          <Row label="Liq Haircut" value={`${recalc.liqHaircut > 0 ? "+" : ""}${recalc.liqHaircut.toFixed(2)}%`} sub={recalc.poolPrice > 0 ? `Pool: ${recalc.poolPrice.toFixed(5)}τ` : undefined} warn={Math.abs(recalc.liqHaircut) > 5} />
          {liqDiv > 5 && <Row label="Liq divergence" value={`${liqDiv.toFixed(1)}%`} warn={true} />}
        </div>
        <div className="space-y-1.5 pt-2 border-t border-white/5">
          <div className="text-white/40 text-[9px] tracking-widest mb-1">SCORES SANTÉ</div>
          <ScoreBar label="Liquidité" score={scores.liquidityHealth} />
          <ScoreBar label="Volume" score={scores.volumeHealth} />
          <ScoreBar label="Émission" score={100 - scores.emissionPressure} inverted />
          <ScoreBar label="Dilution" score={100 - scores.dilutionRisk} inverted />
          <ScoreBar label="Activité" score={scores.activityHealth} />
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, sub, warn }: { label: string; value: string; sub?: string; warn?: boolean }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-white/40">{label}</span>
      <span className="flex items-center gap-2">
        <span className={warn ? "text-orange-400" : "text-white/70"}>{value}</span>
        {sub && <span className={`text-[9px] ${warn ? "text-red-400" : "text-green-400/60"}`}>{sub}</span>}
      </span>
    </div>
  );
}

function ScoreBar({ label, score, inverted }: { label: string; score: number; inverted?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-white/40 w-16">{label}</span>
      <div className="flex-1 h-1.5 rounded-full bg-white/5 overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${score}%`, background: healthColor(score) }} />
      </div>
      <span className="text-white/60 w-8 text-right">{Math.round(score)}</span>
    </div>
  );
}



type SortCol = "netuid" | "name" | "status" | "dstate" | "price" | "var30d" | "spark" | "opp" | "risk" | "depeg" | "asymmetry" | "action" | "momentum" | "sc" | "confiance" | "verdict" | null;
type ViewMode = "all" | "opportunities" | "risks" | "mine" | "rentre" | "hold" | "sors";

function scColor(state: SmartCapitalState): string {
  switch (state) {
    case "ACCUMULATION": return "rgba(76,175,80,0.8)";
    case "DISTRIBUTION": return "rgba(229,57,53,0.8)";
    case "STABLE": return "rgba(255,248,220,0.4)";
  }
}

export default function SubnetsPage() {
  const { t, lang } = useI18n();
  const [mode, setMode] = useState<ViewMode>("all");
  const [healthPanel, setHealthPanel] = useState<null | any>(null);
  const [tmcPanel, setTmcPanel] = useState<null | { netuid: number; name: string }>(null);
  const [sortCol, setSortCol] = useState<SortCol>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const { ownedNetuids, addPosition, isOwned } = useLocalPortfolio();



  const toggleSort = (col: SortCol) => {
    if (sortCol === col) {
      if (sortDir === "desc") setSortDir("asc");
      else { setSortCol(null); setSortDir("desc"); }
    } else {
      setSortCol(col);
      setSortDir("desc");
    }
  };

  // ── UNIFIED SCORES (single source of truth) ──
  const { scoresList, sparklines, scoreTimestamp, marketContext, dataAlignment, dataAgeDebug, decisionStates, fleetDistribution } = useSubnetScores();
  const { verdicts } = useSubnetVerdicts();

  const rows = useMemo(() => {
    return scoresList
      .map(r => ({
        ...r,
        owned: ownedNetuids.has(r.netuid),
        spark: sparklines?.get(r.netuid) || [],
        verdict: verdicts.get(r.netuid),
      }))
      .filter(r => {
        if (mode === "opportunities") return r.assetType !== "CORE_NETWORK" && !r.isOverridden && r.opp > r.risk;
        if (mode === "risks") return r.assetType !== "CORE_NETWORK" && r.risk >= r.opp;
        if (mode === "mine") return r.owned;
        if (mode === "rentre") return r.verdict?.verdict === "RENTRE";
        if (mode === "hold") return r.verdict?.verdict === "HOLD";
        if (mode === "sors") return r.verdict?.verdict === "SORS";
        return true;
      })
      .sort((a, b) => {
        if (sortCol) {
          const actionRank = (a: string) => ["EXIT","SELL","NEUTRAL","WATCH","HOLD","STAKE","ACCUMULATE","ENTER"].indexOf(a);
          const scRank = (s: SmartCapitalState) => s === "ACCUMULATION" ? 2 : s === "STABLE" ? 1 : 0;
          const momRank = (m: string) => ["COLD","COOL","WARM","HOT","FIRE"].indexOf(m);
          const statusRank = (s: string) => ["CRITICAL","DEGRADED","WARNING","OK"].indexOf(s);
          let av = 0, bv = 0;
          switch (sortCol) {
            case "netuid": av = a.netuid; bv = b.netuid; break;
            case "name": return sortDir === "desc" ? b.name.localeCompare(a.name) : a.name.localeCompare(b.name);
            case "status": av = statusRank(a.systemStatus); bv = statusRank(b.systemStatus); break;
            case "price": av = a.alphaPrice || 0; bv = b.alphaPrice || 0; break;
            case "var30d": av = a.priceVar30d ?? -9999; bv = b.priceVar30d ?? -9999; break;
            case "spark": {
              const sa = a.spark, sb = b.spark;
              const pctA = sa.length >= 2 && sa[0] > 0 ? (sa[sa.length-1] - sa[0]) / sa[0] : -9999;
              const pctB = sb.length >= 2 && sb[0] > 0 ? (sb[sb.length-1] - sb[0]) / sb[0] : -9999;
              av = pctA; bv = pctB; break;
            }
            case "opp": av = a.opp; bv = b.opp; break;
            case "risk": av = a.risk; bv = b.risk; break;
            case "asymmetry": av = a.asymmetry; bv = b.asymmetry; break;
            case "action": av = actionRank(a.action); bv = actionRank(b.action); break;
            case "momentum": av = momRank(a.momentumLabel); bv = momRank(b.momentumLabel); break;
            case "sc": av = scRank(a.sc); bv = scRank(b.sc); break;
            case "confiance": av = a.confianceScore; bv = b.confianceScore; break;
            case "depeg": av = a.depegProbability; bv = b.depegProbability; break;
            case "verdict": {
              const vRank = (v: string | undefined) => v === "RENTRE" ? 3 : v === "HOLD" ? 2 : v === "SORS" ? 1 : 0;
              av = vRank(a.verdict?.verdict); bv = vRank(b.verdict?.verdict); break;
            }
            case "dstate": {
              const dsA = decisionStates?.get(a.netuid);
              const dsB = decisionStates?.get(b.netuid);
              av = dsA ? stateSeverity(dsA.state as DecisionState) : 0;
              bv = dsB ? stateSeverity(dsB.state as DecisionState) : 0;
              break;
            }
          }
          return sortDir === "desc" ? bv - av : av - bv;
        }
        // Default sort
        if (mode === "risks") {
          if (a.isOverridden !== b.isOverridden) return a.isOverridden ? -1 : 1;
          return b.risk - a.risk;
        }
        return b.asymmetry - a.asymmetry;
      });
  }, [scoresList, mode, ownedNetuids, sparklines, sortCol, sortDir, decisionStates, verdicts]);

  const modeOptions: { value: ViewMode; label: string }[] = [
    { value: "all", label: t("sub.mode_all") },
    { value: "rentre", label: "🟢 RENTRE" },
    { value: "hold", label: "🟡 HOLD" },
    { value: "sors", label: "🔴 SORS" },
    { value: "opportunities", label: t("sub.mode_opp") },
    { value: "risks", label: t("sub.mode_risk") },
    ...(ownedNetuids.size > 0 ? [{ value: "mine" as ViewMode, label: lang === "fr" ? "Mes subnets" : "My subnets" }] : []),
  ];

  const scLabelFn = (state: SmartCapitalState): string => {
    switch (state) {
      case "ACCUMULATION": return lang === "fr" ? "Accum." : "Accum.";
      case "DISTRIBUTION": return lang === "fr" ? "Distrib." : "Distrib.";
      case "STABLE": return "Stable";
    }
  };

  return (
    <div className="h-full w-full bg-background text-foreground p-4 sm:p-6 overflow-y-auto overflow-x-hidden pt-14 pl-4 sm:pl-6">
      <div className="flex items-center gap-3 mb-5 sm:mb-7 ml-28">
        <h1 className="font-mono text-lg sm:text-xl tracking-widest">{t("sub.title")}</h1>
        <span className="font-mono text-[8px] px-2 py-0.5 rounded cursor-help"
          style={{ background: "rgba(255,215,0,0.06)", color: "rgba(255,215,0,0.5)", border: "1px solid rgba(255,215,0,0.1)" }}
          title={`Score snapshot: ${scoreTimestamp}`}>
          ⏱ {new Date(scoreTimestamp).toLocaleTimeString()}
        </span>
        <DataAlignmentBadge dataAlignment={dataAlignment} dataAgeDebug={dataAgeDebug} />
        <DistributionBadge report={fleetDistribution} />
      </div>

      {/* Filter row */}
      <div className="flex items-center gap-3 mb-6 flex-wrap">
        <div className="flex rounded-lg overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.08)" }}>
          {modeOptions.map(opt => (
            <button key={opt.value}
              onClick={() => {
                setMode(opt.value);
                if (opt.value === "risks") { setSortCol("depeg"); setSortDir("desc"); }
                else if (opt.value !== mode) { setSortCol(null); setSortDir("desc"); }
              }}
              className="font-mono text-[11px] tracking-wider px-4 py-2 transition-all"
              style={{
                background: mode === opt.value ? "rgba(255,215,0,0.1)" : "transparent",
                color: mode === opt.value ? "rgba(255,215,0,0.9)" : "rgba(255,255,255,0.35)",
                fontWeight: mode === opt.value ? 700 : 400,
              }}>
              {opt.label}
            </button>
          ))}
        </div>

        {/* Override ratio indicator — visible in Risques view */}
        {mode === "risks" && (() => {
          const total = scoresList.filter(s => s.assetType !== "CORE_NETWORK").length;
          const overrides = scoresList.filter(s => s.assetType !== "CORE_NETWORK" && s.isOverridden).length;
          const warnings = scoresList.filter(s => s.assetType !== "CORE_NETWORK" && s.systemStatus === "SURVEILLANCE").length;
          const criticals = scoresList.filter(s => s.assetType !== "CORE_NETWORK" && (s.systemStatus === "ZONE_CRITIQUE" || s.systemStatus === "DEPEG" || s.systemStatus === "DEREGISTRATION")).length;
          const pct = total > 0 ? Math.round((overrides / total) * 100) : 0;
          const barColor = pct > 30 ? "rgba(229,57,53,0.8)" : pct > 15 ? "rgba(255,152,0,0.8)" : "rgba(76,175,80,0.8)";
          return (
            <div className="flex items-center gap-3 font-mono text-[10px]"
              style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 8, padding: "6px 12px" }}>
              <div className="flex items-center gap-2">
                <span className="text-white/40">Overrides</span>
                <span className="font-bold" style={{ color: barColor }}>{overrides}/{total}</span>
                <div className="w-16 h-1.5 rounded-full bg-white/5 overflow-hidden">
                  <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: barColor }} />
                </div>
                <span className="font-bold" style={{ color: barColor }}>{pct}%</span>
              </div>
              {criticals > 0 && (
                <span className="flex items-center gap-1" style={{ color: "rgba(229,57,53,0.9)" }}>
                  <span>🔴</span> {criticals} critical
                </span>
              )}
              {warnings > 0 && (
                <span className="flex items-center gap-1" style={{ color: "rgba(255,152,0,0.8)" }}>
                  <span>🟠</span> {warnings} warn
                </span>
              )}
            </div>
          );
        })()}
      </div>

      <SwipeHint storageKey="swipe-hint-seen" />


      {/* Table — swipe-friendly on mobile */}
      <div className="overflow-x-auto -webkit-overflow-scrolling-touch relative" style={{ WebkitOverflowScrolling: "touch" }}>
        <table className="w-full font-mono text-xs" style={{ minWidth: 1200 }}>
          <thead>
            <tr className="border-b border-white/10 text-white/40">
              <th className="text-left py-3 px-2 cursor-pointer select-none hover:text-white/70 transition-colors sticky left-0 z-10 bg-background" onClick={() => toggleSort("netuid")}>
                SN {sortCol === "netuid" ? (sortDir === "desc" ? "▼" : "▲") : ""}
              </th>
              <th className="text-left py-3 px-2 cursor-pointer select-none hover:text-white/70 transition-colors sticky left-[40px] z-10 bg-background" style={{ boxShadow: "4px 0 8px -2px rgba(0,0,0,0.3)" }} onClick={() => toggleSort("name")}>
                {t("sub.name")} {sortCol === "name" ? (sortDir === "desc" ? "▼" : "▲") : ""}
              </th>
              <th className="text-center py-3 px-2 cursor-pointer select-none hover:text-white/70 transition-colors" onClick={() => toggleSort("verdict")}>
                VERDICT {sortCol === "verdict" ? (sortDir === "desc" ? "▼" : "▲") : ""}
              </th>
              <th className="text-center py-3 px-2 cursor-pointer select-none hover:text-white/70 transition-colors" onClick={() => toggleSort("dstate")}>
                ÉTAT {sortCol === "dstate" ? (sortDir === "desc" ? "▼" : "▲") : ""}
              </th>
              <th className="text-center py-3 px-2 cursor-pointer select-none hover:text-white/70 transition-colors" onClick={() => toggleSort("status")}>
                STATUT {sortCol === "status" ? (sortDir === "desc" ? "▼" : "▲") : ""}
              </th>
              <th className="text-right py-3 px-2 cursor-pointer select-none hover:text-white/70 transition-colors" onClick={() => toggleSort("price")}>
                Prix α {sortCol === "price" ? (sortDir === "desc" ? "▼" : "▲") : ""}
              </th>
              <th className="text-right py-3 px-2 cursor-pointer select-none hover:text-white/70 transition-colors" onClick={() => toggleSort("var30d")}>
                Var 30j {sortCol === "var30d" ? (sortDir === "desc" ? "▼" : "▲") : ""}
              </th>
              <th className="text-center py-3 px-2 cursor-pointer select-none hover:text-white/70 transition-colors" onClick={() => toggleSort("spark")}>
                {t("tip.price7d")} {sortCol === "spark" ? (sortDir === "desc" ? "▼" : "▲") : ""}
              </th>
              <th className="text-right py-3 px-2 cursor-pointer select-none hover:text-white/70 transition-colors" onClick={() => toggleSort("opp")}>
                {t("sub.opp")} {sortCol === "opp" ? (sortDir === "desc" ? "▼" : "▲") : ""}
              </th>
              <th className="text-right py-3 px-2 cursor-pointer select-none hover:text-white/70 transition-colors" onClick={() => toggleSort("risk")}>
                {t("sub.risk")} {sortCol === "risk" ? (sortDir === "desc" ? "▼" : "▲") : ""}
              </th>
              {mode === "risks" && (
                <th className="text-center py-3 px-2 cursor-pointer select-none hover:text-white/70 transition-colors" onClick={() => toggleSort("depeg")}>
                  Depeg % {sortCol === "depeg" ? (sortDir === "desc" ? "▼" : "▲") : ""}
                </th>
              )}
              <th className="text-right py-3 px-2 cursor-pointer select-none hover:text-white/70 transition-colors" onClick={() => toggleSort("asymmetry")}>
                AS {sortCol === "asymmetry" ? (sortDir === "desc" ? "▼" : "▲") : ""}
              </th>
              <th className="text-center py-3 px-2 cursor-pointer select-none hover:text-white/70 transition-colors" onClick={() => toggleSort("action")}>
                ACTION {sortCol === "action" ? (sortDir === "desc" ? "▼" : "▲") : ""}
              </th>
              <th className="text-center py-3 px-2 cursor-pointer select-none hover:text-white/70 transition-colors" onClick={() => toggleSort("momentum")}>
                {t("sub.momentum")} {sortCol === "momentum" ? (sortDir === "desc" ? "▼" : "▲") : ""}
              </th>
              <th className="text-center py-3 px-2 cursor-pointer select-none hover:text-white/70 transition-colors" onClick={() => toggleSort("sc")}>
                {t("sc.label")} {sortCol === "sc" ? (sortDir === "desc" ? "▼" : "▲") : ""}
              </th>
              <th className="text-right py-3 px-2 cursor-pointer select-none hover:text-white/70 transition-colors" onClick={() => toggleSort("confiance")}>
                {t("data.confiance")} {sortCol === "confiance" ? (sortDir === "desc" ? "▼" : "▲") : ""}
              </th>
              <th className="text-center py-3 px-2">🔬</th>
              <th className="text-center py-3 px-2" title="Market Context (TMC)">📊</th>
              <th className="text-center py-3 px-2">✔</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, idx) => {
              const oppC = r.isOverridden ? "rgba(229,57,53,0.4)" : opportunityColor(r.opp);
              const rskC = riskColor(r.risk);
              const isTop1 = idx === 0 && !r.isOverridden && r.assetType !== "CORE_NETWORK";
              const momColor = momentumColor(r.momentumLabel);
              const actionLabel = r.action === "EXIT"
                ? (lang === "fr" ? "SORTIR" : "EXIT")
                : r.action === "STAKE"
                ? "STAKER"
                : r.action === "NEUTRAL"
                ? "NEUTRE"
                : r.action === "HOLD"
                ? "HOLD"
                : t(`strat.${r.action.toLowerCase()}` as any);
              return (
                <tr key={r.netuid}
                  className="border-b border-white/[0.04] hover:bg-white/[0.03] transition-colors cursor-pointer"
                  style={{
                    ...(isTop1 ? { background: "rgba(255,215,0,0.02)", borderLeft: "2px solid rgba(255,215,0,0.3)" } : {}),
                    ...(r.isOverridden ? { background: "rgba(229,57,53,0.03)", borderLeft: "2px solid rgba(229,57,53,0.4)" } : {}),
                  }}
                  onClick={() => window.open(`https://taostats.io/subnets/${r.netuid}`, "_blank")}>
                  <td className="py-3 px-2 text-white/55 text-sm sticky left-0 z-[5] bg-background">{r.netuid}</td>
                  <td className="py-3 px-2 text-sm sticky left-[40px] z-[5] bg-background" style={{ color: isTop1 ? "rgba(255,248,220,0.95)" : r.isOverridden ? "rgba(255,255,255,0.4)" : "rgba(255,255,255,0.75)", fontWeight: isTop1 ? 700 : 400, boxShadow: "4px 0 8px -2px rgba(0,0,0,0.3)" }}>
                    <span>{r.name}</span>
                    {SPECIAL_SUBNETS[r.netuid] && (
                      <span className="ml-2 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[8px] font-bold tracking-wider"
                        style={{ background: "rgba(100,181,246,0.10)", color: "rgba(100,181,246,0.9)", border: "1px solid rgba(100,181,246,0.25)" }}>
                        🔷 {SPECIAL_SUBNETS[r.netuid].label}
                      </span>
                    )}
                    {r.isOverridden && (
                      <span className="ml-2 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[8px] font-bold tracking-wider"
                        style={{ background: "rgba(229,57,53,0.12)", color: "rgba(229,57,53,0.9)", border: "1px solid rgba(229,57,53,0.25)" }}
                        title={r.overrideReasons.join(' • ')}>
                        ⛔ OVERRIDE ({r.overrideReasons.length} raisons)
                      </span>
                    )}
                    {r.isWarning && !r.isOverridden && (
                      <span className="ml-2 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[8px] tracking-wider"
                        style={{ background: "rgba(255,193,7,0.10)", color: "rgba(255,193,7,0.9)", border: "1px solid rgba(255,193,7,0.25)" }}
                        title={r.overrideReasons.join(' • ')}>
                        ⚠ Warning
                      </span>
                    )}
                  </td>
                  <td className="py-3 px-2 text-center relative group/ds">
                    {(() => {
                      const ds = decisionStates?.get(r.netuid);
                      const st = ds?.state as DecisionState | undefined;
                      if (!st || st === "OK") return <span className="font-mono text-[9px] text-white/15">—</span>;
                      const sev = stateSeverity(st);
                      const col = stateColor(st);
                      const cooldownMin = ds?.isCooledDown ? "En cooldown" : null;
                      const pendingInfo = ds?.pendingState && ds.pendingTicks > 0
                        ? `${stateLabel(ds.pendingState as DecisionState)} (${ds.pendingTicks} tick${ds.pendingTicks > 1 ? "s" : ""})`
                        : null;
                      const reasons = r.overrideReasons?.length ? r.overrideReasons : [];
                      return (
                        <div className="inline-block relative">
                          <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[8px] font-bold tracking-wider whitespace-nowrap cursor-help${sev >= 3 ? " animate-pulse" : ""}`}
                            style={{ background: `${col}15`, color: col, border: `1px solid ${col}40` }}>
                            {sev >= 3 ? "🚨" : sev >= 2 ? "⚠" : "👁"} {stateLabel(st)}
                          </span>
                          {/* Rich tooltip */}
                          <div className={`absolute left-1/2 -translate-x-1/2 pointer-events-none opacity-0 group-hover/ds:opacity-100 transition-opacity duration-150 z-50 ${idx < 3 ? 'top-full mt-2' : 'bottom-full mb-2'}`}
                            style={{ width: 220 }}>
                            <div className="rounded-lg px-3 py-2.5 font-mono text-[10px] space-y-1.5"
                              style={{ background: "rgba(10,10,14,0.97)", border: `1px solid ${col}30`, boxShadow: `0 4px 24px rgba(0,0,0,0.7), 0 0 12px ${col}10` }}>
                              <div className="font-bold text-[11px] tracking-wider" style={{ color: col }}>
                                {sev >= 3 ? "🚨" : sev >= 2 ? "⚠" : "👁"} {stateLabel(st)}
                              </div>
                              <div className="flex justify-between text-white/40">
                                <span>Sévérité</span>
                                <span className="text-white/70 font-bold">{sev}/4</span>
                              </div>
                              <div className="flex justify-between text-white/40">
                                <span>Transition</span>
                                <span style={{ color: ds?.isTransition ? "rgba(76,175,80,0.9)" : "rgba(255,255,255,0.4)" }}>
                                  {ds?.isTransition ? "✓ Nouvelle" : "Confirmé"}
                                </span>
                              </div>
                              {cooldownMin && (
                                <div className="flex justify-between text-white/40">
                                  <span>Cooldown</span>
                                  <span style={{ color: "rgba(255,193,7,0.8)" }}>⏳ Actif</span>
                                </div>
                              )}
                              {pendingInfo && (
                                <div className="pt-1 border-t border-white/5">
                                  <div className="text-white/30 text-[8px] tracking-widest mb-0.5">TRANSITION PENDING</div>
                                  <div className="text-white/60">{pendingInfo}</div>
                                </div>
                              )}
                              {reasons.length > 0 && (
                                <div className="pt-1 border-t border-white/5">
                                  <div className="text-white/30 text-[8px] tracking-widest mb-0.5">RAISONS</div>
                                  {reasons.slice(0, 4).map((reason, i) => (
                                    <div key={i} className="text-white/55 truncate">• {reason}</div>
                                  ))}
                                  {reasons.length > 4 && <div className="text-white/30">+{reasons.length - 4} autres</div>}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })()}
                  </td>
                  <td className="py-3 px-2 text-center">
                    <span className="font-mono text-[9px] font-bold px-1.5 py-0.5 rounded"
                      style={{ color: systemStatusColor(r.systemStatus), background: `${systemStatusColor(r.systemStatus)}15`, border: `1px solid ${systemStatusColor(r.systemStatus)}30` }}>
                      {systemStatusLabel(r.systemStatus)}
                    </span>
                  </td>
                  <td className="py-3 px-2 text-right font-mono text-[11px]" style={{ color: "rgba(255,255,255,0.65)" }}>
                    {r.alphaPrice > 0 ? r.alphaPrice.toFixed(5) : "—"}
                  </td>
                  <td className="py-3 px-2 text-right font-mono text-[11px] font-bold" style={{
                    color: r.priceVar30d == null ? "rgba(255,255,255,0.2)"
                      : r.priceVar30d > 0 ? "rgba(76,175,80,0.85)"
                      : r.priceVar30d < 0 ? "rgba(229,57,53,0.85)"
                      : "rgba(255,255,255,0.4)"
                  }}>
                    {r.priceVar30d != null ? `${r.priceVar30d > 0 ? "+" : ""}${r.priceVar30d.toFixed(0)}%` : "—"}
                  </td>
                  <td className="py-3 px-2 text-center"><Sparkline data={r.spark} /></td>
                  <td className="py-3 px-2 text-right font-bold text-sm relative group/opp" style={{ color: oppC }}>
                    {r.opp}
                    {/* Opportunity ScoreFactors tooltip */}
                    <div className={`absolute right-0 pointer-events-none opacity-0 group-hover/opp:opacity-100 transition-opacity duration-150 z-50 ${idx < 3 ? 'top-full mt-2' : 'bottom-full mb-2'}`}
                      style={{ width: 230 }}>
                      <div className="rounded-lg px-3 py-2.5 font-mono text-[10px] space-y-1.5"
                        style={{ background: "rgba(10,10,14,0.97)", border: "1px solid rgba(255,215,0,0.2)", boxShadow: "0 4px 24px rgba(0,0,0,0.7)" }}>
                        <div className="flex justify-between items-center">
                          <span className="font-bold text-[11px] tracking-wider" style={{ color: oppC }}>OPP {r.opp}</span>
                          <span className="text-[8px] text-white/20" title={`Snapshot: ${scoreTimestamp}`}>📷 {new Date(scoreTimestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        </div>
                        <div className="text-white/25 text-[8px] tracking-widest pt-0.5">TOP CONTRIBUTEURS</div>
                        {(() => {
                          const h = r.healthScores;
                          const factors: ScoreFactor[] = [
                            { code: "MOMENTUM", label: "Momentum (PSI)", contribution: Math.round(clamp(r.psi - 40, 0, 60) / 60 * 30), rawValue: r.psi },
                            { code: "VOLUME", label: "Volume santé", contribution: Math.round(h.volumeHealth / 100 * 20), rawValue: Math.round(h.volumeHealth) },
                            { code: "ACTIVITY", label: "Activité mineurs", contribution: Math.round(h.activityHealth / 100 * 20), rawValue: Math.round(h.activityHealth) },
                            { code: "SMART_CAPITAL", label: "Smart Capital", contribution: r.sc === "ACCUMULATION" ? 15 : r.sc === "DISTRIBUTION" ? 3 : 8, rawValue: r.sc === "ACCUMULATION" ? 70 : r.sc === "DISTRIBUTION" ? 20 : 45 },
                            { code: "LIQUIDITY", label: "Liquidité", contribution: Math.round(h.liquidityHealth / 100 * 15), rawValue: Math.round(h.liquidityHealth) },
                          ];
                          return topFactors(factors, 3).map((f, i) => (
                            <div key={i} className="space-y-0.5">
                              <div className="flex justify-between items-center">
                                <span className="text-white/50">{f.label}</span>
                                <span className="text-white/75 font-bold">+{f.contribution}</span>
                              </div>
                              <div className="flex items-center gap-1.5">
                                <div className="flex-1 h-1 rounded-full bg-white/5 overflow-hidden">
                                  <div className="h-full rounded-full" style={{ width: `${clamp((f.rawValue ?? 0), 0, 100)}%`, background: oppC }} />
                                </div>
                                <span className="text-white/30 text-[8px] w-6 text-right">{f.rawValue ?? 0}</span>
                              </div>
                            </div>
                          ));
                        })()}
                        {r.isOverridden && <div className="text-red-400/80 text-[9px] pt-1.5 border-t border-white/5">⛔ Override actif → OPP = 0</div>}
                      </div>
                    </div>
                  </td>
                  <td className="py-3 px-2 text-right font-bold text-sm relative group/rsk" style={{ color: rskC }}>
                    {r.risk}
                    {/* Risk ScoreFactors tooltip */}
                    <div className={`absolute right-0 pointer-events-none opacity-0 group-hover/rsk:opacity-100 transition-opacity duration-150 z-50 ${idx < 3 ? 'top-full mt-2' : 'bottom-full mb-2'}`}
                      style={{ width: 230 }}>
                      <div className="rounded-lg px-3 py-2.5 font-mono text-[10px] space-y-1.5"
                        style={{ background: "rgba(10,10,14,0.97)", border: "1px solid rgba(229,57,53,0.2)", boxShadow: "0 4px 24px rgba(0,0,0,0.7)" }}>
                        <div className="flex justify-between items-center">
                          <span className="font-bold text-[11px] tracking-wider" style={{ color: rskC }}>RISK {r.risk}</span>
                          <span className="text-[8px] text-white/20" title={`Snapshot: ${scoreTimestamp}`}>📷 {new Date(scoreTimestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        </div>
                        <div className="text-white/25 text-[8px] tracking-widest pt-0.5">TOP CONTRIBUTEURS</div>
                        {(() => {
                          const h = r.healthScores;
                          const factors: ScoreFactor[] = [
                            { code: "LIQ_LOW", label: "Liquidité ↓", contribution: Math.round((100 - h.liquidityHealth) / 100 * 30), rawValue: Math.round(100 - h.liquidityHealth) },
                            { code: "EMISSION", label: "Pression émission", contribution: Math.round(h.emissionPressure / 100 * 25), rawValue: Math.round(h.emissionPressure) },
                            { code: "DILUTION", label: "Risque dilution", contribution: Math.round(h.dilutionRisk / 100 * 25), rawValue: Math.round(h.dilutionRisk) },
                            { code: "ACTIVITY_LOW", label: "Activité ↓", contribution: Math.round((100 - h.activityHealth) / 100 * 20), rawValue: Math.round(100 - h.activityHealth) },
                            { code: "HAIRCUT", label: "Haircut prix", contribution: Math.round(Math.min(Math.abs(r.recalc.liqHaircut), 50) / 50 * 15), rawValue: Math.round(Math.abs(r.recalc.liqHaircut)) },
                          ];
                          return topFactors(factors, 3).map((f, i) => (
                            <div key={i} className="space-y-0.5">
                              <div className="flex justify-between items-center">
                                <span className="text-white/50">{f.label}</span>
                                <span className="text-white/75 font-bold">+{f.contribution}</span>
                              </div>
                              <div className="flex items-center gap-1.5">
                                <div className="flex-1 h-1 rounded-full bg-white/5 overflow-hidden">
                                  <div className="h-full rounded-full" style={{ width: `${clamp((f.rawValue ?? 0), 0, 100)}%`, background: rskC }} />
                                </div>
                                <span className="text-white/30 text-[8px] w-6 text-right">{f.rawValue ?? 0}</span>
                              </div>
                            </div>
                          ));
                        })()}
                        {r.delistCategory !== "NORMAL" && (
                          <div className="pt-1.5 border-t border-white/5">
                            <div className="flex justify-between items-center">
                              <span className="text-[9px]" style={{ color: r.delistCategory === "DEPEG_PRIORITY" ? "rgba(229,57,53,0.9)" : "rgba(255,152,0,0.9)" }}>
                                {r.delistCategory === "DEPEG_PRIORITY" ? "🔴 RISQUE DEREG" : "🟠 Near Delist"}
                              </span>
                              <span className="text-white/60 font-bold text-[9px]">Score {r.delistScore}</span>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </td>
                  {mode === "risks" && (() => {
                    const dp = r.depegProbability;
                    const dpColor = dp >= 85 ? "rgba(229,57,53,0.95)" : dp >= 70 ? "rgba(255,152,0,0.9)" : dp >= 30 ? "rgba(255,193,7,0.7)" : "rgba(76,175,80,0.7)";
                    const dpLabel = r.depegState === "CONFIRMED" ? "🔴" : r.depegState === "WATCH" || r.depegState === "WAITLIST" ? "🟠" : "";
                    return (
                      <td className="py-3 px-2 relative group/depeg">
                        <div className="flex items-center gap-1.5 justify-center">
                          <div className="w-14 h-2 rounded-full bg-white/5 overflow-hidden">
                            <div className="h-full rounded-full transition-all" style={{ width: `${dp}%`, background: dpColor }} />
                          </div>
                          <span className="font-mono text-[10px] font-bold" style={{ color: dpColor }}>
                            {dpLabel}{dp}%
                          </span>
                        </div>
                        {dp > 0 && r.depegSignals.length > 0 && (
                          <div className={`absolute left-1/2 -translate-x-1/2 pointer-events-none opacity-0 group-hover/depeg:opacity-100 transition-opacity duration-150 z-50 ${idx < 3 ? 'top-full mt-2' : 'bottom-full mb-2'}`}
                            style={{ width: 200 }}>
                            <div className="rounded-lg px-3 py-2 font-mono text-[10px] space-y-1"
                              style={{ background: "rgba(10,10,14,0.97)", border: `1px solid ${dpColor}30`, boxShadow: "0 4px 20px rgba(0,0,0,0.7)" }}>
                              <div className="font-bold text-[11px]" style={{ color: dpColor }}>Depeg {dp}%</div>
                              {r.depegSignals.map((s, i) => (
                                <div key={i} className="text-white/55 text-[9px]">• {s}</div>
                              ))}
                            </div>
                          </div>
                        )}
                      </td>
                    );
                  })()}
                  <td className="py-3 px-2 text-right font-bold text-sm" style={{ color: r.asymmetry > 20 ? "rgba(76,175,80,0.8)" : r.asymmetry > 0 ? "rgba(255,193,7,0.7)" : "rgba(229,57,53,0.7)" }}>
                    {r.asymmetry > 0 ? "+" : ""}{r.asymmetry}
                  </td>
                  <td className="py-3 px-2 text-center" onClick={(e) => e.stopPropagation()}>
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-[10px] tracking-wider font-bold"
                      style={{
                        color: actionColor(r.action),
                        background: actionBg(r.action),
                        border: `1px solid ${actionBorder(r.action)}`,
                      }}>
                      <span>{actionIcon(r.action)}</span>
                      {actionLabel}
                    </span>
                  </td>
                  <td className="py-3 px-2 text-center">
                    <span className="font-mono text-[11px] font-bold" style={{ color: momColor }}>
                      {r.momentumLabel}
                    </span>
                  </td>
                  <td className="py-3 px-2 text-center">
                    <span className="font-mono text-[10px] font-bold" style={{ color: scColor(r.sc) }}>
                      {scLabelFn(r.sc)}
                    </span>
                  </td>
                  <td className="py-3 px-2 text-right">
                    <span className="font-mono text-xs font-bold" style={{ color: confianceColor(r.confianceScore) }}>
                      {r.confianceScore}%
                    </span>
                  </td>
                  <td className="py-3 px-2 text-center">
                    <button
                      onClick={(e) => { e.stopPropagation(); setHealthPanel({ netuid: r.netuid, name: r.name, recalc: r.recalc, scores: r.healthScores, displayedCap: r.displayedCap, displayedLiq: r.displayedLiq }); }}
                      className="text-[10px] px-1.5 py-0.5 rounded transition-colors hover:bg-white/5"
                      style={{ color: "rgba(255,215,0,0.5)", border: "1px solid rgba(255,215,0,0.1)" }}>
                      🔬
                    </button>
                  </td>
                  <td className="py-3 px-2 text-center" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={(e) => { e.stopPropagation(); setTmcPanel({ netuid: r.netuid, name: r.name }); }}
                      className="text-[10px] px-1.5 py-0.5 rounded transition-colors hover:bg-white/5"
                      style={{ color: marketContext?.has(r.netuid) ? "rgba(100,181,246,0.5)" : "rgba(255,255,255,0.15)", border: "1px solid rgba(100,181,246,0.1)" }}>
                      📊
                    </button>
                  </td>
                  <td className="py-3 px-2 text-center" onClick={(e) => e.stopPropagation()}>
                    {r.owned ? (
                      <span style={{ color: "rgba(76,175,80,0.8)", fontSize: 14 }}>✔</span>
                    ) : (
                      <button onClick={(e) => { e.stopPropagation(); addPosition(r.netuid, 0); }}
                        className="font-mono text-[8px] px-1.5 py-0.5 rounded opacity-40 hover:opacity-100 transition-opacity"
                        style={{ background: "rgba(76,175,80,0.08)", color: "rgba(76,175,80,0.6)", border: "1px solid rgba(76,175,80,0.15)" }}>
                        +
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Health Panel Modal */}
      {healthPanel && <HealthPanel health={healthPanel} onClose={() => setHealthPanel(null)} />}

      {/* Market Context Panel (TMC — informational only) */}
      {tmcPanel && (
        <MarketContextPanel
          netuid={tmcPanel.netuid}
          name={tmcPanel.name}
          tmc={marketContext?.get(tmcPanel.netuid)}
          onClose={() => setTmcPanel(null)}
        />
      )}
    </div>
  );
}
