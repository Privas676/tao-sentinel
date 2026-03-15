import { useParams, Link, useNavigate } from "react-router-dom";
import { useI18n } from "@/lib/i18n";
import { useSubnetScores, SPECIAL_SUBNETS, type UnifiedSubnetScore } from "@/hooks/use-subnet-scores";
import { useCanonicalSubnets } from "@/hooks/use-canonical-subnets";
import { RawFactsSection } from "@/components/subnet/ProofSections";
import type { SubnetDecision } from "@/hooks/use-subnet-decisions";
import { useStakeAnalytics } from "@/hooks/use-stake-analytics";
import { useLocalPortfolio } from "@/hooks/use-local-portfolio";
import { useMemo, useState, useEffect, useCallback } from "react";
import { opportunityColor, riskColor, stabilityColor } from "@/lib/gauge-engine";
import { isExitAction, finalActionColor, finalActionIcon, finalActionLabel } from "@/lib/subnet-decision";
import { confianceColor } from "@/lib/data-fusion";
import { ActionBadge } from "@/components/sentinel";
import { SectionCard, SectionTitle, KPIChip, Metric, BarScore, GOLD, GO, WARN, BREAK, MUTED } from "@/components/sentinel/Atoms";

/* ═══════════════════════════════════════════════════════ */
/*   SUBNET DETAIL — Minimal, Decision-First               */
/*   4 blocks: Header, Pourquoi, Données, Audit            */
/*   RULE: All data from canonical SubnetDecision           */
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

