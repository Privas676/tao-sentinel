import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useMemo, useState } from "react";
import { useI18n } from "@/lib/i18n";
import {
  deriveMomentumLabel, momentumColor, computeMomentumScore,
  opportunityColor, riskColor, clamp, normalizeWithVariance,
  computeSmartCapital, type SmartCapitalState,
  computeSaturationIndex, saturationAlert,
  computeStabilitySetup, stabilityColor,
} from "@/lib/gauge-engine";
import {
  deriveSubnetAction, actionColor, actionBg, actionBorder, actionIcon,
} from "@/lib/strategy-engine";
import {
  confianceColor,
  type SourceMetrics,
  fuseMetrics,
} from "@/lib/data-fusion";
import {
  evaluateRiskOverride, checkCoherence,
  systemStatusColor, systemStatusLabel,
  type SystemStatus,
} from "@/lib/risk-override";
import { usePositions } from "@/hooks/use-positions";
import { useAuth } from "@/hooks/use-auth";

/* ═══════════════════════════════════════ */
/*        SPARKLINE COMPONENT              */
/* ═══════════════════════════════════════ */
function Sparkline({ data, width = 64, height = 20 }: { data: number[]; width?: number; height?: number }) {
  if (data.length < 2) return <span className="text-white/10 text-[9px]">—</span>;
  const min = Math.min(...data), max = Math.max(...data);
  const range = max - min || 1;
  const first = data[0], last = data[data.length - 1];
  const trend = last - first;
  const pctChange = first > 0 ? ((last - first) / first) * 100 : 0;
  const color = trend > 0 ? "rgba(76,175,80,0.7)" : trend < 0 ? "rgba(229,57,53,0.7)" : "rgba(255,255,255,0.3)";
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - 1 - ((v - min) / range) * (height - 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  return (
    <div className="relative group inline-block">
      <svg width={width} height={height} className="inline-block">
        <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-150 z-50"
        style={{ width: 130 }}>
        <div className="rounded-lg px-3 py-2 font-mono text-[10px] space-y-1"
          style={{ background: "rgba(10,10,14,0.95)", border: "1px solid rgba(255,255,255,0.12)", boxShadow: "0 4px 20px rgba(0,0,0,0.6)" }}>
          <div className="flex justify-between"><span className="text-white/35">Min</span><span className="text-white/70">{min.toFixed(4)}</span></div>
          <div className="flex justify-between"><span className="text-white/35">Max</span><span className="text-white/70">{max.toFixed(4)}</span></div>
          <div className="flex justify-between"><span className="text-white/35">7j</span><span style={{ color }} className="font-bold">{pctChange > 0 ? "+" : ""}{pctChange.toFixed(1)}%</span></div>
        </div>
      </div>
    </div>
  );
}

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

type ViewMode = "all" | "opportunities" | "risks" | "mine";

/* ─── Scoring functions (Section 3 — LINEAR for spread) ─── */
function deriveOpp(psi: number, conf: number, quality: number, state: string | null): number {
  let opp = 0;
  opp += psi * 0.35;
  opp += quality * 0.25;
  opp += conf * 0.20;
  if (state === "GO") opp += 15;
  else if (state === "GO_SPECULATIVE" || state === "EARLY") opp += 8;
  else if (state === "WATCH") opp += 3;
  else if (state === "HOLD") opp -= 3;
  if (state === "BREAK" || state === "EXIT_FAST") opp -= 25;
  if (psi < 30) opp -= 10;
  return Math.round(clamp(opp, 0, 100));
}

function deriveRisk(psi: number, conf: number, quality: number, state: string | null, dataUncertain = false): number {
  // Base risk floor — even healthy subnets carry inherent risk
  let risk = 15;
  // Core deficits (larger coefficients for spread)
  risk += (100 - quality) * 0.35;
  risk += (100 - conf) * 0.30;
  risk += (100 - psi) * 0.20;
  // Concentration risk: high momentum + mediocre quality = fragile
  if (psi >= 70 && quality < 60) risk += 8;
  if (psi >= 80 && quality < 50) risk += 10;
  // Volatility proxy: extreme momentum in either direction
  if (psi >= 85) risk += 5; // overheated
  if (psi < 40) risk += 8;
  // Confidence gap
  if (conf < 50) risk += 6;
  if (conf < 30) risk += 6;
  // State-based
  if (state === "BREAK" || state === "EXIT_FAST") risk += 20;
  else if (state === "HOLD") risk += 5;
  else if (state === "WATCH") risk += 3;
  // Stagnation zone
  if (psi >= 40 && psi <= 60 && conf < 40) risk += 5;
  if (dataUncertain) risk += 10;
  return Math.round(clamp(risk, 0, 100));
}

function deriveSubnetSC(psi: number, quality: number, conf: number, state: string | null): SmartCapitalState {
  const accSignal = quality * 0.5 + conf * 0.3 + clamp(psi * 0.2, 0, 20);
  const distSignal = clamp((100 - quality) * 0.4, 0, 40) +
    (psi >= 80 && quality < 50 ? 30 : 0) +
    (state === "BREAK" || state === "EXIT_FAST" ? 25 : 0);
  const score = clamp(accSignal - distSignal * 0.5 + 30, 0, 100);
  if (score >= 65) return "ACCUMULATION";
  if (score <= 35) return "DISTRIBUTION";
  return "STABLE";
}

function scColor(state: SmartCapitalState): string {
  switch (state) {
    case "ACCUMULATION": return "rgba(76,175,80,0.8)";
    case "DISTRIBUTION": return "rgba(229,57,53,0.8)";
    case "STABLE": return "rgba(255,248,220,0.4)";
  }
}

function stateDisplayLabel(state: string | null): string {
  switch (state) {
    case "BREAK": return "ZONE CRITIQUE";
    case "EXIT_FAST": return "ZONE CRITIQUE";
    case "GO": return "GO";
    case "GO_SPECULATIVE": return "SPÉCULATIF";
    case "EARLY": return "EARLY";
    case "WATCH": return "WATCH";
    case "HOLD": return "HOLD";
    default: return state || "—";
  }
}

export default function SubnetsPage() {
  const { t, lang } = useI18n();
  const [mode, setMode] = useState<ViewMode>("all");
  const { user } = useAuth();
  const { data: positions } = usePositions();

  const ownedNetuids = useMemo(() => {
    if (!positions?.length) return new Set<number>();
    return new Set(positions.map(p => p.netuid));
  }, [positions]);

  const { data: signals } = useQuery({
    queryKey: ["signals-latest-table"],
    queryFn: async () => {
      const { data, error } = await supabase.from("signals_latest").select("*");
      if (error) throw error;
      return (data || []) as SignalRow[];
    },
    refetchInterval: 60_000,
  });

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

  const { data: sparklines } = useQuery({
    queryKey: ["sparklines-7d"],
    queryFn: async () => {
      const since = new Date(Date.now() - 8 * 86400_000).toISOString().slice(0, 10);
      const { data, error } = await supabase
        .from("subnet_price_daily")
        .select("netuid, date, price_close")
        .gte("date", since)
        .order("date", { ascending: true });
      if (error) throw error;
      const map = new Map<number, number[]>();
      for (const r of data || []) {
        if (r.price_close == null) continue;
        if (!map.has(r.netuid)) map.set(r.netuid, []);
        map.get(r.netuid)!.push(Number(r.price_close));
      }
      return map;
    },
    refetchInterval: 300_000,
  });

  // Consensus data from fusion
  const consensusMap = useMemo(() => {
    if (!primaryMetrics && !secondaryMetrics) return new Map<number, { confianceData: number; dataUncertain: boolean }>();
    const primaryArr = primaryMetrics ? [...primaryMetrics.values()] : [];
    const secondaryArr = secondaryMetrics ? [...secondaryMetrics.values()] : [];
    const fused = fuseMetrics(primaryArr, secondaryArr);
    const map = new Map<number, { confianceData: number; dataUncertain: boolean }>();
    for (const f of fused) {
      map.set(f.netuid, { confianceData: f.confianceData, dataUncertain: f.dataUncertain });
    }
    return map;
  }, [primaryMetrics, secondaryMetrics]);

  // Saturation index
  const saturationIndex = useMemo(() => {
    if (!signals) return 0;
    const valid = signals.filter(s => s.netuid != null);
    const withScores = valid.map(s => {
      const psi = s.mpi ?? s.score ?? 0;
      const conf = s.confidence_pct ?? 0;
      const quality = s.quality_score ?? 0;
      const opp = deriveOpp(psi, conf, quality, s.state);
      const risk = deriveRisk(psi, conf, quality, s.state);
      return opp - risk;
    });
    const highAS = withScores.filter(as => as > 40).length;
    return valid.length > 0 ? Math.round((highAS / valid.length) * 100) : 0;
  }, [signals]);
  const isSaturated = saturationAlert(saturationIndex);

  const rows = useMemo(() => {
    if (!signals) return [];

    const allRows = signals
      .filter(s => s.netuid != null)
      .map(s => {
        const psi = s.mpi ?? s.score ?? 0;
        const conf = s.confidence_pct ?? 0;
        const quality = s.quality_score ?? 0;
        const consensus = consensusMap.get(s.netuid!);
        const dataUncertain = consensus?.dataUncertain ?? false;
        const confianceScore = consensus?.confianceData ?? 50;

        return { netuid: s.netuid!, psi, conf, quality, state: s.state, name: s.subnet_name || `SN-${s.netuid}`, dataUncertain, confianceScore };
      });

    // Batch normalize (Section 2)
    const oppRaws = allRows.map(r => deriveOpp(r.psi, r.conf, r.quality, r.state));
    const riskRaws = allRows.map(r => deriveRisk(r.psi, r.conf, r.quality, r.state, r.dataUncertain));
    const oppNorm = normalizeWithVariance(oppRaws, 3);
    const riskNorm = normalizeWithVariance(riskRaws, 3);

    return allRows.map((r, i) => {
      let opp = oppNorm[i];
      const risk = riskNorm[i];

      // Section 7: DEPEG coherence
      const isBreak = r.state === "BREAK" || r.state === "EXIT_FAST";
      if (isBreak || r.state === "DEPEG_WARNING" || r.state === "DEPEG_CRITICAL") {
        opp = 0;
      }

      // Risk Override
      const override = evaluateRiskOverride({ state: r.state, psi: r.psi, risk, quality: r.quality });
      if (override.isOverridden) opp = 0;

      // AS signed (Section 4) with DATA_UNCERTAIN penalty
      let asymmetry = opp - risk;
      if (r.dataUncertain) asymmetry -= 15;

      const momentumLabel = deriveMomentumLabel(r.psi);
      const momentum = clamp(r.psi - 40, 0, 60) / 60 * 100;

      let action = override.isOverridden ? "EXIT" as const : deriveSubnetAction(opp, risk, r.conf);
      if (override.systemStatus !== "OK" && action === "ENTER") action = "WATCH";

      // Saturation gating (Section 9): stricter ENTER
      if (isSaturated && action === "ENTER") {
        const stability = computeStabilitySetup(opp, risk, r.conf, momentum, r.quality, r.dataUncertain);
        if (stability <= 70) action = "WATCH";
      }

      checkCoherence(override.isOverridden, action);
      const sc = deriveSubnetSC(r.psi, r.quality, r.conf, r.state);
      const owned = ownedNetuids.has(r.netuid);

      return {
        netuid: r.netuid,
        name: r.name,
        state: r.state,
        psi: r.psi, conf: r.conf, opp, risk, asymmetry,
        momentumLabel, action, sc, owned,
        confianceScore: r.confianceScore,
        dataUncertain: r.dataUncertain,
        spark: sparklines?.get(r.netuid) || [],
        isOverridden: override.isOverridden,
        systemStatus: override.systemStatus,
        overrideReasons: override.overrideReasons,
      };
    })
    .filter(r => {
      if (mode === "opportunities") return !r.isOverridden && r.opp > r.risk;
      if (mode === "risks") return r.risk >= r.opp;
      if (mode === "mine") return r.owned;
      return true;
    })
    .sort((a, b) => {
      if (mode === "risks") {
        if (a.isOverridden !== b.isOverridden) return a.isOverridden ? -1 : 1;
        return b.risk - a.risk;
      }
      return b.asymmetry - a.asymmetry;
    });
  }, [signals, mode, primaryMetrics, secondaryMetrics, ownedNetuids, sparklines, consensusMap, isSaturated]);

  const modeOptions: { value: ViewMode; label: string }[] = [
    { value: "all", label: t("sub.mode_all") },
    { value: "opportunities", label: t("sub.mode_opp") },
    { value: "risks", label: t("sub.mode_risk") },
    ...(user ? [{ value: "mine" as ViewMode, label: lang === "fr" ? "Mes subnets" : "My subnets" }] : []),
  ];

  const scLabelFn = (state: SmartCapitalState): string => {
    switch (state) {
      case "ACCUMULATION": return lang === "fr" ? "Accum." : "Accum.";
      case "DISTRIBUTION": return lang === "fr" ? "Distrib." : "Distrib.";
      case "STABLE": return "Stable";
    }
  };

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
        {isSaturated && (
          <span className="font-mono text-[9px] px-2 py-1 rounded" style={{ background: "rgba(255,109,0,0.08)", color: "rgba(255,109,0,0.8)", border: "1px solid rgba(255,109,0,0.15)" }}>
            ⚠ {lang === "fr" ? "MARCHÉ SATURÉ" : "MARKET SATURATED"} ({saturationIndex}%)
          </span>
        )}
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full font-mono text-xs">
          <thead>
            <tr className="border-b border-white/10 text-white/40">
              <th className="text-left py-3 px-2">SN</th>
              <th className="text-left py-3 px-2">{t("sub.name")}</th>
              <th className="text-center py-3 px-2">STATUT</th>
              <th className="text-center py-3 px-2">{t("tip.price7d")}</th>
              <th className="text-right py-3 px-2">{t("sub.opp")}</th>
              <th className="text-right py-3 px-2">{t("sub.risk")}</th>
              <th className="text-right py-3 px-2">AS</th>
              <th className="text-center py-3 px-2">ACTION</th>
              <th className="text-center py-3 px-2">{t("sub.momentum")}</th>
              <th className="text-center py-3 px-2">{t("sc.label")}</th>
              <th className="text-right py-3 px-2">{t("data.confiance")}</th>
              {user && <th className="text-center py-3 px-2">✔</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, idx) => {
              const oppC = r.isOverridden ? "rgba(229,57,53,0.4)" : opportunityColor(r.opp);
              const rskC = riskColor(r.risk);
              const isTop1 = idx === 0 && !r.isOverridden;
              const momColor = momentumColor(r.momentumLabel);
              const actionLabel = r.action === "EXIT"
                ? (lang === "fr" ? "SORTIR" : "EXIT")
                : t(`strat.${r.action.toLowerCase()}` as any);
              return (
                <tr key={r.netuid}
                  className="border-b border-white/[0.04] hover:bg-white/[0.03] transition-colors cursor-pointer"
                  style={{
                    ...(isTop1 ? { background: "rgba(255,215,0,0.02)", borderLeft: "2px solid rgba(255,215,0,0.3)" } : {}),
                    ...(r.isOverridden ? { background: "rgba(229,57,53,0.03)", borderLeft: "2px solid rgba(229,57,53,0.4)" } : {}),
                  }}
                  onClick={() => window.open(`https://taostats.io/subnets/${r.netuid}`, "_blank")}>
                  <td className="py-3 px-2 text-white/55 text-sm">{r.netuid}</td>
                  <td className="py-3 px-2 text-sm" style={{ color: isTop1 ? "rgba(255,248,220,0.95)" : r.isOverridden ? "rgba(255,255,255,0.4)" : "rgba(255,255,255,0.75)", fontWeight: isTop1 ? 700 : 400 }}>
                    <span>{r.name}</span>
                    {r.isOverridden && (
                      <span className="ml-2 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[8px] font-bold tracking-wider"
                        style={{ background: "rgba(229,57,53,0.12)", color: "rgba(229,57,53,0.9)", border: "1px solid rgba(229,57,53,0.25)" }}>
                        ⛔ CRITIQUE – Override
                      </span>
                    )}
                    {r.dataUncertain && !r.isOverridden && (
                      <span className="ml-1 inline-flex items-center px-1 py-0.5 rounded text-[7px] tracking-wider"
                        style={{ background: "rgba(255,152,0,0.08)", color: "rgba(255,152,0,0.7)", border: "1px solid rgba(255,152,0,0.15)" }}>
                        ⚠ DATA
                      </span>
                    )}
                  </td>
                  <td className="py-3 px-2 text-center">
                    <span className="font-mono text-[9px] font-bold px-1.5 py-0.5 rounded"
                      style={{ color: systemStatusColor(r.systemStatus), background: `${systemStatusColor(r.systemStatus)}15`, border: `1px solid ${systemStatusColor(r.systemStatus)}30` }}>
                      {systemStatusLabel(r.systemStatus)}
                    </span>
                  </td>
                  <td className="py-3 px-2 text-center"><Sparkline data={r.spark} /></td>
                  <td className="py-3 px-2 text-right font-bold text-sm" style={{ color: oppC }}>{r.opp}</td>
                  <td className="py-3 px-2 text-right font-bold text-sm" style={{ color: rskC }}>{r.risk}</td>
                  <td className="py-3 px-2 text-right font-bold text-sm" style={{ color: r.asymmetry > 20 ? "rgba(76,175,80,0.8)" : r.asymmetry > 0 ? "rgba(255,193,7,0.7)" : "rgba(229,57,53,0.7)" }}>
                    {r.asymmetry > 0 ? "+" : ""}{r.asymmetry}
                  </td>
                  <td className="py-3 px-2 text-center">
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-[10px] tracking-wider font-bold"
                      style={{
                        color: actionColor(r.action),
                        background: actionBg(r.action),
                        border: `1px solid ${actionBorder(r.action)}`,
                      }}>
                      <span>{actionIcon(r.action)}</span>
                      {actionLabel}
                    </span>
                  </td>
                  <td className="py-3 px-2 text-center">
                    <span className="font-mono text-[11px] font-bold" style={{ color: momColor }}>
                      {r.momentumLabel}
                    </span>
                  </td>
                  <td className="py-3 px-2 text-center">
                    <span className="font-mono text-[10px] font-bold" style={{ color: scColor(r.sc) }}>
                      {scLabelFn(r.sc)}
                    </span>
                  </td>
                  <td className="py-3 px-2 text-right">
                    <span className="font-mono text-xs font-bold" style={{ color: confianceColor(r.confianceScore) }}>
                      {r.confianceScore}%
                    </span>
                  </td>
                  {user && (
                    <td className="py-3 px-2 text-center">
                      {r.owned && (
                        <span style={{ color: "rgba(76,175,80,0.8)", fontSize: 14 }}>✔</span>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
