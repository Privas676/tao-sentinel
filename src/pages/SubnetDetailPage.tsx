import { useParams, Link } from "react-router-dom";
import { useI18n } from "@/lib/i18n";
import { useSubnetScores, SPECIAL_SUBNETS, type UnifiedSubnetScore } from "@/hooks/use-subnet-scores";
import { useSubnetVerdicts, type SubnetVerdictData } from "@/hooks/use-subnet-verdict";
import { useStakeAnalytics, type SubnetRadarData } from "@/hooks/use-stake-analytics";
import { useLocalPortfolio } from "@/hooks/use-local-portfolio";
import { useMemo, useState } from "react";
import {
  opportunityColor, riskColor, stabilityColor, momentumColor,
} from "@/lib/gauge-engine";
import { actionColor, actionIcon } from "@/lib/strategy-engine";
import { confianceColor } from "@/lib/data-fusion";
import { healthColor, formatUsd } from "@/lib/subnet-health";
import { ActionBadge, StatusBadge, ConfidenceBar, SparklineMini } from "@/components/sentinel";

/* ═══════════════════════════════════════ */
/*   SUBNET DETAIL — Command Center        */
/* ═══════════════════════════════════════ */

/* ── Reusable building blocks ── */

function Section({ title, icon, children, accent }: { title: string; icon: string; children: React.ReactNode; accent?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card/50">
      <div className="flex items-center gap-2 px-5 py-3 border-b border-border">
        <span className="text-sm">{icon}</span>
        <h3 className="font-mono text-[10px] tracking-widest uppercase" style={{ color: accent || "hsl(var(--gold))" }}>
          {title}
        </h3>
      </div>
      <div className="px-5 py-4">{children}</div>
    </div>
  );
}

function MetricRow({ label, value, color, sub }: { label: string; value: string | number; color?: string; sub?: string }) {
  return (
    <div className="flex justify-between items-center py-1.5">
      <span className="text-muted-foreground/65 text-[11px]">{label}</span>
      <div className="flex items-center gap-2">
        <span className="font-mono text-[12px] font-medium" style={{ color: color || "hsl(var(--foreground))" }}>{value}</span>
        {sub && <span className="text-[9px] text-muted-foreground/40">{sub}</span>}
      </div>
    </div>
  );
}

function ScoreBar({ label, value, max = 100, color }: { label: string; value: number; max?: number; color?: string }) {
  const pct = Math.min(100, (value / max) * 100);
  const c = color || healthColor(value);
  return (
    <div className="flex items-center gap-2 py-1">
      <span className="text-muted-foreground/65 text-[10px] w-24 shrink-0">{label}</span>
      <div className="flex-1 h-1.5 rounded-full overflow-hidden bg-muted/30">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: c }} />
      </div>
      <span className="font-mono text-[10px] w-8 text-right" style={{ color: c }}>{Math.round(value)}</span>
    </div>
  );
}

function KPI({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div className="rounded-lg px-3 py-2.5 text-center bg-muted/30 border border-border">
      <div className="font-mono text-[7px] text-muted-foreground/50 tracking-widest uppercase mb-1">{label}</div>
      <div className="font-mono text-sm font-bold" style={{ color }}>{value}</div>
    </div>
  );
}

function ReasonList({ items, positive, fr }: { items: string[]; positive: boolean; fr: boolean }) {
  if (!items.length) return null;
  const color = positive ? "hsl(var(--signal-go))" : "hsl(var(--signal-break))";
  const icon = positive ? "+" : "−";
  return (
    <div className="space-y-1">
      {items.map((r, i) => (
        <div key={i} className="font-mono text-[11px] py-0.5" style={{ color: `color-mix(in srgb, ${color} 80%, transparent)` }}>
          {icon} {r}
        </div>
      ))}
    </div>
  );
}

