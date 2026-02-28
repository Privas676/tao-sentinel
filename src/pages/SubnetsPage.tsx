import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useMemo, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { useLocalPortfolio } from "@/hooks/use-local-portfolio";
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
import {
  extractHealthData, recalculate, computeAllHealthScores,
  computeHealthRisk, computeHealthOpportunity,
  healthColor, dilutionLabel, formatUsd,
  type SubnetHealthResult, type HealthScores, type RecalculatedMetrics,
} from "@/lib/subnet-health";

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

/* ═══════════════════════════════════════ */
/*        HEALTH PANEL COMPONENT            */
/* ═══════════════════════════════════════ */
function HealthPanel({ health, onClose }: {
  health: { netuid: number; name: string; recalc: RecalculatedMetrics; scores: HealthScores; displayedCap: number; displayedLiq: number };
  onClose: () => void;
}) {
  const { recalc, scores } = health;
  const capDiv = health.displayedCap > 0 ? Math.abs(recalc.mcRecalc - health.displayedCap) / health.displayedCap * 100 : 0;
  const liqDiv = health.displayedLiq > 0 ? Math.abs(recalc.liquidityRecalc - health.displayedLiq) / health.displayedLiq * 100 : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/70" />
      <div className="relative rounded-xl p-5 font-mono text-[11px] max-w-md w-full mx-4 space-y-4"
        style={{ background: "rgba(10,10,14,0.98)", border: "1px solid rgba(255,215,0,0.15)", boxShadow: "0 8px 40px rgba(0,0,0,0.8)" }}
        onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-3">
          <h3 className="text-white/90 text-sm font-bold tracking-wider">🔬 HEALTH — SN-{health.netuid} {health.name}</h3>
          <button onClick={onClose} className="text-white/30 hover:text-white/60 text-lg">✕</button>
        </div>

        {/* Recalculated vs displayed */}
        <div className="space-y-1.5">
          <div className="text-white/40 text-[9px] tracking-widest mb-1">RECALCULS</div>
          <Row label="MC recalc" value={formatUsd(recalc.mcRecalc)} sub={capDiv > 2 ? `△ ${capDiv.toFixed(1)}%` : "✓"} warn={capDiv > 5} />
          <Row label="FDV recalc" value={formatUsd(recalc.fdvRecalc)} />
          <Row label="Dilution" value={`${recalc.dilutionRatio.toFixed(2)}x — ${dilutionLabel(recalc.dilutionRatio)}`} warn={recalc.dilutionRatio > 3} />
          <Row label="Volume/MC" value={`${(recalc.volumeToMc * 100).toFixed(2)}%`} />
          <Row label="Emission/MC" value={`${(recalc.emissionToMc * 100).toFixed(3)}%/j`} warn={recalc.emissionToMc > 0.005} />
          <Row label="Liq/MC" value={`${(recalc.liquidityToMc * 100).toFixed(2)}%`} warn={recalc.liquidityToMc < 0.003} />
          {liqDiv > 5 && <Row label="Liq divergence" value={`${liqDiv.toFixed(1)}%`} warn={true} />}
        </div>

        {/* Health scores */}
        <div className="space-y-1.5 pt-2 border-t border-white/5">
          <div className="text-white/40 text-[9px] tracking-widest mb-1">SCORES SANTÉ</div>
          <ScoreBar label="Liquidité" score={scores.liquidityHealth} />
          <ScoreBar label="Volume" score={scores.volumeHealth} />
          <ScoreBar label="Émission" score={100 - scores.emissionPressure} inverted />
          <ScoreBar label="Dilution" score={100 - scores.dilutionRisk} inverted />
          <ScoreBar label="Activité" score={scores.activityHealth} />
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, sub, warn }: { label: string; value: string; sub?: string; warn?: boolean }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-white/40">{label}</span>
      <span className="flex items-center gap-2">
        <span className={warn ? "text-orange-400" : "text-white/70"}>{value}</span>
        {sub && <span className={`text-[9px] ${warn ? "text-red-400" : "text-green-400/60"}`}>{sub}</span>}
      </span>
    </div>
  );
}

