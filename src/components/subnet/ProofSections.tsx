/* ═══════════════════════════════════════════════════════ */
/*   PROOF SECTIONS — Raw Facts, Concordance, Derived     */
/*   Scores, and full Verdict Provenance for subnet detail */
/* ═══════════════════════════════════════════════════════ */

import { useState } from "react";
import type { SubnetFacts, Sourced, FieldSource } from "@/lib/subnet-facts";
import { val } from "@/lib/subnet-facts";
import type { ConcordanceResult, ConcordanceCheck } from "@/lib/source-concordance";
import type { ScoringResult, DerivedScores, ProhibitionViolation } from "@/lib/derived-scores";
import type { VerdictV3Result } from "@/lib/verdict-engine-v3";
import { SectionCard, SectionTitle, GOLD, GO, WARN, BREAK, MUTED } from "@/components/sentinel/Atoms";

/* ─── Helpers ─── */

function sourceTag(src: FieldSource) {
  const colors: Record<FieldSource, string> = {
    taostats: "hsl(var(--primary))",
    "taostats:chain": "hsl(210, 60%, 55%)",
    computed: "hsl(var(--gold))",
    unavailable: "hsl(var(--muted-foreground))",
  };
  return (
    <span className="font-mono text-[7px] px-1 py-0.5 rounded" style={{ color: colors[src], border: `1px solid ${colors[src]}33`, background: `${colors[src]}0a` }}>
      {src}
    </span>
  );
}

