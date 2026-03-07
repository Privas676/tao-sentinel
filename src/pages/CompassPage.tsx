import { useState, useMemo, useEffect, useRef, useCallback, type ReactNode } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useSubnetVerdicts } from "@/hooks/use-subnet-verdict";
import { VerdictRow, verdictColor } from "@/components/VerdictBadge";
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

/* ─── Collapsible Section ─── */
function CollapsibleSection({ title, icon, color, lineColor, badge, children, defaultOpen = true }: {
  title: string; icon: string; color: string; lineColor: string;
  badge?: ReactNode; children: ReactNode; defaultOpen?: boolean;
}) {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(!isMobile);
  useEffect(() => { setOpen(!isMobile || defaultOpen === false ? defaultOpen : !isMobile); }, [isMobile]);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <div className="flex items-center gap-2 mb-3 cursor-pointer group select-none">
          <span className="font-mono tracking-[0.2em] uppercase font-bold" style={{ fontSize: 10, color }}>
            {icon} {title}
          </span>
          <div className="flex-1 h-px" style={{ background: lineColor }} />
          {badge}
          <span className="font-mono text-[10px] transition-transform" style={{ color: "hsl(var(--muted-foreground))", transform: open ? "rotate(180deg)" : "rotate(0)" }}>▾</span>
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent>{children}</CollapsibleContent>
    </Collapsible>
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

  // ── Gauge geometry ──
  const SIZE = isMobile ? 260 : 360;
  const CX = SIZE / 2, CY = SIZE / 2;
  const R_OUTER = isMobile ? 100 : 150;
  const R_INNER = isMobile ? 78 : 120;
  const oppGlobal = opportunityColor(globalOpp);
  const rskGlobal = riskColor(globalRisk);
  const oppAngle = (globalOpp / 100) * 270;
  const riskAngle = (globalRisk / 100) * 270;

  function describeArc(cx: number, cy: number, r: number, startAngle: number, endAngle: number) {
    const rad = (a: number) => ((a - 90) * Math.PI) / 180;
    const x1 = cx + r * Math.cos(rad(startAngle));
    const y1 = cy + r * Math.sin(rad(startAngle));
    const x2 = cx + r * Math.cos(rad(endAngle));
    const y2 = cy + r * Math.sin(rad(endAngle));
    const large = endAngle - startAngle > 180 ? 1 : 0;
    return `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`;
  }

  const sections = [
    { title: "🟢 RENTRE", items: topRentre, count: countRentre, color: "rgba(76,175,80,0.5)" },
    { title: "🟡 HOLD", items: topHold, count: countHold, color: "rgba(255,193,7,0.45)" },
    { title: "🔴 SORS", items: topSors, count: countSors, color: "rgba(229,57,53,0.5)" },
  ];

  return (
    <div className="h-full w-full bg-background text-foreground overflow-y-auto overflow-x-hidden">
      <style>{`@keyframes opp-sweep { 0% { opacity: 0.3; } 50% { opacity: 0.6; } 100% { opacity: 0.3; } }`}</style>

      <div className="px-4 sm:px-6 py-4 max-w-[960px] mx-auto">

        {/* ═══ HEADER ROW ═══ */}
        <div className="flex items-center gap-3 mb-4 flex-wrap">
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

        {/* ═══ SENTINEL INDEX + GAUGE ═══ */}
        <div className="rounded-2xl p-4 sm:p-6 mb-4" style={{ background: "hsla(0,0%,100%,0.015)", border: "1px solid hsla(0,0%,100%,0.06)" }}>
          <div className="flex flex-col items-center">
            {/* Circular gauge */}
            <div className="relative" style={{ width: SIZE, height: SIZE }}>
              <div className="absolute inset-0 rounded-full pointer-events-none" style={{ background: "radial-gradient(circle, hsla(var(--gold), 0.06) 0%, transparent 60%)", transform: "scale(1.2)" }} />
              <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
                {/* Tick marks */}
                {Array.from({ length: 54 }, (_, i) => {
                  const angleDeg = (i * 5) - 135;
                  if (angleDeg > 135) return null;
                  const rad = ((angleDeg - 90) * Math.PI) / 180;
                  const isMajor = i % 9 === 0;
                  const r1 = R_OUTER + 4; const r2 = R_OUTER + (isMajor ? 10 : 6);
                  return <line key={`ot-${i}`} x1={CX + r1 * Math.cos(rad)} y1={CY + r1 * Math.sin(rad)} x2={CX + r2 * Math.cos(rad)} y2={CY + r2 * Math.sin(rad)} stroke={isMajor ? "hsla(var(--gold), 0.25)" : "hsla(var(--gold), 0.08)"} strokeWidth={isMajor ? 1.5 : 0.7} strokeLinecap="round" />;
                })}
                {Array.from({ length: 54 }, (_, i) => {
                  const angleDeg = (i * 5) - 135;
                  if (angleDeg > 135) return null;
                  const rad = ((angleDeg - 90) * Math.PI) / 180;
                  const isMajor = i % 9 === 0;
                  const r1 = R_INNER - 4; const r2 = R_INNER - (isMajor ? 8 : 5);
                  return <line key={`it-${i}`} x1={CX + r1 * Math.cos(rad)} y1={CY + r1 * Math.sin(rad)} x2={CX + r2 * Math.cos(rad)} y2={CY + r2 * Math.sin(rad)} stroke={isMajor ? "hsla(var(--destructive), 0.2)" : "hsla(var(--destructive), 0.06)"} strokeWidth={isMajor ? 1.2 : 0.5} strokeLinecap="round" />;
                })}
                {/* Arcs */}
                <circle cx={CX} cy={CY} r={R_OUTER} fill="none" stroke="hsla(var(--gold), 0.05)" strokeWidth={isMobile ? 5 : 7} />
                {oppAngle > 0 && <path d={describeArc(CX, CY, R_OUTER, -135, -135 + oppAngle)} fill="none" stroke={oppGlobal} strokeWidth={isMobile ? 5 : 7} strokeLinecap="round" style={{ opacity: 0.55, animation: "opp-sweep 4s ease-in-out infinite" }} />}
                <circle cx={CX} cy={CY} r={R_INNER} fill="none" stroke="hsla(var(--destructive), 0.05)" strokeWidth={isMobile ? 7 : 9} />
                {riskAngle > 0 && <path d={describeArc(CX, CY, R_INNER, -135, -135 + riskAngle)} fill="none" stroke={rskGlobal} strokeWidth={isMobile ? 7 : 9} strokeLinecap="round" style={{ opacity: 0.55 }} />}
              </svg>

              {/* Center HUD */}
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="flex flex-col items-center text-center" style={{ maxWidth: isMobile ? 140 : 200 }}>
                  <span className="font-mono tracking-[0.2em] uppercase text-muted-foreground/40" style={{ fontSize: isMobile ? 7 : 8 }}>
                    Sentinel Index
                  </span>
                  <span className="font-mono font-bold leading-none mt-1" style={{
                    fontSize: isMobile ? 36 : 52, color: sentinelIndexColor(sentinelIndex),
                    textShadow: "0 0 30px hsla(var(--gold), 0.15)",
                  }}>
                    {sentinelIndex}
                  </span>
                  <span className="font-mono font-bold tracking-wider mt-0.5" style={{ fontSize: isMobile ? 9 : 11, color: sentinelIndexColor(sentinelIndex), opacity: 0.7 }}>
                    {sentinelLabel}
                  </span>
                  <div className="flex items-center mt-2" style={{ gap: isMobile ? 6 : 10 }}>
                    <div className="flex flex-col items-center">
                      <span className="font-mono" style={{ color: "hsla(var(--gold), 0.35)", fontSize: isMobile ? 6 : 7, letterSpacing: "0.15em" }}>OPP</span>
                      <span className="font-mono font-bold" style={{ color: oppGlobal, fontSize: isMobile ? 13 : 16 }}>{globalOpp}</span>
                    </div>
                    <div className="w-px bg-border" style={{ height: isMobile ? 12 : 16 }} />
                    <div className="flex flex-col items-center">
                      <span className="font-mono" style={{ color: "hsla(var(--destructive), 0.35)", fontSize: isMobile ? 6 : 7, letterSpacing: "0.15em" }}>RISK</span>
                      <span className="font-mono font-bold" style={{ color: rskGlobal, fontSize: isMobile ? 13 : 16 }}>{globalRisk}</span>
                    </div>
                    <div className="w-px bg-border" style={{ height: isMobile ? 12 : 16 }} />
                    <div className="flex flex-col items-center">
                      <span className="font-mono text-muted-foreground/25" style={{ fontSize: isMobile ? 6 : 7, letterSpacing: "0.15em" }}>SC</span>
                      <span className="font-mono font-bold" style={{
                        color: smartCapital.state === "ACCUMULATION" ? "rgba(76,175,80,0.85)" : smartCapital.state === "DISTRIBUTION" ? "rgba(229,57,53,0.85)" : "hsl(var(--muted-foreground))",
                        fontSize: isMobile ? 7 : 9,
                      }}>
                        {scLabel}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Macro recommendation */}
            <div className="flex flex-col items-center mt-2">
              <span className="font-mono tracking-[0.15em] uppercase mb-2 text-muted-foreground/25" style={{ fontSize: 8 }}>
                {t("macro.label")}
              </span>
              <div className="flex items-center gap-3 px-5 py-2.5 rounded-xl" style={{
                background: macroBg(macroRec),
                border: `2px solid ${macroBorder(macroRec)}`,
                boxShadow: `0 0 20px ${macroBg(macroRec)}`,
              }}>
                <span style={{ fontSize: isMobile ? 16 : 20 }}>{macroIcon(macroRec)}</span>
                <span className="font-mono font-bold tracking-[0.2em]" style={{ color: macroColor(macroRec), fontSize: isMobile ? 12 : 16 }}>
                  {macroRecLabel}
                </span>
              </div>
            </div>

            {/* Sub-metrics */}
            <div className="flex items-center justify-center gap-6 mt-4">
              <div className="flex flex-col items-center">
                <span className="font-mono text-muted-foreground/30" style={{ fontSize: 8, letterSpacing: "0.12em" }}>{fr ? "Stabilité" : "Stability"}</span>
                <span className="font-mono font-bold" style={{ color: stabilityColor(globalStability), fontSize: isMobile ? 14 : 18 }}>{globalStability}%</span>
              </div>
              <div className="w-px h-5 bg-border" />
              <div className="flex flex-col items-center">
                <span className="font-mono text-muted-foreground/30" style={{ fontSize: 8, letterSpacing: "0.12em" }}>{t("data.confiance")}</span>
                <span className="font-mono font-bold" style={{ color: confianceColor(confianceScore), fontSize: isMobile ? 14 : 18 }}>{confianceScore}%</span>
              </div>
            </div>
          </div>
        </div>

        {/* ═══ DRIVERS DU MOMENT ═══ */}
        <CollapsibleSection title={fr ? "DRIVERS DU MOMENT" : "CURRENT DRIVERS"} icon="📊" color="hsla(var(--gold), 0.6)" lineColor="hsla(var(--gold), 0.1)">
          <div className="flex flex-wrap gap-2 mb-4">
            {drivers.map(d => (
              <div key={d.label} className="flex items-center gap-2 px-3 py-2 rounded-lg"
                style={{ background: "hsla(0,0%,100%,0.015)", border: "1px solid hsla(0,0%,100%,0.05)" }}>
                <span style={{ fontSize: 12 }}>{d.icon}</span>
                <span className="font-mono text-[9px] tracking-wider text-muted-foreground/40">{d.label}</span>
                <span className="font-mono text-[11px] font-bold" style={{ color: d.color }}>{d.value}</span>
              </div>
            ))}
          </div>
        </CollapsibleSection>

        {/* ═══ DECISION ENGINE ═══ */}
        <CollapsibleSection title="DECISION ENGINE" icon="⚙" color="hsla(var(--gold), 0.6)" lineColor="hsla(var(--gold), 0.1)"
          badge={
            <div className="flex gap-2">
              {sections.map(s => (
                <span key={s.title} className="font-mono text-[9px] px-2 py-0.5 rounded" style={{ background: `${s.color}15`, color: s.color, border: `1px solid ${s.color}40` }}>
                  {s.count}
                </span>
              ))}
            </div>
          }>
          {verdictLoading ? (
            <div className="py-8 text-center font-mono text-[10px] text-muted-foreground/20">Chargement...</div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
              {sections.map(s => (
                <div key={s.title} className="rounded-xl" style={{ background: "hsla(0,0%,100%,0.01)", border: "1px solid hsla(0,0%,100%,0.04)" }}>
                  <div className="px-3 py-2 border-b" style={{ borderColor: "hsla(0,0%,100%,0.04)" }}>
                    <span className="font-mono text-[10px] font-bold tracking-wider" style={{ color: s.color }}>{s.title}</span>
                    <span className="font-mono text-[8px] text-muted-foreground/25 ml-2">({s.count})</span>
                  </div>
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
                    <div className="py-4 text-center font-mono text-[10px] text-muted-foreground/15">—</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CollapsibleSection>

        {/* ═══ RISQUES CRITIQUES ═══ */}
        {criticalRisks.length > 0 && (
          <CollapsibleSection title={fr ? "RISQUES CRITIQUES" : "CRITICAL RISKS"} icon="🚨" color="hsla(var(--destructive), 0.6)" lineColor="hsla(var(--destructive), 0.1)"
            badge={
              <span className="font-mono text-[9px] px-2 py-0.5 rounded" style={{ background: "hsla(var(--destructive), 0.08)", color: "hsl(var(--destructive))", border: "1px solid hsla(var(--destructive), 0.2)" }}>
                {criticalRisks.length}
              </span>
            }>
            <div className="rounded-xl overflow-hidden mb-4" style={{ background: "hsla(var(--destructive), 0.02)", border: "1px solid hsla(var(--destructive), 0.08)" }}>
              {criticalRisks.map(s => {
                const tags: { label: string; color: string }[] = [];
                if (s.isOverridden) tags.push({ label: "⛔ OVERRIDE", color: "rgba(229,57,53,0.9)" });
                if (s.delistCategory === "DEPEG_PRIORITY") tags.push({ label: "🔴 DEREG", color: "rgba(229,57,53,0.9)" });
                else if (s.delistCategory === "HIGH_RISK_NEAR_DELIST") tags.push({ label: "🟠 DELIST", color: "rgba(255,152,0,0.9)" });
                if (s.depegProbability >= 50) tags.push({ label: `DEPEG ${s.depegProbability}%`, color: "rgba(255,152,0,0.9)" });
                return (
                  <div key={s.netuid} className="flex items-center gap-2 py-2.5 px-3 cursor-pointer hover:bg-white/[0.02] transition-all"
                    style={{ borderBottom: "1px solid hsla(var(--destructive), 0.06)" }}
                    onClick={() => setPanelSignal(s)}>
                    <span className="font-mono font-bold text-[11px]" style={{ color: "hsl(var(--gold))", width: 55 }}>SN-{s.netuid}</span>
                    <span className="font-mono text-[10px] truncate flex-1 text-muted-foreground/40">{s.name}</span>
                    <div className="flex gap-1">
                      {tags.map((t, i) => (
                        <span key={i} className="font-mono text-[8px] px-1.5 py-0.5 rounded font-bold"
                          style={{ background: `${t.color}12`, color: t.color, border: `1px solid ${t.color}30` }}>
                          {t.label}
                        </span>
                      ))}
                    </div>
                    <span className="font-mono text-[11px] font-bold w-7 text-right" style={{ color: riskColor(s.risk) }}>{s.risk}</span>
                  </div>
                );
              })}
            </div>
          </CollapsibleSection>
        )}

        {/* ═══ QUICK LINKS ═══ */}
        <div className="flex gap-3 mt-2 mb-8">
          <Link to="/subnets" className="flex-1 text-center font-mono text-[10px] tracking-wider py-3 rounded-lg transition-all hover:scale-[1.01]"
            style={{ background: "hsla(var(--gold), 0.04)", color: "hsl(var(--gold))", border: "1px solid hsla(var(--gold), 0.08)" }}>
            {fr ? "Explorer les subnets →" : "Explore subnets →"}
          </Link>
          <Link to="/lab" className="flex-1 text-center font-mono text-[10px] tracking-wider py-3 rounded-lg transition-all hover:scale-[1.01]"
            style={{ background: "hsla(0,0%,100%,0.02)", color: "hsl(var(--muted-foreground))", border: "1px solid hsla(0,0%,100%,0.06)" }}>
            {fr ? "Ouvrir le Lab →" : "Open Lab →"}
          </Link>
        </div>
      </div>

      <SubnetQuickPanel signal={panelSignal} open={!!panelSignal} onClose={() => setPanelSignal(null)} />
    </div>
  );
}
