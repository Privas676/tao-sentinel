import { useState, useMemo, useRef } from "react";
import { useSubnetVerdicts } from "@/hooks/use-subnet-verdict";
import { VerdictRow } from "@/components/VerdictBadge";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useIsMobile } from "@/hooks/use-mobile";
import { useI18n } from "@/lib/i18n";
import { useSubnetScores, type UnifiedSubnetScore } from "@/hooks/use-subnet-scores";
import { useLocalPortfolio } from "@/hooks/use-local-portfolio";
import {
  clamp, opportunityColor, riskColor, computeSmartCapital, computeASMicro, stabilityColor,
  type RawSignal,
} from "@/lib/gauge-engine";
import {
  actionColor, actionBg, actionBorder, actionIcon,
  computeSentinelIndex, sentinelIndexColor, sentinelIndexLabel,
  deriveMacroRecommendation, macroColor, macroBg, macroBorder, macroIcon,
} from "@/lib/strategy-engine";
import { confianceColor } from "@/lib/data-fusion";
import DataAlignmentBadge from "@/components/DataAlignmentBadge";
import { evaluateKillSwitch, type KillSwitchResult } from "@/lib/push-kill-switch";
import { useAuditLogger } from "@/hooks/use-audit-log";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { SectionHeader } from "@/components/sentinel/SectionHeader";
import { MetricCard } from "@/components/sentinel/MetricCard";
import { SparklineMini } from "@/components/sentinel/SparklineMini";
import { ConfidenceBar } from "@/components/sentinel/ConfidenceBar";

/* ═══════════════════════════════════════════════ */
/*   COMPASS — Strategic Decision Command Center  */
/* ═══════════════════════════════════════════════ */

type DashSignal = UnifiedSubnetScore & {
  sparkline_7d: number[];
  dominant: "opportunity" | "risk" | "neutral";
  isMicroCap: boolean;
  asMicro: number;
  preHype: boolean;
  preHypeIntensity: number;
  reasons: string[];
};

/* ─── TAO Price Ticker ─── */
function TaoPriceTicker({ taoUsd, scoreTimestamp }: { taoUsd: number | null; scoreTimestamp: string }) {
  const ageMs = Date.now() - new Date(scoreTimestamp).getTime();
  const ageSec = Math.round(ageMs / 1000);
  const ageMin = Math.round(ageMs / 60000);
  const dot = ageSec > 300 ? "🔴" : ageSec < 120 ? "🟢" : "🟡";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex items-center gap-1.5 font-mono cursor-help px-2 py-0.5 rounded" style={{ fontSize: 10, background: "hsla(var(--gold), 0.06)", border: "1px solid hsla(var(--gold), 0.12)", color: taoUsd ? "hsl(var(--gold))" : "hsl(var(--muted-foreground))" }}>
          <span style={{ fontSize: 7 }}>{dot}</span>
          <span style={{ fontWeight: 600 }}>TAO</span>
          <span>{taoUsd ? `$${taoUsd.toFixed(2)}` : "—"}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="font-mono text-[10px]">
        <p>MAJ : {new Date(scoreTimestamp).toLocaleTimeString()} · il y a {ageMin < 1 ? "< 1" : ageMin} min</p>
      </TooltipContent>
    </Tooltip>
  );
}