function FactRow({ label, sourced, fmt }: { label: string; sourced: Sourced<any>; fmt?: (v: any) => string }) {
  const v = sourced.value;
  const display = fmt ? fmt(v) : typeof v === "number" ? (v > 1000 ? v.toLocaleString("fr-FR", { maximumFractionDigits: 2 }) : v.toFixed(v < 0.01 ? 6 : 2)) : String(v);
  return (
    <div className="flex items-center justify-between py-0.5 gap-2">
      <span className="font-mono text-[9px] text-muted-foreground truncate">{label}</span>
      <div className="flex items-center gap-1.5">
        <span className="font-mono text-[10px] text-foreground/80">{display}</span>
        {sourceTag(sourced.source)}
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
/*   SECTION 1: RAW FACTS                      */
/* ═══════════════════════════════════════════ */

export function RawFactsSection({ facts, fr }: { facts: SubnetFacts; fr: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const fmtPct = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(1)}%`;
  const fmtTao = (v: number) => `${v.toFixed(2)} τ`;
  const fmtUsd = (v: number) => `$${v.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  const fmtInt = (v: number) => Math.round(v).toString();
  const fmtPctR = (v: number) => `${(v * 100).toFixed(1)}%`;

  return (
    <SectionCard>
      <SectionTitle icon="📋" title={fr ? "Faits bruts (Layer A)" : "Raw Facts (Layer A)"} />
      <div className="px-5 py-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6">
          {/* Price & Market — always visible */}
          <div>
            <div className="font-mono text-[7px] tracking-[0.2em] uppercase text-muted-foreground mb-1 mt-1">{fr ? "PRIX & MARCHÉ" : "PRICE & MARKET"}</div>
            <FactRow label={fr ? "Prix α" : "Price α"} sourced={facts.price} fmt={fmtTao} />
            <FactRow label={fr ? "Prix USD" : "Price USD"} sourced={facts.priceUsd} fmt={fmtUsd} />
            <FactRow label="Var 1h" sourced={facts.priceChange1h} fmt={fmtPct} />
            <FactRow label="Var 24h" sourced={facts.priceChange24h} fmt={fmtPct} />
            <FactRow label="Var 7j" sourced={facts.priceChange7d} fmt={fmtPct} />
            <FactRow label="Var 30j" sourced={facts.priceChange30d} fmt={fmtPct} />
            <FactRow label="Market Cap" sourced={facts.marketCap} fmt={fmtTao} />
            <FactRow label="FDV" sourced={facts.fdv} fmt={fmtTao} />
            <FactRow label="Vol 24h" sourced={facts.vol24h} fmt={fmtTao} />
          </div>
          <div>
            <div className="font-mono text-[7px] tracking-[0.2em] uppercase text-muted-foreground mb-1 mt-1">POOL / AMM</div>
            <FactRow label="TAO pool" sourced={facts.taoInPool} fmt={fmtTao} />
            <FactRow label="Alpha pool" sourced={facts.alphaInPool} fmt={fmtTao} />
            <FactRow label="Pool price" sourced={facts.poolPrice} fmt={fmtTao} />
            <FactRow label="Haircut" sourced={facts.liqHaircut} fmt={fmtPct} />
            <FactRow label="Slippage 1τ" sourced={facts.slippage1tau} fmt={fmtPct} />
            <FactRow label="Slippage 10τ" sourced={facts.slippage10tau} fmt={fmtPct} />
            <FactRow label="Spread" sourced={facts.spread} fmt={fmtPct} />
          </div>
        </div>

        {expanded && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 mt-2 pt-2 border-t border-border">
            <div>
              <div className="font-mono text-[7px] tracking-[0.2em] uppercase text-muted-foreground mb-1">{fr ? "TRADING" : "TRADING"}</div>
              <FactRow label="Buys 24h" sourced={facts.buyCount} fmt={fmtInt} />
              <FactRow label="Sells 24h" sourced={facts.sellCount} fmt={fmtInt} />
              <FactRow label="Buyers" sourced={facts.buyerCount} fmt={fmtInt} />
              <FactRow label="Sellers" sourced={facts.sellerCount} fmt={fmtInt} />
            </div>
            <div>
              <div className="font-mono text-[7px] tracking-[0.2em] uppercase text-muted-foreground mb-1">{fr ? "STRUCTURE" : "STRUCTURE"}</div>
              <FactRow label="Validators" sourced={facts.validators} fmt={fmtInt} />
              <FactRow label="Miners" sourced={facts.miners} fmt={fmtInt} />
              <FactRow label="Active UIDs" sourced={facts.activeUids} fmt={fmtInt} />
              <FactRow label="Max UIDs" sourced={facts.maxUids} fmt={fmtInt} />
              <FactRow label="UID Sat." sourced={facts.uidSaturation} fmt={fmtPctR} />
              <FactRow label="Registrations" sourced={facts.registrations} fmt={fmtInt} />
            </div>
            <div>
              <div className="font-mono text-[7px] tracking-[0.2em] uppercase text-muted-foreground mb-1">{fr ? "ÉCONOMIE" : "ECONOMICS"}</div>
              <FactRow label="Emission/j" sourced={facts.emissionPerDay} fmt={fmtTao} />
              <FactRow label="Burn 24h" sourced={facts.burn} fmt={fmtTao} />
              <FactRow label="Root prop" sourced={facts.rootProportion} fmt={fmtPctR} />
              <FactRow label="Circ. Supply" sourced={facts.circulatingSupply} fmt={fmtTao} />
              <FactRow label="Total Supply" sourced={facts.totalSupply} fmt={fmtTao} />
              <FactRow label="Alpha Staked" sourced={facts.alphaStaked} fmt={fmtTao} />
            </div>
            <div>
              <div className="font-mono text-[7px] tracking-[0.2em] uppercase text-muted-foreground mb-1">META</div>
              <FactRow label="Rank" sourced={facts.rank} fmt={fmtInt} />
              <FactRow label="Last Sync" sourced={facts.lastSyncTs} fmt={(v: string) => v.slice(0, 19)} />
              <div className="flex items-center justify-between py-0.5">
                <span className="font-mono text-[9px] text-muted-foreground">TAO/USD</span>
                <span className="font-mono text-[10px] text-foreground/80">{fmtUsd(facts.taoUsd)}</span>
              </div>
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
