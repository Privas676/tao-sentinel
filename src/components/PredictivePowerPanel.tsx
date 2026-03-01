import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/* ── Types ── */
type BucketStats = {
  label: string;
  count: number;
  avgReturn: number;
  successRate: number; // % with positive return
};

type HorizonResult = {
  horizon: string;
  high: BucketStats;  // PSI > 80
  low: BucketStats;   // PSI < 50
  delta: number;      // high.avgReturn - low.avgReturn
  observations: number;
};

type PredictiveReport = {
  horizons: HorizonResult[];
  snapshotCount: number;
  subnetCount: number;
  daysAnalyzed: number;
  mode: "forward" | "retrospective";
};

/* ── Bucket computation helper ── */
function computeBucket(obs: { ret: number }[], label: string): BucketStats {
  if (obs.length === 0) return { label, count: 0, avgReturn: 0, successRate: 0 };
  const returns = obs.map(o => o.ret);
  const avg = returns.reduce((a, b) => a + b, 0) / returns.length;
  const positive = returns.filter(r => r > 0).length;
  return {
    label,
    count: obs.length,
    avgReturn: Math.round(avg * 100) / 100,
    successRate: Math.round((positive / returns.length) * 100),
  };
}

/* ── Data fetching & computation ── */
function usePredictiveAnalysis() {
  return useQuery({
    queryKey: ["quant-predictive-power"],
    queryFn: async (): Promise<PredictiveReport> => {
      const now = Date.now();

      // 1) Try forward-looking: snapshots from 4-30 days ago
      const from = new Date(now - 30 * 86400_000).toISOString();
      const to = new Date(now - 4 * 86400_000).toISOString();

      const snapRes = await supabase
        .from("pipeline_snapshots")
        .select("ts, snapshot")
        .gte("ts", from)
        .lte("ts", to)
        .order("ts", { ascending: true })
        .limit(500);

      if (snapRes.error) throw snapRes.error;
      const historicalSnapshots = snapRes.data || [];

      // If we have historical snapshots, use forward-looking mode
      if (historicalSnapshots.length > 0) {
        return computeForwardMode(historicalSnapshots, now);
      }

      // 2) Fallback: retrospective mode — use latest snapshot + past prices
      return computeRetrospectiveMode(now);
    },
    refetchInterval: 600_000,
    staleTime: 300_000,
  });
}

/* ── Forward-looking mode (original logic) ── */
async function computeForwardMode(
  snapshots: { ts: string; snapshot: unknown }[],
  now: number,
): Promise<PredictiveReport> {
  const priceRes = await supabase
    .from("subnet_price_daily")
    .select("netuid, date, price_close")
    .gte("date", new Date(now - 35 * 86400_000).toISOString().slice(0, 10))
    .order("date", { ascending: true })
    .limit(5000);

  if (priceRes.error) throw priceRes.error;
  const prices = priceRes.data || [];

  const priceLookup = buildPriceLookup(prices);

  type Observation = { psi: number; return24h: number | null; return72h: number | null };
  const observations: Observation[] = [];
  const subnetsSeen = new Set<number>();

  // Sample: 1 snapshot per day
  const dailySnapshots = new Map<string, (typeof snapshots)[0]>();
  for (const s of snapshots) {
    const day = s.ts.slice(0, 10);
    if (!dailySnapshots.has(day)) dailySnapshots.set(day, s);
  }

  for (const [, snap] of dailySnapshots) {
    const snapDate = snap.ts.slice(0, 10);
    const entries = Array.isArray(snap.snapshot) ? (snap.snapshot as any[]) : [];

    for (const e of entries) {
      if (e.netuid == null || e.mpi == null) continue;
      const netuid = Number(e.netuid);
      const psi = Number(e.mpi);
      subnetsSeen.add(netuid);

      const priceT0 = getPrice(priceLookup, netuid, snapDate);
      if (priceT0 == null || priceT0 === 0) continue;

      const date24h = addDays(snapDate, 1);
      const date72h = addDays(snapDate, 3);

      const price24h = getPrice(priceLookup, netuid, date24h);
      const price72h = getPrice(priceLookup, netuid, date72h);

      const r24 = price24h != null ? ((price24h - priceT0) / priceT0) * 100 : null;
      const r72 = price72h != null ? ((price72h - priceT0) / priceT0) * 100 : null;

      observations.push({
        psi,
        return24h: r24 != null && Math.abs(r24) <= 100 ? r24 : null,
        return72h: r72 != null && Math.abs(r72) <= 100 ? r72 : null,
      });
    }
  }

  function computeHorizon(key: "return24h" | "return72h", label: string): HorizonResult {
    const highObs = observations.filter(o => o.psi > 80 && o[key] != null).map(o => ({ ret: o[key]! }));
    const lowObs = observations.filter(o => o.psi < 50 && o[key] != null).map(o => ({ ret: o[key]! }));
    const high = computeBucket(highObs, "PSI > 80");
    const low = computeBucket(lowObs, "PSI < 50");
    return {
      horizon: label,
      high,
      low,
      delta: Math.round((high.avgReturn - low.avgReturn) * 100) / 100,
      observations: highObs.length + lowObs.length,
    };
  }

  return {
    horizons: [computeHorizon("return24h", "+24h"), computeHorizon("return72h", "+72h")],
    snapshotCount: dailySnapshots.size,
    subnetCount: subnetsSeen.size,
    daysAnalyzed: dailySnapshots.size,
    mode: "forward",
  };
}

