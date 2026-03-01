import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { runBacktest, type BacktestResult, type PipelineSnapshot, type HistoricalEvent } from "@/lib/backtest-engine";
import { toast } from "sonner";

type Period = "7d" | "14d" | "30d" | "60d";

const PERIOD_DAYS: Record<Period, number> = { "7d": 7, "14d": 14, "30d": 30, "60d": 60 };

export default function BacktestPanel() {
  const [period, setPeriod] = useState<Period>("7d");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<BacktestResult | null>(null);

  const runTest = async () => {
    setLoading(true);
    setResult(null);
    try {
      const days = PERIOD_DAYS[period];
      const since = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();

      const [snapRes, evtRes] = await Promise.all([
        supabase
          .from("pipeline_snapshots")
          .select("ts, snapshot, subnet_count, engine_version")
          .gte("ts", since)
          .order("ts", { ascending: true })
          .limit(1000),
        supabase
          .from("events")
          .select("ts, netuid, type, severity")
          .gte("ts", since)
          .order("ts", { ascending: true })
          .limit(1000),
      ]);

      if (snapRes.error) throw snapRes.error;
      if (evtRes.error) throw evtRes.error;

      const snapshots = (snapRes.data || []) as unknown as PipelineSnapshot[];
      const events = (evtRes.data || []) as unknown as HistoricalEvent[];

      if (snapshots.length === 0) {
        toast.error("Aucun snapshot disponible pour cette période");
        return;
      }

      const r = runBacktest(snapshots, events);
      setResult(r);
      toast.success(`Backtest terminé : ${r.tickCount} ticks analysés`);
    } catch (err: any) {
      toast.error(err.message || "Erreur backtest");
    } finally {
      setLoading(false);
    }
  };

  const ratingColor = (value: number, invert = false) => {
    const v = invert ? 100 - value : value;
    if (v >= 80) return "rgba(76,175,80,0.8)";
    if (v >= 50) return "rgba(255,193,7,0.8)";
    return "rgba(229,57,53,0.8)";
  };

  return (
    <div className="space-y-4">
      {/* Period selector */}
      <div className="flex gap-2 flex-wrap">
        {(Object.keys(PERIOD_DAYS) as Period[]).map((p) => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            className="px-3 py-1.5 rounded text-[11px] font-mono tracking-wider uppercase transition-all"
            style={{
              background: period === p ? "rgba(255,255,255,0.1)" : "rgba(255,255,255,0.03)",
              color: period === p ? "rgba(255,255,255,0.8)" : "rgba(255,255,255,0.35)",
              border: `1px solid ${period === p ? "rgba(255,255,255,0.15)" : "rgba(255,255,255,0.06)"}`,
            }}
          >
            {p}
          </button>
        ))}
      </div>

      {/* Run button */}
      <button
        onClick={runTest}
        disabled={loading}
        className="w-full py-2.5 rounded-lg text-sm font-semibold tracking-wider uppercase transition-all disabled:opacity-50"
        style={{
          background: "rgba(255,255,255,0.06)",
          color: "rgba(255,255,255,0.7)",
          border: "1px solid rgba(255,255,255,0.1)",
        }}
      >
        {loading ? "Analyse en cours…" : `Lancer le backtest (${period})`}
      </button>

      {/* Results */}
      {result && (
        <div className="space-y-3">
          {/* Summary metrics */}
          <div
            className="grid grid-cols-2 gap-2 p-3 rounded-lg"
            style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}
          >
            <MetricCard
              label="Faux Positifs"
              value={`${result.falsePositiveRate}%`}
              color={ratingColor(result.falsePositiveRate, true)}
              subtitle={`${result.details.unconfirmedAlerts}/${result.details.totalAlerts} alertes`}
            />
            <MetricCard
              label="Faux Négatifs"
              value={`${result.falseNegativeRate}%`}
              color={ratingColor(result.falseNegativeRate, true)}
              subtitle={`${result.details.eventsMissed}/${result.details.totalEvents} events`}
            />
            <MetricCard
              label="Délai Détection"
              value={`${result.avgDetectionDelayMin} min`}
              color={result.avgDetectionDelayMin <= 10 ? "rgba(76,175,80,0.8)" : result.avgDetectionDelayMin <= 30 ? "rgba(255,193,7,0.8)" : "rgba(229,57,53,0.8)"}
              subtitle="moyenne alerte → event"
            />
            <MetricCard
              label="Flapping Rate"
              value={`${result.flappingRate}/h`}
              color={result.flappingRate <= 0.5 ? "rgba(76,175,80,0.8)" : result.flappingRate <= 2 ? "rgba(255,193,7,0.8)" : "rgba(229,57,53,0.8)"}
              subtitle={`${result.details.totalStateChanges} changements`}
            />
          </div>

          {/* Details */}
          <div
            className="p-3 rounded-lg space-y-1.5"
            style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}
          >
            <div className="text-[10px] tracking-widest uppercase font-bold" style={{ color: "rgba(255,255,255,0.3)" }}>
              Détails
            </div>
            <DetailRow label="Période" value={`${new Date(result.period.from).toLocaleDateString()} — ${new Date(result.period.to).toLocaleDateString()}`} />
            <DetailRow label="Ticks analysés" value={String(result.tickCount)} />
            <DetailRow label="Subnets couverts" value={String(result.subnetCount)} />
            <DetailRow label="Alertes émises" value={`${result.details.totalAlerts} (${result.details.confirmedAlerts} confirmées)`} />
            <DetailRow label="Events critiques" value={`${result.details.totalEvents} (${result.details.eventsWithPriorAlert} détectés)`} />
            <DetailRow label="Heures×subnets" value={String(result.details.totalSubnetHours)} />
          </div>
        </div>
      )}
    </div>
  );
}

function MetricCard({ label, value, color, subtitle }: {
  label: string; value: string; color: string; subtitle: string;
}) {
  return (
    <div className="text-center p-2">
      <div className="text-[9px] tracking-widest uppercase mb-1" style={{ color: "rgba(255,255,255,0.3)" }}>
        {label}
      </div>
      <div className="text-lg font-bold font-mono" style={{ color }}>
        {value}
      </div>
      <div className="text-[9px] mt-0.5" style={{ color: "rgba(255,255,255,0.2)" }}>
        {subtitle}
      </div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-[11px] font-mono">
      <span style={{ color: "rgba(255,255,255,0.35)" }}>{label}</span>
      <span style={{ color: "rgba(255,255,255,0.6)" }}>{value}</span>
    </div>
  );
}
