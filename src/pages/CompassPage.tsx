import { useState, useMemo, useRef } from "react";
import { PageLoadingState } from "@/components/PageLoadingState";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useIsMobile } from "@/hooks/use-mobile";
import { useI18n } from "@/lib/i18n";
import { useSubnetScores, type UnifiedSubnetScore, SPECIAL_SUBNETS } from "@/hooks/use-subnet-scores";
import { useCanonicalSubnets, type CanonicalSubnetFacts } from "@/hooks/use-canonical-subnets";
import { EarlyPumpBadge } from "@/components/sentinel/EarlyPumpBadge";
import { useLocalPortfolio } from "@/hooks/use-local-portfolio";
import {
  clamp, opportunityColor, riskColor, computeSmartCapital, computeASMicro, stabilityColor,
  type RawSignal,
} from "@/lib/gauge-engine";
import {
  computeSentinelIndex, sentinelIndexColor, sentinelIndexLabel,
  deriveMacroRecommendation, macroColor, macroBg, macroBorder, macroIcon,
} from "@/lib/strategy-engine";
import { confianceColor } from "@/lib/data-fusion";
import DataAlignmentBadge from "@/components/DataAlignmentBadge";
import DegradedModeBadge from "@/components/DegradedModeBadge";
import { evaluateKillSwitch, type KillSwitchResult } from "@/lib/push-kill-switch";
import { useAuditLogger } from "@/hooks/use-audit-log";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { SectionHeader } from "@/components/sentinel/SectionHeader";
import { MetricCard } from "@/components/sentinel/MetricCard";
import { SparklineMini } from "@/components/sentinel/SparklineMini";
import { ConfidenceBar } from "@/components/sentinel/ConfidenceBar";
import { GOLD, GO, WARN, BREAK, MUTED } from "@/components/sentinel/Atoms";
import { HotNowSection } from "@/components/sentinel/HotNowSection";
import { SystemAlertsPanel } from "@/components/sentinel/SystemAlertsPanel";
import { WarningBanner } from "@/components/sentinel/WarningBanner";
import { dataTrustLabel } from "@/lib/data-trust";

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
function SubnetQuickPanel({ signal, open, onClose, fr, decisions, facts }: { signal: DashSignal | null; open: boolean; onClose: () => void; fr: boolean; decisions: Map<number, import("@/hooks/use-subnet-decisions").SubnetDecision>; facts: Map<number, CanonicalSubnetFacts> }) {
  const { t } = useI18n();
  if (!signal) return null;
  const d = decisions.get(signal.netuid);
  const cf = facts.get(signal.netuid);
  const fa = d?.finalAction ?? "SURVEILLER";
  const faColor = fa === "ENTRER" ? GO : fa === "SORTIR" || fa === "ÉVITER" ? BREAK : fa === "SYSTÈME" ? MUTED : WARN;
  const faIcon = fa === "ENTRER" ? "🟢" : fa === "SORTIR" ? "🔴" : fa === "ÉVITER" ? "⛔" : fa === "SYSTÈME" ? "🔷" : "👁";
  const faLabel = fa === "ENTRER" ? (fr ? "ENTRER" : "ENTER") : fa === "SORTIR" ? (fr ? "SORTIR" : "EXIT") : fa === "ÉVITER" ? (fr ? "ÉVITER" : "AVOID") : fa === "SYSTÈME" ? (fr ? "SYSTÈME" : "SYSTEM") : (fr ? "SURVEILLER" : "MONITOR");
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full sm:w-[380px] border-l border-border bg-background text-foreground overflow-y-auto">
        <SheetHeader>
          <div className="flex items-center justify-between">
            <SheetTitle className="font-mono tracking-wider text-lg">SN-{signal.netuid}</SheetTitle>
            <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors text-sm">✕</button>
          </div>
        </SheetHeader>
        <div className="mt-4 space-y-5">
          <div className="text-center">
            <div className="font-mono text-sm text-muted-foreground">{cf?.subnet_name ?? signal.name}</div>
            <div className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg" style={{ background: `color-mix(in srgb, ${faColor} 8%, transparent)`, border: `1px solid color-mix(in srgb, ${faColor} 20%, transparent)` }}>
              <span>{faIcon}</span>
              <span className="font-mono font-bold tracking-wider text-xs" style={{ color: faColor }}>{faLabel}</span>
            </div>
          </div>
          <div className="flex items-center justify-center gap-8">
            <div className="text-center">
              <div className="font-mono text-2xl font-bold" style={{ color: opportunityColor(signal.opp) }}>{signal.opp}</div>
              <div className="font-mono text-[9px] text-muted-foreground tracking-widest">{t("gauge.opportunity")}</div>
            </div>
            <div className="w-px h-8 bg-border" />
            <div className="text-center">
              <div className="font-mono text-2xl font-bold" style={{ color: riskColor(signal.risk) }}>{signal.risk}</div>
              <div className="font-mono text-[9px] text-muted-foreground tracking-widest">{t("gauge.risk")}</div>
            </div>
          </div>

          {/* ── Canonical Facts Summary ── */}
          {cf && (
            <div className="rounded-lg p-3 space-y-2" style={{ background: "hsla(0,0%,100%,0.02)", border: "1px solid hsla(0,0%,100%,0.04)" }}>
              <div className="font-mono text-[9px] text-muted-foreground tracking-widest mb-1">{fr ? "DONNÉES CANONIQUES" : "CANONICAL DATA"}</div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                {cf.price != null && (
                  <FactRow label={fr ? "Prix α" : "Price α"} value={`${cf.price.toFixed(4)} τ`} />
                )}
                {cf.price_usd != null && (
                  <FactRow label="USD" value={`$${cf.price_usd.toFixed(4)}`} />
                )}
                {cf.change_24h != null && (
                  <FactRow label="24h" value={`${cf.change_24h >= 0 ? "+" : ""}${cf.change_24h.toFixed(1)}%`} color={cf.change_24h >= 0 ? GO : BREAK} />
                )}
                {cf.volume_24h != null && (
                  <FactRow label={fr ? "Vol 24h" : "Vol 24h"} value={`${cf.volume_24h.toFixed(1)} τ`} />
                )}
                {cf.market_cap != null && (
                  <FactRow label="MCap" value={`${(cf.market_cap / 1000).toFixed(1)}k τ`} />
                )}
                {cf.tao_in_pool != null && (
                  <FactRow label={fr ? "Pool τ" : "Pool τ"} value={`${cf.tao_in_pool.toFixed(1)}`} />
                )}
                {cf.emissions_day != null && (
                  <FactRow label={fr ? "Émis./j" : "Emis./d"} value={`${cf.emissions_day.toFixed(2)} τ`} />
                )}
                {cf.validators != null && (
                  <FactRow label="Val." value={`${cf.validators}`} />
                )}
                {cf.miners != null && (
                  <FactRow label="Min." value={`${cf.miners}`} />
                )}
              </div>
              {/* External risk */}
              {cf.taoflute_match && (
                <div className="mt-2 flex items-center gap-1.5 px-2 py-1 rounded" style={{ background: "hsla(4,80%,50%,0.06)", border: "1px solid hsla(4,80%,50%,0.12)" }}>
                  <span style={{ fontSize: 9 }}>⚠</span>
                  <span className="font-mono text-[8px] font-bold" style={{ color: "hsl(4,80%,50%)" }}>TaoFlute: {cf.external_status}</span>
                  {cf.liq_price != null && <span className="font-mono text-[8px] text-muted-foreground ml-1">Liq: {cf.liq_price.toFixed(4)}</span>}
                </div>
              )}
              {/* Social signal */}
              {cf.social_signal_strength != null && cf.social_signal_strength > 0 && (
                <div className="mt-1 flex items-center gap-1.5 px-2 py-1 rounded" style={{ background: "hsla(200,70%,50%,0.04)", border: "1px solid hsla(200,70%,50%,0.1)" }}>
                  <span style={{ fontSize: 9 }}>📡</span>
                  <span className="font-mono text-[8px] text-muted-foreground">Social: {cf.social_signal_strength}/100</span>
                  {cf.social_sentiment_score != null && <span className="font-mono text-[8px] text-muted-foreground ml-1">Sent: {cf.social_sentiment_score > 0 ? "+" : ""}{cf.social_sentiment_score}</span>}
                </div>
              )}
              {/* Source provenance */}
              <div className="mt-2 flex flex-wrap gap-1">
                {cf.taostats_timestamp && (
                  <span className="font-mono text-[7px] px-1.5 py-0.5 rounded text-muted-foreground/50" style={{ background: "hsla(0,0%,100%,0.02)" }}>
                    TaoStats {new Date(cf.taostats_timestamp).toLocaleTimeString()}
                  </span>
                )}
                {cf.taoflute_timestamp && (
                  <span className="font-mono text-[7px] px-1.5 py-0.5 rounded text-muted-foreground/50" style={{ background: "hsla(0,0%,100%,0.02)" }}>
                    TaoFlute {new Date(cf.taoflute_timestamp).toLocaleTimeString()}
                  </span>
                )}
                {cf.social_timestamp && (
                  <span className="font-mono text-[7px] px-1.5 py-0.5 rounded text-muted-foreground/50" style={{ background: "hsla(0,0%,100%,0.02)" }}>
                    Social {new Date(cf.social_timestamp).toLocaleTimeString()}
                  </span>
                )}
              </div>
            </div>
          )}

          {signal.reasons.length > 0 && (
            <div className="rounded-lg p-3" style={{ background: "hsla(0,0%,100%,0.02)" }}>
              <div className="font-mono text-[9px] text-muted-foreground tracking-widest mb-2">RAISONS</div>
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

/* ─── Fact Row helper ─── */
function FactRow({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="font-mono text-[8px] text-muted-foreground/50 uppercase tracking-wider">{label}</span>
      <span className="font-mono text-[10px] font-bold" style={{ color: color ?? "hsl(var(--foreground))" }}>{value}</span>
    </div>
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

  // ── Data sources — useCanonicalSubnets is the single source of truth ──
  const { scoresList, sparklines, scoreTimestamp, taoUsd, dataAlignment, dataAgeDebug, fleetDistribution, dataConfidence, isLoading } = useSubnetScores();
  const { facts: canonicalFacts, decisions, canonicalDecisions, earlyPumps, pulses, dataTrust } = useCanonicalSubnets();


  const { data: rawSignals } = useQuery({
    queryKey: ["unified-signals"],
    queryFn: async () => {
      const { data, error } = await supabase.from("signals_latest").select("*");
      if (error) throw error;
      return (data || []) as RawSignal[];
    },
    refetchInterval: 60_000,
  });

  // ── Exclude system subnets from all speculative aggregations ──
  const specScoresList = useMemo(() => scoresList.filter(s => !SPECIAL_SUBNETS[s.netuid]?.isSystem), [scoresList]);

  // ── Global metrics (speculative only) ──
  const globalOpp = useMemo(() => {
    if (!specScoresList.length) return 0;
    const sorted = [...specScoresList].sort((a, b) => b.opp - a.opp);
    const top25 = sorted.slice(0, Math.max(1, Math.ceil(sorted.length * 0.25)));
    return Math.round(top25.reduce((a, s) => a + s.opp, 0) / top25.length * 0.6 + specScoresList.reduce((a, s) => a + s.opp, 0) / specScoresList.length * 0.4);
  }, [specScoresList]);

  const globalRisk = useMemo(() => {
    if (!specScoresList.length) return 0;
    const sorted = [...specScoresList].sort((a, b) => b.risk - a.risk);
    const top25 = sorted.slice(0, Math.max(1, Math.ceil(sorted.length * 0.25)));
    return Math.round(top25.reduce((a, s) => a + s.risk, 0) / top25.length * 0.5 + specScoresList.reduce((a, s) => a + s.risk, 0) / specScoresList.length * 0.5);
  }, [specScoresList]);

  const smartCapital = useMemo(() => computeSmartCapital(rawSignals ?? []), [rawSignals]);

  const enrichedSignals = useMemo<DashSignal[]>(() => {
    const flowDominance = (() => {
      const oppSignals = specScoresList.filter(s => s.opp > s.risk + 15).length;
      const riskSignals = specScoresList.filter(s => s.risk > s.opp + 15).length;
      return oppSignals > riskSignals + 1 ? "up" as const : riskSignals > oppSignals + 1 ? "down" as const : "stable" as const;
    })();
    const avgMomentum = specScoresList.length ? specScoresList.reduce((a, s) => a + s.momentum, 0) / specScoresList.length : 50;
    const flowEmission = avgMomentum > 55 ? "up" as const : avgMomentum < 35 ? "down" as const : "stable" as const;
    return specScoresList.map(s => {
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
  }, [specScoresList, sparklines, smartCapital.state]);

  const sentinelIndex = useMemo(() => computeSentinelIndex(globalOpp, globalRisk, smartCapital.score), [globalOpp, globalRisk, smartCapital.score]);
  const sentinelLabel = sentinelIndexLabel(sentinelIndex, lang);

  const globalStability = useMemo(() => {
    if (!specScoresList.length) return 50;
    return Math.round(specScoresList.reduce((a, s) => a + s.stability, 0) / specScoresList.length);
  }, [specScoresList]);

  const confianceScore = useMemo(() => {
    if (!specScoresList.length) return 50;
    return Math.round(specScoresList.reduce((a, s) => a + s.confianceScore, 0) / specScoresList.length);
  }, [specScoresList]);

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

  // ── Decision-based priority groups (single source of truth via finalAction) ──
  const priorityGroups = useMemo(() => {
    const nonSystem = enrichedSignals.filter(s => !SPECIAL_SUBNETS[s.netuid]?.isSystem);
    const getFa = (s: DashSignal) => decisions.get(s.netuid)?.finalAction;
    const enterGroup = nonSystem.filter(s => getFa(s) === "ENTRER").sort((a, b) => b.opp - a.opp).slice(0, 5);
    const holdGroup = nonSystem.filter(s => getFa(s) === "SURVEILLER").sort((a, b) => b.opp - a.opp).slice(0, 5);
    const exitGroup = nonSystem.filter(s => getFa(s) === "SORTIR").sort((a, b) => b.risk - a.risk).slice(0, 5);
    const avoidGroup = nonSystem.filter(s => getFa(s) === "ÉVITER").sort((a, b) => b.risk - a.risk).slice(0, 5);
    const enterCount = nonSystem.filter(s => getFa(s) === "ENTRER").length;
    const holdCount = nonSystem.filter(s => getFa(s) === "SURVEILLER").length;
    const exitCount = nonSystem.filter(s => getFa(s) === "SORTIR").length;
    const avoidCount = nonSystem.filter(s => getFa(s) === "ÉVITER").length;
    return { enterGroup, holdGroup, exitGroup, avoidGroup, enterCount, holdCount, exitCount, avoidCount };
  }, [enrichedSignals, decisions]);

  // ── Best opportunity & worst risk ──
  const bestOpp = useMemo(() => {
    return [...enrichedSignals].filter(s => decisions.get(s.netuid)?.finalAction === "ENTRER").sort((a, b) => b.opp - a.opp)[0] || null;
  }, [enrichedSignals, decisions]);

  const worstRisk = useMemo(() => {
    return [...enrichedSignals].filter(s => { const f = decisions.get(s.netuid)?.finalAction; return f === "SORTIR" || f === "ÉVITER"; }).sort((a, b) => b.risk - a.risk)[0] || null;
  }, [enrichedSignals, decisions]);

  // ── Critical risks ──
  const criticalRisks = useMemo(() => {
    return enrichedSignals
      .filter(s => { const f = decisions.get(s.netuid)?.finalAction; return f === "SORTIR" || f === "ÉVITER"; })
      .sort((a, b) => {
        const sev = (x: DashSignal) => (x.isOverridden ? 100 : 0) + x.depegProbability + (x.delistCategory !== "NORMAL" ? x.delistScore : 0);
        return sev(b) - sev(a);
      })
      .slice(0, 6);
  }, [enrichedSignals, decisions]);

  // ── Watchlist: top conviction signals ──
  const watchlist = useMemo(() => {
    return [...enrichedSignals]
      .filter(s => !s.isOverridden && s.conf >= 40 && !SPECIAL_SUBNETS[s.netuid]?.isSystem)
      .sort((a, b) => {
        const score = (x: DashSignal) => Math.abs(x.opp - x.risk) * (x.conf / 100) * (x.momentumScore / 50);
        return score(b) - score(a);
      })
      .slice(0, 8);
  }, [enrichedSignals]);

  // ── Rotation map ──
  const rotationMap = useMemo(() => {
    const nonSystem = enrichedSignals.filter(s => !SPECIAL_SUBNETS[s.netuid]?.isSystem);
    const getFa = (s: DashSignal) => decisions.get(s.netuid)?.finalAction;
    const isEx = (f: string | undefined) => f === "SORTIR" || f === "ÉVITER";
    const leaders = nonSystem.filter(s => getFa(s) === "ENTRER" && s.momentumScore >= 55).sort((a, b) => b.opp - a.opp).slice(0, 5);
    const accumulating = nonSystem.filter(s => s.sc === "ACCUMULATION" && !isEx(getFa(s)) && !leaders.find(l => l.netuid === s.netuid)).sort((a, b) => b.psi - a.psi).slice(0, 5);
    const fragile = nonSystem.filter(s => s.risk > 60 && !isEx(getFa(s))).sort((a, b) => b.risk - a.risk).slice(0, 5);
    const avoid = nonSystem.filter(s => isEx(getFa(s))).sort((a, b) => b.risk - a.risk).slice(0, 5);
    return { leaders, accumulating, fragile, avoid };
  }, [enrichedSignals, decisions]);

  // ── Portfolio alignment ──
  const portfolioAlignment = useMemo(() => {
    if (!positions.length) return null;
    const held = positions.map(p => p.subnet_id);
    let aligned = 0, misaligned = 0, watching = 0;
    for (const netuid of held) {
      const fa = decisions.get(netuid)?.finalAction;
      if (!fa) { watching++; continue; }
      if (fa === "SORTIR" || fa === "ÉVITER") misaligned++;
      else if (fa === "ENTRER" || fa === "SURVEILLER") aligned++;
      else watching++;
    }
    const total = held.length;
    const status: "aligned" | "partial" | "misaligned" = misaligned === 0 ? "aligned" : misaligned / total >= 0.4 ? "misaligned" : "partial";
    return { aligned, misaligned, watching, total, status };
  }, [positions, decisions]);

  // ── Derived values ──
  const scLabel = t(`sc.${smartCapital.state.toLowerCase()}` as any);
  const macroRecLabel = t(`macro.${macroRec.toLowerCase()}` as any);
  const oppGlobal = opportunityColor(globalOpp);
  const rskGlobal = riskColor(globalRisk);
  const [panelSignal, setPanelSignal] = useState<DashSignal | null>(null);

  // ── Drivers ──
  const drivers = useMemo(() => {
    const avgMom = enrichedSignals.length ? Math.round(enrichedSignals.reduce((a, s) => a + s.momentumScore, 0) / enrichedSignals.length) : 0;
    const avgLiqEff = enrichedSignals.length ? Math.round(enrichedSignals.reduce((a, s) => a + (s.quality || 50), 0) / enrichedSignals.length) : 50;
    const sellPressure = enrichedSignals.length ? Math.round(enrichedSignals.filter(s => { const f = decisions.get(s.netuid)?.finalAction; return f === "SORTIR" || f === "ÉVITER"; }).length / enrichedSignals.length * 100) : 0;
    const entryRatio = enrichedSignals.length ? Math.round(enrichedSignals.filter(s => decisions.get(s.netuid)?.finalAction === "ENTRER").length / enrichedSignals.length * 100) : 0;
    return [
      { icon: "💰", label: fr ? "Smart Capital" : "Smart Capital", value: smartCapital.state === "ACCUMULATION" ? "Accum." : smartCapital.state === "DISTRIBUTION" ? "Distrib." : "Stable", num: smartCapital.score, color: smartCapital.state === "ACCUMULATION" ? GO : smartCapital.state === "DISTRIBUTION" ? BREAK : MUTED },
      { icon: "📈", label: "Momentum", value: `${avgMom}`, num: avgMom, color: avgMom >= 55 ? GO : avgMom >= 35 ? WARN : BREAK },
      { icon: "💧", label: fr ? "Liquidité" : "Liquidity", value: `${avgLiqEff}%`, num: avgLiqEff, color: avgLiqEff >= 60 ? GO : avgLiqEff >= 40 ? WARN : BREAK },
      { icon: "📉", label: fr ? "Pression vente" : "Sell Pressure", value: `${sellPressure}%`, num: sellPressure, color: sellPressure <= 15 ? GO : sellPressure <= 30 ? WARN : BREAK },
      { icon: "🎯", label: fr ? "Taux entrée" : "Entry Rate", value: `${entryRatio}%`, num: entryRatio, color: entryRatio >= 10 ? GO : entryRatio >= 3 ? WARN : BREAK },
    ];
  }, [enrichedSignals, smartCapital, fr]);

  // ── Tactical summary — more directive ──
  const tacticalSummary = useMemo(() => {
    if (!enrichedSignals.length) return "";
    const nonSystem = enrichedSignals.filter(s => !SPECIAL_SUBNETS[s.netuid]?.isSystem);
    const entryCount = nonSystem.filter(s => decisions.get(s.netuid)?.finalAction === "ENTRER").length;
    const exitCount = nonSystem.filter(s => { const f = decisions.get(s.netuid)?.finalAction; return f === "SORTIR" || f === "ÉVITER"; }).length;
    const bestName = bestOpp ? `SN-${bestOpp.netuid} ${bestOpp.name}` : "";
    const worstName = worstRisk ? `SN-${worstRisk.netuid}` : "";
    if (fr) {
      if (sentinelIndex >= 65 && entryCount >= 5) return `Marché favorable. ${entryCount} entrées identifiées${bestName ? ` — meilleure : ${bestName}` : ""}. ${exitCount > 0 ? `${exitCount} sortie(s) à exécuter.` : "Aucune sortie urgente."}`;
      if (sentinelIndex >= 45) return `Marché neutre — sélectivité requise. ${entryCount} entrée(s) viable(s), ${exitCount} risque(s) actif(s).${worstName ? ` Risque dominant : ${worstName}.` : ""}`;
      return `Environnement défensif — ${exitCount} subnets en danger.${worstName ? ` Priorité réduction : ${worstName}.` : ""} Exposition minimale recommandée.`;
    }
    if (sentinelIndex >= 65 && entryCount >= 5) return `Favorable market. ${entryCount} entries identified${bestName ? ` — best: ${bestName}` : ""}. ${exitCount > 0 ? `${exitCount} exit(s) to execute.` : "No urgent exits."}`;
    if (sentinelIndex >= 45) return `Neutral market — selectivity required. ${entryCount} viable entry(ies), ${exitCount} active risk(s).${worstName ? ` Dominant risk: ${worstName}.` : ""}`;
    return `Defensive environment — ${exitCount} subnets in danger.${worstName ? ` Priority reduction: ${worstName}.` : ""} Minimal exposure recommended.`;
  }, [enrichedSignals, sentinelIndex, fr, bestOpp, worstRisk]);

  const sections = [
    { key: "enter", title: fr ? "ENTRER" : "ENTER", emoji: "🟢", items: priorityGroups.enterGroup, count: priorityGroups.enterCount, color: GO, bg: `color-mix(in srgb, ${GO} 4%, transparent)`, border: `color-mix(in srgb, ${GO} 12%, transparent)` },
    { key: "hold", title: fr ? "SURVEILLER" : "WATCH", emoji: "🟡", items: priorityGroups.holdGroup, count: priorityGroups.holdCount, color: WARN, bg: `color-mix(in srgb, ${WARN} 4%, transparent)`, border: `color-mix(in srgb, ${WARN} 12%, transparent)` },
    { key: "exit", title: fr ? "SORTIR" : "EXIT", emoji: "🔴", items: priorityGroups.exitGroup, count: priorityGroups.exitCount, color: BREAK, bg: `color-mix(in srgb, ${BREAK} 4%, transparent)`, border: `color-mix(in srgb, ${BREAK} 12%, transparent)` },
    { key: "avoid", title: fr ? "ÉVITER" : "AVOID", emoji: "⛔", items: priorityGroups.avoidGroup, count: priorityGroups.avoidCount, color: "hsl(4,80%,40%)", bg: "color-mix(in srgb, hsl(4,80%,40%) 4%, transparent)", border: "color-mix(in srgb, hsl(4,80%,40%) 12%, transparent)" },
  ];

  const rotationGroups = [
    { key: "leaders", title: fr ? "Leaders" : "Leaders", icon: "🚀", items: rotationMap.leaders, color: GO },
    { key: "accum", title: fr ? "Accumulation" : "Accumulation", icon: "🧲", items: rotationMap.accumulating, color: WARN },
    { key: "fragile", title: fr ? "Fragiles" : "Fragile", icon: "⚠", items: rotationMap.fragile, color: WARN },
    { key: "avoid", title: fr ? "À éviter" : "Avoid", icon: "🚫", items: rotationMap.avoid, color: BREAK },
  ];

  if (isLoading || !scoresList.length) return <PageLoadingState label={fr ? "Chargement Compass..." : "Loading Compass..."} />;

  return (
    <div className="h-full w-full bg-background text-foreground overflow-y-auto overflow-x-hidden">
      <div className="px-3 sm:px-6 py-4 sm:py-5 max-w-[1000px] mx-auto space-y-5 sm:space-y-9">

        {/* ═══ DATA SAFE MODE BANNER — only blocks ENTRER/RENFORCER ═══ */}
        {dataTrust.isSafeMode && (
          <WarningBanner
            level="critical"
            icon="🛡"
            title={fr ? "DATA SAFE MODE — décisions actives gelées" : "DATA SAFE MODE — active decisions frozen"}
            description={
              (fr
                ? `${dataTrustLabel(dataTrust.level, true)}. ENTRER et RENFORCER bloqués. HOT NOW, risques, alertes système et positions restent visibles.`
                : `${dataTrustLabel(dataTrust.level, false)}. ENTER and ADD blocked. HOT NOW, risks, system alerts and positions remain visible.`)
              + (dataTrust.reasons.length ? " · " + dataTrust.reasons.slice(0, 2).join(" · ") : "")
            }
          />
        )}

        {/* ═══ 1. HERO DÉCISIONNEL — MORE DIRECTIVE ═══ */}
        <section>
          <div className="flex items-center gap-2 mb-4 flex-wrap">
            <TaoPriceTicker taoUsd={taoUsd} scoreTimestamp={scoreTimestamp} />
            <DataAlignmentBadge dataAlignment={dataAlignment} dataAgeDebug={dataAgeDebug} className="text-[7px] px-1.5" />
            <DegradedModeBadge degradedCount={specScoresList.filter(d => d.marketDataDegraded).length} totalCount={specScoresList.length} className="text-[7px] px-1.5" />
            {killSwitch.active && (
              <span className="font-mono text-[9px] px-2 py-0.5 rounded animate-pulse" style={{ background: "hsla(var(--destructive), 0.1)", color: "hsl(var(--destructive))", border: "1px solid hsla(var(--destructive), 0.2)" }}>
                🛡 SAFE MODE
              </span>
            )}
            <span className="ml-auto font-mono text-[8px] text-muted-foreground">{specScoresList.length} subnets</span>
          </div>

          <div className="rounded-2xl overflow-hidden" style={{ background: "linear-gradient(180deg, hsla(var(--gold), 0.03) 0%, transparent 100%)", border: "1px solid hsla(var(--gold), 0.08)", boxShadow: "0 4px 24px -4px hsla(var(--gold), 0.06)" }}>
            <div className="p-4 sm:p-8">
              <div className="flex flex-col sm:flex-row items-center gap-4 sm:gap-10">
                {/* Score central */}
                <div className="flex flex-col items-center flex-shrink-0">
                  <span className="font-mono tracking-[0.25em] uppercase text-muted-foreground" style={{ fontSize: 7 }}>SENTINEL INDEX</span>
                  <span className="font-mono font-bold leading-none mt-1" style={{ fontSize: isMobile ? 48 : 72, color: sentinelIndexColor(sentinelIndex), textShadow: `0 0 50px ${sentinelIndexColor(sentinelIndex)}20` }}>
                    {sentinelIndex}
                  </span>
                  <span className="font-mono font-bold tracking-[0.2em] mt-0.5" style={{ fontSize: isMobile ? 9 : 12, color: sentinelIndexColor(sentinelIndex) }}>
                    {sentinelLabel}
                  </span>
                  <div className="mt-3 w-28">
                    <ConfidenceBar value={confianceScore} label={fr ? "CONFIANCE MOTEUR" : "ENGINE CONF."} height={4} />
                  </div>
                </div>

                <div className="hidden sm:block w-px self-stretch" style={{ background: "hsla(var(--gold), 0.08)" }} />
                <div className="sm:hidden w-3/4 h-px mx-auto" style={{ background: "hsla(var(--gold), 0.08)" }} />

                {/* Right: directive summary */}
                <div className="flex-1 flex flex-col gap-4 w-full items-center sm:items-start">
                  {/* Macro posture — prominent */}
                  <div className="flex items-center gap-2.5 sm:gap-3 px-3 sm:px-5 py-2.5 sm:py-3 rounded-xl w-full" style={{ background: macroBg(macroRec), border: `1.5px solid ${macroBorder(macroRec)}`, boxShadow: `0 0 24px ${macroBg(macroRec)}` }}>
                    <span style={{ fontSize: isMobile ? 16 : 22 }}>{macroIcon(macroRec)}</span>
                    <div className="flex-1 min-w-0">
                      <div className="font-mono text-[7px] tracking-[0.15em] uppercase text-muted-foreground">{fr ? "POSTURE MARCHÉ" : "MARKET POSTURE"}</div>
                      <div className="font-mono font-bold tracking-[0.1em] truncate" style={{ color: macroColor(macroRec), fontSize: isMobile ? 11 : 15 }}>{macroRecLabel}</div>
                    </div>
                  </div>

                  {/* 3 key answers — 5-second scan */}
                  <div className="grid grid-cols-3 gap-1.5 sm:gap-2.5 w-full">
                    <DirectiveCard
                      label={fr ? "MEILLEURE OPP." : "BEST OPP."}
                      value={bestOpp ? `SN-${bestOpp.netuid}` : "—"}
                      sub={bestOpp ? bestOpp.name : ""}
                      color={GO}
                      icon="🟢"
                    />
                    <DirectiveCard
                      label={fr ? "RISQUE DOMINANT" : "TOP RISK"}
                      value={worstRisk ? `SN-${worstRisk.netuid}` : "—"}
                      sub={worstRisk ? `Risk ${worstRisk.risk}` : ""}
                      color={BREAK}
                      icon="🔴"
                    />
                    <DirectiveCard
                      label={fr ? "SORTIES" : "EXITS"}
                      value={priorityGroups.exitCount + priorityGroups.avoidCount}
                      sub={fr ? "à exécuter" : "to execute"}
                      color={(priorityGroups.exitCount + priorityGroups.avoidCount) > 0 ? BREAK : MUTED}
                      icon={(priorityGroups.exitCount + priorityGroups.avoidCount) > 0 ? "⚠" : "✓"}
                    />
                  </div>

                  {/* Tactical summary */}
                  {tacticalSummary && (
                    <p className="font-mono text-[10px] text-foreground/70 leading-relaxed max-w-lg" style={{ letterSpacing: "0.02em" }}>
                      {tacticalSummary}
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ═══ 1b. HOT NOW — TaoStats Price Pulse (raw, never filtered) ═══ */}
        <HotNowSection
          pulses={pulses}
          dataTrust={dataTrust}
          fr={fr}
          limit={8}
          decisions={canonicalDecisions}
          facts={canonicalFacts}
          heldNetuids={new Set(positions.map(p => p.subnet_id))}
          sourceTimestamp={scoreTimestamp}
        />

        {/* ═══ 1c. SYSTEM ALERTS — Data Safe Mode reasons ═══ */}
        <SystemAlertsPanel dataTrust={dataTrust} fr={fr} />

        {/* ═══ 2. DRIVERS DU MOMENT ═══ */}
        <section>
          <SectionHeader title={fr ? "DRIVERS DU MOMENT" : "MARKET DRIVERS"} icon="📊" />
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 sm:gap-2.5">
            {drivers.map(d => (
              <MetricCard key={d.label} label={d.label} value={d.value} icon={d.icon} color={d.color} progress={d.num} />
            ))}
          </div>
        </section>

        {/* ═══ 3. ACTIONS PRIORITAIRES ═══ */}
        <section>
          <SectionHeader
            title={fr ? "DÉCISIONS PRIORITAIRES" : "PRIORITY DECISIONS"}
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
          {enrichedSignals.length === 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {[0, 1, 2].map(i => (
                <div key={i} className="rounded-xl h-48 animate-pulse" style={{ background: "hsla(0,0%,100%,0.02)", border: "1px solid hsla(0,0%,100%,0.05)" }} />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5 sm:gap-3.5">
              {sections.map(s => (
                <div key={s.key} className="rounded-xl overflow-hidden" style={{ background: s.bg, border: `1px solid ${s.border}` }}>
                  <div className="flex items-center justify-between px-3 py-2" style={{ borderBottom: `1px solid ${s.border}` }}>
                    <span className="font-mono text-[10px] font-bold tracking-wider" style={{ color: s.color }}>{s.emoji} {s.title}</span>
                    <span className="font-mono text-[8px] text-muted-foreground">{s.count}</span>
                  </div>
                  {s.items.length > 0 ? s.items.slice(0, 5).map((v, idx) => (
                    <div key={v.netuid} className="flex items-center gap-2 py-2 px-3 cursor-pointer hover:bg-white/[0.02] transition-colors"
                      style={{ borderBottom: idx < Math.min(s.items.length, 5) - 1 ? `1px solid ${s.border}` : "none" }}
                      onClick={() => setPanelSignal(v)}>
                      <span className="font-mono text-[10px] font-bold" style={{ color: GOLD, minWidth: 36 }}>SN-{v.netuid}</span>
                      {(() => {
                        const fa = decisions.get(v.netuid)?.finalAction ?? "SURVEILLER";
                        const faC = fa === "ENTRER" ? GO : fa === "SORTIR" ? BREAK : fa === "ÉVITER" ? "hsl(4,80%,40%)" : WARN;
                        const faI = fa === "ENTRER" ? "🟢" : fa === "SORTIR" ? "🔴" : fa === "ÉVITER" ? "⛔" : "👁";
                        const faL = fa === "ENTRER" ? (fr ? "ENTRER" : "ENTER") : fa === "SORTIR" ? (fr ? "SORTIR" : "EXIT") : fa === "ÉVITER" ? (fr ? "ÉVITER" : "AVOID") : (fr ? "SURVEILLER" : "MONITOR");
                        return <span className="font-mono text-[9px] font-bold whitespace-nowrap" style={{ color: faC }}>{faI} {faL}</span>;
                      })()}
                      <EarlyPumpBadge tag={earlyPumps.get(v.netuid)?.tag ?? null} score={earlyPumps.get(v.netuid)?.early_pump_score} size="sm" />
                      <span className="font-mono text-[9px] text-muted-foreground truncate flex-1">{v.overrideReasons[0] || v.name}</span>
                      <span className="font-mono text-[10px] font-bold" style={{ color: s.key === "exit" ? riskColor(v.risk) : opportunityColor(v.opp) }}>
                        {s.key === "exit" ? v.risk : v.opp}
                      </span>
                    </div>
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
                <table className="w-full font-mono" style={{ minWidth: 560 }}>
                  <thead>
                    <tr style={{ background: "hsla(0,0%,100%,0.02)", borderBottom: "1px solid hsla(0,0%,100%,0.04)" }}>
                      {["SN", fr ? "Nom" : "Name", "Action", "Conv.", "Conf.", "Risk", "Mom.", "7d"].map(h => (
                        <th key={h} className="py-2 px-2.5 text-left text-[8px] tracking-wider text-muted-foreground uppercase whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {watchlist.map((s, idx) => {
                      const d = decisions.get(s.netuid);
                      const fa = d?.finalAction ?? "SURVEILLER";
                      const faColor = fa === "ENTRER" ? GO : fa === "SORTIR" || fa === "ÉVITER" ? BREAK : WARN;
                      const faLabel = fa === "ENTRER" ? (fr ? "🟢 ENTRER" : "🟢 ENTER") : fa === "SORTIR" ? (fr ? "🔴 SORTIR" : "🔴 EXIT") : fa === "ÉVITER" ? (fr ? "⛔ ÉVITER" : "⛔ AVOID") : (fr ? "👁 SURVEILLER" : "👁 MONITOR");
                      const convScore = d?.convictionScore ?? Math.abs(s.opp - s.risk) * (s.conf / 100);
                      const convLevel = convScore >= 70 ? "HIGH" : convScore >= 40 ? "MED" : "LOW";
                      const convLevelColor = convScore >= 70 ? GO : convScore >= 40 ? WARN : MUTED;
                      return (
                        <tr key={s.netuid} className="cursor-pointer hover:bg-white/[0.015] transition-colors" style={{ borderBottom: idx < watchlist.length - 1 ? "1px solid hsla(0,0%,100%,0.03)" : "none" }} onClick={() => setPanelSignal(s)}>
                          <td className="py-2 px-2.5 text-[10px] font-bold" style={{ color: "hsl(var(--gold))" }}>SN-{s.netuid}</td>
                          <td className="py-2 px-2.5 text-[10px] text-muted-foreground truncate" style={{ maxWidth: 120 }}>{s.name}</td>
                          <td className="py-2 px-2.5 text-[9px] font-bold whitespace-nowrap" style={{ color: faColor }}>{faLabel}</td>
                          <td className="py-2 px-2.5 text-[9px] font-bold" style={{ color: convLevelColor }}>{convLevel}</td>
                          <td className="py-2 px-2.5 text-[10px]" style={{ color: confianceColor(s.conf) }}>{s.conf}%</td>
                          <td className="py-2 px-2.5 text-[10px] font-bold" style={{ color: riskColor(s.risk) }}>{s.risk}</td>
                          <td className="py-2 px-2.5 text-[10px]" style={{ color: s.momentumScore >= 55 ? GO : s.momentumScore >= 35 ? WARN : BREAK }}>{Math.round(s.momentumScore)}</td>
                          <td className="py-2 px-2.5"><SparklineMini data={s.sparkline_7d} width={50} height={16} /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        )}

        {/* ═══ 4b. EARLY PUMP DETECTOR ═══ */}
        {(() => {
          const epEarly = [...earlyPumps.entries()].filter(([, ep]) => ep.tag === "EARLY_PUMP_CANDIDATE" || ep.tag === "EARLY_PUMP_WATCH").sort(([, a], [, b]) => b.early_pump_score - a.early_pump_score).slice(0, 5);
          const epLate = [...earlyPumps.entries()].filter(([, ep]) => ep.tag === "LATE_PUMP" || ep.tag === "OVEREXTENDED").sort(([, a], [, b]) => b.overextension_score - a.overextension_score).slice(0, 5);
          if (epEarly.length === 0 && epLate.length === 0) return null;
          return (
            <>
              {epEarly.length > 0 && (
                <section>
                  <SectionHeader title={fr ? "EARLY PUMP DETECTOR" : "EARLY PUMP DETECTOR"} icon="🚀" badge={
                    <span className="font-mono text-[9px] px-2 py-0.5 rounded font-bold" style={{ background: "hsla(280, 80%, 65%, 0.08)", color: "hsl(280, 80%, 65%)", border: "1px solid hsla(280, 80%, 65%, 0.2)" }}>{epEarly.length}</span>
                  } />
                  <div className="rounded-xl overflow-hidden" style={{ background: "hsla(280, 80%, 65%, 0.02)", border: "1px solid hsla(280, 80%, 65%, 0.08)" }}>
                    {epEarly.map(([netuid, ep], idx) => {
                      const s = enrichedSignals.find(x => x.netuid === netuid);
                      return (
                        <div key={netuid} className="flex items-center gap-2 py-2.5 px-3 cursor-pointer hover:bg-white/[0.02] transition-all"
                          style={{ borderBottom: idx < epEarly.length - 1 ? "1px solid hsla(280, 80%, 65%, 0.06)" : "none" }}
                          onClick={() => s && setPanelSignal(s)}>
                          <span className="font-mono font-bold text-[11px]" style={{ color: GOLD, minWidth: 48 }}>SN-{netuid}</span>
                          <span className="font-mono text-[10px] truncate text-muted-foreground" style={{ flex: 1 }}>{s?.name ?? "—"}</span>
                          <EarlyPumpBadge tag={ep.tag} score={ep.early_pump_score} size="sm" showScore reasons={ep.reasons} />
                          <span className="font-mono text-[10px] font-bold" style={{ color: "hsl(280, 80%, 65%)" }}>{ep.early_pump_score}</span>
                        </div>
                      );
                    })}
                  </div>
                </section>
              )}
              {epLate.length > 0 && (
                <section>
                  <SectionHeader title={fr ? "LATE PUMP / OVEREXTENDED" : "LATE PUMP / OVEREXTENDED"} icon="🔥" badge={
                    <span className="font-mono text-[9px] px-2 py-0.5 rounded font-bold" style={{ background: "hsla(25, 90%, 55%, 0.08)", color: "hsl(25, 90%, 55%)", border: "1px solid hsla(25, 90%, 55%, 0.2)" }}>{epLate.length}</span>
                  } />
                  <div className="rounded-xl overflow-hidden" style={{ background: "hsla(25, 90%, 55%, 0.02)", border: "1px solid hsla(25, 90%, 55%, 0.08)" }}>
                    {epLate.map(([netuid, ep], idx) => {
                      const s = enrichedSignals.find(x => x.netuid === netuid);
                      return (
                        <div key={netuid} className="flex items-center gap-2 py-2.5 px-3 cursor-pointer hover:bg-white/[0.02] transition-all"
                          style={{ borderBottom: idx < epLate.length - 1 ? "1px solid hsla(25, 90%, 55%, 0.06)" : "none" }}
                          onClick={() => s && setPanelSignal(s)}>
                          <span className="font-mono font-bold text-[11px]" style={{ color: GOLD, minWidth: 48 }}>SN-{netuid}</span>
                          <span className="font-mono text-[10px] truncate text-muted-foreground" style={{ flex: 1 }}>{s?.name ?? "—"}</span>
                          <EarlyPumpBadge tag={ep.tag} score={ep.overextension_score} size="sm" showScore reasons={ep.reasons} />
                          <span className="font-mono text-[10px] font-bold" style={{ color: "hsl(25, 90%, 55%)" }}>{ep.overextension_score}</span>
                        </div>
                      );
                    })}
                  </div>
                </section>
              )}
            </>
          );
        })()}

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
                    <span className="font-mono font-bold text-[11px]" style={{ color: GOLD, minWidth: 48 }}>SN-{s.netuid}</span>
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
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-2.5">
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
                    color: portfolioAlignment.status === "aligned" ? GO : portfolioAlignment.status === "partial" ? WARN : BREAK,
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
              <span className="text-[10px] tracking-wider font-bold" style={{ color: "hsl(var(--gold))" }}>Subnet Intelligence</span>
              <span className="text-[8px] text-muted-foreground">{fr ? "Table de décision" : "Decision table"}</span>
            </Link>
            <Link to="/lab" className="flex flex-col items-center gap-1.5 py-4 rounded-xl font-mono transition-all hover:scale-[1.01]" style={{ background: "hsla(0,0%,100%,0.02)", border: "1px solid hsla(0,0%,100%,0.06)" }}>
              <span style={{ fontSize: 16 }}>🔬</span>
              <span className="text-[10px] tracking-wider font-bold text-muted-foreground">{fr ? "Laboratoire" : "Lab"}</span>
              <span className="text-[8px] text-muted-foreground">{fr ? "Diagnostics avancés" : "Advanced diagnostics"}</span>
            </Link>
          </div>
        </section>
      </div>

      <SubnetQuickPanel signal={panelSignal} open={!!panelSignal} onClose={() => setPanelSignal(null)} fr={fr} decisions={decisions} facts={canonicalFacts} />
    </div>
  );
}

/* ─── Directive Card — for hero 5-second scan ─── */
function DirectiveCard({ label, value, sub, color, icon }: { label: string; value: string | number; sub: string; color: string; icon: string }) {
  return (
    <div className="rounded-lg p-2.5 text-center" style={{ background: `color-mix(in srgb, ${color} 4%, transparent)`, border: `1px solid color-mix(in srgb, ${color} 12%, transparent)` }}>
      <div className="font-mono text-[7px] tracking-[0.15em] uppercase text-muted-foreground">{label}</div>
      <div className="font-mono font-bold mt-1 flex items-center justify-center gap-1" style={{ color, fontSize: 13 }}>
        <span style={{ fontSize: 10 }}>{icon}</span>
        {value}
      </div>
      {sub && <div className="font-mono text-[8px] text-muted-foreground mt-0.5 truncate">{sub}</div>}
    </div>
  );
}

/* ─── Mini metric inline ─── */
function MiniMetric({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span className="font-mono text-muted-foreground uppercase" style={{ fontSize: 8, letterSpacing: "0.12em" }}>{label}</span>
      <span className="font-mono font-bold leading-none" style={{ color, fontSize: 13 }}>{value}</span>
    </div>
  );
}
