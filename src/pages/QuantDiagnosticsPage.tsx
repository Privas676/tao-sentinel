import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useI18n } from "@/lib/i18n";
import { useSubnetScores } from "@/hooks/use-subnet-scores";
import { analyzeDistribution } from "@/lib/distribution-monitor";
import { analyzeScoreVolatility, type FleetVolatilityReport } from "@/lib/score-volatility";
import { supabase } from "@/integrations/supabase/client";
import CorrelationPanel from "@/components/CorrelationPanel";
import PredictivePowerPanel from "@/components/PredictivePowerPanel";

/* ── Histogram renderer ── */
function Histogram({ values, label, bins = 10 }: { values: number[]; label: string; bins?: number }) {
  const buckets = useMemo(() => {
    const b = new Array(bins).fill(0);
    for (const v of values) {
      const idx = Math.min(Math.floor(v / (100 / bins)), bins - 1);
      b[idx]++;
    }
    return b;
  }, [values, bins]);
  const max = Math.max(...buckets, 1);

  return (
    <div>
      <span className="font-mono text-[10px] text-white/40 tracking-wider">{label}</span>
      <div className="flex items-end gap-px mt-1" style={{ height: 60 }}>
        {buckets.map((count, i) => {
          const pct = (count / max) * 100;
          const rangeStart = Math.round(i * (100 / bins));
          const rangeEnd = Math.round((i + 1) * (100 / bins));
          return (
            <div
              key={i}
              className="flex-1 rounded-t transition-all cursor-help"
              style={{
                height: `${pct}%`,
                minHeight: count > 0 ? 3 : 1,
                background: count > 0
                  ? `rgba(76,175,80,${0.3 + (pct / 100) * 0.5})`
                  : "rgba(255,255,255,0.03)",
              }}
              title={`${rangeStart}–${rangeEnd}: ${count} subnets`}
            />
          );
        })}
      </div>
      <div className="flex justify-between font-mono text-[7px] text-white/15 mt-0.5">
        <span>0</span><span>50</span><span>100</span>
      </div>
    </div>
  );
}

/* ── Stat line ── */
function Stat({ label, value, warn }: { label: string; value: string | number; warn?: boolean }) {
  return (
    <div className="flex justify-between border-b border-white/[0.04] pb-1">
      <span className="font-mono text-[10px] text-white/40">{label}</span>
      <span
        className="font-mono text-[10px]"
        style={{ color: warn ? "rgba(229,57,53,0.85)" : "rgba(255,255,255,0.6)" }}
      >
        {value}
      </span>
    </div>
  );
}

/* ── Flag badge ── */
function Flag({ active, label }: { active: boolean; label: string }) {
  if (!active) return null;
  return (
    <div
      className="font-mono text-[9px] px-2 py-1 rounded animate-pulse"
      style={{
        background: "rgba(229,57,53,0.1)",
        color: "rgba(229,57,53,0.85)",
        border: "1px solid rgba(229,57,53,0.2)",
      }}
    >
      ⚠ {label}
    </div>
  );
}

/* ── Volatility Panel ── */
function VolatilityPanel({ fr }: { fr: boolean }) {
  const [window, setWindow] = useState<"24h" | "7d">("24h");

  const hoursBack = window === "24h" ? 24 : 168;
  const since = useMemo(
    () => new Date(Date.now() - hoursBack * 3600_000).toISOString(),
    [hoursBack],
  );

  const { data: volatility, isLoading } = useQuery({
    queryKey: ["quant-volatility", window],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pipeline_snapshots")
        .select("ts, snapshot")
        .gte("ts", since)
        .order("ts", { ascending: true })
        .limit(1000);
      if (error) throw error;
      return analyzeScoreVolatility(
        (data || []).map(d => ({ ts: d.ts, snapshot: d.snapshot as any[] })),
        window,
      );
    },
    refetchInterval: 300_000,
  });

  return (
    <div className="border border-white/[0.06] rounded-lg p-4 space-y-4">
      <div className="flex items-center justify-between">
        <span className="font-mono text-xs tracking-widest text-white/50">
          {fr ? "VOLATILITÉ DES SCORES" : "SCORE VOLATILITY"}
        </span>
        <div className="flex gap-1">
          {(["24h", "7d"] as const).map(w => (
            <button
              key={w}
              onClick={() => setWindow(w)}
              className="font-mono text-[9px] px-2 py-1 rounded transition-all"
              style={{
                background: window === w ? "rgba(255,255,255,0.08)" : "transparent",
                color: window === w ? "rgba(255,255,255,0.6)" : "rgba(255,255,255,0.25)",
                border: `1px solid ${window === w ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.04)"}`,
              }}
            >
              {w}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="font-mono text-[10px] text-white/20 py-4 text-center">
          {fr ? "Analyse des snapshots…" : "Analyzing snapshots…"}
        </div>
      ) : volatility ? (
        <VolatilityContent report={volatility} fr={fr} />
      ) : null}
    </div>
  );
}