function ScoreBar({ label, score, inverted }: { label: string; score: number; inverted?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-white/40 w-16">{label}</span>
      <div className="flex-1 h-1.5 rounded-full bg-white/5 overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${score}%`, background: healthColor(score) }} />
      </div>
      <span className="text-white/60 w-8 text-right">{Math.round(score)}</span>
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

export default function SubnetsPage() {
  const { t, lang } = useI18n();
  const [mode, setMode] = useState<ViewMode>("all");
  const [healthPanel, setHealthPanel] = useState<null | any>(null);
  const { ownedNetuids, addPosition, isOwned } = useLocalPortfolio();

  const { data: signals } = useQuery({
    queryKey: ["signals-latest-table"],
    queryFn: async () => {
      const { data, error } = await supabase.from("signals_latest").select("*");
      if (error) throw error;
      return (data || []) as SignalRow[];
    },
    refetchInterval: 60_000,
  });

  // Fetch raw_payload for health engine
  const { data: rawPayloads } = useQuery({
    queryKey: ["raw-payloads-health"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("subnet_metrics_ts")
        .select("netuid, raw_payload, source, ts")
        .eq("source", "taostats")
        .order("ts", { ascending: false })
        .limit(300);
      if (error) throw error;
      const map = new Map<number, any>();
      for (const r of data || []) {
        if (!map.has(r.netuid) && r.raw_payload) map.set(r.netuid, r.raw_payload);
      }
      return map;
    },
    refetchInterval: 120_000,
  });

  // TAO USD rate
  const { data: taoUsd } = useQuery({
    queryKey: ["tao-usd-health"],
    queryFn: async () => {
      const { data } = await supabase.from("fx_latest").select("tao_usd").limit(1).maybeSingle();
      return Number(data?.tao_usd) || 450;
    },
    refetchInterval: 300_000,
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

  const { data: subnetLatest } = useQuery({
    queryKey: ["subnet-latest-risk"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("subnet_latest")
        .select("netuid, vol_cap, top_miners_share, liquidity, cap");
      if (error) throw error;
      const map = new Map<number, { volCap: number; topMinersShare: number; liqRatio: number; cap: number; liq: number }>();
      for (const r of data || []) {
        if (r.netuid == null) continue;
        const cap = Number(r.cap) || 0;
        const liq = Number(r.liquidity) || 0;
        map.set(r.netuid, {
          volCap: Number(r.vol_cap) || 0,
          topMinersShare: Number(r.top_miners_share) || 0,
          liqRatio: cap > 0 ? liq / cap : 0,
          cap, liq,
        });
      }
      return map;
    },
    refetchInterval: 120_000,
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

  const rows = useMemo(() => {
    if (!signals) return [];
    const rate = taoUsd || 450;

    const allRows = signals
      .filter(s => s.netuid != null)
      .map(s => {
        const psi = s.mpi ?? s.score ?? 0;
        const conf = s.confidence_pct ?? 0;
        const quality = s.quality_score ?? 0;
        const consensus = consensusMap.get(s.netuid!);
        const dataUncertain = consensus?.dataUncertain ?? false;
        const confianceScore = consensus?.confianceData ?? 50;
        const dataConsistencyRisk = clamp(100 - confianceScore, 0, 100);

        // Health engine: extract from raw_payload
        const payload = rawPayloads?.get(s.netuid!);
        const chainData = payload?._chain || {};
        const healthData = extractHealthData(s.netuid!, payload || {}, chainData, rate);
        const recalc = recalculate(healthData);
        const healthScores = computeAllHealthScores(healthData, recalc);

        // Smart Capital
        const sc = deriveSubnetSC(psi, quality, conf, s.state);
        const scScore = sc === "ACCUMULATION" ? 70 : sc === "DISTRIBUTION" ? 20 : 45;

        // Momentum
        const momentumScore = computeMomentumScore(psi);
        const momentumLabel = deriveMomentumLabel(psi);

        // Pre-hype intensity (simplified)
        const preHypeIntensity = (psi > 50 && quality > 40 && sc === "ACCUMULATION") ? clamp(psi - 30, 0, 70) : 0;

        // NEW RISK: health-based composite (Section 5)
        const riskRaw = computeHealthRisk(healthScores, dataConsistencyRisk);

        // NEW OPPORTUNITY: health-based composite (Section 6)
        const oppRaw = computeHealthOpportunity(momentumScore, healthScores, scScore, preHypeIntensity, recalc);

        return {
          netuid: s.netuid!, psi, conf, quality, state: s.state,
          name: s.subnet_name || `SN-${s.netuid}`,
          dataUncertain, confianceScore,
          oppRaw, riskRaw,
          momentumLabel, momentumScore, sc, scScore,
          healthScores, recalc, healthData,
          displayedCap: (subnetLatest?.get(s.netuid!)?.cap || 0) * rate,
          displayedLiq: (subnetLatest?.get(s.netuid!)?.liq || 0) * rate,
        };
      });

    // Normalize: blend raw score (60%) + percentile (40%) to preserve absolute meaning
    const oppPercentile = normalizeWithVariance(allRows.map(r => r.oppRaw), 3);
    const riskPercentile = normalizeWithVariance(allRows.map(r => r.riskRaw), 3);

    return allRows.map((r, i) => {
      // Blend: 60% raw (clamped 0-100) + 40% percentile rank
      let opp = clamp(Math.round(r.oppRaw * 0.6 + oppPercentile[i] * 0.4), 5, 98);
      const risk = clamp(Math.round(r.riskRaw * 0.6 + riskPercentile[i] * 0.4), 10, 95);

      // DEPEG coherence
      const isBreak = r.state === "BREAK" || r.state === "EXIT_FAST";
      if (isBreak || r.state === "DEPEG_WARNING" || r.state === "DEPEG_CRITICAL") {
        opp = 0;
      }

      // Risk Override
      const override = evaluateRiskOverride({ state: r.state, psi: r.psi, risk, quality: r.quality });
      if (override.isOverridden) opp = 0;

      // AS signed with DATA_UNCERTAIN penalty
      let asymmetry = opp - risk;
      if (r.dataUncertain) asymmetry -= 15;

      const momentum = clamp(r.psi - 40, 0, 60) / 60 * 100;
      let action = override.isOverridden ? "EXIT" as const : deriveSubnetAction(opp, risk, r.conf);
      if (override.systemStatus !== "OK" && action === "ENTER") action = "WATCH";

      checkCoherence(override.isOverridden, action);
      const owned = ownedNetuids.has(r.netuid);

      return {
        netuid: r.netuid, name: r.name, state: r.state,
        psi: r.psi, conf: r.conf, opp, risk, asymmetry,
        momentumLabel: r.momentumLabel, action, sc: r.sc, owned,
        confianceScore: r.confianceScore,
        dataUncertain: r.dataUncertain,
        spark: sparklines?.get(r.netuid) || [],
        isOverridden: override.isOverridden,
        systemStatus: override.systemStatus,
        overrideReasons: override.overrideReasons,
        healthScores: r.healthScores,
        recalc: r.recalc,
        displayedCap: r.displayedCap,
        displayedLiq: r.displayedLiq,
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
  }, [signals, mode, primaryMetrics, secondaryMetrics, ownedNetuids, sparklines, subnetLatest, consensusMap, rawPayloads, taoUsd]);

  const modeOptions: { value: ViewMode; label: string }[] = [
    { value: "all", label: t("sub.mode_all") },
    { value: "opportunities", label: t("sub.mode_opp") },
    { value: "risks", label: t("sub.mode_risk") },
    ...(ownedNetuids.size > 0 ? [{ value: "mine" as ViewMode, label: lang === "fr" ? "Mes subnets" : "My subnets" }] : []),
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
              <th className="text-center py-3 px-2">🔬</th>
              <th className="text-center py-3 px-2">✔</th>
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
                  <td className="py-3 px-2 text-center">
                    <button
                      onClick={(e) => { e.stopPropagation(); setHealthPanel({ netuid: r.netuid, name: r.name, recalc: r.recalc, scores: r.healthScores, displayedCap: r.displayedCap, displayedLiq: r.displayedLiq }); }}
                      className="text-[10px] px-1.5 py-0.5 rounded transition-colors hover:bg-white/5"
                      style={{ color: "rgba(255,215,0,0.5)", border: "1px solid rgba(255,215,0,0.1)" }}>
                      🔬
                    </button>
                  </td>
                  <td className="py-3 px-2 text-center">
                    {r.owned ? (
                      <span style={{ color: "rgba(76,175,80,0.8)", fontSize: 14 }}>✔</span>
                    ) : (
                      <button onClick={(e) => { e.stopPropagation(); addPosition(r.netuid, 0); }}
                        className="font-mono text-[8px] px-1.5 py-0.5 rounded opacity-40 hover:opacity-100 transition-opacity"
                        style={{ background: "rgba(76,175,80,0.08)", color: "rgba(76,175,80,0.6)", border: "1px solid rgba(76,175,80,0.15)" }}>
                        +
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Health Panel Modal */}
      {healthPanel && <HealthPanel health={healthPanel} onClose={() => setHealthPanel(null)} />}
    </div>
  );
}
