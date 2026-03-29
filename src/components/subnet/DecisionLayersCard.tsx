/* ═══════════════════════════════════════════════ */
/*   DECISION LAYERS — 4 source cards              */
/*   Canonical · TaoFlute · TaoStats · Social      */
/* ═══════════════════════════════════════════════ */

import type { LayeredDecision } from "@/lib/decision-fusion";
import { deregBandColor, deregBandLabel } from "@/lib/canonical-dereg";
import { SectionCard } from "@/components/sentinel/Atoms";

const GO = "hsl(var(--signal-go))";
const WARN = "hsl(var(--signal-warn))";
const BREAK = "hsl(var(--signal-break))";
const MUTED = "hsl(var(--muted-foreground))";
const GOLD = "hsl(var(--gold))";

function verdictColor(v: string): string {
  if (v === "SAFE" || v === "STRONG" || v === "HEALTHY" || v === "BULLISH") return GO;
  if (v === "LOW_RISK" || v === "NEUTRAL" || v === "WATCH" || v === "NONE") return MUTED;
  if (v === "AT_RISK" || v === "WEAK" || v === "CAUTION" || v === "EARLY_PUMP") return WARN;
  return BREAK; // CRITICAL, HIGH_RISK, PUMP_RISK
}

function LayerCard({ icon, title, verdict, score, reasons, updatedAt, sourceUrl, fr }: {
  icon: string;
  title: string;
  verdict: string;
  score?: number;
  reasons: string[];
  updatedAt: string | null;
  sourceUrl?: string | null;
  fr: boolean;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-2.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm">{icon}</span>
          <span className="font-mono text-[9px] tracking-[0.15em] uppercase font-bold text-foreground/80">{title}</span>
        </div>
        <span className="font-mono text-[10px] font-bold" style={{ color: verdictColor(verdict) }}>
          {verdict}
        </span>
      </div>

      {score != null && (
        <div className="flex items-center gap-2">
          <div className="flex-1 h-1.5 rounded-full bg-muted/30 overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${Math.min(100, score)}%`,
                background: score >= 60 ? BREAK : score >= 30 ? WARN : GO,
              }}
            />
          </div>
          <span className="font-mono text-[9px] text-muted-foreground w-8 text-right">{score}</span>
        </div>
      )}

      {reasons.length > 0 && (
        <div className="space-y-1">
          {reasons.slice(0, 3).map((r, i) => (
            <div key={i} className="font-mono text-[9px] text-foreground/60 leading-relaxed flex items-start gap-1.5">
              <span className="text-[7px] mt-0.5 shrink-0">•</span>
              <span>{r}</span>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between pt-1 border-t border-border/50">
        <span className="font-mono text-[7px] text-muted-foreground/60">
          {updatedAt ? new Date(updatedAt).toLocaleTimeString(fr ? "fr-FR" : "en-US", { hour: "2-digit", minute: "2-digit" }) : "—"}
        </span>
        {sourceUrl && (
          <a href={sourceUrl} target="_blank" rel="noopener noreferrer"
            className="font-mono text-[7px] text-muted-foreground hover:text-foreground transition-colors">
            {fr ? "source →" : "source →"}
          </a>
        )}
      </div>
    </div>
  );
}

export default function DecisionLayersCard({ ld, fr }: { ld: LayeredDecision; fr: boolean }) {
  const { canonical, taoflute, taostats, social } = ld;

  return (
    <SectionCard>
      <div className="px-5 py-5">
        <div className="flex items-center gap-2.5 mb-4">
          <span className="text-sm">🔍</span>
          <span className="font-mono text-[10px] tracking-[0.18em] uppercase font-bold" style={{ color: GOLD }}>
            {fr ? "Sources de décision" : "Decision Sources"}
          </span>
          {!ld.layers_agree && (
            <span className="font-mono text-[7px] px-1.5 py-0.5 rounded" style={{ background: "hsla(38,70%,50%,0.08)", color: WARN, border: "1px solid hsla(38,70%,50%,0.15)" }}>
              {fr ? "DIVERGENCE" : "DIVERGENCE"}
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {/* 1. Canonical Bittensor */}
          <LayerCard
            icon="⛓"
            title={fr ? "Canonique Bittensor" : "Canonical Bittensor"}
            verdict={canonical.verdict}
            score={canonical.dereg_risk.official_dereg_risk_score}
            reasons={canonical.dereg_risk.official_dereg_reason}
            updatedAt={canonical.updated_at}
            sourceUrl={`https://taostats.io/subnets/${ld.subnet_id}`}
            fr={fr}
          />

          {/* 2. TaoFlute External */}
          <LayerCard
            icon="🛡"
            title="TaoFlute"
            verdict={taoflute.taoflute_match ? (taoflute.taoflute_severity === "priority" ? `P${taoflute.taoflute_priority ?? "?"}` : "WATCH") : "NONE"}
            reasons={taoflute.taoflute_reason.length > 0 ? taoflute.taoflute_reason : [fr ? "Aucun signal externe" : "No external signal"]}
            updatedAt={taoflute.updated_at}
            sourceUrl={taoflute.taoflute_source_url}
            fr={fr}
          />

          {/* 3. TaoStats Market */}
          <LayerCard
            icon="📊"
            title="TaoStats"
            verdict={taostats.verdict}
            reasons={[
              `${fr ? "Liquidité" : "Liquidity"}: ${taostats.liquidity_score}`,
              `${fr ? "Flux" : "Flow"}: ${taostats.flow_score}`,
              `Momentum: ${taostats.momentum_score}`,
            ]}
            updatedAt={taostats.updated_at}
            sourceUrl={`https://taostats.io/subnets/${ld.subnet_id}`}
            fr={fr}
          />

          {/* 4. Social / X */}
          <LayerCard
            icon="𝕏"
            title={fr ? "Signal Social" : "Social Signal"}
            verdict={social.social_verdict}
            reasons={
              social.mentions_24h > 0
                ? [
                    `${social.mentions_24h} mention${social.mentions_24h > 1 ? "s" : ""} 24h`,
                    `KOL: ${social.kol_score}`,
                    social.pump_risk_score > 30 ? `⚠ Pump risk: ${social.pump_risk_score}` : `Heat: ${social.heat_score}`,
                  ]
                : [fr ? "Pas de signal social récent" : "No recent social signal"]
            }
            updatedAt={social.updated_at}
            fr={fr}
          />
        </div>

        {/* Divergence notes */}
        {ld.divergence_notes.length > 0 && (
          <div className="mt-3 rounded-lg px-4 py-2.5 border border-border bg-accent/5">
            <div className="font-mono text-[7px] tracking-widest uppercase text-muted-foreground mb-1.5">
              {fr ? "DIVERGENCES DÉTECTÉES" : "DIVERGENCES DETECTED"}
            </div>
            {ld.divergence_notes.map((n, i) => (
              <div key={i} className="font-mono text-[9px] text-foreground/60 leading-relaxed">⚠ {n}</div>
            ))}
          </div>
        )}

        {/* Dominant layer + confidence */}
        <div className="flex items-center gap-3 mt-3 pt-3 border-t border-border/50">
          <span className="font-mono text-[7px] tracking-widest uppercase text-muted-foreground">
            {fr ? "COUCHE DOMINANTE" : "DOMINANT LAYER"}
          </span>
          <span className="font-mono text-[10px] font-bold" style={{ color: GOLD }}>{ld.dominant_layer}</span>
          <div className="flex-1" />
          <span className="font-mono text-[7px] tracking-widest uppercase text-muted-foreground">
            {fr ? "CONFIANCE" : "CONFIDENCE"}
          </span>
          <span className="font-mono text-[10px] font-bold" style={{ color: ld.final_confidence >= 60 ? GO : ld.final_confidence >= 40 ? WARN : BREAK }}>
            {ld.final_confidence}%
          </span>
        </div>
      </div>
    </SectionCard>
  );
}