/* ── Retrospective mode: latest snapshot + past price returns ── */
async function computeRetrospectiveMode(now: number): Promise<PredictiveReport> {
  // Get latest snapshot
  const snapRes = await supabase
    .from("pipeline_snapshots")
    .select("ts, snapshot")
    .order("ts", { ascending: false })
    .limit(1);

  if (snapRes.error) throw snapRes.error;
  if (!snapRes.data?.length) {
    return emptyReport("retrospective");
  }

  const latestSnap = snapRes.data[0];
  const entries = Array.isArray(latestSnap.snapshot) ? (latestSnap.snapshot as any[]) : [];
  if (entries.length === 0) return emptyReport("retrospective");

  // Get prices for the last 10 days
  const priceRes = await supabase
    .from("subnet_price_daily")
    .select("netuid, date, price_close")
    .gte("date", new Date(now - 10 * 86400_000).toISOString().slice(0, 10))
    .order("date", { ascending: true })
    .limit(5000);

  if (priceRes.error) throw priceRes.error;
  const prices = priceRes.data || [];
  if (prices.length === 0) return emptyReport("retrospective");

  const priceLookup = buildPriceLookup(prices);
  const today = new Date(now).toISOString().slice(0, 10);
  const subnetsSeen = new Set<number>();

  type Observation = { psi: number; return24h: number | null; return72h: number | null };
  const observations: Observation[] = [];

  for (const e of entries) {
    if (e.netuid == null || e.mpi == null) continue;
    const netuid = Number(e.netuid);
    const psi = Number(e.mpi);
    subnetsSeen.add(netuid);

    // Current price (today or most recent)
    const priceNow = getPrice(priceLookup, netuid, today) ?? getPrice(priceLookup, netuid, addDays(today, -1));
    if (priceNow == null || priceNow === 0) continue;

    // Past prices: -1d and -3d
    const date1d = addDays(today, -1);
    const date3d = addDays(today, -3);

    const price1d = getPrice(priceLookup, netuid, date1d);
    const price3d = getPrice(priceLookup, netuid, date3d);

    const r24 = price1d != null && price1d !== 0 ? ((priceNow - price1d) / price1d) * 100 : null;
    const r72 = price3d != null && price3d !== 0 ? ((priceNow - price3d) / price3d) * 100 : null;

    // Filter outliers: cap returns at ±100% to avoid skewing from micro-cap tokens
    observations.push({
      psi,
      return24h: r24 != null && Math.abs(r24) <= 100 ? r24 : null,
      return72h: r72 != null && Math.abs(r72) <= 100 ? r72 : null,
    });
  }

  function computeHorizon(key: "return24h" | "return72h", label: string): HorizonResult {
    const highObs = observations.filter(o => o.psi > 80 && o[key] != null).map(o => ({ ret: o[key]! }));
    const lowObs = observations.filter(o => o.psi < 50 && o[key] != null).map(o => ({ ret: o[key]! }));
    const high = computeBucket(highObs, "PSI > 80");
    const low = computeBucket(lowObs, "PSI < 50");
    return {
      horizon: label,
      high,
      low,
      delta: Math.round((high.avgReturn - low.avgReturn) * 100) / 100,
      observations: highObs.length + lowObs.length,
    };
  }

  return {
    horizons: [computeHorizon("return24h", "-24h"), computeHorizon("return72h", "-72h")],
    snapshotCount: 1,
    subnetCount: subnetsSeen.size,
    daysAnalyzed: 1,
    mode: "retrospective",
  };
}

