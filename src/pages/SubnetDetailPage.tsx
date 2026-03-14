import { useParams, Link, useNavigate } from "react-router-dom";
import { useI18n } from "@/lib/i18n";
import { useSubnetScores, SPECIAL_SUBNETS, type UnifiedSubnetScore } from "@/hooks/use-subnet-scores";
import { useSubnetDecisions, type SubnetDecision } from "@/hooks/use-subnet-decisions";
import { useStakeAnalytics } from "@/hooks/use-stake-analytics";
import { useLocalPortfolio } from "@/hooks/use-local-portfolio";
import { useMemo, useState, useEffect, useCallback } from "react";
import { opportunityColor, riskColor, stabilityColor, momentumColor } from "@/lib/gauge-engine";
import type { FinalAction } from "@/lib/subnet-decision";
import { confianceColor } from "@/lib/data-fusion";
import { healthColor } from "@/lib/subnet-health";
import { ActionBadge } from "@/components/sentinel";
import { SectionCard, SectionTitle, KPIChip, Metric, BarScore, GOLD, GO, WARN, BREAK, MUTED } from "@/components/sentinel/Atoms";
import DecisionDebugBadge from "@/components/DecisionDebugBadge";
import SocialSignalBlock from "@/components/social/SocialSignalBlock";

/* ═══════════════════════════════════════════════════════ */
/*   SUBNET COMMAND CENTER — Decision-First Architecture   */
/* ═══════════════════════════════════════════════════════ */

