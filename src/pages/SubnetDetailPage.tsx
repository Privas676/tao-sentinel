import { useParams, Link } from "react-router-dom";
import { useI18n } from "@/lib/i18n";
import { useSubnetScores, SPECIAL_SUBNETS } from "@/hooks/use-subnet-scores";
import { useSubnetVerdicts } from "@/hooks/use-subnet-verdict";
import { useStakeAnalytics } from "@/hooks/use-stake-analytics";
import { useLocalPortfolio } from "@/hooks/use-local-portfolio";
import { useMemo, useState } from "react";
import {
  verdictColor, verdictBg, verdictBorder, verdictIcon,
} from "@/components/VerdictBadge";
import {
  momentumColor,
  opportunityColor, riskColor,
  stabilityColor,
} from "@/lib/gauge-engine";
import {
  actionColor, actionBg, actionBorder, actionIcon,
} from "@/lib/strategy-engine";
import { systemStatusColor, systemStatusLabel } from "@/lib/risk-override";
import { confianceColor } from "@/lib/data-fusion";
import { healthColor, formatUsd } from "@/lib/subnet-health";

/* ═══════════════════════════════════════ */
/*   SUBNET DETAIL — /subnets/:id          */
/*   Vue complète avec vraies données      */
/* ═══════════════════════════════════════ */

/* ── Section wrapper ── */
function Section({ title, icon, children }: { title: string; icon: string; children: React.ReactNode }) {
  return (
    <div
      className="rounded-xl p-5"
      style={{
        background: "linear-gradient(135deg, hsla(0,0%,100%,0.02) 0%, hsla(0,0%,100%,0.005) 100%)",
        border: "1px solid hsla(0,0%,100%,0.06)",
      }}
    >
      <div className="flex items-center gap-2 mb-4">
        <span className="text-sm">{icon}</span>
        <h3 className="font-mono text-[11px] tracking-widest uppercase" style={{ color: "hsl(var(--gold))" }}>
          {title}
        </h3>
      </div>
      {children}
    </div>
  );
}

/* ── Metric row ── */
function Metric({ label, value, color, sub }: { label: string; value: string | number; color?: string; sub?: string }) {
  return (
    <div className="flex justify-between items-center py-1.5">
      <span className="text-muted-foreground/50 text-[11px]">{label}</span>
      <div className="flex items-center gap-2">
        <span className="font-mono text-[12px] font-medium" style={{ color: color || "hsl(var(--foreground))" }}>{value}</span>
        {sub && <span className="text-[9px] text-muted-foreground/40">{sub}</span>}
      </div>
    </div>
  );
}

/* ── Score bar ── */
function ScoreBar({ label, value, max = 100, color }: { label: string; value: number; max?: number; color?: string }) {
  const pct = Math.min(100, (value / max) * 100);
  const c = color || healthColor(value);
  return (
    <div className="flex items-center gap-2 py-1">
      <span className="text-muted-foreground/50 text-[10px] w-20 shrink-0">{label}</span>
      <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: "hsla(0,0%,100%,0.05)" }}>
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: c }} />
      </div>
      <span className="font-mono text-[10px] w-8 text-right" style={{ color: c }}>{Math.round(value)}</span>
    </div>
  );
}