/* ── Shared helpers ── */
function buildPriceLookup(prices: { netuid: number; date: string; price_close: number | null }[]) {
  const lookup = new Map<number, Map<string, number>>();
  for (const p of prices) {
    if (p.price_close == null) continue;
    if (!lookup.has(p.netuid)) lookup.set(p.netuid, new Map());
    lookup.get(p.netuid)!.set(p.date, Number(p.price_close));
  }
  return lookup;
}

function getPrice(lookup: Map<number, Map<string, number>>, netuid: number, targetDate: string): number | null {
  const map = lookup.get(netuid);
  if (!map) return null;
  if (map.has(targetDate)) return map.get(targetDate)!;
  const d = new Date(targetDate);
  const prev = new Date(d.getTime() - 86400_000).toISOString().slice(0, 10);
  const next = new Date(d.getTime() + 86400_000).toISOString().slice(0, 10);
  return map.get(prev) ?? map.get(next) ?? null;
}

function addDays(dateStr: string, days: number): string {
  return new Date(new Date(dateStr).getTime() + days * 86400_000).toISOString().slice(0, 10);
}

function emptyReport(mode: "forward" | "retrospective"): PredictiveReport {
  const empty: BucketStats = { label: "", count: 0, avgReturn: 0, successRate: 0 };
  return {
    horizons: [
      { horizon: mode === "forward" ? "+24h" : "-24h", high: empty, low: empty, delta: 0, observations: 0 },
      { horizon: mode === "forward" ? "+72h" : "-72h", high: empty, low: empty, delta: 0, observations: 0 },
    ],
    snapshotCount: 0,
    subnetCount: 0,
    daysAnalyzed: 0,
    mode,
  };
}

/* ── Stat line (local) ── */
function Stat({ label, value, warn, good }: { label: string; value: string | number; warn?: boolean; good?: boolean }) {
  return (
    <div className="flex justify-between border-b border-white/[0.04] pb-1">
      <span className="font-mono text-[10px] text-white/40">{label}</span>
      <span
        className="font-mono text-[10px]"
        style={{
          color: good
            ? "rgba(76,175,80,0.8)"
            : warn
              ? "rgba(229,57,53,0.85)"
              : "rgba(255,255,255,0.6)",
        }}
      >
        {value}
      </span>
    </div>
  );
}

/* ── Horizon card ── */
function HorizonCard({ result, fr }: { result: HorizonResult; fr: boolean }) {
  const deltaPositive = result.delta > 0;

  return (
    <div className="border border-white/[0.04] rounded p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] tracking-widest text-white/50">
          {fr ? `HORIZON ${result.horizon}` : `${result.horizon} HORIZON`}
        </span>
        <span className="font-mono text-[8px] text-white/20">
          n={result.observations}
        </span>
      </div>

      {/* Delta highlight */}
      <div className="flex items-center gap-2">
        <span
          className="font-mono text-lg font-bold"
          style={{
            color: deltaPositive ? "rgba(76,175,80,0.85)" : "rgba(229,57,53,0.85)",
          }}
        >
          Δ {deltaPositive ? "+" : ""}{result.delta}%
        </span>
        <span className="font-mono text-[9px] text-white/30">
          {fr ? "avantage rendement PSI>80" : "PSI>80 return edge"}
        </span>
      </div>

      {/* Bucket comparison */}
      <div className="grid grid-cols-2 gap-3">
        {/* PSI > 80 */}
        <div className="space-y-1">
          <span className="font-mono text-[9px] text-white/35 tracking-wider">PSI &gt; 80</span>
          <Stat
            label={fr ? "Rend. moyen" : "Avg return"}
            value={`${result.high.avgReturn > 0 ? "+" : ""}${result.high.avgReturn}%`}
            good={result.high.avgReturn > 0}
            warn={result.high.avgReturn < 0}
          />
          <Stat
            label={fr ? "Taux réussite" : "Success rate"}
            value={`${result.high.successRate}%`}
            good={result.high.successRate > 55}
            warn={result.high.successRate < 45}
          />
          <Stat label="n" value={result.high.count} />
        </div>

        {/* PSI < 50 */}
        <div className="space-y-1">
          <span className="font-mono text-[9px] text-white/35 tracking-wider">PSI &lt; 50</span>
          <Stat
            label={fr ? "Rend. moyen" : "Avg return"}
            value={`${result.low.avgReturn > 0 ? "+" : ""}${result.low.avgReturn}%`}
            good={result.low.avgReturn > 0}
            warn={result.low.avgReturn < 0}
          />
          <Stat
            label={fr ? "Taux réussite" : "Success rate"}
            value={`${result.low.successRate}%`}
            good={result.low.successRate > 55}
            warn={result.low.successRate < 45}
          />
          <Stat label="n" value={result.low.count} />
        </div>
      </div>
    </div>
  );
}

