import { useState, useMemo, useRef, type ReactNode } from "react";
import { useSubnetVerdicts } from "@/hooks/use-subnet-verdict";
import { VerdictRow } from "@/components/VerdictBadge";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useIsMobile } from "@/hooks/use-mobile";
import { useI18n } from "@/lib/i18n";
import { useSubnetScores, type UnifiedSubnetScore } from "@/hooks/use-subnet-scores";
import {
  clamp,
  opportunityColor, riskColor,
  computeSmartCapital,
  computeASMicro,
  stabilityColor,
  type SmartCapitalState, type RawSignal,
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

/* ═══════════════════════════════════════ */
/*   COMPASS — Executive Decision View     */
/* ═══════════════════════════════════════ */

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
  const isFresh = ageSec < 120;
  const isStale = ageSec > 300;
  const dot = isStale ? "🔴" : isFresh ? "🟢" : "🟡";
  const ageLabel = ageMin < 1 ? "< 1 min" : `${ageMin} min`;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className="inline-flex items-center gap-1.5 font-mono cursor-help px-2 py-0.5 rounded"
          style={{
            fontSize: 10,
            background: "hsla(var(--gold), 0.06)",
            border: "1px solid hsla(var(--gold), 0.12)",
            color: taoUsd ? "hsl(var(--gold))" : "hsl(var(--muted-foreground))",
          }}
        >
          <span style={{ fontSize: 7 }}>{dot}</span>
          <span style={{ fontWeight: 600 }}>TAO</span>
          <span>{taoUsd ? `$${taoUsd.toFixed(2)}` : "—"}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="font-mono text-[10px]">
        <p>Dernière MAJ : {new Date(scoreTimestamp).toLocaleTimeString()}</p>
        <p>Fraîcheur : il y a {ageLabel}</p>
        <p>Source : signals_latest</p>
        {!taoUsd && <p className="text-destructive">⚠ Données indisponibles</p>}
      </TooltipContent>
    </Tooltip>
  );
}

/* ─── Section Header ─── */
function SectionHeader({ title, icon, accentVar = "--gold", badge }: {
  title: string; icon: string; accentVar?: string; badge?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-2.5 mb-4">
      <span style={{ fontSize: 14 }}>{icon}</span>
      <span
        className="font-mono tracking-[0.2em] uppercase font-bold"
        style={{ fontSize: 11, color: `hsla(var(${accentVar}), 0.7)` }}
      >
        {title}
      </span>
      <div className="flex-1 h-px" style={{ background: `hsla(var(${accentVar}), 0.08)` }} />
      {badge}
    </div>
  );
}

