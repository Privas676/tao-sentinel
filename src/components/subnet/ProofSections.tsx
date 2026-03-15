/* ═══════════════════════════════════════════════════════ */
/*   PROOF SECTIONS — Raw Facts, Concordance, Derived     */
/*   Scores, and full Verdict Provenance for subnet detail */
/*   Uses CanonicalSubnetFacts as single source of truth   */
/* ═══════════════════════════════════════════════════════ */

import { useState } from "react";
import type { CanonicalSubnetFacts, SourceType } from "@/lib/canonical-types";
import type { ConcordanceResult, ConcordanceCheck } from "@/lib/source-concordance";
import type { ScoringResult, DerivedScores, ProhibitionViolation } from "@/lib/derived-scores";
import type { VerdictV3Result } from "@/lib/verdict-engine-v3";
import { SectionCard, SectionTitle, GOLD, GO, WARN, BREAK, MUTED } from "@/components/sentinel/Atoms";

/* ─── Helpers ─── */

function sourceTag(src: SourceType) {
  const colors: Record<SourceType, string> = {
    taostats: "hsl(var(--primary))",
    "taostats:chain": "hsl(210, 60%, 55%)",
    taoflute: "hsl(280, 60%, 55%)",
    social: "hsl(160, 60%, 50%)",
    computed: "hsl(var(--gold))",
    unavailable: "hsl(var(--muted-foreground))",
  };
  return (
    <span className="font-mono text-[7px] px-1 py-0.5 rounded" style={{ color: colors[src], border: `1px solid ${colors[src]}33`, background: `${colors[src]}0a` }}>
      {src}
    </span>
  );
}

function getFieldSource(facts: CanonicalSubnetFacts, fieldKey: string): SourceType {
  return facts.provenance[fieldKey]?.source_type ?? "unavailable";
}

function FactRow({ label, value, source, fmt }: { label: string; value: number | string | null; source: SourceType; fmt?: (v: any) => string }) {
  if (value == null) return null;
  const display = fmt ? fmt(value) : typeof value === "number" ? (value > 1000 ? value.toLocaleString("fr-FR", { maximumFractionDigits: 2 }) : value.toFixed(value < 0.01 && value > 0 ? 6 : 2)) : String(value);
  return (
    <div className="flex items-center justify-between py-0.5 gap-2">
      <span className="font-mono text-[9px] text-muted-foreground truncate">{label}</span>
      <div className="flex items-center gap-1.5">
        <span className="font-mono text-[10px] text-foreground/80">{display}</span>
        {sourceTag(source)}
      </div>
    </div>
  );
}

function ScoreBar({ label, value, explanation, inverted }: { label: string; value: number; explanation: string; inverted?: boolean }) {
  const effective = inverted ? 100 - value : value;
  const color = effective >= 70 ? GO : effective >= 40 ? WARN : BREAK;
  return (
    <div className="py-1">
      <div className="flex items-center justify-between mb-0.5">
        <span className="font-mono text-[9px] text-muted-foreground">{label}</span>
        <span className="font-mono text-[10px] font-bold" style={{ color }}>{value}</span>
      </div>
      <div className="h-1 rounded-full bg-muted/30 overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${value}%`, background: color }} />
      </div>
      <div className="font-mono text-[7px] text-muted-foreground/60 mt-0.5 truncate">{explanation}</div>
    </div>
  );
}

/* ═══════════════════════════════════════════ */
/*   SECTION 1: RAW FACTS (Canonical)          */
/* ═══════════════════════════════════════════ */

