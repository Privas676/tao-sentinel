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
};

/* ── Data fetching & computation ── */
function usePredictiveAnalysis() {
  return useQuery({
    queryKey: ["quant-predictive-power"],
    queryFn: async (): Promise<PredictiveReport> => {
      // 1) Get snapshots from 4-30 days ago (need +72h of price data after)
      const now = Date.now();
      const from = new Date(now - 30 * 86400_000).toISOString();
      const to = new Date(now - 4 * 86400_000).toISOString();

      const [snapRes, priceRes] = await Promise.all([
        supabase
          .from("pipeline_snapshots")
          .select("ts, snapshot")
          .gte("ts", from)
          .lte("ts", to)
          .order("ts", { ascending: true })
          .limit(500),
        supabase
          .from("subnet_price_daily")
          .select("netuid, date, price_close")
          .gte("date", new Date(now - 35 * 86400_000).toISOString().slice(0, 10))
          .order("date", { ascending: true })
          .limit(1000),
      ]);

      if (snapRes.error) throw snapRes.error;
      if (priceRes.error) throw priceRes.error;

      const snapshots = snapRes.data || [];
      const prices = priceRes.data || [];

      // Build price lookup: netuid -> date -> price_close
      const priceLookup = new Map<number, Map<string, number>>();
      for (const p of prices) {
        if (p.price_close == null) continue;
        if (!priceLookup.has(p.netuid)) priceLookup.set(p.netuid, new Map());
        priceLookup.get(p.netuid)!.set(p.date, Number(p.price_close));
      }

      // Helper: find closest price within ±1 day
      function getPrice(netuid: number, targetDate: string): number | null {
        const map = priceLookup.get(netuid);
        if (!map) return null;
        if (map.has(targetDate)) return map.get(targetDate)!;
        // Try ±1 day
        const d = new Date(targetDate);
        const prev = new Date(d.getTime() - 86400_000).toISOString().slice(0, 10);
        const next = new Date(d.getTime() + 86400_000).toISOString().slice(0, 10);
        return map.get(prev) ?? map.get(next) ?? null;
      }

      // 2) For each snapshot, extract PSI per subnet and pair with future prices
      type Observation = { psi: number; return24h: number | null; return72h: number | null };
      const observations: Observation[] = [];
      const subnetsSeen = new Set<number>();

      // Sample: take 1 snapshot per day max to avoid over-weighting
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

          const priceT0 = getPrice(netuid, snapDate);
          if (priceT0 == null || priceT0 === 0) continue;

          const date24h = new Date(new Date(snapDate).getTime() + 86400_000).toISOString().slice(0, 10);
          const date72h = new Date(new Date(snapDate).getTime() + 3 * 86400_000).toISOString().slice(0, 10);

          const price24h = getPrice(netuid, date24h);
          const price72h = getPrice(netuid, date72h);

          observations.push({
            psi,
            return24h: price24h != null ? ((price24h - priceT0) / priceT0) * 100 : null,
            return72h: price72h != null ? ((price72h - priceT0) / priceT0) * 100 : null,
          });
        }
      }

      // 3) Compute bucket stats per horizon
      function computeHorizon(
        key: "return24h" | "return72h",
        label: string,
      ): HorizonResult {
        const highObs = observations.filter(o => o.psi > 80 && o[key] != null);
        const lowObs = observations.filter(o => o.psi < 50 && o[key] != null);

        const bucket = (obs: typeof highObs, lbl: string): BucketStats => {
          if (obs.length === 0) return { label: lbl, count: 0, avgReturn: 0, successRate: 0 };
          const returns = obs.map(o => o[key]!);
          const avg = returns.reduce((a, b) => a + b, 0) / returns.length;
          const positive = returns.filter(r => r > 0).length;
          return {
            label: lbl,
            count: obs.length,
            avgReturn: Math.round(avg * 100) / 100,
            successRate: Math.round((positive / returns.length) * 100),
          };
        };

        const high = bucket(highObs, "PSI > 80");
        const low = bucket(lowObs, "PSI < 50");

        return {
          horizon: label,
          high,
          low,
          delta: Math.round((high.avgReturn - low.avgReturn) * 100) / 100,
          observations: highObs.length + lowObs.length,
        };
      }

      return {
        horizons: [
          computeHorizon("return24h", "+24h"),
          computeHorizon("return72h", "+72h"),
        ],
        snapshotCount: dailySnapshots.size,
        subnetCount: subnetsSeen.size,
        daysAnalyzed: dailySnapshots.size,
      };
    },
    refetchInterval: 600_000,
    staleTime: 300_000,
  });
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
    const h72 = report.horizons.find(h => h.horizon === "+72h");
    if (!h72 || h72.observations < 10) return null;

    if (h72.delta > 2 && h72.high.successRate > 55) {
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
    if (h72.delta < -1) {
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
            ? "Données insuffisantes — nécessite ≥ 4 jours d'historique de prix"
            : "Insufficient data — requires ≥ 4 days of price history"}
        </div>
      )}
    </div>
  );
}
