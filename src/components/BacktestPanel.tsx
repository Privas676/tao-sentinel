import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { runBacktest, type BacktestResult, type PipelineSnapshot, type HistoricalEvent, type TickMetric, type SnapshotSubnet } from "@/lib/backtest-engine";
import { toast } from "sonner";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

type Period = "7d" | "14d" | "30d" | "60d";

const PERIOD_DAYS: Record<Period, number> = { "7d": 7, "14d": 14, "30d": 30, "60d": 60 };

const IS_DEV = import.meta.env.DEV;

/* ── Simulation: generates fake snapshots + events for sparkline testing ── */
function generateSimulatedData(days: number) {
  const TICK_INTERVAL_MS = 60 * 60 * 1000; // 1h
  const tickCount = days * 24;
  const now = Date.now();
  const start = now - days * 24 * 3600 * 1000;
  const STATES = ["WATCH", "HOLD", "BREAK", "GO", "GO_SPECULATIVE", "EARLY"];
  const NETUIDS = [1, 2, 6, 8, 13, 18, 33, 42, 50, 73];

  const snapshots: PipelineSnapshot[] = [];
  const events: HistoricalEvent[] = [];
  const prevState = new Map<number, string>();

  for (let i = 0; i < tickCount; i++) {
    const ts = new Date(start + i * TICK_INTERVAL_MS).toISOString();
    const subs: SnapshotSubnet[] = NETUIDS.map((netuid) => {
      const cycle = Math.sin((i + netuid) / 12) * 0.5 + 0.5; // 0..1 wave
      const noise = (Math.random() - 0.5) * 0.2;
      const mpi = Math.round(Math.max(0, Math.min(100, cycle * 80 + noise * 40 + 10)));
      const conf = Math.round(Math.max(0, Math.min(100, cycle * 70 + noise * 30 + 20)));
      const stateIdx = mpi > 80 ? (Math.random() > 0.5 ? 3 : 4) // GO or GO_SPECULATIVE
        : mpi > 55 ? 0  // WATCH
        : mpi > 35 ? 1  // HOLD
        : 2;             // BREAK
      const state = STATES[stateIdx];
      prevState.set(netuid, state);

      return {
        netuid, price: 0.5 + cycle * 2, price_5m: 0.5, price_1h: 0.5,
        liq: 5000 + cycle * 20000, liq_1h: 5000, miners: 64, miners_delta: 0,
        price_max_7d: 3, mpi_raw: mpi, M: mpi, A: conf, L: 70, B: 50, Q: 60,
        mpi, quality: Math.round(mpi * 0.9), confidence: conf,
        state, gating_fail: false, breakout: mpi > 85,
      };
    });

    snapshots.push({ ts, snapshot: subs, subnet_count: NETUIDS.length, engine_version: "v4-sim" });

    // Sprinkle some critical events
    if (i > 0 && Math.random() < 0.08) {
      const netuid = NETUIDS[Math.floor(Math.random() * NETUIDS.length)];
      events.push({
        ts: new Date(start + i * TICK_INTERVAL_MS + 5 * 60000).toISOString(),
        netuid,
        type: ["DEPEG_WARNING", "BREAK", "EXIT_FAST"][Math.floor(Math.random() * 3)],
        severity: Math.floor(Math.random() * 5) + 5,
      });
    }
    // Sprinkle confirming events
    if (i > 0 && Math.random() < 0.06) {
      const netuid = NETUIDS[Math.floor(Math.random() * NETUIDS.length)];
      events.push({
        ts: new Date(start + i * TICK_INTERVAL_MS + 10 * 60000).toISOString(),
        netuid,
        type: ["GO", "SMART_ACCUMULATION"][Math.floor(Math.random() * 2)],
        severity: 3,
      });
    }
  }

  return { snapshots, events };
}

type CompareEntry = { period: Period; result: BacktestResult };