export function RawFactsSection({ facts, fr }: { facts: CanonicalSubnetFacts; fr: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const fmtPct = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(1)}%`;
  const fmtTao = (v: number) => `${v.toFixed(2)} τ`;
  const fmtUsd = (v: number) => `$${v.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  const fmtInt = (v: number) => Math.round(v).toString();
  const fmtPctR = (v: number) => `${(v * 100).toFixed(1)}%`;
  const src = (key: string) => getFieldSource(facts, key);

  return (
    <SectionCard>
      <SectionTitle icon="📋" title={fr ? "Faits bruts (Layer A)" : "Raw Facts (Layer A)"} />
      <div className="px-5 py-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6">
          {/* Price & Market — always visible */}
          <div>
            <div className="font-mono text-[7px] tracking-[0.2em] uppercase text-muted-foreground mb-1 mt-1">{fr ? "PRIX & MARCHÉ" : "PRICE & MARKET"}</div>
            <FactRow label={fr ? "Prix α" : "Price α"} value={facts.price} source={src("price")} fmt={fmtTao} />
            <FactRow label={fr ? "Prix USD" : "Price USD"} value={facts.price_usd} source={src("price_usd")} fmt={fmtUsd} />
            <FactRow label="Var 1h" value={facts.change_1h} source={src("change_1h")} fmt={fmtPct} />
            <FactRow label="Var 24h" value={facts.change_24h} source={src("change_24h")} fmt={fmtPct} />
            <FactRow label="Var 7j" value={facts.change_7d} source={src("change_7d")} fmt={fmtPct} />
            <FactRow label="Var 30j" value={facts.change_30d} source={src("change_30d")} fmt={fmtPct} />
            <FactRow label="Market Cap" value={facts.market_cap} source={src("market_cap")} fmt={fmtTao} />
            <FactRow label="FDV" value={facts.fdv} source={src("fdv")} fmt={fmtTao} />
            <FactRow label="Vol 24h" value={facts.volume_24h} source={src("volume_24h")} fmt={fmtTao} />
          </div>
          <div>
            <div className="font-mono text-[7px] tracking-[0.2em] uppercase text-muted-foreground mb-1 mt-1">POOL / AMM</div>
            <FactRow label="TAO pool" value={facts.tao_in_pool} source={src("tao_in_pool")} fmt={fmtTao} />
            <FactRow label="Alpha pool" value={facts.alpha_in_pool} source={src("alpha_in_pool")} fmt={fmtTao} />
            <FactRow label="Pool ratio" value={facts.tao_pool_ratio} source={src("tao_pool_ratio")} fmt={fmtTao} />
            <FactRow label="Slippage 1τ" value={facts.slippage_1tau} source={src("slippage_1tau")} fmt={fmtPct} />
            <FactRow label="Slippage 10τ" value={facts.slippage_10tau} source={src("slippage_10tau")} fmt={fmtPct} />
            <FactRow label="Spread" value={facts.spread} source={src("spread")} fmt={fmtPct} />
          </div>
        </div>

        {expanded && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 mt-2 pt-2 border-t border-border">
            <div>
              <div className="font-mono text-[7px] tracking-[0.2em] uppercase text-muted-foreground mb-1">TRADING</div>
              <FactRow label="Buys 24h" value={facts.buys_count} source={src("buys_count")} fmt={fmtInt} />
              <FactRow label="Sells 24h" value={facts.sells_count} source={src("sells_count")} fmt={fmtInt} />
              <FactRow label="Buyers" value={facts.buyers_count} source={src("buyers_count")} fmt={fmtInt} />
              <FactRow label="Sellers" value={facts.sellers_count} source={src("sellers_count")} fmt={fmtInt} />
            </div>
            <div>
              <div className="font-mono text-[7px] tracking-[0.2em] uppercase text-muted-foreground mb-1">{fr ? "STRUCTURE" : "STRUCTURE"}</div>
              <FactRow label="Validators" value={facts.validators} source={src("validators")} fmt={fmtInt} />
              <FactRow label="Miners" value={facts.miners} source={src("miners")} fmt={fmtInt} />
              <FactRow label="Holders" value={facts.holders} source={src("holders")} fmt={fmtInt} />
              <FactRow label="UID Sat." value={facts.uid_saturation} source={src("uid_saturation")} fmt={fmtPctR} />
            </div>
            <div>
              <div className="font-mono text-[7px] tracking-[0.2em] uppercase text-muted-foreground mb-1">{fr ? "ÉCONOMIE" : "ECONOMICS"}</div>
              <FactRow label="Emission/j" value={facts.emissions_day} source={src("emissions_day")} fmt={fmtTao} />
              <FactRow label="Emission %" value={facts.emissions_pct} source={src("emissions_pct")} fmt={fmtPct} />
              <FactRow label="Root prop" value={facts.root_proportion} source={src("root_proportion")} fmt={fmtPctR} />
              <FactRow label="Circ. Supply" value={facts.circulating_supply} source={src("circulating_supply")} fmt={fmtTao} />
              <FactRow label="Total Supply" value={facts.total_supply} source={src("total_supply")} fmt={fmtTao} />
              <FactRow label="Burn %" value={facts.incentive_burn_pct} source={src("incentive_burn_pct")} fmt={fmtPct} />
            </div>
            <div>
              <div className="font-mono text-[7px] tracking-[0.2em] uppercase text-muted-foreground mb-1">{fr ? "RISQUE EXTERNE" : "EXTERNAL RISK"}</div>
              <FactRow label="TaoFlute" value={facts.external_status} source={facts.taoflute_match ? "taoflute" : "unavailable"} />
              {facts.liq_price != null && <FactRow label="Liq. Price" value={facts.liq_price} source="taoflute" fmt={fmtTao} />}
              {facts.liq_haircut != null && <FactRow label="Liq. Haircut" value={facts.liq_haircut} source="taoflute" fmt={fmtPct} />}
              {facts.taoflute_flags.length > 0 && (
                <div className="font-mono text-[8px] text-muted-foreground mt-1">
                  Flags: {facts.taoflute_flags.join(", ")}
                </div>
              )}
              <div className="font-mono text-[7px] tracking-[0.2em] uppercase text-muted-foreground mb-1 mt-2">{fr ? "SIGNAL SOCIAL" : "SOCIAL SIGNAL"}</div>
              <FactRow label="Mentions 24h" value={facts.social_mentions_24h} source={src("social_mentions_24h")} fmt={fmtInt} />
              <FactRow label="Signal" value={facts.social_signal_strength} source={src("social_signal_strength")} fmt={fmtInt} />
              <FactRow label="Crédibilité" value={facts.social_credibility_score} source={src("social_credibility_score")} fmt={fmtInt} />
              <FactRow label="Sentiment" value={facts.social_sentiment_score} source={src("social_sentiment_score")} fmt={fmtInt} />
            </div>
            <div>
              <div className="font-mono text-[7px] tracking-[0.2em] uppercase text-muted-foreground mb-1">META</div>
              <FactRow label="TaoStats sync" value={facts.taostats_timestamp} source="taostats" fmt={(v: string) => v?.slice(0, 19) ?? "—"} />
              <FactRow label="TaoFlute sync" value={facts.taoflute_timestamp} source="taoflute" fmt={(v: string) => v?.slice(0, 19) ?? "—"} />
              <FactRow label="Social sync" value={facts.social_timestamp} source="social" fmt={(v: string) => v?.slice(0, 19) ?? "—"} />
              <FactRow label="Sentinel ts" value={facts.sentinel_timestamp} source="computed" fmt={(v: string) => v?.slice(0, 19)} />
            </div>
          </div>
        )}

        <button
          onClick={() => setExpanded(!expanded)}
          className="mt-2 w-full font-mono text-[8px] tracking-wider text-muted-foreground hover:text-foreground transition-colors text-center py-1"
        >
          {expanded ? (fr ? "▲ Réduire" : "▲ Collapse") : (fr ? "▼ Tout afficher" : "▼ Show all")}
        </button>
      </div>
    </SectionCard>
  );
}