export default function SubnetDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { lang } = useI18n();
  const fr = lang === "fr";
  const netuid = parseInt(id || "0", 10);

  const goBack = useCallback(() => {
    if (window.history.length > 2) navigate(-1);
    else navigate("/subnets");
  }, [navigate]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); goBack(); } };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [goBack]);

  const { scores, sparklines } = useSubnetScores();
  const { decisions } = useCanonicalSubnets();
  const { data: radarData } = useStakeAnalytics();
  const { isOwned, addPosition, removePosition } = useLocalPortfolio();
  const [flash, setFlash] = useState<string | null>(null);
  const [showAudit, setShowAudit] = useState(false);

  const s = scores.get(netuid);
  const decision = decisions.get(netuid);
  const spark = sparklines?.get(netuid) || [];
  const radar = useMemo(() => radarData?.find(r => r.netuid === netuid) || null, [radarData, netuid]);
  const inPortfolio = isOwned(netuid);
  const isSystem = !!SPECIAL_SUBNETS[netuid]?.isSystem;

  const doFlash = (msg: string) => { setFlash(msg); setTimeout(() => setFlash(null), 1500); };

  if (!s || !decision) {
    return (
      <div className="h-full w-full bg-background text-foreground p-6 flex flex-col items-center justify-center gap-4">
        <div className="animate-pulse font-mono text-muted-foreground text-sm tracking-widest">
          {fr ? "Chargement..." : "Loading..."}
        </div>
        <Link to="/subnets" className="font-mono text-[10px] text-muted-foreground hover:text-foreground transition-colors">← Subnets</Link>
      </div>
    );
  }

  const fa = decision.finalAction;
  const faColor = finalActionColor(fa);
  const faIcn = finalActionIcon(fa);
  const faLbl = finalActionLabel(fa, fr);
  const isExit = isExitAction(fa);
  const confLabel = decision.confidence >= 70 ? (fr ? "Élevée" : "High") : decision.confidence >= 45 ? (fr ? "Moyenne" : "Medium") : (fr ? "Faible" : "Low");
  const confColor = decision.confidence >= 70 ? GO : decision.confidence >= 45 ? WARN : BREAK;

  // Build concise reasons (max 4)
  const reasons: string[] = [];
  if (decision.primaryReason && decision.primaryReason !== "—") reasons.push(decision.primaryReason);
  for (const t of decision.thesis.slice(0, 2)) {
    if (!reasons.includes(t)) reasons.push(t);
  }
  for (const r of decision.blockReasons.slice(0, 2)) {
    if (!reasons.includes(r)) reasons.push(r);
  }
  const displayReasons = reasons.slice(0, 4);

  const eco = radar?.economicContext;
  const amm = radar?.ammMetrics;
  const sn = radar?.snapshot;
  const pctChange = spark.length >= 2 && spark[0] > 0 ? ((spark[spark.length - 1] - spark[0]) / spark[0]) * 100 : null;

  return (
    <div className="h-full w-full bg-background text-foreground overflow-auto pb-24">
      <div className="px-4 sm:px-6 py-6 max-w-[900px] mx-auto space-y-5">

        {/* ── Navigation ── */}
        <nav className="flex items-center gap-3">
          <button onClick={goBack} className="inline-flex items-center gap-1.5 font-mono text-[10px] tracking-wider text-muted-foreground hover:text-foreground transition-colors px-2.5 py-1.5 rounded-md border border-border hover:border-foreground/20">
            ← {fr ? "Retour" : "Back"}
          </button>
          <span className="text-muted-foreground text-[10px]">/</span>
          <span className="font-mono text-[10px] text-muted-foreground">SN-{netuid}</span>
          <span className="ml-auto font-mono text-[8px] text-muted-foreground/50 hidden sm:block">ESC</span>
        </nav>

        {/* ══════════════════════════════════════════ */}
        {/*   BLOC 1: HEADER — Identity + Action        */}
        {/* ══════════════════════════════════════════ */}
        <SectionCard>
          <div className="px-5 sm:px-7 py-6">
            {/* Identity row */}
            <div className="flex items-start gap-4 mb-5">
              <div className="w-14 h-14 rounded-xl flex items-center justify-center font-mono text-xl font-bold border border-border bg-muted/15 text-[hsl(var(--gold))] shrink-0">
                {netuid}
              </div>
              <div className="flex-1 min-w-0">
                <h1 className="font-mono text-lg sm:text-xl tracking-wide text-[hsl(var(--gold))] leading-tight">{s.name}</h1>
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  <span className="font-mono text-[9px] text-muted-foreground">SN-{netuid}</span>
                  {isSystem && (
                    <span className="font-mono text-[7px] px-1.5 py-0.5 rounded font-bold"
                      style={{ background: "hsla(var(--signal-system), 0.08)", color: "hsl(var(--signal-system))", border: "1px solid hsla(var(--signal-system), 0.2)" }}>
                      🔷 {fr ? "Système" : "System"}
                    </span>
                  )}
                </div>
              </div>
              <ActionBadge action={decision.badgeAction} />
            </div>

            {/* Core metrics — 4 pills */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <KPIChip label={fr ? "CONFIANCE" : "CONFIDENCE"} value={confLabel} color={confColor} />
              <KPIChip label={fr ? "RISQUE" : "RISK"} value={s.risk} color={riskColor(s.risk)} />
              <KPIChip label="MOMENTUM" value={Math.round(s.momentumScore)} color={s.momentumScore >= 55 ? GO : s.momentumScore >= 35 ? WARN : BREAK} />
              <KPIChip label={fr ? "STABILITÉ" : "STABILITY"} value={Math.round(s.stability)} color={stabilityColor(s.stability)} />
            </div>
          </div>
        </SectionCard>

        {/* ══════════════════════════════════════════ */}
        {/*   BLOC 2: POURQUOI — Reasons (max 4)        */}
        {/* ══════════════════════════════════════════ */}
        <SectionCard>
          <div className="px-5 py-5">
            <div className="flex items-center gap-2.5 mb-4">
              <span className="text-base">{faIcn}</span>
              <span className="font-mono text-sm font-bold tracking-wider" style={{ color: faColor }}>
                {faLbl}
              </span>
              {decision.isBlocked && (
                <span className="font-mono text-[8px] px-2 py-0.5 rounded" style={{ background: "hsla(4,80%,50%,0.06)", color: BREAK, border: "1px solid hsla(4,80%,50%,0.12)" }}>
                  {fr ? "BLOQUÉ" : "BLOCKED"}
                </span>
              )}
            </div>

            {displayReasons.length > 0 ? (
              <div className="space-y-2">
                {displayReasons.map((r, i) => (
                  <div key={i} className="flex items-start gap-2.5">
                    <span className="font-mono text-[10px] text-muted-foreground mt-0.5 shrink-0">{i + 1}.</span>
                    <span className="font-mono text-[11px] text-foreground/80 leading-relaxed">{r}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="font-mono text-[11px] text-muted-foreground italic">{fr ? "Aucune raison spécifique" : "No specific reason"}</div>
            )}

            {/* Conflict explanation — only if signal contradicts action */}
            {decision.conflictExplanation && (
              <div className="mt-3 rounded-lg px-4 py-2.5 border border-border bg-accent/10">
                <div className="font-mono text-[10px] text-foreground/65 leading-relaxed">{decision.conflictExplanation}</div>
              </div>
            )}
          </div>
        </SectionCard>

        {/* ══════════════════════════════════════════ */}
        {/*   BLOC 3: DONNÉES CLÉS                      */}
        {/* ══════════════════════════════════════════ */}
        <SectionCard>
          <SectionTitle icon="📊" title={fr ? "Données clés" : "Key Data"} />
          <div className="px-5 py-4 space-y-3">
            {/* Scores bar */}
            <div className="space-y-1">
              <BarScore label={fr ? "Opportunité" : "Opportunity"} value={s.opp} />
              <BarScore label={fr ? "Risque" : "Risk"} value={s.risk} />
              <BarScore label={fr ? "Liquidité" : "Liquidity"} value={s.healthScores.liquidityHealth} />
              <BarScore label="Structure" value={s.stability} color={stabilityColor(s.stability)} />
            </div>

            {/* Key metrics grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-1 pt-3 border-t border-border">
              <Metric label={fr ? "Asymétrie" : "Asymmetry"} value={s.asymmetry > 0 ? `+${s.asymmetry}` : `${s.asymmetry}`} color={s.asymmetry > 0 ? GO : BREAK} />
              <Metric label={fr ? "Confiance données" : "Data confidence"} value={`${s.confianceScore}%`} color={confianceColor(s.confianceScore)} />
              <Metric label={fr ? "Conviction" : "Conviction"} value={decision.conviction} color={decision.conviction === "HIGH" ? GO : decision.conviction === "MEDIUM" ? WARN : MUTED} />
              <Metric label={fr ? "Statut externe" : "External status"} value={decision.taoFluteStatus?.taoflute_match ? (decision.taoFluteStatus.taoflute_severity === "priority" ? `P${decision.taoFluteStatus.taoflute_priority_rank}` : "WATCH") : "NONE"} color={decision.taoFluteStatus?.taoflute_severity === "priority" ? BREAK : decision.taoFluteStatus?.taoflute_severity === "watch" ? WARN : MUTED} />
            </div>

            {/* Sparkline */}
            {spark.length > 1 && (
              <div className="flex items-center gap-4 pt-3 border-t border-border">
                <span className="font-mono text-[8px] text-muted-foreground tracking-widest">7D</span>
                <DetailSparkline data={spark} />
                {pctChange != null && (
                  <span className="font-mono text-[11px] font-bold" style={{ color: pctChange > 0 ? GO : BREAK }}>
                    {pctChange > 0 ? "+" : ""}{pctChange.toFixed(1)}%
                  </span>
                )}
              </div>
            )}

            {/* TaoFlute — only if confirmed match */}
            {decision.taoFluteStatus?.taoflute_match && (
              <div className="rounded-lg px-4 py-2.5 border border-destructive/15 bg-destructive/[0.03]">
                <div className="flex items-center gap-2">
                  {decision.taoFluteStatus.taoflute_severity === "priority" ? (
                    <span className="font-mono text-[10px] font-black" style={{ color: BREAK }}>
                      ⛔ P{decision.taoFluteStatus.taoflute_priority_rank} — {fr ? "PRIORITÉ EXTERNE" : "EXTERNAL PRIORITY"}
                    </span>
                  ) : (
                    <span className="font-mono text-[10px] font-bold" style={{ color: WARN }}>
                      ⚠ WATCH — {fr ? "SURVEILLANCE EXTERNE" : "EXTERNAL WATCH"}
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Blocages actifs */}
            {decision.blockReasons.length > 0 && (
              <div className="rounded-lg px-4 py-2.5 border border-border bg-muted/10">
                <div className="font-mono text-[7px] tracking-widest uppercase text-muted-foreground mb-1.5">{fr ? "GARDE-FOUS ACTIFS" : "ACTIVE GUARDS"}</div>
                {decision.blockReasons.slice(0, 3).map((r, i) => (
                  <div key={i} className="font-mono text-[10px] text-foreground/60 flex items-center gap-2">
                    <span className="text-[8px]">⛔</span> {r}
                  </div>
                ))}
              </div>
            )}
          </div>
        </SectionCard>

        {/* ══════════════════════════════════════════ */}
        {/*   BLOC 4: AUDIT — Compact, repliable         */}
        {/* ══════════════════════════════════════════ */}
        <div>
          <button
            onClick={() => setShowAudit(!showAudit)}
            className="w-full flex items-center justify-between px-5 py-3 rounded-xl border border-border bg-card transition-all hover:bg-muted/10"
          >
            <div className="flex items-center gap-2.5">
              <span className="text-sm opacity-60">📋</span>
              <span className="font-mono text-[10px] tracking-[0.18em] uppercase font-bold" style={{ color: GOLD }}>
                {fr ? "Audit technique" : "Technical Audit"}
              </span>
            </div>
            <span className={`font-mono text-[10px] text-muted-foreground transition-transform ${showAudit ? "rotate-180" : ""}`}>▼</span>
          </button>

          {showAudit && (
            <div className="mt-3 space-y-4">
              {/* Raw signal vs final action */}
              <SectionCard>
                <div className="px-5 py-4">
                  <div className="font-mono text-[7px] tracking-widest uppercase text-muted-foreground mb-3">{fr ? "TRANSPARENCE MOTEUR" : "ENGINE TRANSPARENCY"}</div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="rounded-lg px-3 py-2 bg-muted/20 border border-border text-center">
                      <div className="font-mono text-[7px] tracking-widest uppercase text-muted-foreground mb-1">{fr ? "SIGNAL BRUT" : "RAW SIGNAL"}</div>
                      <div className="font-mono text-[11px] font-bold" style={{
                        color: decision.rawSignal === "opportunity" ? GO : decision.rawSignal === "exit" ? BREAK : WARN
                      }}>
                        {decision.rawSignal === "opportunity" ? (fr ? "Opportunité" : "Opportunity") : decision.rawSignal === "exit" ? (fr ? "Sortie" : "Exit") : (fr ? "Neutre" : "Neutral")}
                      </div>
                    </div>
                    <div className="rounded-lg px-3 py-2 bg-muted/20 border border-border text-center">
                      <div className="font-mono text-[7px] tracking-widest uppercase text-muted-foreground mb-1">{fr ? "ACTION FINALE" : "FINAL ACTION"}</div>
                      <div className="font-mono text-[11px] font-bold" style={{ color: faColor }}>{fa}</div>
                    </div>
                    <div className="rounded-lg px-3 py-2 bg-muted/20 border border-border text-center">
                      <div className="font-mono text-[7px] tracking-widest uppercase text-muted-foreground mb-1">{fr ? "MOTEUR" : "ENGINE"}</div>
                      <div className="font-mono text-[11px] font-bold" style={{ color: decision.verdictV3 ? "hsl(210,80%,55%)" : MUTED }}>
                        {decision.verdictV3 ? "v3" : "v1"}
                      </div>
                    </div>
                    <div className="rounded-lg px-3 py-2 bg-muted/20 border border-border text-center">
                      <div className="font-mono text-[7px] tracking-widest uppercase text-muted-foreground mb-1">{fr ? "CONCORDANCE" : "CONCORDANCE"}</div>
                      <div className="font-mono text-[11px] font-bold" style={{
                        color: s.concordance?.grade === "A" ? GO : s.concordance?.grade === "B" ? "hsl(210,80%,55%)" : s.concordance?.grade === "C" ? WARN : BREAK
                      }}>
                        {s.concordance?.grade ?? "—"}
                      </div>
                    </div>
                  </div>
                </div>
              </SectionCard>

              {/* Advanced metrics */}
              <SectionCard>
                <div className="px-5 py-4 space-y-0.5">
                  <Metric label="OPP" value={s.opp} color={opportunityColor(s.opp)} />
                  <Metric label="RISK" value={s.risk} color={riskColor(s.risk)} />
                  <Metric label="Momentum" value={`${Math.round(s.momentumScore)} (${s.momentumLabel})`} />
                  <Metric label="Depeg" value={s.depegProbability > 0 ? `${s.depegProbability}%` : "—"} color={s.depegProbability >= 30 ? BREAK : undefined} />
                  <Metric label="Delist" value={`${s.delistScore} (${s.delistCategory})`} color={s.delistCategory !== "NORMAL" ? BREAK : undefined} />
                  <Metric label="Override" value={s.isOverridden ? (fr ? "Oui" : "Yes") : (fr ? "Non" : "No")} color={s.isOverridden ? BREAK : GO} />
                  {amm && <Metric label="Spread" value={`${(amm.spreadBps / 100).toFixed(3)}%`} />}
                  {amm && <Metric label="Slippage 10τ" value={`${(amm.slippageBps10Tao / 100).toFixed(2)}%`} />}
                  {sn && <Metric label={fr ? "Mineurs" : "Miners"} value={`${sn.minersActive} / ${sn.minersTotal}`} />}
                  {sn && <Metric label="Concentration" value={`${(sn.stakeConcentration <= 1 ? sn.stakeConcentration * 100 : sn.stakeConcentration).toFixed(1)}%`} />}
                  {eco && <Metric label="Pool" value={`α${eco.alphaInPool.toFixed(0)} / τ${eco.taoInPool.toFixed(1)}`} />}
                </div>
              </SectionCard>
            </div>
          )}
        </div>

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
        <div className="max-w-[900px] mx-auto px-4 sm:px-6 py-2.5 flex items-center gap-2.5">
          <ActionBadge action={decision.badgeAction} size="sm" />
          <span className="font-mono text-[9px] text-muted-foreground hidden sm:inline">{faLbl}</span>
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
        </div>
      </div>
    </div>
  );
}
