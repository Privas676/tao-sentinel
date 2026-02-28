import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useState, useMemo, useRef, useEffect } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { useI18n } from "@/lib/i18n";
import {
  SubnetSignal, RawSignal,
  clamp, processSignals,
  computeGlobalPsi, computeGlobalConfidence,
  computeGlobalOpportunity, computeGlobalRisk,
  opportunityColor, riskColor,
  computeSmartCapital, type SmartCapitalState,
  computeASMicro, detectPreHype, computeSaturationIndex, saturationAlert,
  stabilityColor, computeStabilitySetup, momentumColor,
} from "@/lib/gauge-engine";
import {
  deriveStrategicAction, actionColor, actionBg, actionBorder, actionIcon,
  computeSentinelIndex, sentinelIndexColor, sentinelIndexLabel,
  deriveSubnetAction,
} from "@/lib/strategy-engine";
import {
  computeGlobalConfianceData, confianceColor, shouldModerateRecommendation,
  type SourceMetrics,
} from "@/lib/data-fusion";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

/* ═══════════════════════════════════════ */
/*          VISUAL HELPERS                 */
/* ═══════════════════════════════════════ */
function describeArc(cx: number, cy: number, r: number, startAngle: number, endAngle: number) {
  const rad = (a: number) => ((a - 90) * Math.PI) / 180;
  const x1 = cx + r * Math.cos(rad(startAngle));
  const y1 = cy + r * Math.sin(rad(startAngle));
  const x2 = cx + r * Math.cos(rad(endAngle));
  const y2 = cy + r * Math.sin(rad(endAngle));
  const large = endAngle - startAngle > 180 ? 1 : 0;
  return `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`;
}

function TooltipSparkline({ data, width, height, color }: { data: number[]; width: number; height: number; color: string }) {
  if (data.length < 2) return null;
  const min = Math.min(...data), max = Math.max(...data);
  const range = max - min || 1;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((v - min) / range) * height;
    return `${x},${y}`;
  }).join(" ");
  return <polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />;
}

/* ═══════════════════════════════════════ */
/*     STRATEGIC RECOMMENDATION BADGE      */
/* ═══════════════════════════════════════ */
function StrategicBadge({ action, label, isMobile }: { action: "ENTER" | "WATCH" | "EXIT"; label: string; isMobile: boolean }) {
  const prevActionRef = useRef(action);
  const [morphing, setMorphing] = useState(false);
  const [displayAction, setDisplayAction] = useState(action);
  const [displayLabel, setDisplayLabel] = useState(label);

  useEffect(() => {
    if (action !== prevActionRef.current) {
      setMorphing(true);
      const timer = setTimeout(() => {
        setDisplayAction(action);
        setDisplayLabel(label);
        prevActionRef.current = action;
        const timer2 = setTimeout(() => setMorphing(false), 80);
        return () => clearTimeout(timer2);
      }, 300);
      return () => clearTimeout(timer);
    } else {
      setDisplayAction(action);
      setDisplayLabel(label);
    }
  }, [action, label]);

  return (
    <div className="flex items-center gap-3 px-6 py-3.5 rounded-xl"
      style={{
        background: actionBg(displayAction),
        border: `2px solid ${actionBorder(displayAction)}`,
        boxShadow: `0 0 35px ${actionBg(displayAction)}, 0 0 60px ${actionBg(displayAction)}`,
        animation: displayAction === "EXIT" ? "priority-pulse 2s ease-in-out infinite" : displayAction === "ENTER" ? "priority-pulse 3s ease-in-out infinite" : "none",
        transition: "background 0.5s ease, border-color 0.5s ease, box-shadow 0.5s ease",
        transform: morphing ? "scale(0.88)" : "scale(1)",
        opacity: morphing ? 0 : 1,
        filter: morphing ? "blur(4px) brightness(1.8)" : "blur(0) brightness(1)",
        transitionProperty: "background, border-color, box-shadow, transform, opacity, filter",
        transitionDuration: "0.5s, 0.5s, 0.5s, 0.3s, 0.3s, 0.3s",
      }}>
      <span style={{ fontSize: isMobile ? 20 : 28, transition: "transform 0.4s cubic-bezier(0.34,1.56,0.64,1)", transform: morphing ? "rotate(180deg) scale(0)" : "rotate(0deg) scale(1)", display: "inline-block" }}>
        {actionIcon(displayAction)}
      </span>
      <span className="font-mono font-bold tracking-[0.25em]" style={{ color: actionColor(displayAction), fontSize: isMobile ? 18 : 26 }}>
        {displayLabel}
      </span>
    </div>
  );
}