function DetailSparkline({ data, w = 200, h = 44 }: { data: number[]; w?: number; h?: number }) {
  if (data.length < 2) return <span className="text-muted-foreground text-[9px] italic">no data</span>;
  const min = Math.min(...data), max = Math.max(...data), range = max - min || 1;
  const trend = data[data.length - 1] - data[0];
  const c = trend > 0 ? GO : trend < 0 ? BREAK : MUTED;
  const pts = data.map((v, i) => `${((i / (data.length - 1)) * w).toFixed(1)},${(h - 3 - ((v - min) / range) * (h - 6)).toFixed(1)}`).join(" ");
  return (
    <svg width={w} height={h} className="opacity-80">
      <polyline points={pts} fill="none" stroke={c} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* ── Logic helpers — use unified decision source ── */

function urgency(d: SubnetDecision, fr: boolean): { text: string; color: string } {
  if (d.isOverridden) return { text: fr ? "Immédiate — sortie forcée" : "Immediate — forced exit", color: BREAK };
  if (d.depegProbability >= 50) return { text: fr ? "Haute — risque depeg" : "High — depeg risk", color: BREAK };
  if (d.finalAction === "SORTIR") return { text: fr ? "Haute" : "High", color: BREAK };
  if (d.finalAction === "ENTRER" && d.opp > 65) return { text: fr ? "Haute — fenêtre ouverte" : "High — window open", color: GO };
  return { text: fr ? "Normale" : "Normal", color: MUTED };
}

function horizon(d: SubnetDecision, fr: boolean): string {
  if (d.finalAction === "ENTRER") return fr ? "Court à moyen terme" : "Short to medium term";
  if (d.finalAction === "SURVEILLER") return fr ? "Moyen terme" : "Medium term";
  return fr ? "Court terme" : "Short term";
}

function fitScore(s: UnifiedSubnetScore): number {
  let f = 50;
  if (s.opp > 50) f += 15;
  if (s.risk < 40) f += 10;
  if (s.stability > 50) f += 10;
  if (s.confianceScore > 60) f += 10;
  if (s.isOverridden) f -= 30;
  return Math.max(0, Math.min(100, f));
}

function convColor(l: "HIGH" | "MEDIUM" | "LOW") {
  return l === "HIGH" ? GO : l === "MEDIUM" ? WARN : MUTED;
}

/* ── Portfolio profile logic ── */
type ProfileType = "core" | "tactical" | "opportunistic" | "watchlist" | "avoid";

function portfolioProfile(s: UnifiedSubnetScore): { profile: ProfileType; label: string; labelFr: string; color: string; desc: string; descFr: string } {
  if (s.isOverridden || s.delistCategory !== "NORMAL" || s.depegProbability >= 40 || s.risk > 75)
    return { profile: "avoid", label: "Avoid", labelFr: "Éviter", color: BREAK, desc: "Too risky for any portfolio. Critical alerts active.", descFr: "Trop risqué. Alertes critiques actives." };
  if (s.opp < 35 && s.momentumScore < 35 && s.confianceScore < 50)
    return { profile: "watchlist", label: "Watchlist Only", labelFr: "Watchlist uniquement", color: MUTED, desc: "Not ready yet. Monitor for improvement signals.", descFr: "Pas encore prêt. Surveiller les signaux d'amélioration." };
  if (s.opp > 60 && s.risk < 50 && s.momentumScore > 50)
    return { profile: "opportunistic", label: "Opportunistic", labelFr: "Opportuniste", color: GO, desc: "Strong entry window. Size 3-8% with defined exit.", descFr: "Fenêtre d'entrée forte. Taille 3-8% avec sortie définie." };
  if (s.stability > 55 && s.risk < 45 && s.confianceScore > 55)
    return { profile: "core", label: "Core Position", labelFr: "Position de fond", color: GOLD, desc: "Stable, low-risk. Suitable for 5-15% allocation.", descFr: "Stable, risque faible. Allocation 5-15% adaptée." };
  return { profile: "tactical", label: "Tactical", labelFr: "Tactique", color: WARN, desc: "Moderate conviction. Position 2-5%, active monitoring.", descFr: "Conviction modérée. Position 2-5%, suivi actif." };
}

/* ── Watch points generator — RESPECTS final decision ── */
function watchPoints(s: UnifiedSubnetScore, d: SubnetDecision, eco: any, sn: any, fr: boolean): { icon: string; text: string; urgency: "high" | "medium" | "low" }[] {
  const pts: { icon: string; text: string; urgency: "high" | "medium" | "low" }[] = [];

  if (s.depegProbability >= 30)
    pts.push({ icon: "⚠", text: fr ? `Probabilité de depeg à ${s.depegProbability}% — seuil critique à 50%` : `Depeg probability at ${s.depegProbability}% — critical at 50%`, urgency: "high" });
  if (s.isOverridden)
    pts.push({ icon: "🚨", text: fr ? "Override manuel actif — sortie recommandée" : "Manual override active — exit recommended", urgency: "high" });
  if (s.risk > 60)
    pts.push({ icon: "🔴", text: fr ? `Risque élevé (${s.risk}/100) — surveiller les catalyseurs de baisse` : `High risk (${s.risk}/100) — watch for downside catalysts`, urgency: "high" });
  if (s.momentumScore < 35)
    pts.push({ icon: "📉", text: fr ? `Momentum faible (${Math.round(s.momentumScore)}) — attendre un retournement` : `Weak momentum (${Math.round(s.momentumScore)}) — wait for reversal`, urgency: "medium" });
  if (s.confianceScore < 55)
    pts.push({ icon: "📊", text: fr ? `Données insuffisantes (${s.confianceScore}%) — fiabilité limitée` : `Insufficient data (${s.confianceScore}%) — limited reliability`, urgency: "medium" });
  if (eco?.sentiment != null && eco.sentiment < 0.4)
    pts.push({ icon: "🐻", text: fr ? "Pression vendeuse dominante — surveiller les sorties de capital" : "Dominant sell pressure — monitor capital outflows", urgency: "medium" });
  if (s.healthScores.liquidityHealth < 35)
    pts.push({ icon: "💧", text: fr ? "Liquidité critique — slippage élevé probable" : "Critical liquidity — high slippage likely", urgency: "medium" });
  // FIXED: Only show entry window hint if final action allows it
  if (d.finalAction === "ENTRER" && s.opp > 60 && s.momentumScore > 55)
    pts.push({ icon: "🎯", text: fr ? "Fenêtre d'entrée ouverte — volume et momentum alignés" : "Entry window open — volume and momentum aligned", urgency: "low" });
  else if (d.rawSignal === "opportunity" && d.isBlocked)
    pts.push({ icon: "⚖️", text: fr ? "Opportunité brute détectée mais bloquée par garde-fous" : "Raw opportunity detected but blocked by safety guards", urgency: "medium" });
  if (sn?.stakeConcentration > 50)
    pts.push({ icon: "🏗", text: fr ? `Concentration élevée (${(sn.stakeConcentration <= 1 ? sn.stakeConcentration * 100 : sn.stakeConcentration).toFixed(0)}%) — risque de dump coordonné` : `High concentration (${(sn.stakeConcentration <= 1 ? sn.stakeConcentration * 100 : sn.stakeConcentration).toFixed(0)}%) — coordinated dump risk`, urgency: "medium" });

  // Sort by urgency, take top 5
  const order = { high: 0, medium: 1, low: 2 };
  return pts.sort((a, b) => order[a.urgency] - order[b.urgency]).slice(0, 5);
}

/* ═══════════════════════════════════════════════ */
/*   MAIN PAGE                                      */
/* ═══════════════════════════════════════════════ */
export default function SubnetDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { lang } = useI18n();
  const fr = lang === "fr";
  const netuid = parseInt(id || "0", 10);

  /* ── Escape key → back to /subnets (preserves browser history state) ── */
  const goBack = useCallback(() => {
    if (window.history.length > 2) {
      navigate(-1);
    } else {
      navigate("/subnets");
    }
  }, [navigate]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); goBack(); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [goBack]);

  const { scores, sparklines } = useSubnetScores();
  const { decisions } = useSubnetDecisions();
  const { data: radarData } = useStakeAnalytics();
  const { isOwned, addPosition, removePosition } = useLocalPortfolio();
  const [flash, setFlash] = useState<string | null>(null);
  const [showDeepDive, setShowDeepDive] = useState(false);
  const s = scores.get(netuid);
  const decisionObj = decisions.get(netuid);
  const verdict = decisionObj?.verdict;
  const spark = sparklines?.get(netuid) || [];
  const radar = useMemo(() => radarData?.find(r => r.netuid === netuid) || null, [radarData, netuid]);
  const inPortfolio = isOwned(netuid);
  const isSpecial = !!SPECIAL_SUBNETS[netuid];

  const doFlash = (msg: string) => { setFlash(msg); setTimeout(() => setFlash(null), 1500); };

  if (!s) {
    return (
      <div className="h-full w-full bg-background text-foreground p-6 flex flex-col items-center justify-center gap-4">
        <div className="animate-pulse font-mono text-muted-foreground text-sm tracking-widest">
          {fr ? "Chargement..." : "Loading..."}
        </div>
        <Link to="/subnets" className="font-mono text-[10px] text-muted-foreground hover:text-foreground transition-colors">← Subnets</Link>
      </div>
    );
  }

  const decision = decisionObj ?? (s ? {
    netuid: s.netuid, name: s.name,
    finalAction: "SURVEILLER" as const,
    engineAction: s.action, actionFr: "SURVEILLER" as const,
    actionEn: "MONITOR", badgeAction: "SURVEILLER" as const, isSystem: false,
    rawSignal: "neutral" as const, isBlocked: false, blockReasons: [], primaryReason: "—",
    portfolioAction: "CONSERVER" as const, portfolioActionFr: "CONSERVER", portfolioActionEn: "HOLD",
    conviction: "LOW" as const, convictionScore: 0, opp: s.opp, risk: s.risk,
    asymmetry: s.asymmetry, confidence: s.confianceScore, momentumScore: s.momentumScore,
    momentumLabel: s.momentumLabel, stability: s.stability,
    liquidityLevel: "LOW" as const, structureLevel: "FRAGILE" as const, statusLevel: "WATCH" as const,
    signalPrincipal: "—", thesis: [], invalidation: [], conflictExplanation: null,
    isOverridden: s.isOverridden, dataUncertain: s.dataUncertain,
    depegProbability: s.depegProbability, delistCategory: s.delistCategory, delistScore: s.delistScore,
    score: s, verdict: undefined,
  } as SubnetDecision : null);
  if (!decision) return null;
  const urg = urgency(decision, fr);
  const eco = radar?.economicContext;
  const dm = radar?.derivedMetrics;
  const sn = radar?.snapshot;
  const rs = radar?.scores;
  const amm = radar?.ammMetrics;
  const profile = portfolioProfile(s);
  const watches = watchPoints(s, decision, eco, sn, fr);
  const pctChange = spark.length >= 2 && spark[0] > 0 ? ((spark[spark.length - 1] - spark[0]) / spark[0]) * 100 : null;

  return (
    <div className="h-full w-full bg-background text-foreground overflow-auto pb-24">
      <div className="px-4 sm:px-6 py-6 max-w-[1100px] mx-auto space-y-7">

        {/* ── Back button + Breadcrumb ── */}
        <nav className="flex items-center gap-3">
          <button
            onClick={goBack}
            className="inline-flex items-center gap-1.5 font-mono text-[10px] tracking-wider text-muted-foreground hover:text-foreground transition-colors px-2.5 py-1.5 rounded-md border border-border hover:border-foreground/20 hover:bg-muted/20"
          >
            ← {fr ? "Retour" : "Back"}
          </button>
          <span className="text-muted-foreground text-[10px]">/</span>
          <span className="font-mono text-[10px] text-muted-foreground">SN-{netuid}</span>
          <span className="ml-auto font-mono text-[8px] text-muted-foreground/50 hidden sm:block">ESC</span>
        </nav>

        {/* ── EXIT/SORTIR WARNING BANNER — decision coherence ── */}
        {(decision.finalAction === "SORTIR") && (
          <div className="rounded-xl px-5 py-4 flex items-start gap-3" style={{ background: "hsla(4,80%,50%,0.08)", border: "1.5px solid hsla(4,80%,50%,0.2)", boxShadow: "0 0 24px hsla(4,80%,50%,0.1)" }}>
            <span className="text-xl shrink-0 mt-0.5">🚨</span>
            <div>
              <div className="font-mono text-[8px] tracking-[0.2em] uppercase text-muted-foreground mb-1">{fr ? "VERDICT : SORTIE RECOMMANDÉE" : "VERDICT: EXIT RECOMMENDED"}</div>
              <div className="font-mono text-sm font-bold" style={{ color: BREAK }}>
                {decision.primaryReason}
              </div>
              {decision.conflictExplanation && (
                <div className="font-mono text-[10px] text-foreground/60 mt-1">{decision.conflictExplanation}</div>
              )}
              {decision.invalidation.length > 0 && (
                <div className="font-mono text-[10px] text-foreground/50 mt-1">
                  {decision.invalidation.map((r, i) => <span key={i}>• {r} </span>)}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ══════════════════════════════════════════ */}
        {/*   HERO — Identity + Primary Decision       */}
        {/* ══════════════════════════════════════════ */}
        <SectionCard>
          <div className="px-5 sm:px-7 py-6 sm:py-7">
            {/* Identity row */}
            <div className="flex items-start gap-4 mb-5">
              <div className="w-14 h-14 rounded-xl flex items-center justify-center font-mono text-xl font-bold border border-border bg-muted/15 text-[hsl(var(--gold))] shrink-0">
                {netuid}
              </div>
              <div className="flex-1 min-w-0">
                <h1 className="font-mono text-lg sm:text-xl tracking-wide text-[hsl(var(--gold))] leading-tight">{s.name}</h1>
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  <span className="font-mono text-[9px] text-muted-foreground">SN-{netuid} · {s.assetType}</span>
                  {isSpecial && (
                    <span className="font-mono text-[7px] px-1.5 py-0.5 rounded font-bold"
                      style={{ background: "hsla(var(--signal-system), 0.08)", color: "hsl(var(--signal-system))", border: "1px solid hsla(var(--signal-system), 0.2)" }}>
                      🔷 {fr ? SPECIAL_SUBNETS[netuid].label : SPECIAL_SUBNETS[netuid].labelEn}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <ActionBadge action={decision.badgeAction} />
                <DecisionDebugBadge decision={decision} />
              </div>
            </div>

            {/* Primary decision strip */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <KPIChip label="CONVICTION" value={`${decision.conviction} (${decision.convictionScore})`} color={convColor(decision.conviction)} />
              <KPIChip label="CONFIDENCE" value={`${s.confianceScore}%`} color={confianceColor(s.confianceScore)} />
              <KPIChip label="RISK" value={s.risk} color={riskColor(s.risk)} />
              <KPIChip label="MOMENTUM" value={Math.round(s.momentumScore)} color={s.momentumScore >= 55 ? GO : s.momentumScore >= 35 ? WARN : BREAK} />
            </div>

            {/* Secondary context row */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-1 mt-4 pt-4 border-t border-border">
              <Metric label={fr ? "Horizon" : "Horizon"} value={horizon(decision, fr)} />
              <Metric label={fr ? "Urgence" : "Urgency"} value={urg.text} color={urg.color} />
              <Metric label={fr ? "Régime" : "Regime"} value={s.systemStatus === "OK" ? (fr ? "Favorable" : "Favorable") : s.systemStatus === "SURVEILLANCE" ? (fr ? "Neutre" : "Neutral") : (fr ? "Défavorable" : "Unfavorable")} color={s.systemStatus === "OK" ? GO : s.systemStatus === "SURVEILLANCE" ? WARN : BREAK} />
              <Metric label={fr ? "Asymétrie" : "Asymmetry"} value={s.asymmetry > 0 ? `+${s.asymmetry}` : `${s.asymmetry}`} color={s.asymmetry > 0 ? GO : BREAK} />
            </div>
          </div>
        </SectionCard>

        {/* ── System subnet explanation ── */}
        {isSpecial && SPECIAL_SUBNETS[netuid]?.isSystem && (
          <SectionCard>
            <div className="px-5 py-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-lg">🔷</span>
                <span className="font-mono text-[10px] tracking-wider font-bold" style={{ color: "hsl(var(--signal-system))" }}>
                  {fr ? "SUBNET SYSTÈME" : "SYSTEM SUBNET"}
                </span>
              </div>
              <p className="font-mono text-[11px] text-foreground/70 leading-relaxed">
                {fr ? SPECIAL_SUBNETS[netuid].description : SPECIAL_SUBNETS[netuid].descriptionEn}
              </p>
              <p className="font-mono text-[9px] text-muted-foreground mt-2">
                {fr
                  ? "Les métriques d'opportunité et de risque sont plafonnées. Ce subnet est traité comme une position d'infrastructure, pas comme une opportunité alpha."
                  : "Opportunity and risk metrics are capped. This subnet is treated as an infrastructure position, not as an alpha opportunity."}
              </p>
            </div>
          </SectionCard>
        )}

        {/* ══════════════════════════════════════════ */}
        {/*   DECISION TRANSPARENCY — Engine Arbiter    */}
        {/* ══════════════════════════════════════════ */}
        {!isSpecial && (
          <SectionCard>
            <SectionTitle icon="🔬" title={fr ? "Transparence décision" : "Decision Transparency"} />
            <div className="px-5 py-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="rounded-lg px-3 py-2.5 bg-muted/20 border border-border text-center">
                  <div className="font-mono text-[7px] tracking-widest uppercase text-muted-foreground mb-1">{fr ? "SIGNAL BRUT" : "RAW SIGNAL"}</div>
                  <div className="font-mono text-[12px] font-bold" style={{
                    color: decision.rawSignal === "opportunity" ? GO : decision.rawSignal === "exit" ? BREAK : WARN
                  }}>
                    {decision.rawSignal === "opportunity" ? (fr ? "Opportunité" : "Opportunity") : decision.rawSignal === "exit" ? (fr ? "Sortie" : "Exit") : (fr ? "Neutre" : "Neutral")}
                  </div>
                </div>
                <div className="rounded-lg px-3 py-2.5 bg-muted/20 border border-border text-center">
                  <div className="font-mono text-[7px] tracking-widest uppercase text-muted-foreground mb-1">{fr ? "BLOCAGE" : "BLOCKED"}</div>
                  <div className="font-mono text-[12px] font-bold" style={{
                    color: decision.isBlocked ? BREAK : GO
                  }}>
                    {decision.isBlocked ? (fr ? "Oui" : "Yes") : (fr ? "Non" : "No")}
                  </div>
                </div>
                <div className="rounded-lg px-3 py-2.5 bg-muted/20 border border-border text-center">
                  <div className="font-mono text-[7px] tracking-widest uppercase text-muted-foreground mb-1">{fr ? "ACTION FINALE" : "FINAL ACTION"}</div>
                  <div className="font-mono text-[12px] font-bold" style={{
                    color: decision.finalAction === "ENTRER" ? GO : decision.finalAction === "SORTIR" ? BREAK : WARN
                  }}>
                    {decision.finalAction}
                  </div>
                </div>
                <div className="rounded-lg px-3 py-2.5 bg-muted/20 border border-border text-center">
                  <div className="font-mono text-[7px] tracking-widest uppercase text-muted-foreground mb-1">{fr ? "MOTIF" : "REASON"}</div>
                  <div className="font-mono text-[10px] font-medium text-foreground/70 leading-snug">{decision.primaryReason}</div>
                </div>
              </div>
              {decision.blockReasons.length > 0 && (
                <div className="mt-3 rounded-lg px-4 py-2.5 border border-border bg-destructive/[0.03]">
                  <div className="font-mono text-[7px] tracking-widest uppercase text-muted-foreground mb-1.5">{fr ? "GARDE-FOUS ACTIFS" : "ACTIVE SAFETY GUARDS"}</div>
                  <div className="space-y-1">
                    {decision.blockReasons.map((r, i) => (
                      <div key={i} className="font-mono text-[10px] text-foreground/60 flex items-center gap-2">
                        <span className="text-[8px]">⛔</span> {r}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </SectionCard>
        )}

        {/*   WATCH NOW — What to monitor               */}
        {/* ══════════════════════════════════════════ */}
        {watches.length > 0 && (
          <SectionCard>
            <SectionTitle icon="👁" title={fr ? "Ce qu'il faut surveiller maintenant" : "What to watch now"} />
            <div className="px-5 py-4 space-y-2">
              {watches.map((w, i) => {
                const bgClass = w.urgency === "high" ? "bg-destructive/[0.04] border-destructive/15" : w.urgency === "medium" ? "bg-accent/20 border-border" : "bg-primary/[0.02] border-primary/10";
                const dotColor = w.urgency === "high" ? BREAK : w.urgency === "medium" ? WARN : GO;
                return (
                  <div key={i} className={`flex items-start gap-3 rounded-lg px-4 py-2.5 border ${bgClass}`}>
                    <span className="text-sm mt-0.5 shrink-0 w-5 text-center">{w.icon}</span>
                    <span className="font-mono text-[11px] text-foreground/80 leading-relaxed flex-1">{w.text}</span>
                    <span className="w-2 h-2 rounded-full mt-1.5 shrink-0" style={{ background: dotColor }} />
                  </div>
                );
              })}
            </div>
          </SectionCard>
        )}

        {/* ══════════════════════════════════════════ */}
        {/*   WHY / WHY NOT — Premium 4-quadrant        */}
        {/* ══════════════════════════════════════════ */}
        <SectionCard>
          <SectionTitle icon="⚖️" title={fr ? "Analyse décisionnelle" : "Decision Analysis"} />
          {/* Conflict explanation — when signal seems contradictory */}
          {decision.conflictExplanation && (
            <div className="mx-5 mt-3 rounded-lg px-4 py-2.5 border border-border bg-accent/10">
              <div className="font-mono text-[8px] tracking-widest uppercase text-muted-foreground mb-1">{fr ? "ARBITRAGE MOTEUR" : "ENGINE ARBITRAGE"}</div>
              <div className="font-mono text-[11px] text-foreground/75 leading-relaxed">{decision.conflictExplanation}</div>
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-0">
            {/* Thesis: only show when finalAction is NOT SORTIR */}
            {decision.finalAction !== "SORTIR" && (
              <QuadrantBlock
                title={fr ? "Thèse (pourquoi entrer)" : "Thesis (why enter)"}
                tone="go"
                items={[
                  ...decision.thesis,
                  s.opp > 55 && !decision.thesis.length ? (fr ? `Opportunité ${s.opp}/100` : `Opportunity ${s.opp}/100`) : null,
                  s.momentumScore >= 55 && !decision.thesis.length ? (fr ? `Momentum haussier (${Math.round(s.momentumScore)})` : `Bullish momentum (${Math.round(s.momentumScore)})`) : null,
                  s.asymmetry > 20 && !decision.thesis.length ? (fr ? `Asymétrie +${s.asymmetry}` : `Asymmetry +${s.asymmetry}`) : null,
                ].filter(Boolean) as string[]}
                position="tl"
              />
            )}
            {/* Why wait: only show when finalAction is SURVEILLER */}
            {decision.finalAction === "SURVEILLER" && (
              <QuadrantBlock
                title={fr ? "Pourquoi attendre" : "Why wait"}
                tone="warn"
                items={[
                  s.risk > 40 && s.risk < 65 ? (fr ? `Risque modéré (${s.risk})` : `Moderate risk (${s.risk})`) : null,
                  s.confianceScore < 60 ? (fr ? `Données ${s.confianceScore}%` : `Data ${s.confianceScore}%`) : null,
                  s.momentumScore < 40 ? (fr ? "Momentum faible" : "Weak momentum") : null,
                  s.stability < 40 ? (fr ? "Structure instable" : "Unstable structure") : null,
                ].filter(Boolean) as string[]}
                position="tr"
              />
            )}
            {/* Needs improvement: only show when NOT SORTIR */}
            {decision.finalAction !== "SORTIR" && (
              <QuadrantBlock
                title={fr ? "Ce qui doit s'améliorer" : "Needs improvement"}
                tone="neutral"
                items={[
                  s.risk > 50 ? (fr ? `Risque ${s.risk} → <40` : `Risk ${s.risk} → <40`) : null,
                  s.healthScores.liquidityHealth < 40 ? (fr ? "Liquidité" : "Liquidity") : null,
                  s.healthScores.activityHealth < 40 ? (fr ? "Activité réseau" : "Network activity") : null,
                  sn && sn.stakeConcentration > 50 ? (fr ? "Concentration" : "Concentration") : null,
                ].filter(Boolean) as string[]}
                position="bl"
              />
            )}
            {/* Invalidation: always show */}
            <QuadrantBlock
              title={fr ? "Invalidation" : "Invalidation"}
              tone="break"
              items={[
                ...decision.invalidation,
                s.isOverridden && !decision.invalidation.length ? "Override actif" : null,
                s.depegProbability >= 40 && !decision.invalidation.length ? `Depeg ${s.depegProbability}%` : null,
                s.delistCategory !== "NORMAL" && !decision.invalidation.length ? `Delist: ${s.delistCategory}` : null,
                s.risk > 75 && !decision.invalidation.length ? (fr ? "Zone danger" : "Danger zone") : null,
              ].filter(Boolean) as string[]}
              position="br"
            />
          </div>
        </SectionCard>

        {/* ══════════════════════════════════════════ */}
        {/*   CONVICTION STACK                          */}
        {/* ══════════════════════════════════════════ */}
        <SectionCard>
          <SectionTitle icon="📊" title="Conviction Stack" />
          <div className="px-5 py-4 space-y-1">
            <BarScore label="Flow" value={rs?.capitalMomentum ?? s.opp} />
            <BarScore label={fr ? "Liquidité" : "Liquidity"} value={s.healthScores.liquidityHealth} />
            <BarScore label="Structure" value={s.stability} color={stabilityColor(s.stability)} />
            <BarScore label="Economics" value={rs?.healthIndex ?? 50} />
            <BarScore label="Smart Money" value={rs?.smartMoneyScore ?? 50} />
            <BarScore label={fr ? "Risque (inv.)" : "Risk (inv.)"} value={100 - s.risk} />
          </div>
        </SectionCard>

        {/* ══════════════════════════════════════════ */}
        {/*   DEEP DIVE — Collapsible advanced metrics   */}
        {/* ══════════════════════════════════════════ */}
        <div>
          <button
            onClick={() => setShowDeepDive(!showDeepDive)}
            className="w-full flex items-center justify-between px-5 py-3 rounded-xl border border-border bg-card transition-all hover:bg-muted/10"
            style={{ boxShadow: "var(--shadow-card)" }}
          >
            <div className="flex items-center gap-2.5">
              <span className="text-sm" style={{ opacity: 0.6 }}>📊</span>
              <span className="font-mono text-[10px] tracking-[0.18em] uppercase font-bold" style={{ color: GOLD }}>
                {fr ? "Analyse approfondie" : "Deep Dive Analysis"}
              </span>
              <span className="font-mono text-[8px] text-muted-foreground">
                Flow · Liquidity · Structure · Economics · Smart Money
              </span>
            </div>
            <span className={`font-mono text-[10px] text-muted-foreground transition-transform ${showDeepDive ? "rotate-180" : ""}`}>▼</span>
          </button>

          {showDeepDive && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-4">

              {/* Flow & Momentum */}
              <SectionCard>
                <SectionTitle icon="📈" title="Flow & Momentum" />
                <div className="px-5 py-4 space-y-0.5">
                  <Metric label={fr ? "Prix 7j" : "Price 7d"} value={pctChange != null ? `${pctChange > 0 ? "+" : ""}${pctChange.toFixed(1)}%` : "—"} color={pctChange != null ? (pctChange > 0 ? GO : BREAK) : undefined} />
                  <Metric label="Capital Flow" value={rs?.capitalMomentum != null ? `${rs.capitalMomentum}` : "—"} color={healthColor(rs?.capitalMomentum ?? 50)} />
                  {eco && <Metric label="Buy / Sell" value={`${eco.buyersCount} / ${eco.sellersCount}`} />}
                  <Metric label="Trend" value={s.momentumLabel} color={momentumColor(s.momentumLabel)} />
                  <div className="pt-3 flex justify-center"><DetailSparkline data={spark} /></div>
                </div>
              </SectionCard>

              {/* Liquidity & Execution */}
              <SectionCard>
                <SectionTitle icon="💧" title={fr ? "Liquidité & Exécution" : "Liquidity & Execution"} />
                <div className="px-5 py-4 space-y-0.5">
                  {amm && (
                    <>
                      <Metric label="Spread" value={`${(amm.spreadBps / 100).toFixed(3)}%`} color={amm.spreadBps < 50 ? GO : amm.spreadBps < 200 ? WARN : BREAK} />
                      <Metric label="Slippage 1τ" value={`${(amm.slippageBps1Tao / 100).toFixed(2)}%`} />
                      <Metric label="Slippage 10τ" value={`${(amm.slippageBps10Tao / 100).toFixed(2)}%`} color={amm.slippageBps10Tao > 500 ? BREAK : undefined} />
                      <Metric label={fr ? "Profondeur" : "Depth"} value={`${amm.poolDepth.toFixed(1)}τ`} color={healthColor(Math.min(100, amm.poolDepth))} />
                      <Metric label="AMM" value={amm.ammEfficiency} color={healthColor(amm.ammEfficiency)} />
                    </>
                  )}
                  {eco && <Metric label="Pool" value={`α${eco.alphaInPool.toFixed(0)} / τ${eco.taoInPool.toFixed(1)}`} />}
                  <BarScore label={fr ? "Score Liq." : "Liq. Score"} value={s.healthScores.liquidityHealth} />
                </div>
              </SectionCard>

              {/* Structure */}
              <SectionCard>
                <SectionTitle icon="🏗️" title="Structure" />
                <div className="px-5 py-4 space-y-0.5">
                  {sn && (
                    <>
                      <Metric label={fr ? "Validateurs" : "Validators"} value={sn.validatorsActive} />
                      <Metric label={fr ? "Mineurs" : "Miners"} value={sn.minersActive} sub={`/ ${sn.minersTotal}`} />
                      <Metric label="Holders" value={sn.holdersCount > 0 ? sn.holdersCount : "N/A"} color={sn.holdersCount <= 0 ? MUTED : undefined} />
                      <Metric label="Concentration" value={`${(sn.stakeConcentration <= 1 ? sn.stakeConcentration * 100 : sn.stakeConcentration).toFixed(1)}%`} color={sn.stakeConcentration > 50 ? BREAK : sn.stakeConcentration > 30 ? WARN : GO} />
                    </>
                  )}
                  {rs && (
                    <>
                      <Metric label="Manipulation" value={rs.manipulationScore} color={healthColor(100 - rs.manipulationScore)} />
                      <Metric label="Bubble" value={rs.bubbleScore} color={healthColor(100 - rs.bubbleScore)} />
                      <Metric label="Dump" value={rs.dumpRisk} color={healthColor(100 - rs.dumpRisk)} />
                    </>
                  )}
                </div>
              </SectionCard>

              {/* Economics */}
              <SectionCard>
                <SectionTitle icon="🏦" title="Economics" />
                <div className="px-5 py-4 space-y-0.5">
                  {eco && (
                    <>
                      <Metric label={fr ? "Émissions/j" : "Emissions/d"} value={`${eco.emissionsPerDay.toFixed(1)} α`} />
                      <Metric label={fr ? "Part" : "Share"} value={`${eco.emissionsPercent.toFixed(2)}%`} />
                      {dm && <Metric label="Burn" value={`${(dm.burnRatio * 100).toFixed(1)}%`} color={dm.burnRatio > 0.5 ? GO : dm.burnRatio > 0.2 ? WARN : BREAK} />}
                      <Metric label="Supply" value={`${eco.circulatingSupply.toFixed(0)} α`} />
                      {dm && <Metric label="UID Sat." value={`${(dm.uidSaturation * 100).toFixed(0)}%`} color={dm.uidSaturation > 0.9 ? BREAK : dm.uidSaturation > 0.7 ? WARN : GO} />}
                      {dm && <Metric label={fr ? "Pression" : "Pressure"} value={dm.tradingPressure > 0 ? (fr ? "Achat" : "Buy") : (fr ? "Vente" : "Sell")} color={dm.tradingPressure > 0 ? GO : BREAK} />}
                    </>
                  )}
                  <BarScore label={fr ? "Émission" : "Emission"} value={100 - s.healthScores.emissionPressure} />
                </div>
              </SectionCard>

              {/* Smart Money */}
              <SectionCard>
                <SectionTitle icon="🐋" title="Smart Money" />
                <div className="px-5 py-4 space-y-0.5">
                  {rs && (
                    <>
                      <Metric label="Score" value={rs.smartMoneyScore} color={healthColor(rs.smartMoneyScore)} />
                      <Metric label="Narrative" value={rs.narrativeScore} color={healthColor(rs.narrativeScore)} />
                    </>
                  )}
                  {eco && <Metric label="Sentiment" value={`${(eco.sentiment * 100).toFixed(0)}%`} color={eco.sentiment > 0.55 ? GO : eco.sentiment < 0.45 ? BREAK : WARN} sub={eco.sentiment > 0.55 ? "Buy" : eco.sentiment < 0.45 ? "Sell" : "—"} />}
                  <BarScore label={fr ? "Activité" : "Activity"} value={s.healthScores.activityHealth} />
                </div>
              </SectionCard>

              {/* Portfolio Profile */}
              <SectionCard>
                <SectionTitle icon="📁" title={fr ? "Profil portefeuille" : "Portfolio Profile"} />
                <div className="px-5 py-4">
                  <div className="flex items-center gap-3 mb-4">
                    <span className="font-mono text-[13px] font-bold" style={{ color: profile.color }}>{fr ? profile.labelFr : profile.label}</span>
                    <span className="font-mono text-[10px] text-muted-foreground">— Fit {fitScore(s)}/100</span>
                  </div>
                  <p className="font-mono text-[11px] text-muted-foreground leading-relaxed mb-4">
                    {fr ? profile.descFr : profile.desc}
                  </p>
                  <div className="space-y-1.5">
                    {(["core", "tactical", "opportunistic", "watchlist", "avoid"] as ProfileType[]).map(p => {
                      const active = profile.profile === p;
                      const labels: Record<ProfileType, { en: string; fr: string }> = {
                        core: { en: "Core (5-15%)", fr: "Fond (5-15%)" },
                        tactical: { en: "Tactical (2-5%)", fr: "Tactique (2-5%)" },
                        opportunistic: { en: "Opportunistic (3-8%)", fr: "Opportuniste (3-8%)" },
                        watchlist: { en: "Watchlist Only", fr: "Watchlist seule" },
                        avoid: { en: "Avoid", fr: "Éviter" },
                      };
                      return (
                        <div key={p} className={`flex items-center gap-2.5 py-1 px-2.5 rounded-md transition-colors ${active ? "bg-muted/40" : ""}`}>
                          <span className={`w-2 h-2 rounded-full shrink-0 ${active ? "" : "opacity-[0.35]"}`} style={{ background: active ? profile.color : MUTED }} />
                          <span className={`font-mono text-[10px] ${active ? "text-foreground font-medium" : "text-muted-foreground"}`}>
                            {fr ? labels[p].fr : labels[p].en}
                          </span>
                          {active && <span className="font-mono text-[8px] text-muted-foreground ml-auto">◄</span>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </SectionCard>
            </div>
          )}
        </div>

        {/* ══════════════════════════════════════════ */}
        {/*   SCENARIOS — informational, never contradictory */}
        {/* ══════════════════════════════════════════ */}
        <SectionCard>
          <SectionTitle icon="🔮" title={fr ? "Scénarios" : "Scenarios"} />
          {/* Disclaimer when final action is SORTIR but bull scenario exists */}
          {decision.finalAction === "SORTIR" && (
            <div className="mx-5 mt-2 rounded-lg px-3 py-2 border border-border bg-destructive/[0.03]">
              <div className="font-mono text-[9px] text-foreground/50">
                {fr ? "⚠ Scénarios exploratoires — le verdict actuel est SORTIR. Consulter la section Transparence ci-dessus." : "⚠ Exploratory scenarios — current verdict is EXIT. See Transparency section above."}
              </div>
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-0 divide-y sm:divide-y-0 sm:divide-x divide-border">
            <ScenarioBlock
              title="Bull"
              color={GO}
              items={[
                // FIXED: Never say "Opportunité confirmée" if action is SORTIR
                decision.finalAction === "SORTIR"
                  ? (fr ? `Opportunité brute (${s.opp}) — non actionnable` : `Raw opportunity (${s.opp}) — not actionable`)
                  : s.opp > 50
                    ? (fr ? `Opportunité détectée (${s.opp})` : `Opportunity detected (${s.opp})`)
                    : (fr ? "Momentum accélère" : "Momentum accelerates"),
                eco?.sentiment != null && eco.sentiment > 0.5 ? (fr ? "Achat soutenu" : "Sustained buying") : (fr ? "Adoption croissante" : "Growing adoption"),
                fr ? "Breakout prix + volume" : "Price + volume breakout",
              ]}
            />
            <ScenarioBlock
              title="Base"
              color={WARN}
              items={[
                fr ? "Consolidation latérale" : "Sideways consolidation",
                fr ? "Volumes stables" : "Stable volumes",
                fr ? "Pas de catalyseur" : "No catalyst",
              ]}
            />
            <ScenarioBlock
              title="Bear"
              color={BREAK}
              items={[
                s.risk > 40 ? (fr ? `Risque matérialisé (${s.risk})` : `Risk materializes (${s.risk})`) : (fr ? "Perte de momentum" : "Momentum loss"),
                s.depegProbability > 20 ? `Depeg → ${s.depegProbability}%` : (fr ? "Sortie de capital" : "Capital outflow"),
                fr ? "Liquidité s'assèche" : "Liquidity dries up",
              ]}
            />
          </div>
        </SectionCard>

        {/* External ref */}
        <div className="flex justify-end pb-2">
          <a href={`https://taostats.io/subnets/${netuid}`} target="_blank" rel="noopener noreferrer"
            className="font-mono text-[9px] tracking-wider text-muted-foreground hover:text-foreground transition-colors">
            Taostats →
          </a>
        </div>
      </div>

      {/* ══════════════════════════════════════════ */}
      {/*   STICKY FOOTER                             */}
      {/* ══════════════════════════════════════════ */}
      <div className="fixed bottom-0 left-0 right-0 z-50 border-t border-border bg-background/95 backdrop-blur-md">
        <div className="max-w-[1100px] mx-auto px-4 sm:px-6 py-2.5 flex items-center gap-2.5">
          <ActionBadge action={decision.badgeAction} size="sm" />
          <span className="font-mono text-[9px] text-muted-foreground hidden sm:inline">
            {fr ? profile.labelFr : profile.label}
          </span>
          <div className="flex-1" />
          {flash && <span className="font-mono text-[9px] text-primary animate-pulse">{flash}</span>}
          <button
            onClick={() => {
              if (inPortfolio) { removePosition(netuid); doFlash("✓"); }
              else { addPosition(netuid, 0, s.alphaPrice); doFlash("✓"); }
            }}
            className="font-mono text-[9px] tracking-wider px-3 py-1.5 rounded-lg border transition-all"
            style={{
              background: inPortfolio ? "hsl(var(--gold) / 0.08)" : "hsl(var(--signal-go) / 0.06)",
              color: inPortfolio ? GOLD : GO,
              borderColor: inPortfolio ? "hsl(var(--gold) / 0.15)" : "hsl(var(--signal-go) / 0.15)",
            }}
          >
            {inPortfolio ? "★" : "+"} Portfolio
          </button>
          <Link to="/alerts" className="font-mono text-[9px] px-2.5 py-1.5 rounded-lg border border-border text-muted-foreground hover:text-foreground transition-colors">
            🔔
          </Link>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════ */
/*   SUB-COMPONENTS                     */
/* ═══════════════════════════════════ */

function QuadrantBlock({ title, items, tone, position }: { title: string; items: string[]; tone: "go" | "warn" | "break" | "neutral"; position: "tl" | "tr" | "bl" | "br" }) {
  const styles = {
    go: { accent: GO, bg: "bg-primary/[0.02]" },
    warn: { accent: WARN, bg: "bg-accent/10" },
    break: { accent: BREAK, bg: "bg-destructive/[0.02]" },
    neutral: { accent: MUTED, bg: "bg-muted/10" },
  }[tone];

  const borderClass = {
    tl: "border-b sm:border-r border-border",
    tr: "border-b border-border",
    bl: "sm:border-r border-b sm:border-b-0 border-border",
    br: "",
  }[position];

  return (
    <div className={`p-5 ${styles.bg} ${borderClass}`}>
      <div className="font-mono text-[8px] tracking-[0.18em] uppercase font-bold mb-3" style={{ color: styles.accent }}>
        {title}
      </div>
      {items.length === 0 ? (
        <div className="font-mono text-[10px] text-muted-foreground italic">—</div>
      ) : (
        <div className="space-y-1.5">
          {items.map((item, i) => (
            <div key={i} className="font-mono text-[11px] text-foreground/70 leading-relaxed flex items-start gap-2">
              <span className="text-muted-foreground mt-px shrink-0">•</span>
              <span>{item}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ScenarioBlock({ title, color, items }: { title: string; color: string; items: string[] }) {
  return (
    <div className="px-5 py-4">
      <div className="font-mono text-[8px] tracking-[0.18em] uppercase font-bold mb-3" style={{ color }}>{title}</div>
      {items.map((item, i) => (
        <div key={i} className="font-mono text-[10px] text-muted-foreground mb-1.5 leading-relaxed">→ {item}</div>
      ))}
    </div>
  );
}