/* ─── Subnet Side Panel ─── */
function SubnetQuickPanel({ signal, open, onClose }: { signal: DashSignal | null; open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  if (!signal) return null;
  const oppC = opportunityColor(signal.opp);
  const rskC = riskColor(signal.risk);
  const action = signal.action;

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full sm:w-[380px] border-l border-border bg-background text-foreground overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="font-mono tracking-wider text-lg">SN-{signal.netuid}</SheetTitle>
        </SheetHeader>
        <div className="mt-4 space-y-5">
          <div className="text-center">
            <div className="font-mono text-sm text-muted-foreground">{signal.name}</div>
            <div className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg" style={{ background: actionBg(action), border: `1px solid ${actionBorder(action)}` }}>
              <span>{actionIcon(action)}</span>
              <span className="font-mono font-bold tracking-wider text-xs" style={{ color: actionColor(action) }}>{t(`strat.${action.toLowerCase()}` as any)}</span>
            </div>
          </div>
          <div className="flex items-center justify-center gap-8">
            <div className="text-center">
              <div className="font-mono text-2xl font-bold" style={{ color: oppC }}>{signal.opp}</div>
              <div className="font-mono text-[9px] text-muted-foreground/50 tracking-widest">{t("gauge.opportunity")}</div>
            </div>
            <div className="w-px h-8 bg-border" />
            <div className="text-center">
              <div className="font-mono text-2xl font-bold" style={{ color: rskC }}>{signal.risk}</div>
              <div className="font-mono text-[9px] text-muted-foreground/50 tracking-widest">{t("gauge.risk")}</div>
            </div>
          </div>
          {signal.reasons.length > 0 && (
            <div className="rounded-lg p-3" style={{ background: "hsla(0,0%,100%,0.02)" }}>
              <div className="font-mono text-[9px] text-muted-foreground/40 tracking-widest mb-2">RAISONS</div>
              {signal.reasons.map((r, i) => <div key={i} className="font-mono text-xs text-muted-foreground mb-1">• {r}</div>)}
            </div>
          )}
          <Link to={`/subnets/${signal.netuid}`} className="block text-center font-mono text-[10px] tracking-wider py-2 rounded-lg transition-all hover:scale-[1.01]"
            style={{ background: "hsla(var(--gold), 0.05)", color: "hsl(var(--gold))", border: "1px solid hsla(var(--gold), 0.1)" }}>
            Voir la fiche complète →
          </Link>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/* ═══════════════════════════════════════ */
/*   COMPASS PAGE — MAIN                   */
/* ═══════════════════════════════════════ */
export default function CompassPage() {
  const { t, lang } = useI18n();
  const fr = lang === "fr";
  const isMobile = useIsMobile();

  // ── Unified data ──
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
    } else {
      criticalSurgeRef.current = null;
    }
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
        const sev = (s: DashSignal) => (s.isOverridden ? 100 : 0) + s.depegProbability + (s.delistCategory !== "NORMAL" ? s.delistScore : 0);
        return sev(b) - sev(a);
      })
      .slice(0, 8);
  }, [enrichedSignals]);

  // ── Macro drivers ──
  const drivers = useMemo(() => {
    const avgMom = enrichedSignals.length ? Math.round(enrichedSignals.reduce((a, s) => a + s.momentumScore, 0) / enrichedSignals.length) : 0;
    return [
      { icon: "📊", label: fr ? "Régime" : "Regime", value: sentinelIndex >= 70 ? (fr ? "Favorable" : "Bullish") : sentinelIndex >= 45 ? (fr ? "Neutre" : "Neutral") : (fr ? "Défavorable" : "Bearish"), num: sentinelIndex, color: sentinelIndex >= 70 ? "rgba(76,175,80,0.85)" : sentinelIndex >= 45 ? "rgba(255,193,7,0.85)" : "rgba(229,57,53,0.85)" },
      { icon: "🧠", label: "Smart Capital", value: smartCapital.state, num: smartCapital.score, color: smartCapital.state === "ACCUMULATION" ? "rgba(76,175,80,0.85)" : smartCapital.state === "DISTRIBUTION" ? "rgba(229,57,53,0.85)" : "rgba(255,248,220,0.5)" },
      { icon: "⚖", label: fr ? "Stabilité" : "Stability", value: `${globalStability}%`, num: globalStability, color: globalStability >= 65 ? "rgba(76,175,80,0.85)" : globalStability >= 40 ? "rgba(255,193,7,0.85)" : "rgba(229,57,53,0.85)" },
      { icon: "📡", label: "Data", value: `${confianceScore}%`, num: confianceScore, color: confianceScore >= 70 ? "rgba(76,175,80,0.85)" : confianceScore >= 45 ? "rgba(255,193,7,0.85)" : "rgba(229,57,53,0.85)" },
      { icon: "📈", label: "Momentum", value: `${avgMom}`, num: avgMom, color: avgMom >= 60 ? "rgba(76,175,80,0.85)" : avgMom >= 35 ? "rgba(255,193,7,0.85)" : "rgba(229,57,53,0.85)" },
    ];
  }, [sentinelIndex, smartCapital, globalStability, confianceScore, enrichedSignals, fr]);

  const [panelSignal, setPanelSignal] = useState<DashSignal | null>(null);

  const scLabel = t(`sc.${smartCapital.state.toLowerCase()}` as any);
  const macroRecLabel = t(`macro.${macroRec.toLowerCase()}` as any);

  const oppGlobal = opportunityColor(globalOpp);
  const rskGlobal = riskColor(globalRisk);

  const sections = [
    { title: "RENTRE", emoji: "🟢", items: topRentre, count: countRentre, color: "rgba(76,175,80,0.75)", bg: "rgba(76,175,80,0.04)", border: "rgba(76,175,80,0.12)" },
    { title: "HOLD", emoji: "🟡", items: topHold, count: countHold, color: "rgba(255,193,7,0.75)", bg: "rgba(255,193,7,0.04)", border: "rgba(255,193,7,0.12)" },
    { title: "SORS", emoji: "🔴", items: topSors, count: countSors, color: "rgba(229,57,53,0.75)", bg: "rgba(229,57,53,0.04)", border: "rgba(229,57,53,0.12)" },
  ];

  return (
    <div className="h-full w-full bg-background text-foreground overflow-y-auto overflow-x-hidden">
      <div className="px-4 sm:px-6 py-4 max-w-[960px] mx-auto space-y-6">

        {/* ═══════════════════════════════ */}
        {/* ═══ 1. HERO DÉCISIONNEL ═══════ */}
        {/* ═══════════════════════════════ */}
        <section>
          {/* Status bar */}
          <div className="flex items-center gap-2 mb-5 flex-wrap">
            <TaoPriceTicker taoUsd={taoUsd} scoreTimestamp={scoreTimestamp} />
            <DataAlignmentBadge dataAlignment={dataAlignment} dataAgeDebug={dataAgeDebug} className="text-[7px] px-1.5" />
            {killSwitch.active && (
              <span className="font-mono text-[9px] px-2 py-0.5 rounded animate-pulse" style={{ background: "hsla(var(--destructive), 0.1)", color: "hsl(var(--destructive))", border: "1px solid hsla(var(--destructive), 0.2)" }}>
                🛡 SAFE MODE
              </span>
            )}
            <span className="ml-auto font-mono text-[8px] text-muted-foreground/30">
              {scoresList.length} subnets
            </span>
          </div>

          {/* Hero card */}
          <div
            className="rounded-2xl p-5 sm:p-8"
            style={{
              background: "linear-gradient(180deg, hsla(var(--gold), 0.03) 0%, hsla(0,0%,100%,0.008) 100%)",
              border: "1px solid hsla(var(--gold), 0.08)",
            }}
          >
            <div className="flex flex-col sm:flex-row items-center gap-6 sm:gap-10">
              {/* Left: Sentinel Index score */}
              <div className="flex flex-col items-center flex-shrink-0">
                <span className="font-mono tracking-[0.25em] uppercase text-muted-foreground/35" style={{ fontSize: 8 }}>
                  Sentinel Index
                </span>
                <span
                  className="font-mono font-bold leading-none mt-1"
                  style={{
                    fontSize: isMobile ? 56 : 72,
                    color: sentinelIndexColor(sentinelIndex),
                    textShadow: `0 0 40px hsla(var(--gold), 0.12)`,
                  }}
                >
                  {sentinelIndex}
                </span>
                <span
                  className="font-mono font-bold tracking-[0.2em] mt-1"
                  style={{ fontSize: isMobile ? 10 : 12, color: sentinelIndexColor(sentinelIndex), opacity: 0.65 }}
                >
                  {sentinelLabel}
                </span>
              </div>

              {/* Center divider */}
              <div className="hidden sm:block w-px self-stretch" style={{ background: "hsla(var(--gold), 0.08)" }} />
              <div className="sm:hidden w-full h-px" style={{ background: "hsla(var(--gold), 0.08)" }} />

              {/* Right: Key metrics + Macro */}
              <div className="flex-1 flex flex-col items-center sm:items-start gap-4 w-full">
                {/* Metrics row */}
                <div className="flex items-center justify-center sm:justify-start gap-5 sm:gap-6 w-full">
                  <MetricPill label="OPP" value={globalOpp} color={oppGlobal} />
                  <MetricPill label="RISK" value={globalRisk} color={rskGlobal} />
                  <MetricPill label="SC" value={scLabel} color={smartCapital.state === "ACCUMULATION" ? "rgba(76,175,80,0.85)" : smartCapital.state === "DISTRIBUTION" ? "rgba(229,57,53,0.85)" : "hsl(var(--muted-foreground))"} small />
                  <MetricPill label={fr ? "Stabilité" : "Stability"} value={`${globalStability}%`} color={stabilityColor(globalStability)} />
                  <MetricPill label="Data" value={`${confianceScore}%`} color={confianceColor(confianceScore)} />
                </div>

                {/* Macro recommendation badge */}
                <div
                  className="flex items-center gap-2.5 px-4 py-2 rounded-xl self-center sm:self-start"
                  style={{
                    background: macroBg(macroRec),
                    border: `1.5px solid ${macroBorder(macroRec)}`,
                    boxShadow: `0 0 24px ${macroBg(macroRec)}`,
                  }}
                >
                  <span style={{ fontSize: isMobile ? 14 : 18 }}>{macroIcon(macroRec)}</span>
                  <div>
                    <div className="font-mono text-[7px] tracking-[0.15em] uppercase text-muted-foreground/30">{t("macro.label")}</div>
                    <div className="font-mono font-bold tracking-[0.15em]" style={{ color: macroColor(macroRec), fontSize: isMobile ? 11 : 14 }}>
                      {macroRecLabel}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ═══════════════════════════════ */}
        {/* ═══ 2. DRIVERS DU MOMENT ══════ */}
        {/* ═══════════════════════════════ */}
        <section>
          <SectionHeader
            title={fr ? "DRIVERS DU MOMENT" : "CURRENT DRIVERS"}
            icon="📊"
          />
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            {drivers.map(d => (
              <div
                key={d.label}
                className="rounded-lg px-3 py-3 flex flex-col items-center gap-1"
                style={{ background: "hsla(0,0%,100%,0.015)", border: "1px solid hsla(0,0%,100%,0.05)" }}
              >
                <div className="flex items-center gap-1.5">
                  <span style={{ fontSize: 11 }}>{d.icon}</span>
                  <span className="font-mono text-[8px] tracking-wider text-muted-foreground/40 uppercase">{d.label}</span>
                </div>
                <span className="font-mono text-sm font-bold" style={{ color: d.color }}>{d.value}</span>
                {/* Mini bar */}
                <div className="w-full h-[3px] rounded-full overflow-hidden" style={{ background: "hsla(0,0%,100%,0.04)" }}>
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{ width: `${Math.min(d.num, 100)}%`, background: d.color }}
                  />
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ═══════════════════════════════ */}
        {/* ═══ 3. ACTIONS PRIORITAIRES ═══ */}
        {/* ═══════════════════════════════ */}
        <section>
          <SectionHeader
            title={fr ? "ACTIONS PRIORITAIRES" : "PRIORITY ACTIONS"}
            icon="⚙"
            badge={
              <div className="flex gap-1.5">
                {sections.map(s => (
                  <span
                    key={s.title}
                    className="font-mono text-[9px] px-2 py-0.5 rounded font-bold"
                    style={{ background: s.bg, color: s.color, border: `1px solid ${s.border}` }}
                  >
                    {s.emoji} {s.count}
                  </span>
                ))}
              </div>
            }
          />
          {verdictLoading ? (
            <div className="py-10 text-center font-mono text-[10px] text-muted-foreground/20">
              {fr ? "Chargement…" : "Loading…"}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {sections.map(s => (
                <div
                  key={s.title}
                  className="rounded-xl overflow-hidden"
                  style={{ background: s.bg, border: `1px solid ${s.border}` }}
                >
                  {/* Column header */}
                  <div
                    className="flex items-center justify-between px-3 py-2.5"
                    style={{ borderBottom: `1px solid ${s.border}` }}
                  >
                    <span className="font-mono text-[11px] font-bold tracking-wider" style={{ color: s.color }}>
                      {s.emoji} {s.title}
                    </span>
                    <span className="font-mono text-[9px] text-muted-foreground/30">
                      {s.count} subnet{s.count !== 1 ? "s" : ""}
                    </span>
                  </div>
                  {/* Verdict rows */}
                  {s.items.length > 0 ? s.items.slice(0, 5).map(v => (
                    <VerdictRow
                      key={v.netuid}
                      netuid={v.netuid}
                      name={v.name}
                      verdict={v.verdict}
                      confidence={v.confidence}
                      mainScore={v.verdict === "SORS" ? v.exitRisk : v.verdict === "RENTRE" ? v.entryScore : v.holdScore}
                      positiveReasons={v.positiveReasons}
                      negativeReasons={v.negativeReasons}
                    />
                  )) : (
                    <div className="py-5 text-center font-mono text-[10px] text-muted-foreground/15">
                      {fr ? "Aucun subnet" : "No subnets"}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ═══════════════════════════════ */}
        {/* ═══ 4. RISQUES CRITIQUES ══════ */}
        {/* ═══════════════════════════════ */}
        {criticalRisks.length > 0 && (
          <section>
            <SectionHeader
              title={fr ? "RISQUES CRITIQUES" : "CRITICAL RISKS"}
              icon="🚨"
              accentVar="--destructive"
              badge={
                <span className="font-mono text-[9px] px-2 py-0.5 rounded font-bold" style={{ background: "hsla(var(--destructive), 0.08)", color: "hsl(var(--destructive))", border: "1px solid hsla(var(--destructive), 0.2)" }}>
                  {criticalRisks.length}
                </span>
              }
            />
            <div
              className="rounded-xl overflow-hidden"
              style={{ background: "hsla(var(--destructive), 0.02)", border: "1px solid hsla(var(--destructive), 0.08)" }}
            >
              {criticalRisks.map((s, idx) => {
                const tags: { label: string; color: string }[] = [];
                if (s.isOverridden) tags.push({ label: "⛔ OVERRIDE", color: "rgba(229,57,53,0.9)" });
                if (s.delistCategory === "DEPEG_PRIORITY") tags.push({ label: "🔴 DEREG", color: "rgba(229,57,53,0.9)" });
                else if (s.delistCategory === "HIGH_RISK_NEAR_DELIST") tags.push({ label: "🟠 DELIST", color: "rgba(255,152,0,0.9)" });
                if (s.depegProbability >= 50) tags.push({ label: `DEPEG ${s.depegProbability}%`, color: "rgba(255,152,0,0.9)" });
                return (
                  <div
                    key={s.netuid}
                    className="flex items-center gap-2 py-2.5 px-3 cursor-pointer hover:bg-white/[0.02] transition-all"
                    style={{ borderBottom: idx < criticalRisks.length - 1 ? "1px solid hsla(var(--destructive), 0.06)" : "none" }}
                    onClick={() => setPanelSignal(s)}
                  >
                    <span className="font-mono font-bold text-[11px]" style={{ color: "hsl(var(--gold))", minWidth: 50 }}>SN-{s.netuid}</span>
                    <span className="font-mono text-[10px] truncate flex-1 text-muted-foreground/40">{s.name}</span>
                    <div className="flex gap-1 flex-shrink-0">
                      {tags.map((tag, i) => (
                        <span
                          key={i}
                          className="font-mono text-[8px] px-1.5 py-0.5 rounded font-bold"
                          style={{ background: `${tag.color}12`, color: tag.color, border: `1px solid ${tag.color}30` }}
                        >
                          {tag.label}
                        </span>
                      ))}
                    </div>
                    <span className="font-mono text-[11px] font-bold w-7 text-right flex-shrink-0" style={{ color: riskColor(s.risk) }}>
                      {s.risk}
                    </span>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* ═══════════════════════════════ */}
        {/* ═══ 5. CTA NAVIGATION ═════════ */}
        {/* ═══════════════════════════════ */}
        <section className="pb-8">
          <div className="grid grid-cols-2 gap-3">
            <Link
              to="/subnets"
              className="group flex flex-col items-center gap-1.5 py-4 rounded-xl font-mono transition-all hover:scale-[1.01]"
              style={{
                background: "hsla(var(--gold), 0.04)",
                border: "1px solid hsla(var(--gold), 0.1)",
              }}
            >
              <span style={{ fontSize: 18 }}>📋</span>
              <span className="text-[10px] tracking-wider font-bold" style={{ color: "hsl(var(--gold))" }}>
                {fr ? "Subnet Intelligence" : "Subnet Intelligence"}
              </span>
              <span className="text-[8px] text-muted-foreground/30">
                {fr ? "Table de décision complète" : "Full decision table"}
              </span>
            </Link>
            <Link
              to="/lab"
              className="group flex flex-col items-center gap-1.5 py-4 rounded-xl font-mono transition-all hover:scale-[1.01]"
              style={{
                background: "hsla(0,0%,100%,0.02)",
                border: "1px solid hsla(0,0%,100%,0.06)",
              }}
            >
              <span style={{ fontSize: 18 }}>🔬</span>
              <span className="text-[10px] tracking-wider font-bold text-muted-foreground/60">
                {fr ? "Laboratoire" : "Lab"}
              </span>
              <span className="text-[8px] text-muted-foreground/30">
                {fr ? "Radar & diagnostics avancés" : "Radar & advanced diagnostics"}
              </span>
            </Link>
          </div>
        </section>

      </div>

      <SubnetQuickPanel signal={panelSignal} open={!!panelSignal} onClose={() => setPanelSignal(null)} />
    </div>
  );
}

/* ─── Metric Pill (compact reusable) ─── */
function MetricPill({ label, value, color, small }: { label: string; value: string | number; color: string; small?: boolean }) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span className="font-mono text-muted-foreground/30 uppercase" style={{ fontSize: 7, letterSpacing: "0.12em" }}>{label}</span>
      <span className="font-mono font-bold" style={{ color, fontSize: small ? 9 : 14 }}>{value}</span>
    </div>
  );
}