function Sparkline({ data, width = 180, height = 40 }: { data: number[]; width?: number; height?: number }) {
  if (data.length < 2) return <span className="text-muted-foreground/20 text-[9px]">—</span>;
  const min = Math.min(...data), max = Math.max(...data);
  const range = max - min || 1;
  const last = data[data.length - 1], first = data[0];
  const trend = last - first;
  const color = trend > 0 ? "hsl(var(--signal-go))" : trend < 0 ? "hsl(var(--signal-break))" : "hsl(var(--muted-foreground))";
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - 2 - ((v - min) / range) * (height - 4);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  return (
    <svg width={width} height={height}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* ── Helpers ── */
function convictionLevel(score: UnifiedSubnetScore, verdict?: SubnetVerdictData): { level: "HIGH" | "MEDIUM" | "LOW"; score: number } {
  const s = verdict ? Math.max(verdict.entryScore, verdict.holdScore) : Math.abs(score.opp - score.risk) * (score.conf / 100);
  return { level: s >= 70 ? "HIGH" : s >= 40 ? "MEDIUM" : "LOW", score: Math.round(s) };
}

function urgencyLabel(score: UnifiedSubnetScore, fr: boolean): string {
  if (score.isOverridden) return fr ? "Immédiate — sortie forcée" : "Immediate — forced exit";
  if (score.depegProbability >= 50) return fr ? "Haute — risque depeg" : "High — depeg risk";
  if (score.action === "EXIT") return fr ? "Haute — signal de sortie" : "High — exit signal";
  if (score.action === "ENTER" && score.opp > 65) return fr ? "Haute — fenêtre d'entrée" : "High — entry window";
  return fr ? "Normale" : "Normal";
}

function horizonLabel(score: UnifiedSubnetScore, fr: boolean): string {
  if (score.action === "ENTER") return fr ? "Court à moyen terme" : "Short to medium term";
  if (score.action === "HOLD" || score.action === "STAKE") return fr ? "Moyen terme (swing)" : "Medium term (swing)";
  return fr ? "Court terme (sortie)" : "Short term (exit)";
}

function fitScore(score: UnifiedSubnetScore): number {
  let fit = 50;
  if (score.opp > 50) fit += 15;
  if (score.risk < 40) fit += 10;
  if (score.stability > 50) fit += 10;
  if (score.confianceScore > 60) fit += 10;
  if (score.isOverridden) fit -= 30;
  return Math.max(0, Math.min(100, fit));
}

/* ═══════════════════════════════════════ */
/*   MAIN PAGE                              */
/* ═══════════════════════════════════════ */
export default function SubnetDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { lang } = useI18n();
  const fr = lang === "fr";
  const netuid = parseInt(id || "0", 10);

  const { scores, sparklines } = useSubnetScores();
  const { verdicts } = useSubnetVerdicts();
  const { data: radarData } = useStakeAnalytics();
  const { isOwned, addPosition, removePosition } = useLocalPortfolio();
  const [justAction, setJustAction] = useState<string | null>(null);

  const s = scores.get(netuid);
  const verdict = verdicts.get(netuid);
  const spark = sparklines?.get(netuid) || [];
  const radar = useMemo(() => radarData?.find(r => r.netuid === netuid) || null, [radarData, netuid]);
  const inPortfolio = isOwned(netuid);
  const isSpecial = !!SPECIAL_SUBNETS[netuid];
  const conv = s ? convictionLevel(s, verdict) : { level: "LOW" as const, score: 0 };

  const flash = (msg: string) => { setJustAction(msg); setTimeout(() => setJustAction(null), 1500); };

  if (!s) {
    return (
      <div className="h-full w-full bg-background text-foreground p-6 flex flex-col items-center justify-center gap-4">
        <div className="animate-pulse font-mono text-muted-foreground/40 text-sm tracking-widest">
          {fr ? "Chargement du subnet..." : "Loading subnet..."}
        </div>
        <Link to="/subnets" className="font-mono text-[10px] text-muted-foreground/30 hover:text-muted-foreground/60">← Subnets</Link>
      </div>
    );
  }

  const pctChange = spark.length >= 2 && spark[0] > 0
    ? ((spark[spark.length - 1] - spark[0]) / spark[0]) * 100
    : null;

  const eco = radar?.economicContext;
  const dm = radar?.derivedMetrics;
  const pc = radar?.priceContext;
  const sn = radar?.snapshot;
  const rs = radar?.scores;
  const amm = radar?.ammMetrics;

  return (
    <div className="h-full w-full bg-background text-foreground overflow-auto pb-24">
      <div className="px-4 sm:px-6 py-4 max-w-[1200px] mx-auto space-y-5">

        {/* ── Breadcrumb ── */}
        <div className="flex items-center gap-2">
          <Link to="/subnets" className="font-mono text-[10px] tracking-wider text-muted-foreground/40 hover:text-muted-foreground/70 transition-colors">
            ← Subnets
          </Link>
          <span className="font-mono text-[10px] text-muted-foreground/20">/</span>
          <span className="font-mono text-[10px] text-muted-foreground/60">SN-{netuid}</span>
        </div>

        {/* ═══════════════════════════════════ */}
        {/*  1. HEADER                          */}
        {/* ═══════════════════════════════════ */}
        <div className="flex items-center gap-4 flex-wrap">
          <div className="w-12 h-12 rounded-xl flex items-center justify-center font-mono text-lg font-bold border border-border" style={{ background: "hsla(var(--gold), 0.06)", color: "hsl(var(--gold))" }}>
            {netuid}
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="font-mono text-base tracking-wider" style={{ color: "hsl(var(--gold))" }}>
              {s.name}
            </h1>
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              <span className="font-mono text-[9px] text-muted-foreground/50">SN-{netuid} · {s.assetType}</span>
              {isSpecial && <span className="font-mono text-[7px] px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/20">{SPECIAL_SUBNETS[netuid].label}</span>}
            </div>
          </div>
          <ActionBadge action={s.action === "ENTER" ? "RENTRE" : s.action === "EXIT" ? "SORS" : s.action === "STAKE" ? "RENFORCER" : "HOLD"} />
        </div>

        {/* Header KPIs */}
        <div className="grid grid-cols-4 sm:grid-cols-8 gap-2">
          <KPI label="CONVICTION" value={conv.level} color={conv.level === "HIGH" ? "hsl(var(--signal-go))" : conv.level === "MEDIUM" ? "hsl(var(--signal-go-spec))" : "hsl(var(--muted-foreground))"} />
          <KPI label="CONFIDENCE" value={`${s.confianceScore}%`} color={confianceColor(s.confianceScore)} />
          <KPI label="RISK" value={s.risk} color={riskColor(s.risk)} />
          <KPI label="STABILITY" value={s.stability} color={stabilityColor(s.stability)} />
          <KPI label="MOMENTUM" value={Math.round(s.momentumScore)} color={s.momentumScore >= 55 ? "hsl(var(--signal-go))" : s.momentumScore >= 35 ? "hsl(var(--signal-go-spec))" : "hsl(var(--signal-break))"} />
          <KPI label="OPP" value={s.opp} color={opportunityColor(s.opp)} />
          <KPI label="ASYM" value={s.asymmetry} color={s.asymmetry > 0 ? "hsl(var(--signal-go))" : "hsl(var(--signal-break))"} />
          <KPI label="DATA" value={`${s.confianceScore}%`} color={confianceColor(s.confianceScore)} />
        </div>

        {/* ═══════════════════════════════════ */}
        {/*  2. DECISION SUMMARY                */}
        {/* ═══════════════════════════════════ */}
        <Section icon="🎯" title={fr ? "Résumé Décisionnel" : "Decision Summary"}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <ActionBadge action={s.action === "ENTER" ? "RENTRE" : s.action === "EXIT" ? "SORS" : s.action === "STAKE" ? "RENFORCER" : "HOLD"} />
                <div>
                  <div className="font-mono text-[7px] text-muted-foreground/50 tracking-widest uppercase">CONVICTION</div>
                  <div className="font-mono text-sm font-bold" style={{ color: conv.level === "HIGH" ? "hsl(var(--signal-go))" : conv.level === "MEDIUM" ? "hsl(var(--signal-go-spec))" : "hsl(var(--muted-foreground))" }}>
                    {conv.level} ({conv.score})
                  </div>
                </div>
              </div>

              <MetricRow label={fr ? "Horizon" : "Horizon"} value={horizonLabel(s, fr)} />
              <MetricRow label={fr ? "Urgence" : "Urgency"} value={urgencyLabel(s, fr)} color={s.isOverridden || s.action === "EXIT" ? "hsl(var(--signal-break))" : undefined} />
              <MetricRow label={fr ? "Régime compatible" : "Regime fit"} value={s.systemStatus === "OK" ? (fr ? "Favorable" : "Favorable") : s.systemStatus === "SURVEILLANCE" ? (fr ? "Neutre" : "Neutral") : (fr ? "Défavorable" : "Unfavorable")} />
            </div>

            <div className="space-y-3">
              {/* Thesis */}
              {verdict?.positiveReasons && verdict.positiveReasons.length > 0 && (
                <div>
                  <div className="font-mono text-[7px] text-muted-foreground/50 tracking-widest uppercase mb-1.5">{fr ? "THÈSE" : "THESIS"}</div>
                  <ReasonList items={verdict.positiveReasons.slice(0, 3)} positive fr={fr} />
                </div>
              )}
              {/* Invalidation */}
              {verdict?.negativeReasons && verdict.negativeReasons.length > 0 && (
                <div>
                  <div className="font-mono text-[7px] text-muted-foreground/50 tracking-widest uppercase mb-1.5">INVALIDATION</div>
                  <ReasonList items={verdict.negativeReasons.slice(0, 3)} positive={false} fr={fr} />
                </div>
              )}
            </div>
          </div>
        </Section>

        {/* ═══════════════════════════════════ */}
        {/*  3. WHY / WHY NOT                   */}
        {/* ═══════════════════════════════════ */}
        <Section icon="⚖️" title={fr ? "Analyse Décisionnelle" : "Decision Analysis"}>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <WhyBlock
              title={fr ? "Pourquoi entrer" : "Why enter"}
              items={[
                s.opp > 55 ? (fr ? `Opportunité ${s.opp}/100` : `Opportunity ${s.opp}/100`) : null,
                s.momentumScore >= 55 ? (fr ? `Momentum haussier (${Math.round(s.momentumScore)})` : `Bullish momentum (${Math.round(s.momentumScore)})`) : null,
                s.asymmetry > 20 ? (fr ? `Asymétrie favorable (+${s.asymmetry})` : `Favorable asymmetry (+${s.asymmetry})`) : null,
                eco && eco.sentiment > 0.55 ? (fr ? "Pression acheteuse" : "Buying pressure") : null,
              ].filter(Boolean) as string[]}
              tone="go"
            />
            <WhyBlock
              title={fr ? "Pourquoi attendre" : "Why wait"}
              items={[
                s.risk > 40 && s.risk < 65 ? (fr ? `Risque modéré (${s.risk})` : `Moderate risk (${s.risk})`) : null,
                s.confianceScore < 60 ? (fr ? `Données incomplètes (${s.confianceScore}%)` : `Incomplete data (${s.confianceScore}%)`) : null,
                s.momentumScore < 40 ? (fr ? "Momentum faible" : "Weak momentum") : null,
                s.stability < 40 ? (fr ? "Structure instable" : "Unstable structure") : null,
              ].filter(Boolean) as string[]}
              tone="warn"
            />
            <WhyBlock
              title={fr ? "Ce qui doit s'améliorer" : "What needs to improve"}
              items={[
                s.risk > 50 ? (fr ? `Réduire le risque (${s.risk} → <40)` : `Reduce risk (${s.risk} → <40)`) : null,
                s.healthScores.liquidityHealth < 40 ? (fr ? "Liquidité insuffisante" : "Insufficient liquidity") : null,
                s.healthScores.activityHealth < 40 ? (fr ? "Activité réseau faible" : "Low network activity") : null,
                sn && sn.stakeConcentration > 50 ? (fr ? "Décentraliser le stake" : "Decentralize stake") : null,
              ].filter(Boolean) as string[]}
              tone="neutral"
            />
            <WhyBlock
              title={fr ? "Ce qui invalide" : "What invalidates"}
              items={[
                s.isOverridden ? (fr ? "Override actif — zone critique" : "Active override — critical zone") : null,
                s.depegProbability >= 40 ? `Depeg ${s.depegProbability}%` : null,
                s.delistCategory !== "NORMAL" ? (fr ? `Risque delist (${s.delistCategory})` : `Delist risk (${s.delistCategory})`) : null,
                s.risk > 75 ? (fr ? "Zone de danger extrême" : "Extreme danger zone") : null,
              ].filter(Boolean) as string[]}
              tone="break"
            />
          </div>
        </Section>

        {/* ═══════════════════════════════════ */}
        {/*  4. CONVICTION STACK                */}
        {/* ═══════════════════════════════════ */}
        <Section icon="📊" title="Conviction Stack">
          <div className="space-y-1.5 mb-4">
            <ScoreBar label="Flow" value={rs?.capitalMomentum ?? s.opp} color={healthColor(rs?.capitalMomentum ?? s.opp)} />
            <ScoreBar label={fr ? "Liquidité" : "Liquidity"} value={s.healthScores.liquidityHealth} />
            <ScoreBar label="Structure" value={s.stability} color={stabilityColor(s.stability)} />
            <ScoreBar label="Economics" value={rs?.healthIndex ?? 50} />
            <ScoreBar label="Smart Money" value={rs?.smartMoneyScore ?? 50} />
            <ScoreBar label={fr ? "Risque" : "Risk"} value={100 - s.risk} color={healthColor(100 - s.risk)} />
          </div>
          <div className="grid grid-cols-3 gap-2 pt-3 border-t border-border">
            <KPI label={fr ? "CONVICTION FINALE" : "FINAL CONVICTION"} value={conv.score} color={conv.level === "HIGH" ? "hsl(var(--signal-go))" : conv.level === "MEDIUM" ? "hsl(var(--signal-go-spec))" : "hsl(var(--muted-foreground))"} />
            <KPI label="CONFIDENCE" value={`${s.confianceScore}%`} color={confianceColor(s.confianceScore)} />
            <KPI label="REGIME FIT" value={s.systemStatus === "OK" ? "✓" : s.systemStatus === "SURVEILLANCE" ? "~" : "✕"} color={s.systemStatus === "OK" ? "hsl(var(--signal-go))" : s.systemStatus === "SURVEILLANCE" ? "hsl(var(--signal-go-spec))" : "hsl(var(--signal-break))"} />
          </div>
        </Section>

        {/* ═══════════════════════════════════ */}
        {/*  5-9. DETAIL GRID                   */}
        {/* ═══════════════════════════════════ */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

          {/* 5. Flow & Momentum */}
          <Section icon="📈" title={fr ? "Flow & Momentum" : "Flow & Momentum"}>
            <div className="space-y-1">
              <MetricRow label="Prix 7d" value={pctChange != null ? `${pctChange > 0 ? "+" : ""}${pctChange.toFixed(1)}%` : "—"} color={pctChange != null ? (pctChange > 0 ? "hsl(var(--signal-go))" : "hsl(var(--signal-break))") : undefined} />
              <MetricRow label="Momentum" value={Math.round(s.momentumScore)} color={s.momentumScore >= 55 ? "hsl(var(--signal-go))" : s.momentumScore >= 35 ? "hsl(var(--signal-go-spec))" : "hsl(var(--signal-break))"} />
              <MetricRow label="Capital Inflow" value={rs?.capitalMomentum != null ? `${rs.capitalMomentum}` : "—"} color={healthColor(rs?.capitalMomentum ?? 50)} />
              {eco && <MetricRow label="Buy/Sell" value={`${eco.buyersCount}/${eco.sellersCount}`} color={eco.sentiment > 0.55 ? "hsl(var(--signal-go))" : eco.sentiment < 0.45 ? "hsl(var(--signal-break))" : "hsl(var(--signal-go-spec))"} sub={`${(eco.sentiment * 100).toFixed(0)}%`} />}
              {rs && <MetricRow label="Smart Money Flow" value={rs.smartMoneyScore} color={healthColor(rs.smartMoneyScore)} />}
              <MetricRow label="Trend" value={s.momentumLabel} color={momentumColor(s.momentumLabel)} />
            </div>
            <div className="mt-3 flex justify-center">
              <Sparkline data={spark} />
            </div>
          </Section>

          {/* 6. Liquidity & Execution */}
          <Section icon="💧" title={fr ? "Liquidité & Exécution" : "Liquidity & Execution"}>
            <div className="space-y-1">
              {amm && (
                <>
                  <MetricRow label="Spread bid/ask" value={`${amm.spreadPct.toFixed(3)}%`} color={amm.spreadPct < 0.5 ? "hsl(var(--signal-go))" : amm.spreadPct < 2 ? "hsl(var(--signal-go-spec))" : "hsl(var(--signal-break))"} />
                  <MetricRow label="Slippage 1τ" value={`${amm.slippage1t.toFixed(2)}%`} />
                  <MetricRow label="Slippage 10τ" value={`${amm.slippage10t.toFixed(2)}%`} color={amm.slippage10t > 5 ? "hsl(var(--signal-break))" : undefined} />
                  <MetricRow label={fr ? "Profondeur" : "Depth"} value={`${amm.depthScore}`} color={healthColor(amm.depthScore)} />
                </>
              )}
              {eco && (
                <>
                  <MetricRow label="Pool Balance" value={`α${eco.alphaInPool.toFixed(0)} / τ${eco.taoInPool.toFixed(1)}`} />
                  <MetricRow label="Vol/MCap" value={`${(eco.volumeMarketcapRatio * 100).toFixed(2)}%`} />
                </>
              )}
              <ScoreBar label={fr ? "Score Liq." : "Liq. Score"} value={s.healthScores.liquidityHealth} />
            </div>
          </Section>

          {/* 7. Structure & Concentration */}
          <Section icon="🏗️" title={fr ? "Structure & Concentration" : "Structure & Concentration"}>
            <div className="space-y-1">
              {sn && (
                <>
                  <MetricRow label={fr ? "Validateurs" : "Validators"} value={sn.validatorsActive} />
                  <MetricRow label={fr ? "Mineurs actifs" : "Active miners"} value={sn.minersActive} sub={`/ ${sn.minersTotal}`} />
                  <MetricRow label="Concentration" value={`${(sn.stakeConcentration <= 1 ? sn.stakeConcentration * 100 : sn.stakeConcentration).toFixed(1)}%`} color={sn.stakeConcentration > 50 ? "hsl(var(--signal-break))" : sn.stakeConcentration > 30 ? "hsl(var(--signal-go-spec))" : "hsl(var(--signal-go))"} />
                </>
              )}
              {rs && (
                <>
                  <MetricRow label="Manipulation" value={rs.manipulationScore} color={healthColor(100 - rs.manipulationScore)} />
                  <MetricRow label="Bubble Risk" value={rs.bubbleScore} color={healthColor(100 - rs.bubbleScore)} />
                  <MetricRow label="Dump Risk" value={rs.dumpRisk} color={healthColor(100 - rs.dumpRisk)} />
                </>
              )}
              <ScoreBar label={fr ? "Stabilité" : "Stability"} value={s.stability} color={stabilityColor(s.stability)} />
            </div>
          </Section>

          {/* 8. Economics */}
          <Section icon="🏦" title="Economics">
            <div className="space-y-1">
              {eco && (
                <>
                  <MetricRow label={fr ? "Émissions/jour" : "Emissions/day"} value={`${eco.emissionsPerDay.toFixed(1)} α`} />
                  <MetricRow label={fr ? "Part émission" : "Emission share"} value={`${eco.emissionsPercent.toFixed(2)}%`} />
                  {dm && <MetricRow label="Burn Ratio" value={`${(dm.burnRatio * 100).toFixed(1)}%`} color={dm.burnRatio > 0.5 ? "hsl(var(--signal-go))" : dm.burnRatio > 0.2 ? "hsl(var(--signal-go-spec))" : "hsl(var(--signal-break))"} />}
                  <MetricRow label="Circ. Supply" value={`${eco.circulatingSupply.toFixed(0)} α`} />
                  {dm && <MetricRow label="UID Saturation" value={`${(dm.uidSaturation * 100).toFixed(0)}%`} color={dm.uidSaturation > 0.9 ? "hsl(var(--signal-break))" : dm.uidSaturation > 0.7 ? "hsl(var(--signal-go-spec))" : "hsl(var(--signal-go))"} />}
                  {dm && <MetricRow label={fr ? "Pression token" : "Token pressure"} value={dm.tradingPressure > 0 ? (fr ? "Achat" : "Buy") : (fr ? "Vente" : "Sell")} color={dm.tradingPressure > 0 ? "hsl(var(--signal-go))" : "hsl(var(--signal-break))"} />}
                </>
              )}
              <ScoreBar label={fr ? "Émission" : "Emission"} value={100 - s.healthScores.emissionPressure} />
              <ScoreBar label="Dilution" value={100 - s.healthScores.dilutionRisk} />
            </div>
          </Section>

          {/* 9. Smart Money & Narrative */}
          <Section icon="🐋" title={fr ? "Smart Money & Narrative" : "Smart Money & Narrative"}>
            <div className="space-y-1">
              {rs && (
                <>
                  <MetricRow label="Smart Money" value={rs.smartMoneyScore} color={healthColor(rs.smartMoneyScore)} />
                  <MetricRow label="Narrative" value={rs.narrativeScore} color={healthColor(rs.narrativeScore)} />
                </>
              )}
              {eco && (
                <>
                  <MetricRow label={fr ? "Acheteurs" : "Buyers"} value={eco.buyersCount} />
                  <MetricRow label={fr ? "Vendeurs" : "Sellers"} value={eco.sellersCount} />
                  <MetricRow label="Sentiment" value={`${(eco.sentiment * 100).toFixed(0)}%`} color={eco.sentiment > 0.55 ? "hsl(var(--signal-go))" : eco.sentiment < 0.45 ? "hsl(var(--signal-break))" : "hsl(var(--signal-go-spec))"} sub={eco.sentiment > 0.55 ? "Buy" : eco.sentiment < 0.45 ? "Sell" : "Neutral"} />
                </>
              )}
              {sn && <MetricRow label={fr ? "Holders" : "Holders"} value={sn.holdersCount} />}
              <ScoreBar label={fr ? "Activité" : "Activity"} value={s.healthScores.activityHealth} />
            </div>
          </Section>

          {/* 10. Portfolio Fit */}
          <Section icon="📁" title="Portfolio Fit">
            {(() => {
              const fit = fitScore(s);
              const role = s.action === "ENTER" ? (fr ? "Position de croissance" : "Growth position")
                : s.action === "HOLD" || s.action === "STAKE" ? (fr ? "Position de fond" : "Core position")
                : (fr ? "À céder" : "To exit");
              const weight = fit >= 70 ? "5-10%" : fit >= 50 ? "2-5%" : "<2%";
              return (
                <div className="space-y-1">
                  <MetricRow label="Fit Score" value={fit} color={healthColor(fit)} />
                  <MetricRow label={fr ? "Rôle conseillé" : "Suggested role"} value={role} />
                  <MetricRow label={fr ? "Poids recommandé" : "Recommended weight"} value={weight} />
                  <MetricRow label={fr ? "Redondance" : "Redundancy"} value={fr ? "Faible" : "Low"} color="hsl(var(--signal-go))" />
                  <MetricRow label="Diversification" value={fr ? "Compatible" : "Compatible"} color="hsl(var(--signal-go))" />
                  <MetricRow label={fr ? "Contribution risque" : "Risk contribution"} value={s.risk > 60 ? (fr ? "Élevée" : "High") : s.risk > 35 ? (fr ? "Modérée" : "Moderate") : (fr ? "Faible" : "Low")} color={riskColor(s.risk)} />
                </div>
              );
            })()}
          </Section>
        </div>

        {/* ═══════════════════════════════════ */}
        {/*  11. SCENARIOS                      */}
        {/* ═══════════════════════════════════ */}
        <Section icon="🔮" title={fr ? "Scénarios" : "Scenarios"}>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <ScenarioCard
              title="Bull Case"
              color="hsl(var(--signal-go))"
              items={[
                s.opp > 50 ? (fr ? `Opportunité se confirme (${s.opp})` : `Opportunity confirms (${s.opp})`) : (fr ? "Momentum s'accélère" : "Momentum accelerates"),
                eco && eco.sentiment > 0.5 ? (fr ? "Pression d'achat soutenue" : "Sustained buy pressure") : (fr ? "Adoption croissante" : "Growing adoption"),
                fr ? "Breakout prix + volume" : "Price + volume breakout",
              ]}
            />
            <ScenarioCard
              title="Base Case"
              color="hsl(var(--signal-go-spec))"
              items={[
                fr ? "Consolidation latérale" : "Sideways consolidation",
                fr ? "Volumes stables" : "Stable volumes",
                fr ? "Pas de catalyseur" : "No catalyst",
              ]}
            />
            <ScenarioCard
              title="Bear Case"
              color="hsl(var(--signal-break))"
              items={[
                s.risk > 40 ? (fr ? `Risque matérialise (${s.risk})` : `Risk materializes (${s.risk})`) : (fr ? "Perte de momentum" : "Momentum loss"),
                s.depegProbability > 20 ? `Depeg → ${s.depegProbability}%` : (fr ? "Sortie de capital" : "Capital outflow"),
                fr ? "Liquidité s'assèche" : "Liquidity dries up",
              ]}
            />
          </div>
        </Section>

        {/* External link */}
        <div className="flex justify-end">
          <a href={`https://taostats.io/subnets/${netuid}`} target="_blank" rel="noopener noreferrer"
            className="font-mono text-[10px] tracking-wider text-muted-foreground/30 hover:text-muted-foreground/60 transition-colors">
            {fr ? "Voir sur Taostats →" : "View on Taostats →"}
          </a>
        </div>
      </div>

      {/* ═══════════════════════════════════ */}
      {/*  12. STICKY FOOTER                  */}
      {/* ═══════════════════════════════════ */}
      <div className="fixed bottom-0 left-0 right-0 z-50 border-t border-border bg-background/95 backdrop-blur-md">
        <div className="max-w-[1200px] mx-auto px-4 sm:px-6 py-3 flex items-center gap-3 flex-wrap">
          {/* Action */}
          <ActionBadge action={s.action === "ENTER" ? "RENTRE" : s.action === "EXIT" ? "SORS" : s.action === "STAKE" ? "RENFORCER" : "HOLD"} size="sm" />

          {/* Recommended size */}
          <span className="font-mono text-[9px] text-muted-foreground/65">
            {fr ? "Taille :" : "Size:"} {fitScore(s) >= 70 ? "5-10%" : fitScore(s) >= 50 ? "2-5%" : "<2%"}
          </span>

          <div className="flex-1" />

          {/* Flash feedback */}
          {justAction && (
            <span className="font-mono text-[9px] text-primary animate-pulse">{justAction}</span>
          )}

          {/* Add to watchlist */}
          <button
            onClick={() => { if (!inPortfolio) { addPosition(netuid, 0, s.alphaPrice); flash("✓ Ajouté"); } }}
            className="font-mono text-[9px] tracking-wider px-3 py-1.5 rounded-lg border border-border text-muted-foreground/70 hover:text-foreground transition-colors"
            disabled={inPortfolio}
          >
            {inPortfolio ? "★ Portfolio" : "+ Watchlist"}
          </button>

          {/* Portfolio toggle */}
          <button
            onClick={() => {
              if (inPortfolio) { removePosition(netuid); flash("✓ Retiré"); }
              else { addPosition(netuid, 0, s.alphaPrice); flash("✓ Ajouté"); }
            }}
            className="font-mono text-[9px] tracking-wider px-3 py-1.5 rounded-lg transition-all"
            style={{
              background: inPortfolio ? "hsla(var(--gold), 0.08)" : "hsla(var(--signal-go), 0.06)",
              color: inPortfolio ? "hsl(var(--gold))" : "hsl(var(--signal-go))",
              border: `1px solid ${inPortfolio ? "hsla(var(--gold), 0.15)" : "hsla(var(--signal-go), 0.15)"}`,
            }}
          >
            {inPortfolio ? (fr ? "Retirer" : "Remove") : (fr ? "Ajouter" : "Add to portfolio")}
          </button>

          {/* Alert CTA */}
          <Link
            to="/alerts"
            className="font-mono text-[9px] tracking-wider px-3 py-1.5 rounded-lg border border-border text-muted-foreground/70 hover:text-foreground transition-colors"
          >
            🔔 {fr ? "Alerte" : "Alert"}
          </Link>
        </div>
      </div>
    </div>
  );
}

/* ── Sub-components ── */

function WhyBlock({ title, items, tone }: { title: string; items: string[]; tone: "go" | "warn" | "break" | "neutral" }) {
  const colors = {
    go: { bg: "bg-primary/[0.03]", border: "border-primary/10", text: "hsl(var(--signal-go))" },
    warn: { bg: "bg-yellow-500/[0.03]", border: "border-yellow-500/10", text: "hsl(var(--signal-go-spec))" },
    break: { bg: "bg-destructive/[0.03]", border: "border-destructive/10", text: "hsl(var(--signal-break))" },
    neutral: { bg: "bg-muted/20", border: "border-border", text: "hsl(var(--muted-foreground))" },
  }[tone];
  return (
    <div className={`rounded-lg p-3 ${colors.bg} border ${colors.border}`}>
      <div className="font-mono text-[7px] tracking-widest uppercase mb-2" style={{ color: colors.text }}>
        {title}
      </div>
      {items.length === 0 ? (
        <div className="font-mono text-[10px] text-muted-foreground/30">—</div>
      ) : (
        items.map((item, i) => (
          <div key={i} className="font-mono text-[10px] text-foreground/70 mb-1">• {item}</div>
        ))
      )}
    </div>
  );
}

function ScenarioCard({ title, color, items }: { title: string; color: string; items: string[] }) {
  return (
    <div className="rounded-lg p-3 bg-muted/20 border border-border">
      <div className="font-mono text-[8px] tracking-widest uppercase mb-2 font-bold" style={{ color }}>{title}</div>
      {items.map((item, i) => (
        <div key={i} className="font-mono text-[10px] text-foreground/70 mb-1">→ {item}</div>
      ))}
    </div>
  );
}
