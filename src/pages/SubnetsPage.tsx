import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useMemo, useState } from "react";
import { useI18n } from "@/lib/i18n";
import {
  deriveMomentumLabel, momentumColor,
  opportunityColor, riskColor, clamp,
} from "@/lib/gauge-engine";
import {
  deriveStrategicAction, actionColor, actionBg, actionBorder, actionIcon,
} from "@/lib/strategy-engine";
import {
  computeGlobalConfianceData, confianceColor,
  type SourceMetrics,
} from "@/lib/data-fusion";

type SignalRow = {
  netuid: number | null;
  subnet_name: string | null;
  state: string | null;
  mpi: number | null;
  score: number | null;
  confidence_pct: number | null;
  quality_score: number | null;
  ts: string | null;
};

type ViewMode = "all" | "opportunities" | "risks";

function deriveOpp(psi: number, conf: number, quality: number, state: string | null): number {
  let opp = 0;
  opp += clamp(psi * 0.45, 0, 45);
  opp += clamp(conf * 0.25, 0, 25);
  opp += clamp(quality * 0.20, 0, 20);
  if (state === "GO" || state === "GO_SPECULATIVE") opp += 10;
  return Math.round(clamp(opp, 0, 100));
}

function deriveRisk(psi: number, conf: number, quality: number, state: string | null): number {
  let risk = 0;
  if (state === "BREAK" || state === "EXIT_FAST") risk += 45;
  risk += clamp((100 - quality) * 0.25, 0, 25);
  risk += clamp((100 - conf) * 0.15, 0, 15);
  if (psi >= 85) risk += clamp((psi - 85) * 1.5, 0, 15);
  return Math.round(clamp(risk, 0, 100));
}