function VolatilityContent({ report, fr }: { report: FleetVolatilityReport; fr: boolean }) {
  const [showTop, setShowTop] = useState(false);

  return (
    <div className="space-y-3">
      {/* Flags */}
      <div className="space-y-1.5">
        <Flag
          active={report.scoreInstability}
          label={
            fr
              ? `Score Instability — ${report.scoreInstabilityPsi ? `ΔPSI>20: ${report.pctPsiAbove20}%` : ""} ${report.scoreInstabilityRisk ? `ΔRisk>25: ${report.pctRiskAbove25}%` : ""} des subnets instables`
              : `Score Instability — ${report.scoreInstabilityPsi ? `ΔPSI>20: ${report.pctPsiAbove20}%` : ""} ${report.scoreInstabilityRisk ? `ΔRisk>25: ${report.pctRiskAbove25}%` : ""} of subnets unstable`
          }
        />
        {!report.scoreInstability && report.subnetCount > 0 && (
          <div
            className="font-mono text-[9px] px-2 py-1 rounded"
            style={{
              background: "rgba(76,175,80,0.08)",
              color: "rgba(76,175,80,0.7)",
              border: "1px solid rgba(76,175,80,0.15)",
            }}
          >
            ✓ {fr ? "Scores stables — aucune instabilité détectée" : "Scores stable — no instability detected"}
          </div>
        )}
      </div>

      {/* Meta */}
      <div className="font-mono text-[9px] text-white/20">
        {report.snapshotCount} snapshots · {report.subnetCount} subnets · {report.window}
      </div>

      {/* Stats */}
      <div className="space-y-1">
        <Stat label={fr ? "ΔPSI moyen (1h)" : "Avg ΔPSI (1h)"} value={report.avgDeltaPsi} />
        <Stat label={fr ? "ΔRisk moyen (1h)" : "Avg ΔRisk (1h)"} value={report.avgDeltaRisk} />
        <Stat
          label={fr ? "% subnets ΔPSI > 20 (1h)" : "% subnets ΔPSI > 20 (1h)"}
          value={`${report.pctPsiAbove20}%`}
          warn={report.pctPsiAbove20 > 20}
        />
        <Stat
          label={fr ? "% subnets ΔRisk > 25 (1h)" : "% subnets ΔRisk > 25 (1h)"}
          value={`${report.pctRiskAbove25}%`}
          warn={report.pctRiskAbove25 > 20}
        />
      </div>

      {/* Top movers toggle */}
      {report.subnets.length > 0 && (
        <div>
          <button
            onClick={() => setShowTop(v => !v)}
            className="font-mono text-[9px] text-white/30 hover:text-white/50 transition-colors"
          >
            {showTop
              ? (fr ? "▼ Masquer le détail" : "▼ Hide detail")
              : (fr ? "▶ Top 10 subnets les plus volatils" : "▶ Top 10 most volatile subnets")}
          </button>

          {showTop && (
            <div className="mt-2 space-y-0.5">
              <div className="grid grid-cols-5 gap-1 font-mono text-[8px] text-white/25 pb-1 border-b border-white/[0.04]">
                <span>SN</span>
                <span>ΔPSI avg</span>
                <span>ΔPSI max</span>
                <span>ΔRisk avg</span>
                <span>ΔRisk max</span>
              </div>
              {report.subnets.slice(0, 10).map(s => {
                const psiWarn = s.deltaPsiMax1h > 20;
                const riskWarn = s.deltaRiskMax1h > 25;
                return (
                  <div
                    key={s.netuid}
                    className="grid grid-cols-5 gap-1 font-mono text-[9px] py-0.5"
                    style={{
                      color: psiWarn || riskWarn ? "rgba(229,57,53,0.7)" : "rgba(255,255,255,0.4)",
                    }}
                  >
                    <span className="text-white/50">SN-{s.netuid}</span>
                    <span>{s.deltaPsiMean1h}</span>
                    <span style={{ fontWeight: psiWarn ? 700 : 400 }}>{s.deltaPsiMax1h}</span>
                    <span>{s.deltaRiskMean1h}</span>
                    <span style={{ fontWeight: riskWarn ? 700 : 400 }}>{s.deltaRiskMax1h}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function QuantDiagnosticsPage() {
  const { lang } = useI18n();
  const fr = lang === "fr";
  const { scoresList, isLoading } = useSubnetScores();

  const { psiValues, riskValues } = useMemo(() => {
    const psi: number[] = [];
    const risk: number[] = [];
    for (const s of scoresList) {
      psi.push(s.psi);
      risk.push(s.risk);
    }
    return { psiValues: psi, riskValues: risk };
  }, [scoresList]);

  const psiReport = useMemo(() => analyzeDistribution(psiValues, "PSI"), [psiValues]);
  const riskReport = useMemo(() => analyzeDistribution(riskValues, "Risk"), [riskValues]);

  // Custom thresholds for flags
  const baisHaussier = psiValues.length >= 5 && psiValues.filter(v => v > 85).length / psiValues.length > 0.35;
  const stressGlobal = riskValues.length >= 5 && riskValues.filter(v => v > 80).length / riskValues.length > 0.30;
  const pctPsiBelow40 = psiValues.length > 0
    ? Math.round((psiValues.filter(v => v < 40).length / psiValues.length) * 100)
    : 0;
  const pctRiskAbove80 = riskValues.length > 0
    ? Math.round((riskValues.filter(v => v > 80).length / riskValues.length) * 100)
    : 0;

  if (isLoading) {
    return (
      <div className="h-full w-full bg-black text-white/30 flex items-center justify-center font-mono text-xs">
        {fr ? "Chargement…" : "Loading…"}
      </div>
    );
  }

  return (
    <div className="h-full w-full bg-black text-white/70 overflow-auto px-4 sm:px-8 pb-16">
      <div className="max-w-2xl mx-auto">
        <Link
          to="/settings"
          className="inline-flex items-center gap-1.5 font-mono text-[10px] tracking-wider text-white/25 hover:text-white/50 transition-colors mb-6"
        >
          ← {fr ? "Retour aux paramètres" : "Back to settings"}
        </Link>

        <h1 className="font-mono text-base tracking-widest text-white/80 mb-1">
          🔬 QUANT DIAGNOSTICS
        </h1>
        <p className="font-mono text-[10px] text-white/25 mb-8">
          {fr
            ? `Analyse de distribution sur ${psiValues.length} subnets — module lecture seule, ne modifie pas le scoring.`
            : `Distribution analysis on ${psiValues.length} subnets — read-only module, does not modify scoring.`}
        </p>

        {/* ── Automatic Flags ── */}
        <div className="space-y-1.5 mb-8">
          <Flag
            active={psiReport.isCompressed}
            label={fr ? "Distribution PSI compressée (σ < 8)" : "PSI distribution compressed (σ < 8)"}
          />
          <Flag
            active={riskReport.isCompressed}
            label={fr ? "Distribution Risk compressée (σ < 8)" : "Risk distribution compressed (σ < 8)"}
          />
          <Flag
            active={baisHaussier}
            label={fr ? `Biais haussier — ${psiReport.pctAbove85}% PSI > 85` : `Bullish bias — ${psiReport.pctAbove85}% PSI > 85`}
          />
          <Flag
            active={stressGlobal}
            label={fr ? `Stress global possible — ${pctRiskAbove80}% Risk > 80` : `Possible global stress — ${pctRiskAbove80}% Risk > 80`}
          />
          <Flag
            active={psiReport.isExtremeLow}
            label={fr ? `PSI extrême bas — ${psiReport.pctBelow15}% < 15` : `PSI extreme low — ${psiReport.pctBelow15}% < 15`}
          />
          {!psiReport.isCompressed && !riskReport.isCompressed && !baisHaussier && !stressGlobal && !psiReport.isExtremeLow && (
            <div
              className="font-mono text-[9px] px-2 py-1 rounded"
              style={{
                background: "rgba(76,175,80,0.08)",
                color: "rgba(76,175,80,0.7)",
                border: "1px solid rgba(76,175,80,0.15)",
              }}
            >
              ✓ {fr ? "Distributions saines — aucun flag actif" : "Healthy distributions — no flags active"}
            </div>
          )}
        </div>

        {/* ── PSI Section ── */}
        <div className="border border-white/[0.06] rounded-lg p-4 mb-4 space-y-3">
          <span className="font-mono text-xs tracking-widest text-white/50">PSI (Potential Signal Index)</span>
          <Histogram values={psiValues} label={fr ? "Distribution" : "Distribution"} />
          <div className="space-y-1">
            <Stat label={fr ? "Moyenne" : "Mean"} value={psiReport.mean.toFixed(1)} />
            <Stat label={fr ? "Médiane (P50)" : "Median (P50)"} value={psiReport.p50} />
            <Stat label={fr ? "Écart-type (σ)" : "Std dev (σ)"} value={psiReport.std} warn={psiReport.isCompressed} />
            <Stat label="P10" value={psiReport.p10} />
            <Stat label="P25" value={Math.round(percentile([...psiValues].sort((a, b) => a - b), 25) * 10) / 10} />
            <Stat label="P50" value={psiReport.p50} />
            <Stat label="P75" value={Math.round(percentile([...psiValues].sort((a, b) => a - b), 75) * 10) / 10} />
            <Stat label="P90" value={psiReport.p90} />
            <Stat label="% PSI > 85" value={`${psiReport.pctAbove85}%`} warn={psiReport.pctAbove85 > 35} />
            <Stat label="% PSI < 40" value={`${pctPsiBelow40}%`} />
          </div>
        </div>

        {/* ── Risk Section ── */}
        <div className="border border-white/[0.06] rounded-lg p-4 mb-4 space-y-3">
          <span className="font-mono text-xs tracking-widest text-white/50">RISK SCORE</span>
          <Histogram values={riskValues} label={fr ? "Distribution" : "Distribution"} />
          <div className="space-y-1">
            <Stat label={fr ? "Moyenne" : "Mean"} value={riskReport.mean.toFixed(1)} />
            <Stat label={fr ? "Médiane (P50)" : "Median (P50)"} value={riskReport.p50} />
            <Stat label={fr ? "Écart-type (σ)" : "Std dev (σ)"} value={riskReport.std} warn={riskReport.isCompressed} />
            <Stat label="P10" value={riskReport.p10} />
            <Stat label="P25" value={Math.round(percentile([...riskValues].sort((a, b) => a - b), 25) * 10) / 10} />
            <Stat label="P50" value={riskReport.p50} />
            <Stat label="P75" value={Math.round(percentile([...riskValues].sort((a, b) => a - b), 75) * 10) / 10} />
            <Stat label="P90" value={riskReport.p90} />
            <Stat label="% Risk > 80" value={`${pctRiskAbove80}%`} warn={pctRiskAbove80 > 30} />
            <Stat label="% Risk > 85" value={`${riskReport.pctAbove85}%`} warn={riskReport.pctAbove85 > 50} />
          </div>
        </div>

        {/* ── Correlation Section ── */}
        <div className="mb-4">
          <CorrelationPanel psiValues={psiValues} riskValues={riskValues} fr={fr} />
        </div>

        {/* ── Predictive Power Section ── */}
        <div className="mb-4">
          <PredictivePowerPanel fr={fr} />
        </div>

        {/* ── Score Volatility Section ── */}
        <div className="mb-4">
          <VolatilityPanel fr={fr} />
        </div>

        <p className="font-mono text-[8px] text-white/15 text-center mt-8">
          {fr ? "Module purement analytique — aucune modification du scoring" : "Purely analytical module — no scoring modification"}
        </p>
      </div>
    </div>
  );
}

/* Local percentile helper */
function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}