/* ─── Subnet Side Panel ─── */
function SubnetQuickPanel({ signal, open, onClose, fr }: { signal: DashSignal | null; open: boolean; onClose: () => void; fr: boolean }) {
  const { t } = useI18n();
  if (!signal) return null;
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full sm:w-[380px] border-l border-border bg-background text-foreground overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="font-mono tracking-wider text-lg">SN-{signal.netuid}</SheetTitle>
        </SheetHeader>
        <div className="mt-4 space-y-5">
          <div className="text-center">
            <div className="font-mono text-sm text-muted-foreground">{signal.name}</div>
            <div className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg" style={{ background: actionBg(signal.action), border: `1px solid ${actionBorder(signal.action)}` }}>
              <span>{actionIcon(signal.action)}</span>
              <span className="font-mono font-bold tracking-wider text-xs" style={{ color: actionColor(signal.action) }}>{t(`strat.${signal.action.toLowerCase()}` as any)}</span>
            </div>
          </div>
          <div className="flex items-center justify-center gap-8">
            <div className="text-center">
              <div className="font-mono text-2xl font-bold" style={{ color: opportunityColor(signal.opp) }}>{signal.opp}</div>
              <div className="font-mono text-[9px] text-muted-foreground/70 tracking-widest">{t("gauge.opportunity")}</div>
            </div>
            <div className="w-px h-8 bg-border" />
            <div className="text-center">
              <div className="font-mono text-2xl font-bold" style={{ color: riskColor(signal.risk) }}>{signal.risk}</div>
              <div className="font-mono text-[9px] text-muted-foreground/70 tracking-widest">{t("gauge.risk")}</div>
            </div>
          </div>
          {signal.reasons.length > 0 && (
            <div className="rounded-lg p-3" style={{ background: "hsla(0,0%,100%,0.02)" }}>
              <div className="font-mono text-[9px] text-muted-foreground/65 tracking-widest mb-2">RAISONS</div>
              {signal.reasons.map((r, i) => <div key={i} className="font-mono text-xs text-muted-foreground mb-1">• {r}</div>)}
            </div>
          )}
          <Link to={`/subnets/${signal.netuid}`} className="block text-center font-mono text-[10px] tracking-wider py-2 rounded-lg" style={{ background: "hsla(var(--gold), 0.05)", color: "hsl(var(--gold))", border: "1px solid hsla(var(--gold), 0.1)" }}>
            {fr ? "Voir la fiche complète →" : "View full profile →"}
          </Link>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/* ═══════════════════════════════════════ */
/*   MAIN PAGE                              */
/* ═══════════════════════════════════════ */
export default function CompassPage() {
  const { t, lang } = useI18n();
  const fr = lang === "fr";
  const isMobile = useIsMobile();
  const { positions } = useLocalPortfolio();

  // ── Data sources ──
  const { scoresList, sparklines, scoreTimestamp, taoUsd, dataAlignment, dataAgeDebug, fleetDistribution, dataConfidence } = useSubnetScores();

  const { data: rawSignals } = useQuery({
    queryKey: ["unified-signals"],
    queryFn: async () => {
      const { data, error } = await supabase.from("signals_latest").select("*");
      if (error) throw error;
      return (data || []) as RawSignal[];
    },
    refetchInterval: 60_000,
  });

  // ── Global metrics ──
  const globalOpp = useMemo(() => {
    if (!scoresList.length) return 0;
    const sorted = [...scoresList].sort((a, b) => b.opp - a.opp);
    const top25 = sorted.slice(0, Math.max(1, Math.ceil(sorted.length * 0.25)));
    return Math.round(top25.reduce((a, s) => a + s.opp, 0) / top25.length * 0.6 + scoresList.reduce((a, s) => a + s.opp, 0) / scoresList.length * 0.4);
  }, [scoresList]);

  const globalRisk = useMemo(() => {
    if (!scoresList.length) return 0;
    const sorted = [...scoresList].sort((a, b) => b.risk - a.risk);
    const top25 = sorted.slice(0, Math.max(1, Math.ceil(sorted.length * 0.25)));
    return Math.round(top25.reduce((a, s) => a + s.risk, 0) / top25.length * 0.5 + scoresList.reduce((a, s) => a + s.risk, 0) / scoresList.length * 0.5);
  }, [scoresList]);

  const smartCapital = useMemo(() => computeSmartCapital(rawSignals ?? []), [rawSignals]);

  const enrichedSignals = useMemo<DashSignal[]>(() => {
    const flowDominance = (() => {
      const oppSignals = scoresList.filter(s => s.opp > s.risk + 15).length;
      const riskSignals = scoresList.filter(s => s.risk > s.opp + 15).length;
      return oppSignals > riskSignals + 1 ? "up" as const : riskSignals > oppSignals + 1 ? "down" as const : "stable" as const;
    })();
    const avgMomentum = scoresList.length ? scoresList.reduce((a, s) => a + s.momentum, 0) / scoresList.length : 50;
    const flowEmission = avgMomentum > 55 ? "up" as const : avgMomentum < 35 ? "down" as const : "stable" as const;
    return scoresList.map(s => {
      const spark7d = (sparklines?.get(s.netuid) ?? []).slice(-7);
      const dominant = s.isOverridden ? "risk" as const : s.opp > s.risk + 15 ? "opportunity" as const : s.risk > s.opp + 15 ? "risk" as const : "neutral" as const;
      const isMicroCap = s.displayedCap > 0 && s.displayedCap < 500_000;
      let asMicro = s.asymmetry;
      let preHype = false;
      let preHypeIntensity = 0;
      if (!s.isOverridden) {
        if (isMicroCap) {
          const microSignal = { opportunity: s.opp, risk: s.risk, confidence: s.conf, momentumScore: s.momentumScore, isMicroCap: true } as any;
          asMicro = computeASMicro(microSignal, smartCapital.state, flowDominance, flowEmission);
        }
        if (s.psi > 50 && s.quality > 40 && s.sc === "ACCUMULATION") {
          preHype = true;
          preHypeIntensity = clamp(s.psi - 30, 0, 70);
        }
      }
      return { ...s, sparkline_7d: spark7d, dominant, isMicroCap, asMicro, preHype, preHypeIntensity, reasons: s.overrideReasons.length > 0 ? s.overrideReasons : [] };
    });
  }, [scoresList, sparklines, smartCapital.state]);

  const sentinelIndex = useMemo(() => computeSentinelIndex(globalOpp, globalRisk, smartCapital.score), [globalOpp, globalRisk, smartCapital.score]);
  const sentinelLabel = sentinelIndexLabel(sentinelIndex, lang);

  const globalStability = useMemo(() => {
    if (!scoresList.length) return 50;
    return Math.round(scoresList.reduce((a, s) => a + s.stability, 0) / scoresList.length);
  }, [scoresList]);

  const confianceScore = useMemo(() => {
    if (!scoresList.length) return 50;
    return Math.round(scoresList.reduce((a, s) => a + s.confianceScore, 0) / scoresList.length);
  }, [scoresList]);

  const macroRec = useMemo(() => deriveMacroRecommendation(sentinelIndex, smartCapital.state, globalStability, confianceScore), [sentinelIndex, smartCapital.state, globalStability, confianceScore]);

  // ── Kill Switch ──
  const criticalSurgeRef = useRef<number | null>(null);
  const killSwitch = useMemo<KillSwitchResult>(() => {
    const criticalCount = enrichedSignals.filter(s => s.action === "EXIT" || s.isOverridden).length;
    const totalSubnets = enrichedSignals.length;
    if (criticalCount / (totalSubnets || 1) >= 0.30) {
      if (criticalSurgeRef.current === null) criticalSurgeRef.current = Date.now();
    } else { criticalSurgeRef.current = null; }
    return evaluateKillSwitch({ dataConfidence, fleetDistribution, criticalCount, totalSubnets, criticalSurgeStartedAt: criticalSurgeRef.current });
  }, [enrichedSignals, dataConfidence, fleetDistribution]);

  useAuditLogger(enrichedSignals, scoreTimestamp, dataAlignment ?? "UNKNOWN", dataConfidence, killSwitch, fleetDistribution);

  // ── Verdict engine ──
  const { topRentre, topHold, topSors, countRentre, countHold, countSors, isLoading: verdictLoading } = useSubnetVerdicts();

  // ── Critical risks ──
  const criticalRisks = useMemo(() => {
    return enrichedSignals
      .filter(s => s.isOverridden || s.delistCategory !== "NORMAL" || s.depegProbability >= 50)
      .sort((a, b) => {
        const sev = (x: DashSignal) => (x.isOverridden ? 100 : 0) + x.depegProbability + (x.delistCategory !== "NORMAL" ? x.delistScore : 0);
        return sev(b) - sev(a);
      })
      .slice(0, 6);
  }, [enrichedSignals]);

  // ── Watchlist: top conviction signals ──
  const watchlist = useMemo(() => {
    return [...enrichedSignals]
      .filter(s => !s.isOverridden && s.conf >= 40)
      .sort((a, b) => {
        const score = (x: DashSignal) => Math.abs(x.opp - x.risk) * (x.conf / 100) * (x.momentumScore / 50);
        return score(b) - score(a);
      })
      .slice(0, 8);
  }, [enrichedSignals]);

  // ── Rotation map ──
  const rotationMap = useMemo(() => {
    const leaders = enrichedSignals.filter(s => s.action === "ENTER" && s.momentumScore >= 55 && !s.isOverridden).sort((a, b) => b.opp - a.opp).slice(0, 5);
    const accumulating = enrichedSignals.filter(s => s.sc === "ACCUMULATION" && s.action !== "EXIT" && !s.isOverridden && !leaders.find(l => l.netuid === s.netuid)).sort((a, b) => b.psi - a.psi).slice(0, 5);
    const fragile = enrichedSignals.filter(s => s.risk > 60 && s.action !== "EXIT" && !s.isOverridden).sort((a, b) => b.risk - a.risk).slice(0, 5);
    const avoid = enrichedSignals.filter(s => s.action === "EXIT" || s.isOverridden).sort((a, b) => b.risk - a.risk).slice(0, 5);
    return { leaders, accumulating, fragile, avoid };
  }, [enrichedSignals]);

  // ── Portfolio alignment ──
  const portfolioAlignment = useMemo(() => {
    if (!positions.length) return null;
    const held = positions.map(p => p.subnet_id);
    let aligned = 0, misaligned = 0, watching = 0;
    for (const netuid of held) {
      const sig = enrichedSignals.find(s => s.netuid === netuid);
      if (!sig) { watching++; continue; }
      if (sig.action === "EXIT" || sig.isOverridden) misaligned++;
      else if (sig.action === "ENTER" || sig.action === "HOLD") aligned++;
      else watching++;
    }
    const total = held.length;
    const status: "aligned" | "partial" | "misaligned" = misaligned === 0 ? "aligned" : misaligned / total >= 0.4 ? "misaligned" : "partial";
    return { aligned, misaligned, watching, total, status };
  }, [positions, enrichedSignals]);

  // ── Derived values ──
  const scLabel = t(`sc.${smartCapital.state.toLowerCase()}` as any);
  const macroRecLabel = t(`macro.${macroRec.toLowerCase()}` as any);
  const oppGlobal = opportunityColor(globalOpp);
  const rskGlobal = riskColor(globalRisk);
  const [panelSignal, setPanelSignal] = useState<DashSignal | null>(null);

  // ── Drivers (computed from real data — no overlap with hero metrics) ──
  const drivers = useMemo(() => {
    const avgMom = enrichedSignals.length ? Math.round(enrichedSignals.reduce((a, s) => a + s.momentumScore, 0) / enrichedSignals.length) : 0;
    const avgLiqEff = enrichedSignals.length ? Math.round(enrichedSignals.reduce((a, s) => a + (s.quality || 50), 0) / enrichedSignals.length) : 50;
    const sellPressure = enrichedSignals.length ? Math.round(enrichedSignals.filter(s => s.action === "EXIT" || s.risk > 70).length / enrichedSignals.length * 100) : 0;
    const entryRatio = enrichedSignals.length ? Math.round(enrichedSignals.filter(s => s.action === "ENTER").length / enrichedSignals.length * 100) : 0;
    return [
      { icon: "💰", label: fr ? "Smart Capital" : "Smart Capital", value: smartCapital.state === "ACCUMULATION" ? "Accum." : smartCapital.state === "DISTRIBUTION" ? "Distrib." : "Stable", num: smartCapital.score, color: smartCapital.state === "ACCUMULATION" ? "hsl(145,65%,48%)" : smartCapital.state === "DISTRIBUTION" ? "hsl(4,80%,50%)" : "hsl(var(--muted-foreground))" },
      { icon: "📈", label: "Momentum", value: `${avgMom}`, num: avgMom, color: avgMom >= 55 ? "hsl(145,65%,48%)" : avgMom >= 35 ? "hsl(38,92%,55%)" : "hsl(4,80%,50%)" },
      { icon: "💧", label: fr ? "Liquidité" : "Liquidity", value: `${avgLiqEff}%`, num: avgLiqEff, color: avgLiqEff >= 60 ? "hsl(145,65%,48%)" : avgLiqEff >= 40 ? "hsl(38,92%,55%)" : "hsl(4,80%,50%)" },
      { icon: "📉", label: fr ? "Pression vente" : "Sell Pressure", value: `${sellPressure}%`, num: sellPressure, color: sellPressure <= 15 ? "hsl(145,65%,48%)" : sellPressure <= 30 ? "hsl(38,92%,55%)" : "hsl(4,80%,50%)" },
      { icon: "🎯", label: fr ? "Taux entrée" : "Entry Rate", value: `${entryRatio}%`, num: entryRatio, color: entryRatio >= 10 ? "hsl(145,65%,48%)" : entryRatio >= 3 ? "hsl(38,92%,55%)" : "hsl(4,80%,50%)" },
    ];
  }, [enrichedSignals, smartCapital, fr]);

  // ── Tactical summary ──
  const tacticalSummary = useMemo(() => {
    if (!enrichedSignals.length) return "";
    const entryCount = enrichedSignals.filter(s => s.action === "ENTER").length;
    const exitCount = enrichedSignals.filter(s => s.action === "EXIT" || s.isOverridden).length;
    if (fr) {
      if (sentinelIndex >= 65 && entryCount >= 5) return `Conditions favorables — ${entryCount} opportunités d'entrée identifiées, momentum haussier.`;
      if (sentinelIndex >= 45) return `Marché neutre — sélectivité requise, ${entryCount} entrées possibles, ${exitCount} risques actifs.`;
      return `Environnement défensif — ${exitCount} subnets en zone de risque, réduction d'exposition recommandée.`;
    }
    if (sentinelIndex >= 65 && entryCount >= 5) return `Favorable conditions — ${entryCount} entry opportunities identified, bullish momentum.`;
    if (sentinelIndex >= 45) return `Neutral market — selectivity required, ${entryCount} possible entries, ${exitCount} active risks.`;
    return `Defensive environment — ${exitCount} subnets in risk zone, exposure reduction recommended.`;
  }, [enrichedSignals, sentinelIndex, fr]);

  const sections = [
    { key: "enter", title: fr ? "ENTRÉES" : "ENTER", emoji: "🟢", items: topRentre, count: countRentre, color: "hsl(145,65%,48%)", bg: "hsla(145,65%,48%,0.04)", border: "hsla(145,65%,48%,0.12)" },
    { key: "hold", title: fr ? "RENFORCER" : "REINFORCE", emoji: "🟡", items: topHold, count: countHold, color: "hsl(38,92%,55%)", bg: "hsla(38,92%,55%,0.04)", border: "hsla(38,92%,55%,0.12)" },
    { key: "exit", title: fr ? "RÉDUIRE / SORTIR" : "REDUCE / EXIT", emoji: "🔴", items: topSors, count: countSors, color: "hsl(4,80%,50%)", bg: "hsla(4,80%,50%,0.04)", border: "hsla(4,80%,50%,0.12)" },
  ];

  const rotationGroups = [
    { key: "leaders", title: fr ? "Leaders" : "Leaders", icon: "🚀", items: rotationMap.leaders, color: "hsl(145,65%,48%)" },
    { key: "accum", title: fr ? "Accumulation" : "Accumulation", icon: "🧲", items: rotationMap.accumulating, color: "hsl(38,92%,55%)" },
    { key: "fragile", title: fr ? "Fragiles" : "Fragile", icon: "⚠", items: rotationMap.fragile, color: "hsl(38,70%,50%)" },
    { key: "avoid", title: fr ? "À éviter" : "Avoid", icon: "🚫", items: rotationMap.avoid, color: "hsl(4,80%,50%)" },
  ];

  return (
    <div className="h-full w-full bg-background text-foreground overflow-y-auto overflow-x-hidden">
      <div className="px-4 sm:px-6 py-4 max-w-[1000px] mx-auto space-y-6 sm:space-y-8">

        {/* ═══ 1. HERO DÉCISIONNEL ═══ */}
        <section>
          <div className="flex items-center gap-2 mb-4 flex-wrap">
            <TaoPriceTicker taoUsd={taoUsd} scoreTimestamp={scoreTimestamp} />
            <DataAlignmentBadge dataAlignment={dataAlignment} dataAgeDebug={dataAgeDebug} className="text-[7px] px-1.5" />
            {killSwitch.active && (
              <span className="font-mono text-[9px] px-2 py-0.5 rounded animate-pulse" style={{ background: "hsla(var(--destructive), 0.1)", color: "hsl(var(--destructive))", border: "1px solid hsla(var(--destructive), 0.2)" }}>
                🛡 SAFE MODE
              </span>
            )}
            <span className="ml-auto font-mono text-[8px] text-muted-foreground">{scoresList.length} subnets</span>
          </div>

          <div className="rounded-2xl overflow-hidden" style={{ background: "linear-gradient(180deg, hsla(var(--gold), 0.025) 0%, hsla(0,0%,100%,0.005) 100%)", border: "1px solid hsla(var(--gold), 0.08)" }}>
            {/* Main hero content */}
            <div className="p-5 sm:p-8">
              <div className="flex flex-col sm:flex-row items-center gap-5 sm:gap-10">
                {/* Score central */}
                <div className="flex flex-col items-center flex-shrink-0">
                  <span className="font-mono tracking-[0.25em] uppercase text-muted-foreground" style={{ fontSize: 7 }}>SENTINEL INDEX</span>
                  <span className="font-mono font-bold leading-none mt-1" style={{ fontSize: isMobile ? 52 : 68, color: sentinelIndexColor(sentinelIndex), textShadow: "0 0 40px hsla(var(--gold), 0.1)" }}>
                    {sentinelIndex}
                  </span>
                  <span className="font-mono font-bold tracking-[0.2em] mt-0.5" style={{ fontSize: isMobile ? 9 : 11, color: sentinelIndexColor(sentinelIndex), opacity: 0.75 }}>
                    {sentinelLabel}
                  </span>
                  {/* Confidence bar */}
                  <div className="mt-3 w-24">
                    <ConfidenceBar value={confianceScore} label="CONF" height={3} />
                  </div>
                </div>

                <div className="hidden sm:block w-px self-stretch" style={{ background: "hsla(var(--gold), 0.06)" }} />
                <div className="sm:hidden w-3/4 h-px mx-auto" style={{ background: "hsla(var(--gold), 0.06)" }} />

                {/* Right side */}
                <div className="flex-1 flex flex-col gap-4 w-full items-center sm:items-start">
                  {/* Metrics row */}
                  <div className="flex items-center gap-4 sm:gap-5 flex-wrap justify-center sm:justify-start">
                    <MiniMetric label="OPP" value={globalOpp} color={oppGlobal} />
                    <MiniMetric label="RISK" value={globalRisk} color={rskGlobal} />
                    <MiniMetric label={fr ? "Stabilité" : "Stability"} value={`${globalStability}%`} color={stabilityColor(globalStability)} />
                  </div>

                  {/* Macro badge */}
                  <div className="flex items-center gap-2.5 px-4 py-2 rounded-xl" style={{ background: macroBg(macroRec), border: `1.5px solid ${macroBorder(macroRec)}`, boxShadow: `0 0 20px ${macroBg(macroRec)}` }}>
                    <span style={{ fontSize: isMobile ? 14 : 18 }}>{macroIcon(macroRec)}</span>
                    <div>
                      <div className="font-mono text-[7px] tracking-[0.15em] uppercase text-muted-foreground">{t("macro.label")}</div>
                      <div className="font-mono font-bold tracking-[0.12em]" style={{ color: macroColor(macroRec), fontSize: isMobile ? 11 : 13 }}>{macroRecLabel}</div>
                    </div>
                  </div>

                  {/* Tactical summary */}
                  {tacticalSummary && (
                    <p className="font-mono text-[10px] text-muted-foreground leading-relaxed max-w-md" style={{ letterSpacing: "0.02em" }}>
                      {tacticalSummary}
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ═══ 2. DRIVERS DU MOMENT ═══ */}
        <section>
          <SectionHeader title={fr ? "DRIVERS DU MOMENT" : "MARKET DRIVERS"} icon="📊" />
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            {drivers.map(d => (
              <MetricCard key={d.label} label={d.label} value={d.value} icon={d.icon} color={d.color} progress={d.num} />
            ))}
          </div>
        </section>

        {/* ═══ 3. ACTIONS PRIORITAIRES ═══ */}
        <section>
          <SectionHeader
            title={fr ? "ACTIONS PRIORITAIRES" : "PRIORITY ACTIONS"}
            icon="⚡"
            badge={
              <div className="flex gap-1.5">
                {sections.map(s => (
                  <span key={s.key} className="font-mono text-[9px] px-2 py-0.5 rounded font-bold" style={{ background: s.bg, color: s.color, border: `1px solid ${s.border}` }}>
                    {s.emoji} {s.count}
                  </span>
                ))}
              </div>
            }
          />
          {verdictLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {[0, 1, 2].map(i => (
                <div key={i} className="rounded-xl h-48 animate-pulse" style={{ background: "hsla(0,0%,100%,0.02)", border: "1px solid hsla(0,0%,100%,0.05)" }} />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {sections.map(s => (
                <div key={s.key} className="rounded-xl overflow-hidden" style={{ background: s.bg, border: `1px solid ${s.border}` }}>
                  <div className="flex items-center justify-between px-3 py-2" style={{ borderBottom: `1px solid ${s.border}` }}>
                    <span className="font-mono text-[10px] font-bold tracking-wider" style={{ color: s.color }}>{s.emoji} {s.title}</span>
                    <span className="font-mono text-[8px] text-muted-foreground">{s.count}</span>
                  </div>
                  {s.items.length > 0 ? s.items.slice(0, 5).map(v => (
                    <VerdictRow key={v.netuid} netuid={v.netuid} name={v.name} verdict={v.verdict} confidence={v.confidence}
                      mainScore={v.verdict === "SORS" ? v.exitRisk : v.verdict === "RENTRE" ? v.entryScore : v.holdScore}
                      positiveReasons={v.positiveReasons} negativeReasons={v.negativeReasons} />
                  )) : (
                    <div className="py-4 text-center font-mono text-[10px] text-muted-foreground">{fr ? "Aucun" : "None"}</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ═══ 4. WATCHLIST ACTIVE ═══ */}
        {watchlist.length > 0 && (
          <section>
            <SectionHeader title={fr ? "WATCHLIST ACTIVE" : "ACTIVE WATCHLIST"} icon="👁" badge={
              <span className="font-mono text-[8px] text-muted-foreground">{fr ? "Top conviction" : "Top conviction"}</span>
            } />
            <div className="rounded-xl overflow-hidden" style={{ border: "1px solid hsla(0,0%,100%,0.05)" }}>
              <div className="overflow-x-auto" style={{ WebkitOverflowScrolling: "touch" }}>
                <table className="w-full font-mono" style={{ minWidth: 480 }}>
                  <thead>
                    <tr style={{ background: "hsla(0,0%,100%,0.02)", borderBottom: "1px solid hsla(0,0%,100%,0.04)" }}>
                      {["SN", fr ? "Nom" : "Name", "Action", "Conv.", "Risk", "Mom.", "7d"].map(h => (
                        <th key={h} className="py-2 px-2.5 text-left text-[8px] tracking-wider text-muted-foreground uppercase whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {watchlist.map((s, idx) => (
                      <tr key={s.netuid} className="cursor-pointer hover:bg-white/[0.015] transition-colors" style={{ borderBottom: idx < watchlist.length - 1 ? "1px solid hsla(0,0%,100%,0.03)" : "none" }} onClick={() => setPanelSignal(s)}>
                        <td className="py-2 px-2.5 text-[10px] font-bold" style={{ color: "hsl(var(--gold))" }}>SN-{s.netuid}</td>
                        <td className="py-2 px-2.5 text-[10px] text-muted-foreground truncate" style={{ maxWidth: 120 }}>{s.name}</td>
                        <td className="py-2 px-2.5 text-[9px] font-bold whitespace-nowrap" style={{ color: actionColor(s.action) }}>{actionIcon(s.action)} {s.action === "ENTER" ? (fr ? "Entrer" : "Enter") : s.action === "EXIT" ? (fr ? "Sortir" : "Exit") : "Hold"}</td>
                        <td className="py-2 px-2.5 text-[10px]" style={{ color: confianceColor(s.conf) }}>{s.conf}%</td>
                        <td className="py-2 px-2.5 text-[10px] font-bold" style={{ color: riskColor(s.risk) }}>{s.risk}</td>
                        <td className="py-2 px-2.5 text-[10px]" style={{ color: s.momentumScore >= 55 ? "hsl(145,65%,48%)" : s.momentumScore >= 35 ? "hsl(38,92%,55%)" : "hsl(4,80%,50%)" }}>{Math.round(s.momentumScore)}</td>
                        <td className="py-2 px-2.5"><SparklineMini data={s.sparkline_7d} width={50} height={16} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        )}

        {/* ═══ 5. ALERTES CRITIQUES ═══ */}
        {criticalRisks.length > 0 && (
          <section>
            <SectionHeader title={fr ? "ALERTES CRITIQUES" : "CRITICAL ALERTS"} icon="🚨" accentVar="--destructive" badge={
              <span className="font-mono text-[9px] px-2 py-0.5 rounded font-bold" style={{ background: "hsla(var(--destructive), 0.08)", color: "hsl(var(--destructive))", border: "1px solid hsla(var(--destructive), 0.2)" }}>{criticalRisks.length}</span>
            } />
            <div className="rounded-xl overflow-hidden" style={{ background: "hsla(var(--destructive), 0.02)", border: "1px solid hsla(var(--destructive), 0.08)" }}>
              {criticalRisks.map((s, idx) => {
                const tags: { label: string; color: string }[] = [];
                if (s.isOverridden) tags.push({ label: "⛔ OVERRIDE", color: "hsl(4,80%,50%)" });
                if (s.delistCategory === "DEPEG_PRIORITY") tags.push({ label: "🔴 DEREG", color: "hsl(4,80%,50%)" });
                else if (s.delistCategory === "HIGH_RISK_NEAR_DELIST") tags.push({ label: "🟠 DELIST", color: "hsl(38,70%,50%)" });
                if (s.depegProbability >= 50) tags.push({ label: `DEPEG ${s.depegProbability}%`, color: "hsl(38,70%,50%)" });
                return (
                  <div key={s.netuid} className="flex items-center gap-2 py-2.5 px-3 cursor-pointer hover:bg-white/[0.02] transition-all"
                    style={{ borderBottom: idx < criticalRisks.length - 1 ? "1px solid hsla(var(--destructive), 0.06)" : "none" }}
                    onClick={() => setPanelSignal(s)}>
                    <span className="font-mono font-bold text-[11px]" style={{ color: "hsl(var(--gold))", minWidth: 48 }}>SN-{s.netuid}</span>
                    <span className="font-mono text-[10px] truncate flex-1 text-muted-foreground">{s.name}</span>
                    <div className="flex gap-1 flex-shrink-0">
                      {tags.map((tag, i) => (
                        <span key={i} className="font-mono text-[7px] px-1.5 py-0.5 rounded font-bold" style={{ background: `color-mix(in srgb, ${tag.color} 10%, transparent)`, color: tag.color, border: `1px solid color-mix(in srgb, ${tag.color} 25%, transparent)` }}>{tag.label}</span>
                      ))}
                    </div>
                    <span className="font-mono text-[10px] font-bold w-6 text-right" style={{ color: riskColor(s.risk) }}>{s.risk}</span>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* ═══ 6. CARTE DE ROTATION ═══ */}
        <section>
          <SectionHeader title={fr ? "CARTE DE ROTATION" : "ROTATION MAP"} icon="🗺" />
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {rotationGroups.map(g => (
              <div key={g.key} className="rounded-xl overflow-hidden" style={{ border: `1px solid color-mix(in srgb, ${g.color} 15%, transparent)`, background: `color-mix(in srgb, ${g.color} 3%, transparent)` }}>
                <div className="px-3 py-2 flex items-center gap-1.5" style={{ borderBottom: `1px solid color-mix(in srgb, ${g.color} 10%, transparent)` }}>
                  <span style={{ fontSize: 11 }}>{g.icon}</span>
                  <span className="font-mono text-[9px] font-bold tracking-wider" style={{ color: g.color }}>{g.title}</span>
                  <span className="ml-auto font-mono text-[8px] text-muted-foreground">{g.items.length}</span>
                </div>
                {g.items.length > 0 ? g.items.map(s => (
                  <div key={s.netuid} className="flex items-center gap-1.5 px-3 py-1.5 cursor-pointer hover:bg-white/[0.015] transition-colors" onClick={() => setPanelSignal(s)}>
                    <span className="font-mono text-[9px] font-bold" style={{ color: "hsl(var(--gold))", opacity: 0.7 }}>{s.netuid}</span>
                    <span className="font-mono text-[9px] text-muted-foreground truncate flex-1">{s.name}</span>
                    <span className="font-mono text-[9px] font-bold" style={{ color: g.color }}>{s.opp}</span>
                  </div>
                )) : (
                  <div className="py-3 text-center font-mono text-[9px] text-muted-foreground">—</div>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* ═══ 7. ALIGNEMENT PORTEFEUILLE ═══ */}
        <section>
          <SectionHeader title={fr ? "ALIGNEMENT PORTEFEUILLE" : "PORTFOLIO ALIGNMENT"} icon="📐" />
          {portfolioAlignment ? (
            <div className="rounded-xl p-4" style={{ background: "hsla(0,0%,100%,0.01)", border: "1px solid hsla(0,0%,100%,0.05)" }}>
              <div className="flex items-center gap-4 mb-3">
                <span style={{ fontSize: 20 }}>
                  {portfolioAlignment.status === "aligned" ? "✅" : portfolioAlignment.status === "partial" ? "⚠️" : "🔴"}
                </span>
                <div>
                  <div className="font-mono text-[12px] font-bold" style={{
                    color: portfolioAlignment.status === "aligned" ? "hsl(145,65%,48%)" : portfolioAlignment.status === "partial" ? "hsl(38,92%,55%)" : "hsl(4,80%,50%)",
                  }}>
                    {portfolioAlignment.status === "aligned" ? (fr ? "Portefeuille aligné" : "Portfolio aligned") :
                     portfolioAlignment.status === "partial" ? (fr ? "Partiellement aligné" : "Partially aligned") :
                     (fr ? "Désalignement détecté" : "Misalignment detected")}
                  </div>
                   <div className="font-mono text-[9px] text-muted-foreground mt-0.5">
                     {portfolioAlignment.total} position{portfolioAlignment.total !== 1 ? "s" : ""} · {portfolioAlignment.aligned} {fr ? "alignée" : "aligned"}{portfolioAlignment.aligned !== 1 ? "s" : ""} · {portfolioAlignment.misaligned} {fr ? "à risque" : "at risk"}
                  </div>
                </div>
              </div>
              {portfolioAlignment.misaligned > 0 && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ background: "hsla(4,80%,50%,0.04)", border: "1px solid hsla(4,80%,50%,0.1)" }}>
                  <span className="font-mono text-[9px]" style={{ color: "hsl(4,80%,50%)" }}>
                    ⚠ {fr ? `${portfolioAlignment.misaligned} position(s) en zone de sortie — action recommandée` : `${portfolioAlignment.misaligned} position(s) in exit zone — action recommended`}
                  </span>
                </div>
              )}
              <Link to="/portfolio" className="block mt-3 text-center font-mono text-[10px] tracking-wider py-2 rounded-lg" style={{ background: "hsla(var(--gold), 0.04)", color: "hsl(var(--gold))", border: "1px solid hsla(var(--gold), 0.08)" }}>
                {fr ? "Gérer le portefeuille →" : "Manage portfolio →"}
              </Link>
            </div>
          ) : (
            <div className="rounded-xl p-6 flex flex-col items-center gap-2" style={{ background: "hsla(0,0%,100%,0.01)", border: "1px dashed hsla(0,0%,100%,0.06)" }}>
              <span style={{ fontSize: 20, opacity: 0.5 }}>📂</span>
              <span className="font-mono text-[10px] text-muted-foreground">{fr ? "Aucune position dans le portefeuille" : "No positions in portfolio"}</span>
              <Link to="/subnets" className="font-mono text-[9px] tracking-wider px-3 py-1.5 rounded-lg mt-1" style={{ background: "hsla(var(--gold), 0.05)", color: "hsl(var(--gold))", border: "1px solid hsla(var(--gold), 0.1)" }}>
                {fr ? "Explorer les subnets →" : "Explore subnets →"}
              </Link>
            </div>
          )}
        </section>

        {/* ═══ CTA ═══ */}
        <section className="pb-8">
          <div className="grid grid-cols-2 gap-3">
            <Link to="/subnets" className="flex flex-col items-center gap-1.5 py-4 rounded-xl font-mono transition-all hover:scale-[1.01]" style={{ background: "hsla(var(--gold), 0.04)", border: "1px solid hsla(var(--gold), 0.1)" }}>
              <span style={{ fontSize: 16 }}>📋</span>
              <span className="text-[10px] tracking-wider font-bold" style={{ color: "hsl(var(--gold))" }}>{fr ? "Subnet Intelligence" : "Subnet Intelligence"}</span>
              <span className="text-[8px] text-muted-foreground/65">{fr ? "Table de décision" : "Decision table"}</span>
            </Link>
            <Link to="/lab" className="flex flex-col items-center gap-1.5 py-4 rounded-xl font-mono transition-all hover:scale-[1.01]" style={{ background: "hsla(0,0%,100%,0.02)", border: "1px solid hsla(0,0%,100%,0.06)" }}>
              <span style={{ fontSize: 16 }}>🔬</span>
              <span className="text-[10px] tracking-wider font-bold text-muted-foreground/70">{fr ? "Laboratoire" : "Lab"}</span>
              <span className="text-[8px] text-muted-foreground/65">{fr ? "Diagnostics avancés" : "Advanced diagnostics"}</span>
            </Link>
          </div>
        </section>
      </div>

      <SubnetQuickPanel signal={panelSignal} open={!!panelSignal} onClose={() => setPanelSignal(null)} fr={fr} />
    </div>
  );
}

/* ─── Mini metric inline ─── */
function MiniMetric({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span className="font-mono text-muted-foreground/65 uppercase" style={{ fontSize: 7, letterSpacing: "0.12em" }}>{label}</span>
      <span className="font-mono font-bold leading-none" style={{ color, fontSize: 13 }}>{value}</span>
    </div>
  );
}