/* ── Main Panel ── */
export default function PredictivePowerPanel({ fr }: { fr: boolean }) {
  const { data: report, isLoading } = usePredictiveAnalysis();

  const verdict = useMemo(() => {
    if (!report) return null;
    const h = report.horizons.find(h =>
      h.horizon === "+72h" || h.horizon === "-72h",
    );
    if (!h || h.observations < 5) return null;

    if (h.delta > 2 && h.high.successRate > 55) {
      return {
        icon: "✓",
        bg: "rgba(76,175,80,0.08)",
        border: "rgba(76,175,80,0.15)",
        color: "rgba(76,175,80,0.7)",
        text: fr
          ? "Signal prédictif — PSI > 80 surperforme significativement"
          : "Predictive signal — PSI > 80 significantly outperforms",
      };
    }
    if (h.delta < -1) {
      return {
        icon: "⚠",
        bg: "rgba(229,57,53,0.08)",
        border: "rgba(229,57,53,0.2)",
        color: "rgba(229,57,53,0.85)",
        text: fr
          ? "Signal inversé — PSI > 80 sous-performe (anomalie potentielle)"
          : "Inverted signal — PSI > 80 underperforms (potential anomaly)",
      };
    }
    return {
      icon: "~",
      bg: "rgba(255,183,77,0.08)",
      border: "rgba(255,183,77,0.2)",
      color: "rgba(255,183,77,0.8)",
      text: fr
        ? "Signal faible — pas de différence statistique claire"
        : "Weak signal — no clear statistical difference",
    };
  }, [report, fr]);

  const modeLabel = useMemo(() => {
    if (!report) return "";
    if (report.mode === "retrospective") {
      return fr
        ? "Mode rétrospectif — PSI actuel vs rendements passés (en attente d'historique de snapshots)"
        : "Retrospective mode — current PSI vs past returns (awaiting snapshot history)";
    }
    return fr
      ? "Mode prédictif — PSI historique vs rendements futurs"
      : "Forward mode — historical PSI vs future returns";
  }, [report, fr]);

  return (
    <div className="border border-white/[0.06] rounded-lg p-4 space-y-4">
      <span className="font-mono text-xs tracking-widest text-white/50">
        {fr ? "POUVOIR PRÉDICTIF DU PSI" : "PSI PREDICTIVE POWER"}
      </span>

      {isLoading ? (
        <div className="font-mono text-[10px] text-white/20 py-4 text-center">
          {fr ? "Analyse des prix historiques…" : "Analyzing historical prices…"}
        </div>
      ) : report && report.horizons[0].observations > 0 ? (
        <div className="space-y-3">
          {/* Mode indicator */}
          <div
            className="font-mono text-[8px] px-2 py-1 rounded"
            style={{
              background: report.mode === "retrospective" ? "rgba(255,183,77,0.06)" : "rgba(76,175,80,0.06)",
              color: report.mode === "retrospective" ? "rgba(255,183,77,0.6)" : "rgba(76,175,80,0.5)",
              border: `1px solid ${report.mode === "retrospective" ? "rgba(255,183,77,0.12)" : "rgba(76,175,80,0.1)"}`,
            }}
          >
            {modeLabel}
          </div>

          {/* Verdict */}
          {verdict && (
            <div
              className="font-mono text-[9px] px-2 py-1.5 rounded"
              style={{
                background: verdict.bg,
                color: verdict.color,
                border: `1px solid ${verdict.border}`,
              }}
            >
              {verdict.icon} {verdict.text}
            </div>
          )}

          {/* Horizon cards */}
          {report.horizons.map(h => (
            <HorizonCard key={h.horizon} result={h} fr={fr} />
          ))}

          {/* Meta */}
          <div className="font-mono text-[8px] text-white/15">
            {report.daysAnalyzed} {fr ? "jours analysés" : "days analyzed"} · {report.subnetCount} subnets · {fr ? "prix de clôture quotidiens" : "daily close prices"}
          </div>
        </div>
      ) : (
        <div className="font-mono text-[10px] text-white/20 py-4 text-center">
          {fr
            ? "Données insuffisantes — nécessite des prix historiques et au moins 1 snapshot"
            : "Insufficient data — requires historical prices and at least 1 snapshot"}
        </div>
      )}
    </div>
  );
}