export default function SubnetsPage() {
  const { t } = useI18n();
  const [mode, setMode] = useState<ViewMode>("all");

  const { data: signals } = useQuery({
    queryKey: ["signals-latest-table"],
    queryFn: async () => {
      const { data, error } = await supabase.from("signals_latest").select("*");
      if (error) throw error;
      return (data || []) as SignalRow[];
    },
    refetchInterval: 60_000,
  });

  /* ─── Per-subnet Confiance Data ─── */
  const { data: primaryMetrics } = useQuery({
    queryKey: ["metrics-primary-table"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("subnet_metrics_ts")
        .select("netuid, price, cap, vol_24h, liquidity, ts, source")
        .eq("source", "taostats")
        .order("ts", { ascending: false })
        .limit(200);
      if (error) throw error;
      const map = new Map<number, SourceMetrics>();
      for (const r of data || []) {
        if (!map.has(r.netuid)) map.set(r.netuid, { netuid: r.netuid, price: Number(r.price) || null, cap: Number(r.cap) || null, vol24h: Number(r.vol_24h) || null, liquidity: Number(r.liquidity) || null, ts: r.ts, source: "taostats" });
      }
      return map;
    },
    refetchInterval: 120_000,
  });

  const { data: secondaryMetrics } = useQuery({
    queryKey: ["metrics-secondary-table"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("subnet_metrics_ts")
        .select("netuid, price, cap, vol_24h, liquidity, ts, source")
        .eq("source", "taomarketcap")
        .order("ts", { ascending: false })
        .limit(200);
      if (error) throw error;
      const map = new Map<number, SourceMetrics>();
      for (const r of data || []) {
        if (!map.has(r.netuid)) map.set(r.netuid, { netuid: r.netuid, price: Number(r.price) || null, cap: Number(r.cap) || null, vol24h: Number(r.vol_24h) || null, liquidity: Number(r.liquidity) || null, ts: r.ts, source: "taomarketcap" });
      }
      return map;
    },
    refetchInterval: 120_000,
  });

  const rows = useMemo(() => {
    if (!signals) return [];
    return signals
      .filter(s => s.netuid != null)
      .map(s => {
        const psi = s.mpi ?? s.score ?? 0;
        const conf = s.confidence_pct ?? 0;
        const quality = s.quality_score ?? 0;
        const opp = deriveOpp(psi, conf, quality, s.state);
        const risk = deriveRisk(psi, conf, quality, s.state);
        const asymmetry = opp - risk;
        const momentumLabel = deriveMomentumLabel(psi);
        const action = deriveStrategicAction(opp, risk, "ACCUMULATION", conf, "hunter");

        // Per-subnet confiance data
        const pm = primaryMetrics?.get(s.netuid!);
        const sm = secondaryMetrics?.get(s.netuid!);
        let confianceScore = 50;
        if (pm && sm) {
          // Simple concordance check
          let conc = 0, n = 0;
          for (const f of ["price", "cap", "vol24h"] as const) {
            const pv = pm[f] as number | null;
            const sv = sm[f] as number | null;
            if (pv && pv > 0 && sv && sv > 0) {
              const avg = (Math.abs(pv) + Math.abs(sv)) / 2;
              const diff = avg > 0 ? Math.abs(pv - sv) / avg * 100 : 0;
              conc += Math.max(0, 100 - diff * 5);
              n++;
            }
          }
          confianceScore = n > 0 ? Math.round(conc / n * 0.6 + 40) : 60;
        } else if (pm || sm) {
          confianceScore = 45;
        }

        return { netuid: s.netuid!, name: s.subnet_name || `SN-${s.netuid}`, psi, conf, opp, risk, asymmetry, momentumLabel, action, confianceScore };
      })
      .filter(r => {
        if (mode === "opportunities") return r.opp > r.risk;
        if (mode === "risks") return r.risk >= r.opp;
        return true;
      })
      .sort((a, b) => b.asymmetry - a.asymmetry);
  }, [signals, mode, primaryMetrics, secondaryMetrics]);

  const modeOptions: { value: ViewMode; label: string }[] = [
    { value: "all", label: t("sub.mode_all") },
    { value: "opportunities", label: t("sub.mode_opp") },
    { value: "risks", label: t("sub.mode_risk") },
  ];

  return (
    <div className="h-full w-full bg-[#000] text-white p-4 sm:p-6 overflow-auto pt-14">
      <h1 className="font-mono text-lg sm:text-xl tracking-widest text-white/85 mb-5 sm:mb-7">{t("sub.title")}</h1>

      {/* Filter row */}
      <div className="flex items-center gap-3 mb-6">
        <div className="flex rounded-lg overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.08)" }}>
          {modeOptions.map(opt => (
            <button key={opt.value}
              onClick={() => setMode(opt.value)}
              className="font-mono text-[11px] tracking-wider px-4 py-2 transition-all"
              style={{
                background: mode === opt.value ? "rgba(255,215,0,0.1)" : "transparent",
                color: mode === opt.value ? "rgba(255,215,0,0.9)" : "rgba(255,255,255,0.35)",
                fontWeight: mode === opt.value ? 700 : 400,
              }}>
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full font-mono text-xs">
          <thead>
            <tr className="border-b border-white/10 text-white/40">
              <th className="text-left py-3 px-3">SN</th>
              <th className="text-left py-3 px-3">{t("sub.name")}</th>
              <th className="text-right py-3 px-3">{t("sub.opp")}</th>
              <th className="text-right py-3 px-3">{t("sub.risk")}</th>
              <th className="text-right py-3 px-3">ASYM</th>
              <th className="text-center py-3 px-3">ACTION</th>
              <th className="text-center py-3 px-3">{t("sub.momentum")}</th>
              <th className="text-right py-3 px-3">{t("data.confiance")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, idx) => {
              const oppC = opportunityColor(r.opp);
              const rskC = riskColor(r.risk);
              const isTop1 = idx === 0;
              const momColor = momentumColor(r.momentumLabel);
              return (
                <tr key={r.netuid}
                  className="border-b border-white/[0.04] hover:bg-white/[0.03] transition-colors cursor-pointer"
                  style={isTop1 ? { background: "rgba(255,215,0,0.02)", borderLeft: "2px solid rgba(255,215,0,0.3)" } : undefined}
                  onClick={() => window.open(`https://taostats.io/subnets/${r.netuid}`, "_blank")}>
                  <td className="py-3 px-3 text-white/55 text-sm">{r.netuid}</td>
                  <td className="py-3 px-3 text-sm" style={{ color: isTop1 ? "rgba(255,248,220,0.95)" : "rgba(255,255,255,0.75)", fontWeight: isTop1 ? 700 : 400 }}>{r.name}</td>
                  <td className="py-3 px-3 text-right font-bold text-sm" style={{ color: oppC }}>{r.opp}</td>
                  <td className="py-3 px-3 text-right font-bold text-sm" style={{ color: rskC }}>{r.risk}</td>
                  <td className="py-3 px-3 text-right font-bold text-sm" style={{ color: r.asymmetry > 20 ? "rgba(76,175,80,0.8)" : r.asymmetry > 0 ? "rgba(255,193,7,0.7)" : "rgba(229,57,53,0.7)" }}>
                    {r.asymmetry > 0 ? "+" : ""}{r.asymmetry}
                  </td>
                  <td className="py-3 px-3 text-center">
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-[10px] tracking-wider font-bold"
                      style={{
                        color: actionColor(r.action),
                        background: actionBg(r.action),
                        border: `1px solid ${actionBorder(r.action)}`,
                        transition: "all 0.5s ease",
                      }}>
                      <span style={{ display: "inline-block", transition: "transform 0.4s cubic-bezier(0.34,1.56,0.64,1)" }}>
                        {actionIcon(r.action)}
                      </span>
                      {t(`strat.${r.action.toLowerCase()}` as any)}
                    </span>
                  </td>
                  <td className="py-3 px-3 text-center">
                    <span className="font-mono text-[11px] font-bold" style={{ color: momColor }}>
                      {r.momentumLabel}
                    </span>
                  </td>
                  <td className="py-3 px-3 text-right">
                    <span className="font-mono text-xs font-bold" style={{ color: confianceColor(r.confianceScore) }}>
                      {r.confianceScore}%
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