/* ── Mini sparkline ── */
function Sparkline({ data, width = 120, height = 32 }: { data: number[]; width?: number; height?: number }) {
  if (data.length < 2) return <span className="text-muted-foreground/20 text-[9px]">—</span>;
  const min = Math.min(...data), max = Math.max(...data);
  const range = max - min || 1;
  const last = data[data.length - 1], first = data[0];
  const trend = last - first;
  const color = trend > 0 ? "rgba(76,175,80,0.8)" : trend < 0 ? "rgba(229,57,53,0.8)" : "rgba(255,255,255,0.3)";
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

export default function SubnetDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { lang } = useI18n();
  const fr = lang === "fr";
  const netuid = parseInt(id || "0", 10);

  const { scores, sparklines } = useSubnetScores();
  const { verdicts } = useSubnetVerdicts();
  const { data: radarData } = useStakeAnalytics();
  const { isOwned, addPosition, removePosition } = useLocalPortfolio();
  const [justToggled, setJustToggled] = useState(false);

  const inPortfolio = isOwned(netuid);

  const score = scores.get(netuid);
  const verdict = verdicts.get(netuid);
  const spark = sparklines?.get(netuid) || [];

  const radar = useMemo(() => {
    if (!radarData) return null;
    return radarData.find(r => r.netuid === netuid) || null;
  }, [radarData, netuid]);

  const isSpecial = !!SPECIAL_SUBNETS[netuid];

  const handlePortfolioToggle = () => {
    if (inPortfolio) {
      removePosition(netuid);
    } else {
      addPosition(netuid, 0, score?.alphaPrice);
    }
    setJustToggled(true);
    setTimeout(() => setJustToggled(false), 1200);
  };

  if (!score) {
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

  return (
    <div className="h-full w-full bg-background text-foreground p-4 sm:p-6 overflow-auto">
      {/* ── Breadcrumb ── */}
      <div className="flex items-center gap-2 mb-5">
        <Link to="/subnets" className="font-mono text-[10px] tracking-wider text-muted-foreground/40 hover:text-muted-foreground/70 transition-colors">
          ← Subnets
        </Link>
        <span className="font-mono text-[10px] text-muted-foreground/20">/</span>
        <span className="font-mono text-[10px] text-muted-foreground/60">#{netuid}</span>
      </div>

      {/* ── Header ── */}
      <div className="flex items-center gap-4 mb-6 flex-wrap">
        <div
          className="w-12 h-12 rounded-xl flex items-center justify-center font-mono text-lg font-bold"
          style={{
            background: "hsla(var(--gold), 0.08)",
            color: "hsl(var(--gold))",
            border: "1px solid hsla(var(--gold), 0.15)",
          }}
        >
          {netuid}
        </div>
        <div>
          <h2 className="font-mono text-sm tracking-wider" style={{ color: "hsl(var(--gold))" }}>
            {score.name}
          </h2>
          <span className="font-mono text-[9px] text-muted-foreground/40">
            SN-{netuid} · {score.assetType}
            {isSpecial && ` · ${SPECIAL_SUBNETS[netuid].label}`}
          </span>
        </div>

        {/* Verdict badge */}
        {verdict && (
          <div className="ml-auto flex items-center gap-3">
            <span
              className="font-mono text-[11px] font-bold px-4 py-1.5 rounded-full tracking-wider"
              style={{
                background: verdictBg(verdict.verdict),
                color: verdictColor(verdict.verdict),
                border: `1px solid ${verdictBorder(verdict.verdict)}`,
              }}
            >
              {verdictIcon(verdict.verdict)} {verdict.verdict}
            </span>
            <span className="font-mono text-[9px] text-muted-foreground/40">
              {verdict.confidence}
            </span>
          </div>
        )}
      </div>

      {/* ── Top-level KPIs ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-3 mb-6">
        {[
          { label: "OPP", value: score.opp, color: opportunityColor(score.opp) },
          { label: "RISK", value: score.risk, color: riskColor(score.risk) },
          { label: "AS", value: score.asymmetry, color: score.asymmetry > 0 ? "rgba(76,175,80,0.8)" : "rgba(229,57,53,0.8)" },
          { label: fr ? "Stabilité" : "Stability", value: score.stability, color: stabilityColor(score.stability) },
          { label: "Momentum", value: score.momentumLabel, color: momentumColor(score.momentumLabel) },
          { label: "Data", value: `${score.confianceScore}%`, color: confianceColor(score.confianceScore) },
        ].map((kpi) => (
          <div
            key={kpi.label}
            className="rounded-lg p-3 text-center"
            style={{ background: "hsla(0,0%,100%,0.02)", border: "1px solid hsla(0,0%,100%,0.05)" }}
          >
            <div className="font-mono text-[8px] tracking-widest text-muted-foreground/40 mb-1">{kpi.label}</div>
            <div className="font-mono text-lg font-bold" style={{ color: kpi.color }}>{kpi.value}</div>
          </div>
        ))}
      </div>

      {/* ── Detail Grid ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

        {/* ── Prix & Performance ── */}
        <Section icon="📈" title={fr ? "Prix & Performance" : "Price & Performance"}>
          <div className="space-y-1">
            <Metric label={fr ? "Prix Alpha" : "Alpha Price"} value={`${score.alphaPrice?.toFixed(5) || "—"} τ`} />
            <Metric label={fr ? "Prix Consensus" : "Consensus Price"} value={`${score.consensusPrice?.toFixed(5) || "—"} τ`} />
            {score.priceVar30d != null && (
              <Metric
                label="Var 30j"
                value={`${score.priceVar30d > 0 ? "+" : ""}${score.priceVar30d.toFixed(1)}%`}
                color={score.priceVar30d > 0 ? "rgba(76,175,80,0.8)" : "rgba(229,57,53,0.8)"}
              />
            )}
            {pctChange != null && (
              <Metric
                label="Var 7j"
                value={`${pctChange > 0 ? "+" : ""}${pctChange.toFixed(1)}%`}
                color={pctChange > 0 ? "rgba(76,175,80,0.8)" : "rgba(229,57,53,0.8)"}
              />
            )}
          </div>
          <div className="mt-3 flex justify-center">
            <Sparkline data={spark} width={200} height={40} />
          </div>
        </Section>

        {/* ── Score & Facteurs ── */}
        <Section icon="🎯" title={fr ? "Score & Facteurs" : "Score & Factors"}>
          <div className="space-y-1">
            <ScoreBar label={fr ? "Opportunité" : "Opportunity"} value={score.opp} color={opportunityColor(score.opp)} />
            <ScoreBar label={fr ? "Risque" : "Risk"} value={score.risk} color={riskColor(score.risk)} />
            <ScoreBar label={fr ? "Stabilité" : "Stability"} value={score.stability} color={stabilityColor(score.stability)} />
            <ScoreBar label="Data" value={score.confianceScore} color={confianceColor(score.confianceScore)} />
          </div>
          <div className="mt-3 flex items-center gap-2 flex-wrap">
            <span
              className="font-mono text-[9px] px-2 py-0.5 rounded"
              style={{ background: actionBg(score.action), color: actionColor(score.action), border: `1px solid ${actionBorder(score.action)}` }}
            >
              {actionIcon(score.action)} {score.action}
            </span>
            <span
              className="font-mono text-[9px] px-2 py-0.5 rounded"
              style={{ color: systemStatusColor(score.systemStatus), background: "hsla(0,0%,100%,0.03)" }}
            >
              {systemStatusLabel(score.systemStatus)}
            </span>
          </div>
        </Section>

        {/* ── Mineurs & Validateurs ── */}
        <Section icon="⛏️" title={fr ? "Mineurs & Validateurs" : "Miners & Validators"}>
          {radar ? (
            <div className="space-y-1">
              <Metric label={fr ? "Mineurs actifs" : "Active miners"} value={radar.snapshot.minersActive} />
              <Metric label={fr ? "Validateurs actifs" : "Active validators"} value={radar.snapshot.validatorsActive} />
              <Metric label="UID" value={`${radar.snapshot.uidUsed} / ${radar.snapshot.uidMax}`} sub={`${(radar.snapshot.uidUsage * 100).toFixed(0)}%`} />
              <Metric label={fr ? "Holders" : "Holders"} value={radar.snapshot.holdersCount} />
              <Metric label={fr ? "Concentration stake" : "Stake concentration"} value={`${(radar.snapshot.stakeConcentration <= 1 ? radar.snapshot.stakeConcentration * 100 : radar.snapshot.stakeConcentration).toFixed(1)}%`} />
              <Metric label={fr ? "Coût registration" : "Registration cost"} value={`${radar.snapshot.registrationCost.toFixed(2)} τ`} />
            </div>
          ) : (
            <div className="text-muted-foreground/30 text-[10px] font-mono">{fr ? "Données en chargement..." : "Loading..."}</div>
          )}
        </Section>

        {/* ── Liquidité & Volume ── */}
        <Section icon="💧" title={fr ? "Liquidité & Volume" : "Liquidity & Volume"}>
          {radar ? (
            <div className="space-y-1">
              <Metric label={fr ? "Liquidité" : "Liquidity"} value={`${radar.priceContext.liquidity.toFixed(1)} τ`} />
              <Metric label="Cap" value={`${radar.priceContext.marketCap.toFixed(1)} τ`} />
              <Metric label="Vol 24h" value={`${radar.priceContext.vol24h.toFixed(1)} τ`} />
              <Metric label="Vol/MC" value={`${(radar.economicContext.volumeMarketcapRatio * 100).toFixed(2)}%`} />
              <Metric label={fr ? "Émission/jour" : "Emission/day"} value={`${radar.economicContext.emissionsPerDay.toFixed(1)} α`} />
              <Metric label={fr ? "Part émission" : "Emission share"} value={`${radar.economicContext.emissionsPercent.toFixed(2)}%`} />
            </div>
          ) : (
            <div className="text-muted-foreground/30 text-[10px] font-mono">{fr ? "Données en chargement..." : "Loading..."}</div>
          )}
        </Section>

        {/* ── AMM / Economics ── */}
        <Section icon="🏦" title="AMM & Economics">
          {radar ? (
            <div className="space-y-1">
              <Metric label="Alpha In Pool" value={`${radar.economicContext.alphaInPool.toFixed(1)} α`} />
              <Metric label="TAO In Pool" value={`${radar.economicContext.taoInPool.toFixed(1)} τ`} />
              <Metric label="Alpha Staked" value={`${radar.economicContext.alphaStaked.toFixed(1)} α`} />
              <Metric label="Buy Volume 24h" value={`${radar.economicContext.buyVolume.toFixed(1)} τ`} />
              <Metric label="Sell Volume 24h" value={`${radar.economicContext.sellVolume.toFixed(1)} τ`} />
              <Metric
                label="Sentiment"
                value={`${(radar.economicContext.sentiment * 100).toFixed(0)}%`}
                color={radar.economicContext.sentiment > 0.55 ? "rgba(76,175,80,0.8)" : radar.economicContext.sentiment < 0.45 ? "rgba(229,57,53,0.8)" : "rgba(255,193,7,0.8)"}
                sub={radar.economicContext.sentiment > 0.55 ? "Buy" : radar.economicContext.sentiment < 0.45 ? "Sell" : "Neutral"}
              />
              <Metric label={fr ? "Acheteurs" : "Buyers"} value={radar.economicContext.buyersCount} />
              <Metric label={fr ? "Vendeurs" : "Sellers"} value={radar.economicContext.sellersCount} />
            </div>
          ) : (
            <div className="text-muted-foreground/30 text-[10px] font-mono">{fr ? "Données en chargement..." : "Loading..."}</div>
          )}
        </Section>

        {/* ── Risques ── */}
        <Section icon="⚠️" title={fr ? "Risques" : "Risks"}>
          <div className="space-y-1">
            <Metric label="Depeg" value={`${score.depegProbability}%`} color={score.depegProbability >= 50 ? "rgba(229,57,53,0.9)" : score.depegProbability >= 25 ? "rgba(255,152,0,0.8)" : "rgba(76,175,80,0.7)"} />
            <Metric label={fr ? "Catégorie delist" : "Delist category"} value={score.delistCategory} color={score.delistCategory === "NORMAL" ? "rgba(76,175,80,0.7)" : score.delistCategory === "DEPEG_PRIORITY" ? "rgba(229,57,53,0.9)" : "rgba(255,193,7,0.8)"} />
            <Metric label={fr ? "Score delist" : "Delist score"} value={score.delistScore} />
            {score.isOverridden && (
              <div className="mt-2 p-2 rounded-lg" style={{ background: "rgba(229,57,53,0.06)", border: "1px solid rgba(229,57,53,0.15)" }}>
                <div className="font-mono text-[9px] text-red-400/80 tracking-widest mb-1">⛔ OVERRIDE ACTIF</div>
                {score.overrideReasons.map((r, i) => (
                  <div key={i} className="font-mono text-[10px] text-red-400/60">• {r}</div>
                ))}
              </div>
            )}
          </div>
          {/* Health scores */}
          <div className="mt-3 pt-3" style={{ borderTop: "1px solid hsla(0,0%,100%,0.05)" }}>
            <div className="font-mono text-[8px] tracking-widest text-muted-foreground/30 mb-2">SANTÉ</div>
            <ScoreBar label={fr ? "Liquidité" : "Liquidity"} value={score.healthScores.liquidityHealth} />
            <ScoreBar label="Volume" value={score.healthScores.volumeHealth} />
            <ScoreBar label={fr ? "Émission" : "Emission"} value={100 - score.healthScores.emissionPressure} />
            <ScoreBar label="Dilution" value={100 - score.healthScores.dilutionRisk} />
            <ScoreBar label={fr ? "Activité" : "Activity"} value={score.healthScores.activityHealth} />
          </div>
        </Section>
      </div>

      {/* ── Verdict reasons ── */}
      {verdict && (
        <div
          className="mt-6 rounded-xl p-5"
          style={{
            background: "hsla(0,0%,100%,0.015)",
            border: `1px solid ${verdictBorder(verdict.verdict)}`,
          }}
        >
          <div className="flex items-center gap-2 mb-4">
            <span className="text-sm">{verdictIcon(verdict.verdict)}</span>
            <h3 className="font-mono text-[11px] tracking-widest uppercase" style={{ color: verdictColor(verdict.verdict) }}>
              {fr ? "Pourquoi ce verdict" : "Why this verdict"}
            </h3>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
            <div className="text-center">
              <div className="font-mono text-[8px] tracking-widest text-muted-foreground/40 mb-1">ENTRY</div>
              <div className="font-mono text-2xl font-bold" style={{ color: "rgba(76,175,80,0.8)" }}>{verdict.entryScore}</div>
            </div>
            <div className="text-center">
              <div className="font-mono text-[8px] tracking-widest text-muted-foreground/40 mb-1">HOLD</div>
              <div className="font-mono text-2xl font-bold" style={{ color: "rgba(255,193,7,0.8)" }}>{verdict.holdScore}</div>
            </div>
            <div className="text-center">
              <div className="font-mono text-[8px] tracking-widest text-muted-foreground/40 mb-1">EXIT RISK</div>
              <div className="font-mono text-2xl font-bold" style={{ color: "rgba(229,57,53,0.8)" }}>{verdict.exitRisk}</div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {verdict.positiveReasons.length > 0 && (
              <div>
                <div className="font-mono text-[8px] tracking-widest text-green-400/50 mb-2">{fr ? "POINTS FORTS" : "STRENGTHS"}</div>
                {verdict.positiveReasons.map((r, i) => (
                  <div key={i} className="font-mono text-[10px] text-green-400/70 py-0.5">✓ {r}</div>
                ))}
              </div>
            )}
            {verdict.negativeReasons.length > 0 && (
              <div>
                <div className="font-mono text-[8px] tracking-widest text-red-400/50 mb-2">{fr ? "POINTS FAIBLES" : "WEAKNESSES"}</div>
                {verdict.negativeReasons.map((r, i) => (
                  <div key={i} className="font-mono text-[10px] text-red-400/70 py-0.5">✗ {r}</div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── External link ── */}
      <div className="mt-4 flex justify-end">
        <a
          href={`https://taostats.io/subnets/${netuid}`}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono text-[10px] tracking-wider text-muted-foreground/30 hover:text-muted-foreground/60 transition-colors"
        >
          {fr ? "Voir sur Taostats →" : "View on Taostats →"}
        </a>
      </div>
    </div>
  );
}
