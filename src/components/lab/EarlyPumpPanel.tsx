/* ═══════════════════════════════════════════════════════ */
/*   EARLY PUMP PANEL — Lab view for pump detection       */
/* ═══════════════════════════════════════════════════════ */

import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useI18n } from "@/lib/i18n";
import { useCanonicalSubnets } from "@/hooks/use-canonical-subnets";
import type { EarlyPumpResult } from "@/lib/early-pump-detector";
import { EarlyPumpBadge } from "@/components/sentinel/EarlyPumpBadge";
import { SectionHeader } from "@/components/sentinel/SectionHeader";

const GOLD = "hsl(var(--gold))";
const PURPLE = "hsl(280, 80%, 65%)";
const ORANGE = "hsl(25, 90%, 55%)";
const RED = "hsl(4, 80%, 55%)";

type RankedPump = EarlyPumpResult & { netuid: number; name: string | null };

export default function EarlyPumpPanel() {
  const { lang } = useI18n();
  const fr = lang === "fr";
  const { facts, earlyPumps, isLoading } = useCanonicalSubnets();

  const ranked = useMemo<RankedPump[]>(() => {
    const items: RankedPump[] = [];
    for (const [netuid, ep] of earlyPumps) {
      if (!ep.tag) continue;
      const f = facts.get(netuid);
      items.push({ ...ep, netuid, name: f?.subnet_name ?? null });
    }
    return items.sort((a, b) => b.early_pump_score - a.early_pump_score);
  }, [earlyPumps, facts]);

  const candidates = ranked.filter(r => r.tag === "EARLY_PUMP_CANDIDATE");
  const watches = ranked.filter(r => r.tag === "EARLY_PUMP_WATCH");
  const latePumps = ranked.filter(r => r.tag === "LATE_PUMP").sort((a, b) => b.overextension_score - a.overextension_score);
  const overextended = ranked.filter(r => r.tag === "OVEREXTENDED").sort((a, b) => b.overextension_score - a.overextension_score);

  if (isLoading) {
    return <div className="px-5 py-12 text-center font-mono text-[10px] text-muted-foreground animate-pulse">…</div>;
  }

  return (
    <div className="h-full overflow-y-auto" style={{ WebkitOverflowScrolling: "touch" }}>
      <div className="px-4 sm:px-6 py-5 max-w-[800px] mx-auto space-y-6">
        {/* Header */}
        <div>
          <h2 className="font-mono text-lg tracking-wider" style={{ color: PURPLE }}>
            🚀 Pump Detector
          </h2>
          <p className="font-mono text-[10px] text-muted-foreground mt-1 leading-relaxed">
            {fr
              ? "Deux détecteurs distincts : EARLY PUMP (émergence avant la masse) et LATE PUMP / OVEREXTENDED (surchauffe)."
              : "Two distinct detectors: EARLY PUMP (emerging before the crowd) and LATE PUMP / OVEREXTENDED (overheated)."}
          </p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-2">
          <StatCard label="EARLY PUMP" count={candidates.length} color={PURPLE} icon="🚀" />
          <StatCard label="PUMP WATCH" count={watches.length} color="hsl(38, 80%, 55%)" icon="👁" />
          <StatCard label="LATE PUMP" count={latePumps.length} color={ORANGE} icon="🔥" />
          <StatCard label="OVEREXT." count={overextended.length} color={RED} icon="⚠️" />
        </div>

        {/* DETECTOR 1: Early pump */}
        <div className="rounded-xl border border-border p-3">
          <div className="font-mono text-[9px] tracking-widest uppercase mb-1" style={{ color: PURPLE }}>
            {fr ? "DÉTECTEUR 1 — EARLY PUMP" : "DETECTOR 1 — EARLY PUMP"}
          </div>
          <p className="font-mono text-[8px] text-muted-foreground">
            {fr ? "Subnets émergents : accélération sociale + réveil marché + exécution viable − invalidation." : "Emerging subnets: social acceleration + market awakening + viable execution − invalidation."}
          </p>
        </div>

        {candidates.length > 0 && (
          <section>
            <SectionHeader title={fr ? "CANDIDATS EARLY PUMP" : "EARLY PUMP CANDIDATES"} icon="🚀" accentVar="--primary" badge={
              <span className="font-mono text-[9px] font-bold px-2 py-0.5 rounded" style={{ background: `${PURPLE}14`, color: PURPLE, border: `1px solid ${PURPLE}30` }}>{candidates.length}</span>
            } />
            <div className="rounded-xl overflow-hidden border border-border">
              {candidates.map((r, i) => (
                <PumpRow key={r.netuid} r={r} fr={fr} last={i === candidates.length - 1} scoreKey="early" />
              ))}
            </div>
          </section>
        )}

        {watches.length > 0 && (
          <section>
            <SectionHeader title="PUMP WATCH" icon="👁" badge={
              <span className="font-mono text-[8px] text-muted-foreground">{watches.length}</span>
            } />
            <div className="rounded-xl overflow-hidden border border-border">
              {watches.map((r, i) => (
                <PumpRow key={r.netuid} r={r} fr={fr} last={i === watches.length - 1} scoreKey="early" />
              ))}
            </div>
          </section>
        )}

        {/* DETECTOR 2: Late pump / overextended */}
        <div className="rounded-xl border border-border p-3" style={{ borderColor: `${ORANGE}30` }}>
          <div className="font-mono text-[9px] tracking-widest uppercase mb-1" style={{ color: ORANGE }}>
            {fr ? "DÉTECTEUR 2 — LATE PUMP / OVEREXTENDED" : "DETECTOR 2 — LATE PUMP / OVEREXTENDED"}
          </div>
          <p className="font-mono text-[8px] text-muted-foreground">
            {fr ? "Subnets surchauffés : hausse extrême, expansion trop rapide, euphorie tardive, exécution dégradée." : "Overheated subnets: extreme rise, too-rapid expansion, late euphoria, degraded execution."}
          </p>
        </div>

        {overextended.length > 0 && (
          <section>
            <SectionHeader title="OVEREXTENDED" icon="⚠️" badge={
              <span className="font-mono text-[9px] font-bold px-2 py-0.5 rounded" style={{ background: `${RED}14`, color: RED, border: `1px solid ${RED}30` }}>{overextended.length}</span>
            } />
            <div className="rounded-xl overflow-hidden border border-border">
              {overextended.map((r, i) => (
                <PumpRow key={r.netuid} r={r} fr={fr} last={i === overextended.length - 1} scoreKey="overext" />
              ))}
            </div>
          </section>
        )}

        {latePumps.length > 0 && (
          <section>
            <SectionHeader title="LATE PUMP" icon="🔥" badge={
              <span className="font-mono text-[8px] text-muted-foreground">{latePumps.length}</span>
            } />
            <div className="rounded-xl overflow-hidden border border-border">
              {latePumps.map((r, i) => (
                <PumpRow key={r.netuid} r={r} fr={fr} last={i === latePumps.length - 1} scoreKey="overext" />
              ))}
            </div>
          </section>
        )}

        {ranked.length === 0 && (
          <div className="rounded-xl border border-border py-12 text-center">
            <span className="font-mono text-[11px] text-muted-foreground">
              {fr ? "Aucun signal pump détecté actuellement." : "No pump signal detected currently."}
            </span>
          </div>
        )}

        {/* Methodology */}
        <div className="rounded-xl border border-border p-4">
          <div className="font-mono text-[9px] tracking-widest uppercase mb-2" style={{ color: GOLD }}>
            {fr ? "MÉTHODOLOGIE" : "METHODOLOGY"}
          </div>
          <div className="space-y-1.5">
            {[
              { label: "Social Acceleration", desc: fr ? "Variation mentions, diversité comptes, surpoids KOL Tier A/B" : "Mention velocity, account diversity, KOL Tier A/B weighting" },
              { label: "Market Awakening", desc: fr ? "Hausse progressive prix/volume, pression acheteuse, breakout précoce" : "Progressive price/volume rise, buy pressure, early breakout" },
              { label: "Execution Viability", desc: fr ? "Liquidité, slippage, spread, profondeur minimum" : "Liquidity, slippage, spread, minimum depth" },
              { label: "Overextension", desc: fr ? "Hausse extrême, expansion rapide, euphorie tardive, concentration, slippage dégradé" : "Extreme rise, rapid expansion, late euphoria, concentration, degraded slippage" },
              { label: "Invalidation", desc: fr ? "Malus TaoFlute, delist/depeg, concentration, structure toxique" : "TaoFlute penalty, delist/depeg, concentration, toxic structure" },
            ].map((m, i) => (
              <div key={i} className="flex items-start gap-2">
                <span className="font-mono text-[8px] font-bold mt-0.5" style={{ color: GOLD }}>{i + 1}.</span>
                <div>
                  <span className="font-mono text-[9px] font-bold text-foreground">{m.label}</span>
                  <span className="font-mono text-[8px] text-muted-foreground ml-1.5">— {m.desc}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Sub-components ── */

function StatCard({ label, count, color, icon }: { label: string; count: number; color: string; icon: string }) {
  return (
    <div className="rounded-xl border border-border p-3 text-center" style={{ background: `color-mix(in srgb, ${color} 4%, transparent)`, borderColor: `color-mix(in srgb, ${color} 15%, transparent)` }}>
      <div className="text-lg">{icon}</div>
      <div className="font-mono text-xl font-bold" style={{ color }}>{count}</div>
      <div className="font-mono text-[7px] tracking-wider uppercase text-muted-foreground">{label}</div>
    </div>
  );
}

function PumpRow({ r, fr, last, scoreKey }: { r: RankedPump; fr: boolean; last: boolean; scoreKey: "early" | "overext" }) {
  const displayScore = scoreKey === "overext" ? r.overextension_score : r.early_pump_score;
  return (
    <Link
      to={`/subnets/${r.netuid}`}
      className="flex items-start gap-3 px-4 py-3 hover:bg-accent/30 transition-colors"
      style={{ borderBottom: last ? "none" : "1px solid hsl(var(--border))" }}
    >
      <div className="flex flex-col items-center gap-1 flex-shrink-0" style={{ minWidth: 48 }}>
        <span className="font-mono text-[11px] font-bold" style={{ color: GOLD }}>SN-{r.netuid}</span>
        <EarlyPumpBadge tag={r.tag} score={displayScore} size="sm" showScore />
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-mono text-[10px] text-foreground/80 truncate">{r.name ?? "—"}</div>
        <div className="grid grid-cols-5 gap-1 mt-1.5">
          <ScoreBar label="Social" value={r.social_acceleration_score} color="hsl(280, 70%, 60%)" />
          <ScoreBar label={fr ? "Marché" : "Market"} value={r.market_awakening_score} color="hsl(145, 65%, 48%)" />
          <ScoreBar label={fr ? "Exéc." : "Exec."} value={r.execution_viability_score} color="hsl(200, 70%, 55%)" />
          <ScoreBar label="Overext." value={r.overextension_score} color="hsl(25, 90%, 55%)" />
          <ScoreBar label="Inval." value={r.invalidation_score} color="hsl(4, 80%, 50%)" />
        </div>
        {r.reasons.slice(0, 3).map((reason, i) => (
          <div key={i} className="font-mono text-[8px] text-muted-foreground mt-0.5">• {reason}</div>
        ))}
        <div className="font-mono text-[7px] text-muted-foreground/50 mt-1">
          {fr ? "Détecté" : "Detected"}: {new Date(r.detected_at).toLocaleTimeString()}
        </div>
      </div>
    </Link>
  );
}

function ScoreBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-0.5">
        <span className="font-mono text-[7px] text-muted-foreground">{label}</span>
        <span className="font-mono text-[7px] font-bold" style={{ color }}>{value}</span>
      </div>
      <div className="h-1 rounded-full bg-muted/30 overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${value}%`, background: color }} />
      </div>
    </div>
  );
}