export default function BacktestPanel() {
  const [period, setPeriod] = useState<Period>("7d");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [comparing, setComparing] = useState(false);
  const [comparison, setComparison] = useState<CompareEntry[] | null>(null);

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

  const runSimulation = () => {
    setLoading(true);
    setResult(null);
    setComparison(null);
    try {
      const days = PERIOD_DAYS[period];
      const { snapshots, events } = generateSimulatedData(days);
      const r = runBacktest(snapshots, events);
      setResult(r);
      toast.success(`Simulation terminée : ${r.tickCount} ticks simulés`);
    } catch (err: any) {
      toast.error(err.message || "Erreur simulation");
    } finally {
      setLoading(false);
    }
  };

  const runCompare = async (simulate = false) => {
    setComparing(true);
    setComparison(null);
    setResult(null);
    try {
      const periods: Period[] = ["7d", "14d", "30d", "60d"];
      const entries: CompareEntry[] = [];

      for (const p of periods) {
        const days = PERIOD_DAYS[p];
        let snapshots: PipelineSnapshot[];
        let events: HistoricalEvent[];

        if (simulate) {
          const sim = generateSimulatedData(days);
          snapshots = sim.snapshots;
          events = sim.events;
        } else {
          const since = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
          const [snapRes, evtRes] = await Promise.all([
            supabase.from("pipeline_snapshots")
              .select("ts, snapshot, subnet_count, engine_version")
              .gte("ts", since).order("ts", { ascending: true }).limit(1000),
            supabase.from("events")
              .select("ts, netuid, type, severity")
              .gte("ts", since).order("ts", { ascending: true }).limit(1000),
          ]);
          if (snapRes.error) throw snapRes.error;
          if (evtRes.error) throw evtRes.error;
          snapshots = (snapRes.data || []) as unknown as PipelineSnapshot[];
          events = (evtRes.data || []) as unknown as HistoricalEvent[];
        }

        if (snapshots.length > 0) {
          entries.push({ period: p, result: runBacktest(snapshots, events) });
        }
      }

      if (entries.length === 0) {
        toast.error("Aucun snapshot disponible");
        return;
      }

      setComparison(entries);
      toast.success(`Comparaison terminée : ${entries.length} périodes`);
    } catch (err: any) {
      toast.error(err.message || "Erreur comparaison");
    } finally {
      setComparing(false);
    }
  };

  const ratingColor = (value: number, invert = false) => {
    const v = invert ? 100 - value : value;
    if (v >= 80) return "rgba(76,175,80,0.8)";
    if (v >= 50) return "rgba(255,193,7,0.8)";
    return "rgba(229,57,53,0.8)";
  };

  const gradeColor = (score: number) => {
    if (score >= 85) return "rgba(76,175,80,0.9)";
    if (score >= 70) return "rgba(139,195,74,0.9)";
    if (score >= 50) return "rgba(255,193,7,0.9)";
    if (score >= 30) return "rgba(255,152,0,0.9)";
    return "rgba(229,57,53,0.9)";
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

      {/* Simulate button — DEV only */}
      {IS_DEV && (
        <button
          onClick={runSimulation}
          disabled={loading}
          className="w-full py-2 rounded-lg text-[11px] font-mono tracking-wider uppercase transition-all disabled:opacity-50"
          style={{
            background: "rgba(171,71,188,0.08)",
            color: "rgba(171,71,188,0.7)",
            border: "1px dashed rgba(171,71,188,0.25)",
          }}
        >
          {loading ? "…" : `🧪 Simuler (${period} — données fictives)`}
        </button>
      )}

      {/* Compare buttons */}
      <div className="flex gap-2">
        <button
          onClick={() => runCompare(false)}
          disabled={loading || comparing}
          className="flex-1 py-2 rounded-lg text-[11px] font-mono tracking-wider uppercase transition-all disabled:opacity-50"
          style={{
            background: "rgba(66,165,245,0.08)",
            color: "rgba(66,165,245,0.7)",
            border: "1px solid rgba(66,165,245,0.2)",
          }}
        >
          {comparing ? "…" : "📊 Comparer toutes les périodes"}
        </button>
        {IS_DEV && (
          <button
            onClick={() => runCompare(true)}
            disabled={loading || comparing}
            className="py-2 px-3 rounded-lg text-[11px] font-mono tracking-wider uppercase transition-all disabled:opacity-50"
            style={{
              background: "rgba(171,71,188,0.08)",
              color: "rgba(171,71,188,0.6)",
              border: "1px dashed rgba(171,71,188,0.2)",
            }}
          >
            {comparing ? "…" : "🧪 Sim"}
          </button>
        )}
      </div>

      {/* Comparison table */}
      {comparison && <ComparisonTable entries={comparison} gradeColor={gradeColor} />}

      {result && (
        <div className="space-y-3">
          {/* Reliability Score Hero */}
          <div
            className="flex items-center justify-between p-4 rounded-lg"
            style={{
              background: `linear-gradient(135deg, ${gradeColor(result.reliabilityScore)}15, transparent)`,
              border: `1px solid ${gradeColor(result.reliabilityScore)}30`,
            }}
          >
            <div>
              <div className="text-[9px] tracking-widest uppercase mb-0.5" style={{ color: "rgba(255,255,255,0.35)" }}>
                Score de fiabilité
              </div>
              <div className="text-[10px] font-mono" style={{ color: "rgba(255,255,255,0.3)" }}>
                FP×25% + FN×35% + Délai×20% + Flap×20%
              </div>
            </div>
            <div className="text-right flex items-baseline gap-2">
              <span
                className="text-3xl font-black font-mono"
                style={{ color: gradeColor(result.reliabilityScore) }}
              >
                {result.reliabilityGrade}
              </span>
              <span
                className="text-lg font-bold font-mono"
                style={{ color: gradeColor(result.reliabilityScore), opacity: 0.7 }}
              >
                {result.reliabilityScore}%
              </span>
            </div>
          </div>

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

          {/* Sparklines */}
          {result.tickMetrics.length > 1 && (
            <div
              className="p-3 rounded-lg space-y-3"
              style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}
            >
              <div className="text-[10px] tracking-widest uppercase font-bold" style={{ color: "rgba(255,255,255,0.3)" }}>
                Évolution temporelle
              </div>
              <Sparkline
                data={result.tickMetrics}
                dataKey="avgMpi"
                label="MPI moyen"
                color="#4CAF50"
                domain={[0, 100]}
              />
              <Sparkline
                data={result.tickMetrics}
                dataKey="avgConfidence"
                label="Confiance moyenne"
                color="#42A5F5"
                domain={[0, 100]}
              />
              <Sparkline
                data={result.tickMetrics}
                dataKey="alertCount"
                label="Alertes / tick"
                color="#FFC107"
              />
              <Sparkline
                data={result.tickMetrics}
                dataKey="stateChanges"
                label="Changements d'état"
                color="#E53935"
              />
              <Sparkline
                data={result.tickMetrics}
                dataKey="activeSubnets"
                label="Subnets actifs"
                color="#AB47BC"
              />
            </div>
          )}

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

/* ── Sparkline component ── */

function Sparkline({ data, dataKey, label, color, domain }: {
  data: TickMetric[];
  dataKey: keyof TickMetric;
  label: string;
  color: string;
  domain?: [number, number];
}) {
  const formatTime = (ts: string) => {
    const d = new Date(ts);
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="font-mono text-[9px] tracking-wider" style={{ color: "rgba(255,255,255,0.35)" }}>
          {label}
        </span>
        <span className="font-mono text-[9px]" style={{ color }}>
          {data.length > 0 ? String(data[data.length - 1][dataKey]) : "—"}
        </span>
      </div>
      <ResponsiveContainer width="100%" height={40}>
        <AreaChart data={data} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={`grad-${dataKey}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.3} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          {domain && <YAxis domain={domain} hide />}
          <XAxis dataKey="ts" hide />
          <Tooltip
            contentStyle={{
              background: "rgba(0,0,0,0.85)",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 6,
              fontSize: 10,
              fontFamily: "monospace",
              color: "rgba(255,255,255,0.7)",
            }}
            labelFormatter={formatTime}
            formatter={(value: number) => [value, label]}
          />
          <Area
            type="monotone"
            dataKey={dataKey}
            stroke={color}
            strokeWidth={1.5}
            fill={`url(#grad-${dataKey})`}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
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

/* ── Comparison Table ── */

function ComparisonTable({ entries, gradeColor }: {
  entries: CompareEntry[];
  gradeColor: (score: number) => string;
}) {
  // Find trend direction between shortest and longest period
  const trend = entries.length >= 2
    ? entries[entries.length - 1].result.reliabilityScore - entries[0].result.reliabilityScore
    : 0;
  const trendIcon = trend > 5 ? "📈" : trend < -5 ? "📉" : "➡️";
  const trendLabel = trend > 5 ? "En amélioration" : trend < -5 ? "En dégradation" : "Stable";

  return (
    <div
      className="p-3 rounded-lg space-y-3"
      style={{ background: "rgba(66,165,245,0.03)", border: "1px solid rgba(66,165,245,0.12)" }}
    >
      <div className="flex items-center justify-between">
        <div className="text-[10px] tracking-widest uppercase font-bold" style={{ color: "rgba(255,255,255,0.3)" }}>
          Comparaison inter-périodes
        </div>
        <div className="text-[10px] font-mono" style={{ color: trend > 5 ? "rgba(76,175,80,0.8)" : trend < -5 ? "rgba(229,57,53,0.8)" : "rgba(255,255,255,0.4)" }}>
          {trendIcon} {trendLabel}
        </div>
      </div>

      {/* Score bar chart */}
      <div className="flex items-end gap-2 h-20">
        {entries.map((e) => {
          const h = Math.max(8, (e.result.reliabilityScore / 100) * 100);
          return (
            <div key={e.period} className="flex-1 flex flex-col items-center gap-1">
              <span className="font-mono text-[9px] font-bold" style={{ color: gradeColor(e.result.reliabilityScore) }}>
                {e.result.reliabilityGrade}
              </span>
              <div
                className="w-full rounded-t transition-all"
                style={{
                  height: `${h}%`,
                  background: `linear-gradient(to top, ${gradeColor(e.result.reliabilityScore)}40, ${gradeColor(e.result.reliabilityScore)}15)`,
                  border: `1px solid ${gradeColor(e.result.reliabilityScore)}30`,
                  borderBottom: "none",
                }}
              />
              <span className="font-mono text-[9px]" style={{ color: "rgba(255,255,255,0.4)" }}>
                {e.period}
              </span>
            </div>
          );
        })}
      </div>

      {/* Detail table */}
      <div className="space-y-0.5">
        <div className="grid font-mono text-[8px] tracking-wider uppercase" style={{
          gridTemplateColumns: `80px repeat(${entries.length}, 1fr)`,
          color: "rgba(255,255,255,0.25)",
        }}>
          <span />
          {entries.map(e => <span key={e.period} className="text-center">{e.period}</span>)}
        </div>
        {([
          { key: "reliabilityScore", label: "Score", fmt: (v: number) => `${v}%` },
          { key: "falsePositiveRate", label: "Faux Pos.", fmt: (v: number) => `${v}%` },
          { key: "falseNegativeRate", label: "Faux Neg.", fmt: (v: number) => `${v}%` },
          { key: "avgDetectionDelayMin", label: "Délai", fmt: (v: number) => `${v}m` },
          { key: "flappingRate", label: "Flapping", fmt: (v: number) => `${v}/h` },
          { key: "tickCount", label: "Ticks", fmt: (v: number) => String(v) },
        ] as const).map(({ key, label, fmt }) => (
          <div key={key} className="grid font-mono text-[10px]" style={{
            gridTemplateColumns: `80px repeat(${entries.length}, 1fr)`,
            borderBottom: "1px solid rgba(255,255,255,0.04)",
            padding: "3px 0",
          }}>
            <span style={{ color: "rgba(255,255,255,0.35)" }}>{label}</span>
            {entries.map(e => (
              <span key={e.period} className="text-center" style={{
                color: key === "reliabilityScore"
                  ? gradeColor(e.result[key] as number)
                  : "rgba(255,255,255,0.55)",
              }}>
                {fmt(e.result[key] as number)}
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