/* ═══════════════════════════════════════ */
/*     SENTINEL INDEX DISPLAY              */
/* ═══════════════════════════════════════ */
function SentinelIndexDisplay({ score, label, isMobile }: { score: number; label: string; isMobile: boolean }) {
  const color = sentinelIndexColor(score);
  return (
    <div className="flex flex-col items-center gap-1">
      <span className="font-mono tracking-[0.2em] uppercase" style={{ color: "rgba(255,255,255,0.3)", fontSize: isMobile ? 7 : 9 }}>
        TAO SENTINEL INDEX
      </span>
      <div className="flex items-center gap-2">
        <span className="font-mono font-bold" style={{ color, fontSize: isMobile ? 28 : 38 }}>{score}</span>
        <span className="font-mono font-bold tracking-wider" style={{ color, fontSize: isMobile ? 10 : 13, opacity: 0.7 }}>{label}</span>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════ */
/*     FLOW BADGES                         */
/* ═══════════════════════════════════════ */
function FlowBadge({ label, direction, isMobile }: { label: string; direction: "up" | "down" | "stable"; isMobile: boolean }) {
  const arrow = direction === "up" ? "↑" : direction === "down" ? "↓" : "→";
  const c = direction === "up" ? "rgba(76,175,80,0.8)" : direction === "down" ? "rgba(229,57,53,0.8)" : "rgba(255,255,255,0.35)";
  return (
    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
      <span className="font-mono" style={{ color: "rgba(255,255,255,0.35)", fontSize: isMobile ? 8 : 10, letterSpacing: "0.08em" }}>{label}</span>
      <span className="font-mono font-bold" style={{ color: c, fontSize: isMobile ? 12 : 14 }}>{arrow}</span>
    </div>
  );
}

/* ═══════════════════════════════════════ */
/*     BEST SUBNET CARD                    */
/* ═══════════════════════════════════════ */
function BestSubnetCard({ signal, isMobile, t, onClick, isMicroBest }: {
  signal: SubnetSignal; isMobile: boolean; t: (k: any) => string; onClick: () => void; isMicroBest?: boolean;
}) {
  const action = deriveStrategicAction(signal.opportunity, signal.risk, "ACCUMULATION", signal.confidence, "hunter", signal.stabilitySetup);
  const asymScore = signal.opportunity - signal.risk;
  return (
    <div onClick={onClick} className="cursor-pointer rounded-xl transition-all hover:scale-[1.01]" style={{
      background: "rgba(255,215,0,0.03)", border: "1px solid rgba(255,215,0,0.12)",
      padding: isMobile ? "12px 14px" : "16px 20px", boxShadow: "0 0 40px rgba(255,215,0,0.04)",
    }}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="font-mono font-bold" style={{ color: "rgba(255,248,220,0.9)", fontSize: isMobile ? 14 : 18 }}>SN-{signal.netuid}</span>
          <span className="font-mono" style={{ color: "rgba(255,255,255,0.4)", fontSize: isMobile ? 10 : 12 }}>{signal.name}</span>
          {signal.isMicroCap && (
            <span className="font-mono text-[8px] px-1.5 py-0.5 rounded" style={{ background: "rgba(0,200,255,0.1)", color: "rgba(0,200,255,0.7)", border: "1px solid rgba(0,200,255,0.2)" }}>MICRO</span>
          )}
          {signal.preHype && (
            <span className="font-mono text-[8px] px-1.5 py-0.5 rounded" style={{ background: "rgba(255,100,255,0.08)", color: "rgba(255,100,255,0.7)", border: "1px solid rgba(255,100,255,0.15)" }}>PRÉ-HYPE</span>
          )}
        </div>
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md" style={{
          background: actionBg(action), border: `1px solid ${actionBorder(action)}`, transition: "all 0.5s ease",
        }}>
          <span style={{ fontSize: isMobile ? 10 : 12 }}>{actionIcon(action)}</span>
          <span className="font-mono font-bold tracking-wider" style={{ color: actionColor(action), fontSize: isMobile ? 9 : 11 }}>
            {t(`strat.${action.toLowerCase()}` as any)}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-4">
        <div className="flex flex-col">
          <span className="font-mono" style={{ color: "rgba(255,215,0,0.35)", fontSize: 8, letterSpacing: "0.12em" }}>{t("gauge.opportunity")}</span>
          <span className="font-mono font-bold" style={{ color: opportunityColor(signal.opportunity), fontSize: isMobile ? 20 : 26 }}>{signal.opportunity}</span>
        </div>
        <div className="flex flex-col">
          <span className="font-mono" style={{ color: "rgba(229,57,53,0.3)", fontSize: 8, letterSpacing: "0.12em" }}>{t("gauge.risk")}</span>
          <span className="font-mono font-bold" style={{ color: riskColor(signal.risk), fontSize: isMobile ? 20 : 26 }}>{signal.risk}</span>
        </div>
        <div style={{ width: 1, height: 30, background: "rgba(255,255,255,0.06)" }} />
        <div className="flex flex-col">
          <span className="font-mono" style={{ color: "rgba(255,255,255,0.25)", fontSize: 8, letterSpacing: "0.12em" }}>ASYM</span>
          <span className="font-mono font-bold" style={{ color: asymScore > 30 ? "rgba(76,175,80,0.9)" : "rgba(255,193,7,0.8)", fontSize: isMobile ? 18 : 22 }}>+{asymScore}</span>
        </div>
        <div className="flex flex-col">
          <span className="font-mono" style={{ color: "rgba(255,255,255,0.25)", fontSize: 8, letterSpacing: "0.12em" }}>{t("gauge.stability")}</span>
          <span className="font-mono font-bold" style={{ color: stabilityColor(signal.stabilitySetup), fontSize: isMobile ? 14 : 16 }}>{signal.stabilitySetup}%</span>
        </div>
        {isMicroBest && signal.asMicro > 0 && (
          <div className="flex flex-col">
            <span className="font-mono" style={{ color: "rgba(0,200,255,0.3)", fontSize: 8, letterSpacing: "0.12em" }}>AS_μ</span>
            <span className="font-mono font-bold" style={{ color: "rgba(0,200,255,0.8)", fontSize: isMobile ? 14 : 16 }}>+{signal.asMicro}</span>
          </div>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════ */
/*     MINI SUBNET ROW                     */
/* ═══════════════════════════════════════ */
function SubnetRow({ signal, rank, type, isMobile, t, onClick }: {
  signal: SubnetSignal; rank: number; type: "opp" | "risk"; isMobile: boolean; t: (k: any) => string; onClick: () => void;
}) {
  const action = deriveSubnetAction(signal.opportunity, signal.risk, signal.confidence);
  const mainScore = type === "opp" ? signal.opportunity : signal.risk;
  const mainColor = type === "opp" ? opportunityColor(mainScore) : riskColor(mainScore);
  return (
    <div onClick={onClick} className="flex items-center gap-3 py-2 px-3 rounded-lg cursor-pointer transition-all hover:bg-white/[0.03]"
      style={{ borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
      <span className="font-mono" style={{ color: "rgba(255,255,255,0.15)", fontSize: isMobile ? 10 : 12, width: 16 }}>{rank}</span>
      <span className="font-mono font-bold" style={{ color: "rgba(255,248,220,0.75)", fontSize: isMobile ? 11 : 13, width: isMobile ? 50 : 60 }}>SN-{signal.netuid}</span>
      <span className="font-mono truncate" style={{ color: "rgba(255,255,255,0.35)", fontSize: isMobile ? 9 : 11, flex: 1 }}>{signal.name}</span>
      {signal.preHype && <span style={{ fontSize: 8, color: "rgba(255,100,255,0.6)" }}>⚡</span>}
      <span className="font-mono font-bold" style={{ color: mainColor, fontSize: isMobile ? 14 : 16, width: 36, textAlign: "right" }}>{mainScore}</span>
      <div className="flex items-center gap-1 px-2 py-0.5 rounded" style={{ background: actionBg(action), border: `1px solid ${actionBorder(action)}` }}>
        <span style={{ fontSize: 8 }}>{actionIcon(action)}</span>
        <span className="font-mono font-bold" style={{ color: actionColor(action), fontSize: isMobile ? 7 : 9, letterSpacing: "0.08em" }}>
          {t(`strat.${action.toLowerCase()}` as any)}
        </span>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════ */
/*     SUBNET SIDE PANEL                   */
/* ═══════════════════════════════════════ */
function SubnetPanel({ signal, open, onClose }: { signal: SubnetSignal | null; open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  if (!signal) return null;
  const { data: metrics } = useQuery({
    queryKey: ["subnet-detail", signal.netuid],
    queryFn: async () => {
      const { data } = await supabase.from("subnet_latest_display").select("*").eq("netuid", signal.netuid).maybeSingle();
      return data;
    },
    enabled: open,
  });
  const oppC = opportunityColor(signal.opportunity);
  const rskC = riskColor(signal.risk);
  const action = deriveSubnetAction(signal.opportunity, signal.risk, signal.confidence);

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full sm:w-[400px] border-l border-white/5 bg-[#080810] text-white overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="font-mono text-white/90 tracking-wider text-lg">{t("panel.title")}</SheetTitle>
        </SheetHeader>
        <div className="mt-6 space-y-6">
          <div className="text-center">
            <div className="font-mono text-2xl tracking-wider" style={{ color: "rgba(255,248,220,0.9)" }}>SN-{signal.netuid}</div>
            <div className="font-mono text-sm text-white/60 mt-1">{signal.name}</div>
            <div className="flex items-center justify-center gap-2 mt-2">
              {signal.isMicroCap && <span className="font-mono text-[9px] px-2 py-0.5 rounded" style={{ background: "rgba(0,200,255,0.1)", color: "rgba(0,200,255,0.7)" }}>MICRO-CAP</span>}
              {signal.preHype && <span className="font-mono text-[9px] px-2 py-0.5 rounded" style={{ background: "rgba(255,100,255,0.08)", color: "rgba(255,100,255,0.7)" }}>PRÉ-HYPE {signal.preHypeIntensity}%</span>}
            </div>
            <div className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg" style={{ background: actionBg(action), border: `1px solid ${actionBorder(action)}` }}>
              <span>{actionIcon(action)}</span>
              <span className="font-mono font-bold tracking-wider" style={{ color: actionColor(action), fontSize: 13 }}>{t(`strat.${action.toLowerCase()}` as any)}</span>
            </div>
          </div>
          <div className="flex items-center justify-center gap-8">
            <div className="text-center">
              <div className="font-mono text-3xl font-bold" style={{ color: oppC }}>{signal.opportunity}</div>
              <div className="font-mono text-[10px] text-white/40 tracking-widest mt-1">{t("gauge.opportunity")}</div>
            </div>
            <div style={{ width: 1, height: 40, background: "rgba(255,255,255,0.08)" }} />
            <div className="text-center">
              <div className="font-mono text-3xl font-bold" style={{ color: rskC }}>{signal.risk}</div>
              <div className="font-mono text-[10px] text-white/40 tracking-widest mt-1">{t("gauge.risk")}</div>
            </div>
          </div>
          <div className="flex items-center justify-center gap-6">
            <div className="text-center">
              <div className="font-mono text-lg font-bold" style={{ color: stabilityColor(signal.stabilitySetup) }}>{signal.stabilitySetup}%</div>
              <div className="font-mono text-[9px] text-white/30 tracking-widest">{t("gauge.stability")}</div>
            </div>
            <div className="text-center">
              <div className="font-mono text-lg font-bold" style={{ color: momentumColor(signal.momentumLabel) }}>{signal.momentumLabel}</div>
              <div className="font-mono text-[9px] text-white/30 tracking-widest">{t("sub.momentum")}</div>
            </div>
          </div>
          <div className="bg-white/[0.02] rounded-lg p-4">
            <div className="font-mono text-[10px] text-white/40 tracking-widest mb-3">{t("tip.why")}</div>
            {signal.reasons.map((r, i) => (<div key={i} className="font-mono text-sm text-white/65 mb-1.5">• {r}</div>))}
          </div>
          {signal.sparkline_7d.length > 1 && (
            <div className="bg-white/[0.02] rounded-lg p-4">
              <div className="font-mono text-[10px] text-white/30 tracking-widest mb-2">{t("tip.price7d")}</div>
              <svg width="100%" height="60" viewBox="0 0 300 60" preserveAspectRatio="none">
                <TooltipSparkline data={signal.sparkline_7d} width={300} height={55} color={oppC} />
              </svg>
            </div>
          )}
          {metrics && (
            <div className="space-y-3">
              <div className="font-mono text-[10px] text-white/30 tracking-widest">{t("panel.metrics")}</div>
              {[
                [t("panel.liquidity"), metrics.liquidity_usd ? `$${Number(metrics.liquidity_usd).toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "—"],
                [t("panel.volume"), metrics.vol_24h_usd ? `$${Number(metrics.vol_24h_usd).toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "—"],
                [t("panel.miners"), metrics.miners_active != null ? String(Math.round(Number(metrics.miners_active))) : "—"],
                [t("panel.cap"), metrics.cap_usd ? `$${Number(metrics.cap_usd).toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "—"],
              ].map(([label, val]) => (
                <div key={label} className="flex justify-between font-mono text-xs border-b border-white/[0.04] pb-2">
                  <span className="text-white/40">{label}</span><span className="text-white/75">{val}</span>
                </div>
              ))}
            </div>
          )}
          <button onClick={() => window.open(`https://taostats.io/subnets/${signal.netuid}`, "_blank")}
            className="w-full font-mono text-xs tracking-widest py-3 rounded-lg border border-white/10 hover:border-white/20 text-white/50 hover:text-white/80 transition-all">
            {t("panel.open_taostats")} ↗
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/* ═══════════════════════════════════════ */
/*    ALIEN GAUGE — MAIN PAGE              */
/* ═══════════════════════════════════════ */
export default function AlienGauge() {
  const { t, lang } = useI18n();

  /* ─── data fetch ─── */
  const { data: rawSignals } = useQuery({
    queryKey: ["signals-latest"],
    queryFn: async () => {
      const { data, error } = await supabase.from("signals_latest").select("*");
      if (error) throw error;
      return (data || []) as RawSignal[];
    },
    refetchInterval: 60_000,
  });

  const { data: sparklines } = useQuery({
    queryKey: ["sparklines-30d"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("subnet_price_daily")
        .select("netuid, date, price_close")
        .gte("date", new Date(Date.now() - 30 * 86400000).toISOString().split("T")[0])
        .order("date", { ascending: true });
      if (error) throw error;
      const map: Record<number, number[]> = {};
      for (const row of data || []) {
        if (!map[row.netuid]) map[row.netuid] = [];
        map[row.netuid].push(Number(row.price_close) || 0);
      }
      return map;
    },
    refetchInterval: 300_000,
  });

  /* ─── DataFusion sources ─── */
  const { data: primaryMetricsRaw } = useQuery({
    queryKey: ["metrics-primary"],
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
        const nid = r.netuid;
        if (!map.has(nid)) map.set(nid, { netuid: nid, price: Number(r.price) || null, cap: Number(r.cap) || null, vol24h: Number(r.vol_24h) || null, liquidity: Number(r.liquidity) || null, ts: r.ts, source: "taostats" });
      }
      return [...map.values()];
    },
    refetchInterval: 120_000,
  });

  const { data: secondaryMetricsRaw } = useQuery({
    queryKey: ["metrics-secondary"],
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
        const nid = r.netuid;
        if (!map.has(nid)) map.set(nid, { netuid: nid, price: Number(r.price) || null, cap: Number(r.cap) || null, vol24h: Number(r.vol_24h) || null, liquidity: Number(r.liquidity) || null, ts: r.ts, source: "taomarketcap" });
      }
      return [...map.values()];
    },
    refetchInterval: 120_000,
  });

  /* ─── DataFusion Confiance Data ─── */
  const confianceData = useMemo(() => {
    return computeGlobalConfianceData(primaryMetricsRaw ?? [], secondaryMetricsRaw ?? []);
  }, [primaryMetricsRaw, secondaryMetricsRaw]);

  /* ─── signals ─── */
  const allSignals = useMemo(() => processSignals(rawSignals ?? [], sparklines ?? {}), [rawSignals, sparklines]);

  const realOpp = useMemo(() => computeGlobalOpportunity(rawSignals ?? []), [rawSignals]);
  const realRisk = useMemo(() => computeGlobalRisk(rawSignals ?? []), [rawSignals]);
  const realConf = useMemo(() => computeGlobalConfidence(rawSignals ?? []), [rawSignals]);

  const globalOpp = realOpp;
  const globalRisk = realRisk;
  const globalConf = realConf;

  /* ─── smart capital ─── */
  const smartCapital = useMemo(() => computeSmartCapital(rawSignals ?? []), [rawSignals]);

  /* ─── Flow data ─── */
  const flowData = useMemo(() => {
    if (!allSignals.length) return { dominance: "stable" as const, emission: "stable" as const, inflow: "stable" as const };
    const oppSignals = allSignals.filter(s => s.dominant === "opportunity").length;
    const riskSignals = allSignals.filter(s => s.dominant === "risk").length;
    const avgMomentum = allSignals.reduce((a, s) => a + s.momentum, 0) / allSignals.length;
    return {
      dominance: oppSignals > riskSignals + 1 ? "up" as const : riskSignals > oppSignals + 1 ? "down" as const : "stable" as const,
      emission: avgMomentum > 55 ? "up" as const : avgMomentum < 35 ? "down" as const : "stable" as const,
      inflow: smartCapital.state === "ACCUMULATION" ? "up" as const : smartCapital.state === "DISTRIBUTION" ? "down" as const : "stable" as const,
    };
  }, [allSignals, smartCapital.state]);

  /* ─── Compute AS_micro + Pre-Hype for all signals ─── */
  const enrichedSignals = useMemo(() => {
    return allSignals.map(s => {
      const asMicro = s.isMicroCap
        ? computeASMicro(s, smartCapital.state, flowData.dominance, flowData.emission)
        : s.opportunity - s.risk;
      const ph = detectPreHype(s, smartCapital.state, flowData.dominance, flowData.emission);
      return { ...s, asMicro, preHype: ph.active, preHypeIntensity: ph.intensity };
    });
  }, [allSignals, smartCapital.state, flowData]);

  /* ─── Strategy (fixed hunter mode, modulated by Confiance Data) ─── */
  const strategicAction = useMemo(() => {
    const raw = deriveStrategicAction(globalOpp, globalRisk, smartCapital.state, globalConf, "hunter");
    if (raw === "ENTER" && shouldModerateRecommendation(confianceData.score, globalOpp, globalRisk)) {
      return "WATCH" as const;
    }
    return raw;
  }, [globalOpp, globalRisk, smartCapital.state, globalConf, confianceData.score]);

  /* ─── Sentinel Index ─── */
  const sentinelIndex = useMemo(() => computeSentinelIndex(globalOpp, globalRisk, smartCapital.score), [globalOpp, globalRisk, smartCapital.score]);
  const sentinelLabel = sentinelIndexLabel(sentinelIndex, lang);

  /* ─── Global Stability Setup ─── */
  const globalStability = useMemo(() => {
    if (!enrichedSignals.length) return 50;
    const avg = enrichedSignals.reduce((a, s) => a + s.stabilitySetup, 0) / enrichedSignals.length;
    return Math.round(avg);
  }, [enrichedSignals]);

  /* ─── Global Asymmetry Score ─── */
  const globalAsym = globalOpp - globalRisk;

  /* ─── Saturation Index ─── */
  const saturationIndex = useMemo(() => computeSaturationIndex(enrichedSignals), [enrichedSignals]);
  const isSaturated = saturationAlert(saturationIndex);

  /* ─── Best micro-cap subnet (center card) ─── */
  const bestMicroCap = useMemo(() => {
    const micros = enrichedSignals.filter(s => s.isMicroCap && s.asMicro > 0);
    if (!micros.length) return null;
    return micros.sort((a, b) => b.asMicro - a.asMicro)[0];
  }, [enrichedSignals]);

  const bestSubnet = useMemo(() => {
    if (!enrichedSignals.length) return null;
    return [...enrichedSignals].sort((a, b) => (b.opportunity - b.risk) - (a.opportunity - a.risk))[0];
  }, [enrichedSignals]);

  const displayBest = bestMicroCap ?? bestSubnet;
  const isMicroBest = !!bestMicroCap;

  /* ─── Top 3 Opportunities + Top 3 Risks ─── */
  const topOpportunities = useMemo(() =>
    [...enrichedSignals].sort((a, b) => b.opportunity - a.opportunity).slice(0, 3),
    [enrichedSignals]
  );
  const topRisks = useMemo(() =>
    [...enrichedSignals].filter(s => s.risk > 40).sort((a, b) => b.risk - a.risk).slice(0, 3),
    [enrichedSignals]
  );

  const [panelSignal, setPanelSignal] = useState<SubnetSignal | null>(null);

  /* ─── geometry ─── */
  const isMobile = useIsMobile();
  const SIZE = isMobile ? 300 : 520;
  const SVG_SIZE = SIZE;
  const CX = SVG_SIZE / 2, CY = SVG_SIZE / 2;
  const R_OUTER = isMobile ? 120 : 220;
  const R_INNER = isMobile ? 95 : 180;

  const oppGlobal = opportunityColor(globalOpp);
  const rskGlobal = riskColor(globalRisk);
  const oppAngle = (globalOpp / 100) * 270;
  const riskAngle = (globalRisk / 100) * 270;

  return (
    <div className="h-full w-full select-none overflow-y-auto overflow-x-hidden" style={{ background: "#000" }}>
      <div className="absolute inset-0 pointer-events-none" style={{ background: "radial-gradient(ellipse at center, transparent 35%, rgba(0,0,0,0.75) 100%)" }} />

      <style>{`
        @keyframes priority-pulse {
          0%, 100% { opacity: 0.6; }
          50% { opacity: 1; }
        }
        @keyframes opp-sweep {
          0% { opacity: 0.3; }
          50% { opacity: 0.6; }
          100% { opacity: 0.3; }
        }
      `}</style>

      {/* ═══ HEADER ═══ */}
      <div className="relative z-30 flex items-center justify-center px-4 sm:px-8 pt-4 sm:pt-6">
        <div className="flex flex-col items-center">
          <div style={{ width: 6, height: 6, borderRadius: "50%", background: "rgba(255,215,0,0.6)", boxShadow: "0 0 12px rgba(255,215,0,0.3)", marginBottom: 8 }} />
          <span className="font-mono font-bold tracking-[0.4em] sm:tracking-[0.6em]" style={{ fontSize: isMobile ? 14 : 20, color: "rgba(255,248,220,0.85)", textShadow: "0 0 30px rgba(255,215,0,0.15)" }}>
            {t("header.title")}
          </span>
        </div>
      </div>

      {/* ═══ MAIN CONTENT ═══ */}
      <div className="relative z-10 flex flex-col items-center px-4 sm:px-8 pb-20" style={{ paddingTop: isMobile ? 12 : 24 }}>

        {/* ─── GAUGE ─── */}
        <div className="relative" style={{ width: SIZE, height: SIZE }}>
          <div className="absolute inset-0 rounded-full pointer-events-none" style={{ background: `radial-gradient(circle, rgba(255,180,50,0.05) 0%, transparent 60%)`, transform: "scale(1.3)" }} />
          <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SVG_SIZE} ${SVG_SIZE}`}>
            {Array.from({ length: 54 }, (_, i) => {
              const angleDeg = (i * 5) - 135;
              if (angleDeg > 135) return null;
              const rad = ((angleDeg - 90) * Math.PI) / 180;
              const isMajor = i % 9 === 0;
              const r1 = R_OUTER + 4; const r2 = R_OUTER + (isMajor ? 14 : 8);
              return <line key={`ot-${i}`} x1={CX + r1 * Math.cos(rad)} y1={CY + r1 * Math.sin(rad)} x2={CX + r2 * Math.cos(rad)} y2={CY + r2 * Math.sin(rad)} stroke={isMajor ? "rgba(255,215,0,0.2)" : "rgba(255,215,0,0.06)"} strokeWidth={isMajor ? 1.5 : 0.7} strokeLinecap="round" />;
            })}
            {Array.from({ length: 54 }, (_, i) => {
              const angleDeg = (i * 5) - 135;
              if (angleDeg > 135) return null;
              const rad = ((angleDeg - 90) * Math.PI) / 180;
              const isMajor = i % 9 === 0;
              const r1 = R_INNER - 4; const r2 = R_INNER - (isMajor ? 12 : 7);
              return <line key={`it-${i}`} x1={CX + r1 * Math.cos(rad)} y1={CY + r1 * Math.sin(rad)} x2={CX + r2 * Math.cos(rad)} y2={CY + r2 * Math.sin(rad)} stroke={isMajor ? "rgba(229,57,53,0.18)" : "rgba(229,57,53,0.05)"} strokeWidth={isMajor ? 1.2 : 0.5} strokeLinecap="round" />;
            })}
            <circle cx={CX} cy={CY} r={R_OUTER} fill="none" stroke="rgba(255,215,0,0.04)" strokeWidth={isMobile ? 6 : 10} />
            {oppAngle > 0 && <path d={describeArc(CX, CY, R_OUTER, -135, -135 + oppAngle)} fill="none" stroke={oppGlobal} strokeWidth={isMobile ? 6 : 10} strokeLinecap="round" style={{ opacity: 0.55, animation: "opp-sweep 4s ease-in-out infinite" }} />}
            <circle cx={CX} cy={CY} r={R_INNER} fill="none" stroke="rgba(229,57,53,0.04)" strokeWidth={isMobile ? 8 : 12} />
            {riskAngle > 0 && <path d={describeArc(CX, CY, R_INNER, -135, -135 + riskAngle)} fill="none" stroke={rskGlobal} strokeWidth={isMobile ? 8 : 12} strokeLinecap="round" style={{ opacity: 0.55 }} />}
            <text x={CX + R_OUTER + 18} y={CY - R_OUTER + 30} fill="rgba(255,215,0,0.3)" fontSize={isMobile ? 7 : 10} fontFamily="'JetBrains Mono', monospace" letterSpacing="0.12em" textAnchor="start">{t("gauge.opportunity")}</text>
            <text x={CX + R_INNER + 14} y={CY - R_INNER + 28} fill="rgba(229,57,53,0.25)" fontSize={isMobile ? 7 : 10} fontFamily="'JetBrains Mono', monospace" letterSpacing="0.12em" textAnchor="start">{t("gauge.risk")}</text>
          </svg>

          {/* CENTER HUD */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="flex flex-col items-center text-center" style={{ maxWidth: isMobile ? 180 : 300 }}>
              {/* Stabilité Setup */}
              <span className="font-mono tracking-[0.2em] uppercase" style={{ fontSize: isMobile ? 7 : 10, color: "rgba(255,215,0,0.45)" }}>
                {t("gauge.stability")}
              </span>
              <span className="font-mono font-bold leading-none mt-1" style={{
                fontSize: isMobile ? 36 : 64, color: stabilityColor(globalStability),
                textShadow: "0 0 40px rgba(255,215,0,0.2)",
              }}>
                {globalStability}%
              </span>

              {/* Core metrics row */}
              <div className="flex items-center mt-3" style={{ gap: isMobile ? 8 : 14 }}>
                <div className="flex flex-col items-center">
                  <span className="font-mono" style={{ color: "rgba(255,215,0,0.3)", fontSize: isMobile ? 6 : 8, letterSpacing: "0.15em" }}>OPP</span>
                  <span className="font-mono font-bold" style={{ color: oppGlobal, fontSize: isMobile ? 14 : 20 }}>{globalOpp}</span>
                </div>
                <div style={{ width: 1, height: isMobile ? 16 : 24, background: "rgba(255,255,255,0.06)" }} />
                <div className="flex flex-col items-center">
                  <span className="font-mono" style={{ color: "rgba(229,57,53,0.3)", fontSize: isMobile ? 6 : 8, letterSpacing: "0.15em" }}>RISK</span>
                  <span className="font-mono font-bold" style={{ color: rskGlobal, fontSize: isMobile ? 14 : 20 }}>{globalRisk}</span>
                </div>
                <div style={{ width: 1, height: isMobile ? 16 : 24, background: "rgba(255,255,255,0.06)" }} />
                <div className="flex flex-col items-center">
                  <span className="font-mono" style={{ color: "rgba(255,255,255,0.2)", fontSize: isMobile ? 6 : 8, letterSpacing: "0.15em" }}>ASYM</span>
                  <span className="font-mono font-bold" style={{ color: globalAsym > 20 ? "rgba(76,175,80,0.85)" : globalAsym > 0 ? "rgba(255,193,7,0.7)" : "rgba(229,57,53,0.7)", fontSize: isMobile ? 14 : 20 }}>
                    {globalAsym > 0 ? "+" : ""}{globalAsym}
                  </span>
                </div>
                <div style={{ width: 1, height: isMobile ? 16 : 24, background: "rgba(255,255,255,0.06)" }} />
                <div className="flex flex-col items-center">
                  <span className="font-mono" style={{
                    color: smartCapital.state === "ACCUMULATION" ? "rgba(76,175,80,0.4)" : smartCapital.state === "DISTRIBUTION" ? "rgba(229,57,53,0.4)" : "rgba(255,255,255,0.2)",
                    fontSize: isMobile ? 6 : 8, letterSpacing: "0.15em",
                  }}>SC</span>
                  <span className="font-mono font-bold" style={{
                    color: smartCapital.state === "ACCUMULATION" ? "rgba(76,175,80,0.85)" : smartCapital.state === "DISTRIBUTION" ? "rgba(229,57,53,0.85)" : "rgba(255,248,220,0.5)",
                    fontSize: isMobile ? 9 : 12,
                  }}>
                    {t(`sc.${smartCapital.state.toLowerCase()}` as any)}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ═══ STRATEGIC RECOMMENDATION ═══ */}
        <div className="mt-4 sm:mt-6 flex flex-col items-center gap-3">
          <span className="font-mono tracking-[0.2em] uppercase" style={{ fontSize: isMobile ? 7 : 9, color: "rgba(255,255,255,0.2)" }}>
            {t("strat.label")}
          </span>
          <StrategicBadge action={strategicAction} label={t(`strat.${strategicAction.toLowerCase()}` as any)} isMobile={isMobile} />
        </div>

        {/* ═══ SENTINEL INDEX + CONFIANCE DATA + FLOW BADGES ═══ */}
        <div className="mt-5 sm:mt-8 flex flex-col sm:flex-row items-center gap-4 sm:gap-10">
          <div className="flex flex-col items-center gap-1">
            <SentinelIndexDisplay score={sentinelIndex} label={sentinelLabel} isMobile={isMobile} />
            <span className="font-mono" style={{ fontSize: isMobile ? 8 : 10, color: confianceColor(confianceData.score), letterSpacing: "0.08em" }}>
              {t("data.confiance")}: {confianceData.score}%
            </span>
          </div>
          <div style={{ width: 1, height: 40, background: "rgba(255,255,255,0.05)" }} className="hidden sm:block" />
          <div className="flex items-center gap-2">
            <FlowBadge label={t("flow.dominance")} direction={flowData.dominance} isMobile={isMobile} />
            <FlowBadge label={t("flow.emission")} direction={flowData.emission} isMobile={isMobile} />
            <FlowBadge label={t("flow.inflow")} direction={flowData.inflow} isMobile={isMobile} />
          </div>
        </div>

        {/* ═══ SATURATION ALERT ═══ */}
        {isSaturated && (
          <div className="mt-3 px-4 py-2 rounded-lg" style={{ background: "rgba(255,109,0,0.06)", border: "1px solid rgba(255,109,0,0.15)" }}>
            <span className="font-mono text-[10px] tracking-wider" style={{ color: "rgba(255,109,0,0.8)" }}>
              {t("gauge.saturation_alert")} ({saturationIndex}%)
            </span>
          </div>
        )}

        {/* ═══ BEST SUBNET ═══ */}
        {displayBest && (
          <div className="mt-6 sm:mt-10 w-full" style={{ maxWidth: isMobile ? "100%" : 600 }}>
            <span className="font-mono tracking-[0.2em] uppercase block mb-3" style={{ fontSize: isMobile ? 8 : 10, color: isMicroBest ? "rgba(0,200,255,0.4)" : "rgba(255,215,0,0.3)" }}>
              {isMicroBest ? t("top.best_micro") : t("top.best")}
            </span>
            <BestSubnetCard signal={displayBest} isMobile={isMobile} t={t} onClick={() => setPanelSignal(displayBest)} isMicroBest={isMicroBest} />
          </div>
        )}

        {/* ═══ TOP 3 OPPORTUNITIES + TOP 3 RISKS ═══ */}
        <div className="mt-6 sm:mt-8 w-full grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-8" style={{ maxWidth: 900 }}>
          <div>
            <span className="font-mono tracking-[0.2em] uppercase block mb-3" style={{ fontSize: isMobile ? 8 : 10, color: "rgba(255,215,0,0.3)" }}>
              {t("top.opportunities")}
            </span>
            <div className="rounded-xl" style={{ background: "rgba(255,255,255,0.01)", border: "1px solid rgba(255,255,255,0.04)" }}>
              {topOpportunities.map((s, i) => (
                <SubnetRow key={s.netuid} signal={s} rank={i + 1} type="opp" isMobile={isMobile} t={t} onClick={() => setPanelSignal(s)} />
              ))}
            </div>
          </div>
          <div>
            <span className="font-mono tracking-[0.2em] uppercase block mb-3" style={{ fontSize: isMobile ? 8 : 10, color: "rgba(229,57,53,0.3)" }}>
              {t("top.risks")}
            </span>
            <div className="rounded-xl" style={{ background: "rgba(255,255,255,0.01)", border: "1px solid rgba(255,255,255,0.04)" }}>
              {topRisks.length > 0 ? topRisks.map((s, i) => (
                <SubnetRow key={s.netuid} signal={s} rank={i + 1} type="risk" isMobile={isMobile} t={t} onClick={() => setPanelSignal(s)} />
              )) : (
                <div className="py-6 text-center font-mono text-xs" style={{ color: "rgba(255,255,255,0.15)" }}>—</div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ═══ NOTIFICATION BUTTON (disabled, "bientôt") ═══ */}
      <div className="fixed bottom-4 left-4 z-20">
        <div className="font-mono text-[10px] tracking-wider px-3 py-1.5 rounded-md flex items-center gap-2"
          style={{ background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.25)", border: "1px solid rgba(255,255,255,0.08)", cursor: "not-allowed", opacity: 0.7 }}>
          🔔 {t("gauge.notif")}
          <span className="px-1.5 py-0.5 rounded text-[8px] font-bold" style={{ background: "rgba(255,193,7,0.12)", color: "rgba(255,193,7,0.7)", border: "1px solid rgba(255,193,7,0.2)" }}>
            {lang === "fr" ? "BIENTÔT" : "SOON"}
          </span>
        </div>
      </div>

      <SubnetPanel signal={panelSignal} open={!!panelSignal} onClose={() => setPanelSignal(null)} />
    </div>
  );
}