/* ═══════════════════════════════════════════ */
/*   SECTION 2: SOURCE CONCORDANCE             */
/* ═══════════════════════════════════════════ */

function gradeColor(grade: string) {
  if (grade === "A") return GO;
  if (grade === "B") return GOLD;
  if (grade === "C") return WARN;
  return BREAK;
}

export function ConcordanceSection({ concordance, fr }: { concordance: ConcordanceResult; fr: boolean }) {
  return (
    <SectionCard>
      <SectionTitle icon="🔗" title={fr ? "Concordance des sources" : "Source Concordance"} />
      <div className="px-5 py-3">
        {/* Grade header */}
        <div className="flex items-center gap-4 mb-3">
          <div className="w-12 h-12 rounded-xl border border-border flex items-center justify-center" style={{ background: `${gradeColor(concordance.grade)}12` }}>
            <span className="font-mono text-xl font-bold" style={{ color: gradeColor(concordance.grade) }}>{concordance.grade}</span>
          </div>
          <div>
            <div className="font-mono text-[10px] text-foreground/80">{concordance.score}/100</div>
            <div className="font-mono text-[8px] text-muted-foreground">
              {concordance.failedChecks.length === 0
                ? (fr ? "Toutes les vérifications passées" : "All checks passed")
                : (fr ? `${concordance.failedChecks.length} vérification(s) échouée(s)` : `${concordance.failedChecks.length} check(s) failed`)}
            </div>
            {concordance.forceUnstable && (
              <div className="font-mono text-[8px] font-bold mt-0.5" style={{ color: BREAK }}>
                {fr ? "⚠ Force DONNÉES INSTABLES" : "⚠ Forces UNSTABLE DATA"}
              </div>
            )}
          </div>
        </div>

        {/* Individual checks */}
        <div className="space-y-1">
          {concordance.checks.map((check, i) => (
            <div key={i} className="flex items-start gap-2 py-0.5">
              <span className="text-[10px] mt-0.5 shrink-0">{check.passed ? "✅" : "❌"}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[9px] font-medium text-foreground/80">{check.label}</span>
                  {check.severity > 0 && !check.passed && (
                    <span className="font-mono text-[7px] px-1 py-0.5 rounded" style={{ color: BREAK, background: `${BREAK}12`, border: `1px solid ${BREAK}25` }}>
                      -{check.severity}
                    </span>
                  )}
                </div>
                <div className="font-mono text-[7px] text-muted-foreground/60 truncate">{check.detail}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </SectionCard>
  );
}

/* ═══════════════════════════════════════════ */
/*   SECTION 3: DERIVED SCORES                 */
/* ═══════════════════════════════════════════ */

export function DerivedScoresSection({ scoring, fr }: { scoring: ScoringResult; fr: boolean }) {
  const { scores, violations, explanations } = scoring;

  const scoreKeys: { key: keyof DerivedScores; label: string; inverted?: boolean }[] = [
    { key: "momentum", label: "Momentum" },
    { key: "marketStrength", label: fr ? "Force marché" : "Market Strength" },
    { key: "liquidityQuality", label: fr ? "Qualité liquidité" : "Liquidity Quality" },
    { key: "executionQuality", label: fr ? "Qualité exécution" : "Execution Quality" },
    { key: "smartMoney", label: "Smart Money" },
    { key: "conviction", label: "Conviction" },
    { key: "structuralFragility", label: fr ? "Fragilité struct." : "Structural Fragility", inverted: true },
    { key: "concentrationRisk", label: fr ? "Risque concentration" : "Concentration Risk", inverted: true },
    { key: "depegRisk", label: fr ? "Risque depeg" : "Depeg Risk", inverted: true },
    { key: "delistRisk", label: fr ? "Risque delist" : "Delist Risk", inverted: true },
    { key: "volatility", label: fr ? "Volatilité" : "Volatility", inverted: true },
    { key: "dataConfidence", label: fr ? "Confiance données" : "Data Confidence" },
  ];

  return (
    <SectionCard>
      <SectionTitle icon="🧮" title={fr ? "Scores dérivés (Layer B)" : "Derived Scores (Layer B)"} />
      <div className="px-5 py-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-0">
          {scoreKeys.map(({ key, label, inverted }) => (
            <ScoreBar key={key} label={label} value={scores[key]} explanation={explanations[key]} inverted={inverted} />
          ))}
        </div>

        {/* Prohibition violations */}
        {violations.length > 0 && (
          <div className="mt-3 pt-3 border-t border-border">
            <div className="font-mono text-[7px] tracking-[0.2em] uppercase text-muted-foreground mb-2">
              {fr ? "RÈGLES D'INTERDICTION APPLIQUÉES" : "PROHIBITION RULES APPLIED"}
            </div>
            <div className="space-y-1.5">
              {violations.map((v, i) => (
                <div key={i} className="rounded-lg px-3 py-2 border border-border" style={{ background: `${WARN}08` }}>
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-[9px]">⛔</span>
                    <span className="font-mono text-[8px] font-bold" style={{ color: WARN }}>{v.code}</span>
                  </div>
                  <div className="font-mono text-[8px] text-foreground/70">{v.message}</div>
                  <div className="font-mono text-[7px] text-muted-foreground mt-0.5">
                    {v.scoreCapped}: {v.originalValue} → {v.cappedValue}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </SectionCard>
  );
}

/* ═══════════════════════════════════════════ */
/*   SECTION 4: VERDICT PROVENANCE             */
/* ═══════════════════════════════════════════ */

function verdictColor(verdict: string) {
  if (verdict === "ENTER") return GO;
  if (verdict === "SORTIR") return BREAK;
  if (verdict === "SURVEILLER") return WARN;
  if (verdict === "DONNÉES_INSTABLES") return MUTED;
  if (verdict === "NON_INVESTISSABLE") return BREAK;
  return "hsl(210, 60%, 55%)";
}

export function VerdictProvenanceSection({ verdict, fr }: { verdict: VerdictV3Result; fr: boolean }) {
  return (
    <SectionCard>
      <SectionTitle icon="⚖️" title={fr ? "Preuve du verdict (Layer C)" : "Verdict Provenance (Layer C)"} />
      <div className="px-5 py-3">
        {/* Verdict header */}
        <div className="flex items-center gap-4 mb-4">
          <div className="rounded-xl px-4 py-2.5 border border-border" style={{ background: `${verdictColor(verdict.verdict)}0a`, borderColor: `${verdictColor(verdict.verdict)}30` }}>
            <div className="font-mono text-[7px] tracking-[0.2em] uppercase text-muted-foreground mb-0.5">VERDICT</div>
            <div className="font-mono text-lg font-bold" style={{ color: verdictColor(verdict.verdict) }}>
              {fr ? verdict.verdictFr : verdict.verdictEn}
            </div>
          </div>
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[8px] text-muted-foreground">Conviction:</span>
              <span className="font-mono text-[9px] font-bold" style={{ color: verdict.conviction === "HIGH" ? GO : verdict.conviction === "MEDIUM" ? WARN : MUTED }}>{verdict.conviction}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-[8px] text-muted-foreground">Confidence:</span>
              <span className="font-mono text-[9px]">{verdict.confidence}/100</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-[8px] text-muted-foreground">Urgence:</span>
              <span className="font-mono text-[9px]" style={{ color: verdict.urgency === "CRITICAL" ? BREAK : verdict.urgency === "HIGH" ? BREAK : verdict.urgency === "MEDIUM" ? WARN : MUTED }}>{verdict.urgency}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-[8px] text-muted-foreground">Portfolio:</span>
              <span className="font-mono text-[9px] font-bold" style={{ color: verdict.portfolioAction === "RENFORCER" ? GO : verdict.portfolioAction === "SORTIR" ? BREAK : WARN }}>{verdict.portfolioAction}</span>
            </div>
          </div>
        </div>

        {/* Primary reason */}
        <div className="rounded-lg px-3 py-2 border border-border bg-muted/10 mb-2">
          <div className="font-mono text-[7px] tracking-[0.2em] uppercase text-muted-foreground mb-0.5">{fr ? "RAISON PRINCIPALE" : "PRIMARY REASON"}</div>
          <div className="font-mono text-[10px] text-foreground/80">{verdict.primaryReason.text}</div>
          <div className="font-mono text-[7px] text-muted-foreground/50 mt-0.5">code: {verdict.primaryReason.code} · source: {verdict.primaryReason.source}</div>
        </div>

        {/* Secondary reasons */}
        {verdict.secondaryReasons.length > 0 && (
          <div className="space-y-1 mb-2">
            <div className="font-mono text-[7px] tracking-[0.2em] uppercase text-muted-foreground">{fr ? "RAISONS SECONDAIRES" : "SECONDARY REASONS"}</div>
            {verdict.secondaryReasons.map((r, i) => (
              <div key={i} className="font-mono text-[9px] text-foreground/60 flex items-center gap-2">
                <span className="text-[7px]">▸</span> {r.text}
                <span className="text-[7px] text-muted-foreground/40">[{r.code}]</span>
              </div>
            ))}
          </div>
        )}

        {/* Blocks */}
        {verdict.blocks.length > 0 && (
          <div className="rounded-lg px-3 py-2 border border-border mb-2" style={{ background: `${BREAK}08`, borderColor: `${BREAK}20` }}>
            <div className="font-mono text-[7px] tracking-[0.2em] uppercase mb-1" style={{ color: BREAK }}>{fr ? "BLOCAGES ACTIFS" : "ACTIVE BLOCKS"}</div>
            {verdict.blocks.map((b, i) => (
              <div key={i} className="font-mono text-[9px] text-foreground/70 flex items-start gap-2 py-0.5">
                <span className="text-[8px] mt-0.5 shrink-0">⛔</span>
                <div>
                  <span>{b.message}</span>
                  <span className="text-[7px] text-muted-foreground/40 ml-1">[{b.code}]</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Risk flags */}
        {verdict.riskFlags.length > 0 && (
          <div className="space-y-1 mb-2">
            <div className="font-mono text-[7px] tracking-[0.2em] uppercase text-muted-foreground">{fr ? "DRAPEAUX RISQUE" : "RISK FLAGS"}</div>
            {verdict.riskFlags.map((r, i) => (
              <div key={i} className="font-mono text-[9px] text-foreground/60 flex items-center gap-2">
                <span className="text-[8px]" style={{ color: BREAK }}>⚠</span> {r.text}
              </div>
            ))}
          </div>
        )}

        {/* Watchlist */}
        {verdict.watchlist.length > 0 && (
          <div className="space-y-1 mb-2">
            <div className="font-mono text-[7px] tracking-[0.2em] uppercase text-muted-foreground">{fr ? "À SURVEILLER" : "WATCHLIST"}</div>
            {verdict.watchlist.map((w, i) => (
              <div key={i} className="font-mono text-[9px] text-foreground/60 flex items-center gap-2">
                <span className="text-[7px]">👁</span> {w}
              </div>
            ))}
          </div>
        )}

        {/* Prohibition violations from scoring */}
        {verdict.prohibitionViolations.length > 0 && (
          <div className="space-y-1 mb-2">
            <div className="font-mono text-[7px] tracking-[0.2em] uppercase text-muted-foreground">{fr ? "CORRECTIONS APPLIQUÉES" : "APPLIED CORRECTIONS"}</div>
            {verdict.prohibitionViolations.map((v, i) => (
              <div key={i} className="font-mono text-[8px] text-muted-foreground/60">
                ⛔ {v.code}: {v.scoreCapped} {v.originalValue} → {v.cappedValue}
              </div>
            ))}
          </div>
        )}

        {/* Footer provenance */}
        <div className="mt-3 pt-2 border-t border-border flex items-center gap-4 flex-wrap">
          <div className="font-mono text-[7px] text-muted-foreground/50">
            Engine: {verdict.engineVersion}
          </div>
          <div className="font-mono text-[7px] text-muted-foreground/50">
            Concordance: {verdict.concordanceGrade} ({verdict.concordanceScore}/100)
          </div>
          <div className="font-mono text-[7px] text-muted-foreground/50">
            Horizon: {verdict.horizon}
          </div>
        </div>
      </div>
    </SectionCard>
  );
}
