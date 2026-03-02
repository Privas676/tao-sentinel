import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useIsMobile } from "@/hooks/use-mobile";
import { useI18n } from "@/lib/i18n";
import { useSubnetScores, type UnifiedSubnetScore } from "@/hooks/use-subnet-scores";
import {
  clamp,
  opportunityColor, riskColor,
  computeSmartCapital,
  computeASMicro, detectPreHype, computeSaturationIndex, saturationAlert,
  stabilityColor,
  type SmartCapitalState, type RawSignal,
} from "@/lib/gauge-engine";
import { type ScoreFactor, topFactors } from "@/lib/score-factors";
import {
  actionColor, actionBg, actionBorder, actionIcon,
  computeSentinelIndex, sentinelIndexColor, sentinelIndexLabel,
  deriveSubnetAction,
  deriveMacroRecommendation, macroColor, macroBg, macroBorder, macroIcon,
} from "@/lib/strategy-engine";
import {
  computeGlobalConfianceData, confianceColor,
  fuseMetrics,
} from "@/lib/data-fusion";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import DataAlignmentBadge from "@/components/DataAlignmentBadge";
import { evaluateKillSwitch, type KillSwitchResult } from "@/lib/push-kill-switch";
import { useAuditLogger } from "@/hooks/use-audit-log";

/* ═══════════════════════════════════════ */
/*          SPARKLINE HELPER               */
/* ═══════════════════════════════════════ */
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
/*     METRIC CARD                         */
/* ═══════════════════════════════════════ */
function MetricCard({ label, value, color, sub }: { label: string; value: string | number; color: string; sub?: string }) {
  return (
    <div className="flex flex-col items-center px-4 py-3 rounded-xl" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)" }}>
      <span className="font-mono tracking-[0.15em] uppercase" style={{ fontSize: 8, color: "rgba(255,255,255,0.3)" }}>{label}</span>
      <span className="font-mono font-bold mt-1" style={{ color, fontSize: 22 }}>{value}</span>
      {sub && <span className="font-mono mt-0.5" style={{ fontSize: 9, color, opacity: 0.7 }}>{sub}</span>}
    </div>
  );
}

/* ═══════════════════════════════════════ */
/*    Dashboard signal type (adapter)      */
/* ═══════════════════════════════════════ */
type DashSignal = UnifiedSubnetScore & {
  sparkline_7d: number[];
  dominant: "opportunity" | "risk" | "neutral";
  isMicroCap: boolean;
  asMicro: number;
  preHype: boolean;
  preHypeIntensity: number;
  reasons: string[];
};

/* ═══════════════════════════════════════ */
/*     BEST SUBNET CARD                    */
/* ═══════════════════════════════════════ */
function BestSubnetCard({ signal, isMobile, t, onClick, isMicroBest, smartCapitalLabel }: {
  signal: DashSignal; isMobile: boolean; t: (k: any) => string; onClick: () => void; isMicroBest?: boolean; smartCapitalLabel: string;
}) {
  const action = signal.action;
  const asymScore = signal.opp - signal.risk;
  return (
    <div onClick={onClick} className="cursor-pointer rounded-xl transition-all hover:scale-[1.01]" style={{
      background: "rgba(255,215,0,0.03)", border: "1px solid rgba(255,215,0,0.12)",
      padding: isMobile ? "14px 16px" : "20px 24px", boxShadow: "0 0 40px rgba(255,215,0,0.04)",
    }}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span className="font-mono font-bold" style={{ color: "rgba(255,248,220,0.9)", fontSize: isMobile ? 16 : 20 }}>SN-{signal.netuid}</span>
          <span className="font-mono" style={{ color: "rgba(255,255,255,0.4)", fontSize: isMobile ? 11 : 13 }}>{signal.name}</span>
          {signal.isMicroCap && (
            <span className="font-mono text-[8px] px-1.5 py-0.5 rounded" style={{ background: "rgba(0,200,255,0.1)", color: "rgba(0,200,255,0.7)", border: "1px solid rgba(0,200,255,0.2)" }}>MICRO</span>
          )}
          {signal.preHype && (
            <span className="font-mono text-[8px] px-1.5 py-0.5 rounded" style={{ background: "rgba(255,100,255,0.08)", color: "rgba(255,100,255,0.7)", border: "1px solid rgba(255,100,255,0.15)" }}>PRÉ-HYPE</span>
          )}
          {/* dataUncertain badge removed — TMC decoupled */}
        </div>
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg" style={{
          background: actionBg(action), border: `1px solid ${actionBorder(action)}`,
        }}>
          <span style={{ fontSize: isMobile ? 12 : 14 }}>{actionIcon(action)}</span>
          <span className="font-mono font-bold tracking-wider" style={{ color: actionColor(action), fontSize: isMobile ? 11 : 13 }}>
            {t(`strat.${action.toLowerCase()}` as any)}
          </span>
        </div>
      </div>
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
        <div className="flex flex-col">
          <span className="font-mono" style={{ color: "rgba(255,215,0,0.35)", fontSize: 8, letterSpacing: "0.12em" }}>{t("gauge.opportunity")}</span>
          <span className="font-mono font-bold" style={{ color: opportunityColor(signal.opp), fontSize: isMobile ? 20 : 24 }}>{signal.opp}</span>
        </div>
        <div className="flex flex-col">
          <span className="font-mono" style={{ color: "rgba(229,57,53,0.3)", fontSize: 8, letterSpacing: "0.12em" }}>{t("gauge.risk")}</span>
          <span className="font-mono font-bold" style={{ color: riskColor(signal.risk), fontSize: isMobile ? 20 : 24 }}>{signal.risk}</span>
        </div>
        <div className="flex flex-col">
          <span className="font-mono" style={{ color: "rgba(255,255,255,0.25)", fontSize: 8, letterSpacing: "0.12em" }}>
            {isMicroBest && signal.isMicroCap ? "AS_μ" : "AS"}
          </span>
          <span className="font-mono font-bold" style={{ color: asymScore > 30 ? "rgba(76,175,80,0.9)" : asymScore > 0 ? "rgba(255,193,7,0.8)" : "rgba(229,57,53,0.8)", fontSize: isMobile ? 18 : 22 }}>
            {isMicroBest && signal.isMicroCap ? (signal.asMicro > 0 ? "+" : "") + signal.asMicro : (asymScore > 0 ? "+" : "") + asymScore}
          </span>
        </div>
        <div className="flex flex-col">
          <span className="font-mono" style={{ color: "rgba(255,255,255,0.25)", fontSize: 8, letterSpacing: "0.12em" }}>{t("sc.label")}</span>
          <span className="font-mono font-bold" style={{ fontSize: isMobile ? 10 : 12, color: "rgba(255,248,220,0.6)" }}>{smartCapitalLabel}</span>
        </div>
        <div className="flex flex-col">
          <span className="font-mono" style={{ color: "rgba(255,255,255,0.25)", fontSize: 8, letterSpacing: "0.12em" }}>{t("gauge.stability")}</span>
          <span className="font-mono font-bold" style={{ color: stabilityColor(signal.stability), fontSize: isMobile ? 14 : 16 }}>{signal.stability}%</span>
        </div>
        {signal.preHype && (
          <div className="flex flex-col">
            <span className="font-mono" style={{ color: "rgba(255,100,255,0.3)", fontSize: 8, letterSpacing: "0.12em" }}>{t("pre_hype.label")}</span>
            <span className="font-mono font-bold" style={{ color: "rgba(255,100,255,0.8)", fontSize: isMobile ? 14 : 16 }}>{signal.preHypeIntensity}%</span>
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
  signal: DashSignal; rank: number; type: "opp" | "risk"; isMobile: boolean; t: (k: any) => string; onClick: () => void;
}) {
  const action = signal.action;
  const mainScore = type === "opp" ? signal.opp : signal.risk;
  const mainColor = type === "opp" ? opportunityColor(mainScore) : riskColor(mainScore);
  return (
    <div onClick={onClick} className="flex items-center gap-3 py-2 px-3 rounded-lg cursor-pointer transition-all hover:bg-white/[0.03]"
      style={{ borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
      <span className="font-mono" style={{ color: "rgba(255,255,255,0.15)", fontSize: isMobile ? 10 : 12, width: 16 }}>{rank}</span>
      <span className="font-mono font-bold" style={{ color: "rgba(255,248,220,0.75)", fontSize: isMobile ? 11 : 13, width: isMobile ? 50 : 60 }}>SN-{signal.netuid}</span>
      <span className="font-mono truncate" style={{ color: "rgba(255,255,255,0.35)", fontSize: isMobile ? 9 : 11, flex: 1 }}>{signal.name}</span>
      {signal.preHype && <span style={{ fontSize: 8, color: "rgba(255,100,255,0.6)" }}>⚡</span>}
      {/* dataUncertain indicator removed */}
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
function SubnetPanel({ signal, open, onClose }: { signal: DashSignal | null; open: boolean; onClose: () => void }) {
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
  const oppC = opportunityColor(signal.opp);
  const rskC = riskColor(signal.risk);
  const action = signal.action;

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
              {/* dataUncertain badge removed — TMC decoupled */}
            </div>
            <div className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg" style={{ background: actionBg(action), border: `1px solid ${actionBorder(action)}` }}>
              <span>{actionIcon(action)}</span>
              <span className="font-mono font-bold tracking-wider" style={{ color: actionColor(action), fontSize: 13 }}>{t(`strat.${action.toLowerCase()}` as any)}</span>
            </div>
          </div>
          <div className="flex items-center justify-center gap-8">
            <div className="text-center">
              <div className="font-mono text-3xl font-bold" style={{ color: oppC }}>{signal.opp}</div>
              <div className="font-mono text-[10px] text-white/40 tracking-widest mt-1">{t("gauge.opportunity")}</div>
            </div>
            <div style={{ width: 1, height: 40, background: "rgba(255,255,255,0.08)" }} />
            <div className="text-center">
              <div className="font-mono text-3xl font-bold" style={{ color: rskC }}>{signal.risk}</div>
              <div className="font-mono text-[10px] text-white/40 tracking-widest mt-1">{t("gauge.risk")}</div>
            </div>
          </div>

          {/* ── ScoreFactors: Opportunity ── */}
          <div className="bg-white/[0.02] rounded-lg p-4">
            <div className="font-mono text-[9px] text-white/30 tracking-widest mb-2.5" style={{ color: oppC }}>
              TOP CONTRIBUTEURS — OPP {signal.opp}
            </div>
            {(() => {
              const h = signal.healthScores ?? { volumeHealth: 50, activityHealth: 50, liquidityHealth: 50, emissionPressure: 20, dilutionRisk: 20 };
              const factors: ScoreFactor[] = [
                { code: "MOMENTUM", label: "Momentum (PSI)", contribution: Math.round(clamp(signal.psi - 40, 0, 60) / 60 * 30), rawValue: signal.psi },
                { code: "VOLUME", label: "Volume santé", contribution: Math.round(h.volumeHealth / 100 * 20), rawValue: Math.round(h.volumeHealth) },
                { code: "ACTIVITY", label: "Activité mineurs", contribution: Math.round(h.activityHealth / 100 * 20), rawValue: Math.round(h.activityHealth) },
                { code: "SMART_CAPITAL", label: "Smart Capital", contribution: signal.sc === "ACCUMULATION" ? 15 : signal.sc === "DISTRIBUTION" ? 3 : 8, rawValue: signal.sc === "ACCUMULATION" ? 70 : signal.sc === "DISTRIBUTION" ? 20 : 45 },
                { code: "LIQUIDITY", label: "Liquidité", contribution: Math.round(h.liquidityHealth / 100 * 15), rawValue: Math.round(h.liquidityHealth) },
              ];
              return topFactors(factors, 3).map((f, i) => (
                <div key={i} className="mb-2">
                  <div className="flex justify-between items-center font-mono text-[11px]">
                    <span className="text-white/50">{f.label}</span>
                    <span className="text-white/75 font-bold">+{f.contribution}</span>
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <div className="flex-1 h-1.5 rounded-full bg-white/5 overflow-hidden">
                      <div className="h-full rounded-full transition-all" style={{ width: `${clamp((f.rawValue ?? 0), 0, 100)}%`, background: oppC }} />
                    </div>
                    <span className="font-mono text-[9px] text-white/30 w-7 text-right">{f.rawValue ?? 0}</span>
                  </div>
                </div>
              ));
            })()}
            {signal.isOverridden && <div className="font-mono text-[10px] pt-2 border-t border-white/5" style={{ color: "rgba(229,57,53,0.8)" }}>⛔ Override actif → OPP = 0</div>}
          </div>

          {/* ── ScoreFactors: Risk ── */}
          <div className="bg-white/[0.02] rounded-lg p-4">
            <div className="font-mono text-[9px] text-white/30 tracking-widest mb-2.5" style={{ color: rskC }}>
              TOP CONTRIBUTEURS — RISK {signal.risk}
            </div>
            {(() => {
              const h = signal.healthScores ?? { volumeHealth: 50, activityHealth: 50, liquidityHealth: 50, emissionPressure: 20, dilutionRisk: 20 };
              const factors: ScoreFactor[] = [
                { code: "LIQ_LOW", label: "Liquidité ↓", contribution: Math.round((100 - h.liquidityHealth) / 100 * 30), rawValue: Math.round(100 - h.liquidityHealth) },
                { code: "EMISSION", label: "Pression émission", contribution: Math.round(h.emissionPressure / 100 * 25), rawValue: Math.round(h.emissionPressure) },
                { code: "DILUTION", label: "Risque dilution", contribution: Math.round(h.dilutionRisk / 100 * 25), rawValue: Math.round(h.dilutionRisk) },
                { code: "ACTIVITY_LOW", label: "Activité ↓", contribution: Math.round((100 - h.activityHealth) / 100 * 20), rawValue: Math.round(100 - h.activityHealth) },
                { code: "HAIRCUT", label: "Haircut prix", contribution: Math.round(Math.min(Math.abs(signal.recalc?.liqHaircut ?? 0), 50) / 50 * 15), rawValue: Math.round(Math.abs(signal.recalc?.liqHaircut ?? 0)) },
              ];
              return topFactors(factors, 3).map((f, i) => (
                <div key={i} className="mb-2">
                  <div className="flex justify-between items-center font-mono text-[11px]">
                    <span className="text-white/50">{f.label}</span>
                    <span className="text-white/75 font-bold">+{f.contribution}</span>
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <div className="flex-1 h-1.5 rounded-full bg-white/5 overflow-hidden">
                      <div className="h-full rounded-full transition-all" style={{ width: `${clamp((f.rawValue ?? 0), 0, 100)}%`, background: rskC }} />
                    </div>
                    <span className="font-mono text-[9px] text-white/30 w-7 text-right">{f.rawValue ?? 0}</span>
                  </div>
                </div>
              ));
            })()}
            {signal.delistCategory !== "NORMAL" && (
              <div className="font-mono text-[10px] pt-2 border-t border-white/5 flex justify-between">
                <span style={{ color: signal.delistCategory === "DEPEG_PRIORITY" ? "rgba(229,57,53,0.9)" : "rgba(255,152,0,0.9)" }}>
                  {signal.delistCategory === "DEPEG_PRIORITY" ? "🔴 RISQUE DEREG" : "🟠 Near Delist"}
                </span>
                <span className="text-white/60 font-bold">Score {signal.delistScore}</span>
              </div>
            )}
          </div>

          <div className="flex items-center justify-center gap-6">
            <div className="text-center">
              <div className="font-mono text-lg font-bold" style={{ color: stabilityColor(signal.stability) }}>{signal.stability}%</div>
              <div className="font-mono text-[9px] text-white/30 tracking-widest">{t("gauge.stability")}</div>
            </div>
            <div className="text-center">
              <div className="font-mono text-lg font-bold" style={{ color: confianceColor(signal.confianceScore) }}>{signal.confianceScore}%</div>
              <div className="font-mono text-[9px] text-white/30 tracking-widest">{t("data.confiance")}</div>
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
          <div className="flex gap-2">
            <button onClick={() => window.open(`https://taostats.io/subnets/${signal.netuid}`, "_blank")}
              className="flex-1 font-mono text-xs tracking-widest py-3 rounded-lg border border-white/10 hover:border-white/20 text-white/50 hover:text-white/80 transition-all">
              TaoStats ↗
            </button>
            <button onClick={() => window.open(`https://taomarketcap.com/subnets/${signal.netuid}`, "_blank")}
              className="flex-1 font-mono text-xs tracking-widest py-3 rounded-lg border border-white/10 hover:border-white/20 text-white/50 hover:text-white/80 transition-all">
              TaoMarketCap ↗
            </button>
          </div>
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

  // ── UNIFIED SCORES (single source of truth) ──
  const { scoresList, sparklines, scoreTimestamp, taoUsd, dataAlignment, dataAgeDebug, fleetDistribution, dataConfidence } = useSubnetScores();

  // Raw signals still needed for global Smart Capital computation
  const { data: rawSignals } = useQuery({
    queryKey: ["unified-signals"],
    queryFn: async () => {
      const { data, error } = await supabase.from("signals_latest").select("*");
      if (error) throw error;
      return (data || []) as RawSignal[];
    },
    refetchInterval: 60_000,
  });

  // Global metrics derived from UNIFIED scores
  const globalOpp = useMemo(() => {
    if (!scoresList.length) return 0;
    const sorted = [...scoresList].sort((a, b) => b.opp - a.opp);
    const top25 = sorted.slice(0, Math.max(1, Math.ceil(sorted.length * 0.25)));
    const topAvg = top25.reduce((a, s) => a + s.opp, 0) / top25.length;
    const allAvg = scoresList.reduce((a, s) => a + s.opp, 0) / scoresList.length;
    return Math.round(topAvg * 0.6 + allAvg * 0.4);
  }, [scoresList]);

  const globalRisk = useMemo(() => {
    if (!scoresList.length) return 0;
    const sorted = [...scoresList].sort((a, b) => b.risk - a.risk);
    const top25 = sorted.slice(0, Math.max(1, Math.ceil(sorted.length * 0.25)));
    const topAvg = top25.reduce((a, s) => a + s.risk, 0) / top25.length;
    const allAvg = scoresList.reduce((a, s) => a + s.risk, 0) / scoresList.length;
    return Math.round(topAvg * 0.5 + allAvg * 0.5);
  }, [scoresList]);

  const globalConf = useMemo(() => {
    if (!scoresList.length) return 0;
    const confs = scoresList.map(s => s.conf).filter(c => c > 0);
    return confs.length ? Math.round(confs.reduce((a, b) => a + b, 0) / confs.length) : 0;
  }, [scoresList]);

  const smartCapital = useMemo(() => computeSmartCapital(rawSignals ?? []), [rawSignals]);

  // Build DashSignal[] from unified scores
  const enrichedSignals = useMemo<DashSignal[]>(() => {
    const flowDominance = (() => {
      const oppSignals = scoresList.filter(s => s.opp > s.risk + 15).length;
      const riskSignals = scoresList.filter(s => s.risk > s.opp + 15).length;
      return oppSignals > riskSignals + 1 ? "up" as const : riskSignals > oppSignals + 1 ? "down" as const : "stable" as const;
    })();
    const avgMomentum = scoresList.length ? scoresList.reduce((a, s) => a + s.momentum, 0) / scoresList.length : 50;
    const flowEmission = avgMomentum > 55 ? "up" as const : avgMomentum < 35 ? "down" as const : "stable" as const;

    return scoresList.map(s => {
      const spark7d = (sparklines?.get(s.netuid) ?? []).slice(-7);
      const dominant = s.isOverridden ? "risk" as const :
        s.opp > s.risk + 15 ? "opportunity" as const :
        s.risk > s.opp + 15 ? "risk" as const : "neutral" as const;
      
      // Micro-cap detection (simplified: cap < $500k USD)
      const isMicroCap = s.displayedCap > 0 && s.displayedCap < 500_000;
      
      let asMicro = s.asymmetry;
      let preHype = false;
      let preHypeIntensity = 0;

      if (!s.isOverridden) {
        if (isMicroCap) {
          // Micro AS bonus
          const microSignal = { opportunity: s.opp, risk: s.risk, confidence: s.conf, momentumScore: s.momentumScore, isMicroCap: true } as any;
          asMicro = computeASMicro(microSignal, smartCapital.state, flowDominance, flowEmission);
        }
        // Pre-hype detection
        if (s.psi > 50 && s.quality > 40 && s.sc === "ACCUMULATION") {
          preHype = true;
          preHypeIntensity = clamp(s.psi - 30, 0, 70);
        }
      }

      const reasons = s.overrideReasons.length > 0 ? s.overrideReasons : [];

      return {
        ...s,
        sparkline_7d: spark7d,
        dominant,
        isMicroCap,
        asMicro,
        preHype,
        preHypeIntensity,
        reasons,
      };
    });
  }, [scoresList, sparklines, smartCapital.state]);

  const sentinelIndex = useMemo(() => computeSentinelIndex(globalOpp, globalRisk, smartCapital.score), [globalOpp, globalRisk, smartCapital.score]);
  const sentinelLabel = sentinelIndexLabel(sentinelIndex, lang);

  const globalStability = useMemo(() => {
    if (!scoresList.length) return 50;
    return Math.round(scoresList.reduce((a, s) => a + s.stability, 0) / scoresList.length);
  }, [scoresList]);

  const confianceData = useMemo(() => {
    if (!scoresList.length) return { score: 50 };
    const avg = Math.round(scoresList.reduce((a, s) => a + s.confianceScore, 0) / scoresList.length);
    return { score: avg };
  }, [scoresList]);

  const macroRec = useMemo(() => deriveMacroRecommendation(sentinelIndex, smartCapital.state, globalStability, confianceData.score), [sentinelIndex, smartCapital.state, globalStability, confianceData.score]);

  const saturationIndex = useMemo(() => {
    // Simplified saturation from unified scores
    if (!enrichedSignals.length) return 0;
    const highOpp = enrichedSignals.filter(s => s.opp > 65).length;
    return Math.round((highOpp / enrichedSignals.length) * 100);
  }, [enrichedSignals]);
  const isSaturated = saturationAlert(saturationIndex);

  /* ─── Best subnet (exclude overridden) ─── */
  const bestMicroCap = useMemo(() => {
    const micros = enrichedSignals.filter(s => !s.isOverridden && s.isMicroCap && s.asMicro > 0);
    return micros.length ? micros.sort((a, b) => b.asMicro - a.asMicro)[0] : null;
  }, [enrichedSignals]);

  const bestSubnet = useMemo(() => {
    const valid = enrichedSignals.filter(s => !s.isOverridden);
    if (!valid.length) return null;
    return [...valid].sort((a, b) => (b.opp - b.risk) - (a.opp - a.risk))[0];
  }, [enrichedSignals]);

  const displayBest = bestMicroCap ?? bestSubnet;
  const isMicroBest = !!bestMicroCap;

  /* ─── Top 3 (exclude overridden from opportunities) ─── */
  const topOpportunities = useMemo(() => [...enrichedSignals].filter(s => !s.isOverridden).sort((a, b) => b.opp - a.opp).slice(0, 3), [enrichedSignals]);
  const topRisks = useMemo(() => [...enrichedSignals].filter(s => s.risk > 40).sort((a, b) => {
    if (a.isOverridden !== b.isOverridden) return a.isOverridden ? -1 : 1;
    return b.risk - a.risk;
  }).slice(0, 3), [enrichedSignals]);

  const depegConfirmedSubnets = useMemo(() =>
    enrichedSignals.filter(s => s.depegState === "CONFIRMED" || s.depegState === "WAITLIST").sort((a, b) => b.depegProbability - a.depegProbability),
    [enrichedSignals]);
  const depegHighRiskSubnets = useMemo(() =>
    enrichedSignals.filter(s => s.depegState === "WATCH").sort((a, b) => b.depegProbability - a.depegProbability),
    [enrichedSignals]);

  // ── Audio alert on new DEPEG_CONFIRMED ──
  const prevDepegCountRef = useRef(0);
  const playDepegAlert = useCallback(() => {
    try {
      const ctx = new AudioContext();
      // Alarm tone: two alternating frequencies
      [440, 660].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "square";
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.08, ctx.currentTime + i * 0.15);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.15 + 0.12);
        osc.connect(gain).connect(ctx.destination);
        osc.start(ctx.currentTime + i * 0.15);
        osc.stop(ctx.currentTime + i * 0.15 + 0.12);
      });
    } catch { /* audio not available */ }
  }, []);

  useEffect(() => {
    if (depegConfirmedSubnets.length > prevDepegCountRef.current && prevDepegCountRef.current >= 0) {
      playDepegAlert();
    }
    prevDepegCountRef.current = depegConfirmedSubnets.length;
  }, [depegConfirmedSubnets.length, playDepegAlert]);

  // ── Push Kill Switch (SAFE MODE) ──
  const criticalSurgeRef = useRef<number | null>(null);
  const killSwitch = useMemo<KillSwitchResult>(() => {
    const criticalCount = enrichedSignals.filter(s => s.action === "EXIT" || s.isOverridden).length;
    const totalSubnets = enrichedSignals.length;
    // Track when critical surge started
    if (criticalCount / (totalSubnets || 1) >= 0.30) {
      if (criticalSurgeRef.current === null) criticalSurgeRef.current = Date.now();
    } else {
      criticalSurgeRef.current = null;
    }
    return evaluateKillSwitch({
      dataConfidence,
      fleetDistribution,
      criticalCount,
      totalSubnets,
      criticalSurgeStartedAt: criticalSurgeRef.current,
    });
  }, [enrichedSignals, dataConfidence, fleetDistribution]);

  // ── Audit Logger ──
  useAuditLogger(
    enrichedSignals,
    scoreTimestamp,
    dataAlignment ?? "UNKNOWN",
    dataConfidence,
    killSwitch,
    fleetDistribution,
  );

  const [panelSignal, setPanelSignal] = useState<DashSignal | null>(null);
  const isMobile = useIsMobile();

  const scLabel = t(`sc.${smartCapital.state.toLowerCase()}` as any);
  const macroRecLabel = t(`macro.${macroRec.toLowerCase()}` as any);

  /* ─── Gauge geometry ─── */
  const SIZE = isMobile ? 300 : 440;
  const CX = SIZE / 2, CY = SIZE / 2;
  const R_OUTER = isMobile ? 120 : 190;
  const R_INNER = isMobile ? 95 : 155;
  const oppGlobal = opportunityColor(globalOpp);
  const rskGlobal = riskColor(globalRisk);
  const oppAngle = (globalOpp / 100) * 270;
  const riskAngle = (globalRisk / 100) * 270;

  function describeArc(cx: number, cy: number, r: number, startAngle: number, endAngle: number) {
    const rad = (a: number) => ((a - 90) * Math.PI) / 180;
    const x1 = cx + r * Math.cos(rad(startAngle));
    const y1 = cy + r * Math.sin(rad(startAngle));
    const x2 = cx + r * Math.cos(rad(endAngle));
    const y2 = cy + r * Math.sin(rad(endAngle));
    const large = endAngle - startAngle > 180 ? 1 : 0;
    return `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`;
  }

  return (
    <div className="h-full w-full select-none overflow-y-auto overflow-x-hidden" style={{ background: "#000" }}>
      <style>{`
        @keyframes opp-sweep {
          0% { opacity: 0.3; }
          50% { opacity: 0.6; }
          100% { opacity: 0.3; }
        }
      `}</style>

      {/* ═══ HEADER ═══ */}
      <div className="flex items-center justify-center px-4 pt-6 pb-2">
        <div className="flex flex-col items-center">
          <div style={{ width: 6, height: 6, borderRadius: "50%", background: "rgba(255,215,0,0.6)", boxShadow: "0 0 12px rgba(255,215,0,0.3)", marginBottom: 8 }} />
          <span className="font-mono font-bold tracking-[0.4em] sm:tracking-[0.6em]" style={{ fontSize: isMobile ? 14 : 20, color: "rgba(255,248,220,0.85)", textShadow: "0 0 30px rgba(255,215,0,0.15)" }}>
            {t("header.title")}
          </span>
        </div>
      </div>

      <div className="px-4 sm:px-8 pb-20 max-w-[900px] mx-auto">

        {/* ═══ BLOC 1: VISION MACRO ═══ */}
        <div className="mt-4 rounded-2xl p-5 sm:p-7" style={{ background: "rgba(255,255,255,0.015)", border: "1px solid rgba(255,255,255,0.06)" }}>
          <div className="flex items-center gap-2 mb-4">
            <span className="font-mono tracking-[0.2em] uppercase font-bold" style={{ fontSize: 10, color: "rgba(255,215,0,0.5)" }}>
              VISION MACRO
            </span>
            <div className="flex-1 h-px" style={{ background: "rgba(255,215,0,0.08)" }} />
            <span className="font-mono text-[8px] px-2 py-0.5 rounded cursor-help"
              style={{ background: "rgba(255,215,0,0.06)", color: "rgba(255,215,0,0.4)", border: "1px solid rgba(255,215,0,0.1)" }}
              title={`Score snapshot: ${scoreTimestamp}`}>
              ⏱ {new Date(scoreTimestamp).toLocaleTimeString()}
            </span>
            <DataAlignmentBadge dataAlignment={dataAlignment} dataAgeDebug={dataAgeDebug} className="text-[7px] px-1.5" />
          </div>

          {/* ─── CIRCULAR GAUGE ─── */}
          <div className="flex justify-center">
            <div className="relative" style={{ width: SIZE, height: SIZE }}>
              <div className="absolute inset-0 rounded-full pointer-events-none" style={{ background: "radial-gradient(circle, rgba(255,180,50,0.04) 0%, transparent 60%)", transform: "scale(1.2)" }} />
              <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
                {Array.from({ length: 54 }, (_, i) => {
                  const angleDeg = (i * 5) - 135;
                  if (angleDeg > 135) return null;
                  const rad = ((angleDeg - 90) * Math.PI) / 180;
                  const isMajor = i % 9 === 0;
                  const r1 = R_OUTER + 4; const r2 = R_OUTER + (isMajor ? 12 : 7);
                  return <line key={`ot-${i}`} x1={CX + r1 * Math.cos(rad)} y1={CY + r1 * Math.sin(rad)} x2={CX + r2 * Math.cos(rad)} y2={CY + r2 * Math.sin(rad)} stroke={isMajor ? "rgba(255,215,0,0.2)" : "rgba(255,215,0,0.06)"} strokeWidth={isMajor ? 1.5 : 0.7} strokeLinecap="round" />;
                })}
                {Array.from({ length: 54 }, (_, i) => {
                  const angleDeg = (i * 5) - 135;
                  if (angleDeg > 135) return null;
                  const rad = ((angleDeg - 90) * Math.PI) / 180;
                  const isMajor = i % 9 === 0;
                  const r1 = R_INNER - 4; const r2 = R_INNER - (isMajor ? 10 : 6);
                  return <line key={`it-${i}`} x1={CX + r1 * Math.cos(rad)} y1={CY + r1 * Math.sin(rad)} x2={CX + r2 * Math.cos(rad)} y2={CY + r2 * Math.sin(rad)} stroke={isMajor ? "rgba(229,57,53,0.18)" : "rgba(229,57,53,0.05)"} strokeWidth={isMajor ? 1.2 : 0.5} strokeLinecap="round" />;
                })}
                <circle cx={CX} cy={CY} r={R_OUTER} fill="none" stroke="rgba(255,215,0,0.04)" strokeWidth={isMobile ? 6 : 8} />
                {oppAngle > 0 && <path d={describeArc(CX, CY, R_OUTER, -135, -135 + oppAngle)} fill="none" stroke={oppGlobal} strokeWidth={isMobile ? 6 : 8} strokeLinecap="round" style={{ opacity: 0.55, animation: "opp-sweep 4s ease-in-out infinite" }} />}
                <circle cx={CX} cy={CY} r={R_INNER} fill="none" stroke="rgba(229,57,53,0.04)" strokeWidth={isMobile ? 8 : 10} />
                {riskAngle > 0 && <path d={describeArc(CX, CY, R_INNER, -135, -135 + riskAngle)} fill="none" stroke={rskGlobal} strokeWidth={isMobile ? 8 : 10} strokeLinecap="round" style={{ opacity: 0.55 }} />}
              </svg>

              {/* CENTER HUD */}
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="flex flex-col items-center text-center" style={{ maxWidth: isMobile ? 160 : 240 }}>
                  <span className="font-mono tracking-[0.2em] uppercase" style={{ fontSize: isMobile ? 7 : 9, color: "rgba(255,255,255,0.3)" }}>
                    {t("macro.global_index")}
                  </span>
                  <span className="font-mono font-bold leading-none mt-1" style={{
                    fontSize: isMobile ? 40 : 64, color: sentinelIndexColor(sentinelIndex),
                    textShadow: "0 0 40px rgba(255,215,0,0.15)",
                  }}>
                    {sentinelIndex}
                  </span>
                  <span className="font-mono font-bold tracking-wider mt-0.5" style={{ fontSize: isMobile ? 10 : 13, color: sentinelIndexColor(sentinelIndex), opacity: 0.7 }}>
                    {sentinelLabel}
                  </span>

                  <div className="flex items-center mt-3" style={{ gap: isMobile ? 6 : 12 }}>
                    <div className="flex flex-col items-center">
                      <span className="font-mono" style={{ color: "rgba(255,215,0,0.3)", fontSize: isMobile ? 6 : 8, letterSpacing: "0.15em" }}>OPP</span>
                      <span className="font-mono font-bold" style={{ color: oppGlobal, fontSize: isMobile ? 14 : 18 }}>{globalOpp}</span>
                    </div>
                    <div style={{ width: 1, height: isMobile ? 14 : 20, background: "rgba(255,255,255,0.06)" }} />
                    <div className="flex flex-col items-center">
                      <span className="font-mono" style={{ color: "rgba(229,57,53,0.3)", fontSize: isMobile ? 6 : 8, letterSpacing: "0.15em" }}>RISK</span>
                      <span className="font-mono font-bold" style={{ color: rskGlobal, fontSize: isMobile ? 14 : 18 }}>{globalRisk}</span>
                    </div>
                    <div style={{ width: 1, height: isMobile ? 14 : 20, background: "rgba(255,255,255,0.06)" }} />
                    <div className="flex flex-col items-center">
                      <span className="font-mono" style={{ color: "rgba(255,255,255,0.2)", fontSize: isMobile ? 6 : 8, letterSpacing: "0.15em" }}>SC</span>
                      <span className="font-mono font-bold" style={{
                        color: smartCapital.state === "ACCUMULATION" ? "rgba(76,175,80,0.85)" : smartCapital.state === "DISTRIBUTION" ? "rgba(229,57,53,0.85)" : "rgba(255,248,220,0.5)",
                        fontSize: isMobile ? 8 : 11,
                      }}>
                        {scLabel}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* ─── Macro Recommendation ─── */}
          <div className="flex flex-col items-center mt-2">
            <span className="font-mono tracking-[0.15em] uppercase mb-2" style={{ fontSize: 8, color: "rgba(255,255,255,0.2)" }}>
              {t("macro.label")}
            </span>
            <div className="flex items-center gap-3 px-6 py-3 rounded-xl" style={{
              background: macroBg(macroRec),
              border: `2px solid ${macroBorder(macroRec)}`,
              boxShadow: `0 0 30px ${macroBg(macroRec)}`,
            }}>
              <span style={{ fontSize: isMobile ? 18 : 24 }}>{macroIcon(macroRec)}</span>
              <span className="font-mono font-bold tracking-[0.2em]" style={{ color: macroColor(macroRec), fontSize: isMobile ? 14 : 20 }}>
                {macroRecLabel}
              </span>
            </div>
          </div>

          {/* ─── Sub-metrics row ─── */}
          <div className="flex items-center justify-center gap-4 sm:gap-8 mt-5">
            <div className="flex flex-col items-center">
              <span className="font-mono" style={{ fontSize: 8, color: "rgba(255,255,255,0.25)", letterSpacing: "0.12em" }}>{t("macro.stability")}</span>
              <span className="font-mono font-bold" style={{ color: stabilityColor(globalStability), fontSize: isMobile ? 16 : 20 }}>{globalStability}%</span>
            </div>
            <div style={{ width: 1, height: 24, background: "rgba(255,255,255,0.06)" }} />
            <div className="flex flex-col items-center">
              <span className="font-mono" style={{ fontSize: 8, color: "rgba(255,255,255,0.25)", letterSpacing: "0.12em" }}>{t("data.confiance")}</span>
              <span className="font-mono font-bold" style={{ color: confianceColor(confianceData.score), fontSize: isMobile ? 16 : 20 }}>{confianceData.score}%</span>
            </div>
          </div>

          {/* Saturation alert */}
          {isSaturated && (
            <div className="mt-4 px-4 py-2 rounded-lg text-center" style={{ background: "rgba(255,109,0,0.06)", border: "1px solid rgba(255,109,0,0.15)" }}>
              <span className="font-mono text-[10px] tracking-wider" style={{ color: "rgba(255,109,0,0.8)" }}>
                {t("gauge.saturation_alert")} ({saturationIndex}%)
              </span>
            </div>
          )}

          {/* SAFE MODE indicator */}
          {killSwitch.active && (
            <div className="mt-3 px-4 py-2.5 rounded-lg text-center animate-pulse" style={{
              background: "rgba(229,57,53,0.06)",
              border: "1px solid rgba(229,57,53,0.2)",
              boxShadow: "0 0 20px rgba(229,57,53,0.05)",
            }}>
              <div className="font-mono text-[11px] font-bold tracking-[0.2em]" style={{ color: "rgba(229,57,53,0.9)" }}>
                🛡 SAFE MODE
              </div>
              <div className="font-mono text-[9px] mt-1" style={{ color: "rgba(229,57,53,0.5)" }}>
                {lang === "fr" ? "Push non-critiques suspendues" : "Non-critical push suspended"} · {killSwitch.triggers.length} trigger{killSwitch.triggers.length > 1 ? "s" : ""}
              </div>
            </div>
          )}

          {/* ─── DEPEG CONFIRMED ALERT ─── */}
          {depegConfirmedSubnets.length > 0 && (
            <div className="mt-4 rounded-xl overflow-hidden animate-fade-in" style={{
              background: "rgba(229,57,53,0.06)",
              border: "1px solid rgba(229,57,53,0.25)",
              boxShadow: "0 0 30px rgba(229,57,53,0.08), inset 0 0 20px rgba(229,57,53,0.03)",
            }}>
              <div className="flex items-center gap-2 px-4 py-2" style={{
                background: "rgba(229,57,53,0.08)",
                borderBottom: "1px solid rgba(229,57,53,0.12)",
              }}>
                <span className="inline-block w-2 h-2 rounded-full animate-pulse" style={{ background: "rgba(229,57,53,0.9)", boxShadow: "0 0 8px rgba(229,57,53,0.6)" }} />
                <span className="font-mono text-[10px] font-bold tracking-[0.2em] uppercase" style={{ color: "rgba(229,57,53,0.9)" }}>
                  🚨 DEPEG CONFIRMÉ — {depegConfirmedSubnets.length} subnet{depegConfirmedSubnets.length > 1 ? "s" : ""}
                </span>
              </div>
              <div className="px-4 py-2.5 space-y-1.5">
                {depegConfirmedSubnets.map(s => {
                  const dpColor = s.depegProbability >= 85 ? "rgba(229,57,53,0.95)" : s.depegProbability >= 70 ? "rgba(255,152,0,0.9)" : "rgba(255,193,7,0.8)";
                  return (
                    <div key={s.netuid} className="flex items-center gap-3 cursor-pointer hover:bg-white/[0.03] rounded-lg px-2 py-1.5 transition-all"
                      onClick={() => setPanelSignal(s)}>
                      <span className="font-mono font-bold text-[12px]" style={{ color: "rgba(229,57,53,0.9)" }}>SN-{s.netuid}</span>
                      <span className="font-mono text-[10px] truncate flex-1" style={{ color: "rgba(255,255,255,0.4)" }}>{s.name}</span>
                      <div className="flex items-center gap-1.5">
                        <div className="w-10 h-1.5 rounded-full bg-white/5 overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${s.depegProbability}%`, background: dpColor }} />
                        </div>
                        <span className="font-mono text-[10px] font-bold" style={{ color: dpColor }}>{s.depegProbability}%</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ─── DEPEG HIGH RISK ALERT ─── */}
          {depegHighRiskSubnets.length > 0 && depegConfirmedSubnets.length === 0 && (
            <div className="mt-4 rounded-xl overflow-hidden animate-fade-in" style={{
              background: "rgba(255,152,0,0.04)",
              border: "1px solid rgba(255,152,0,0.2)",
              boxShadow: "0 0 20px rgba(255,152,0,0.05)",
            }}>
              <div className="flex items-center gap-2 px-4 py-2" style={{
                background: "rgba(255,152,0,0.06)",
                borderBottom: "1px solid rgba(255,152,0,0.1)",
              }}>
                <span className="inline-block w-2 h-2 rounded-full" style={{ background: "rgba(255,152,0,0.8)" }} />
                <span className="font-mono text-[10px] font-bold tracking-[0.2em] uppercase" style={{ color: "rgba(255,152,0,0.85)" }}>
                  ⚠ DEPEG PROBABLE — {depegHighRiskSubnets.length} subnet{depegHighRiskSubnets.length > 1 ? "s" : ""}
                </span>
              </div>
              <div className="px-4 py-2 space-y-1">
                {depegHighRiskSubnets.slice(0, 5).map(s => (
                  <div key={s.netuid} className="flex items-center gap-3 cursor-pointer hover:bg-white/[0.03] rounded-lg px-2 py-1 transition-all"
                    onClick={() => setPanelSignal(s)}>
                    <span className="font-mono font-bold text-[11px]" style={{ color: "rgba(255,152,0,0.85)" }}>SN-{s.netuid}</span>
                    <span className="font-mono text-[10px] truncate flex-1" style={{ color: "rgba(255,255,255,0.35)" }}>{s.name}</span>
                    <span className="font-mono text-[10px] font-bold" style={{ color: "rgba(255,152,0,0.8)" }}>{s.depegProbability}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ═══ BLOC 2: MEILLEUR SUBNET ═══ */}
        {displayBest && (
          <div className="mt-6">
            <div className="flex items-center gap-2 mb-3">
              <span className="font-mono tracking-[0.2em] uppercase font-bold" style={{ fontSize: 10, color: isMicroBest ? "rgba(0,200,255,0.5)" : "rgba(255,215,0,0.4)" }}>
                {isMicroBest ? t("top.best_micro") : t("top.best")}
              </span>
              <div className="flex-1 h-px" style={{ background: isMicroBest ? "rgba(0,200,255,0.08)" : "rgba(255,215,0,0.08)" }} />
            </div>
            <BestSubnetCard
              signal={displayBest}
              isMobile={isMobile}
              t={t}
              onClick={() => setPanelSignal(displayBest)}
              isMicroBest={isMicroBest}
              smartCapitalLabel={scLabel}
            />
          </div>
        )}

        {/* ═══ TOP 3 OPPORTUNITIES + TOP 3 RISKS ═══ */}
        <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
          <div>
            <span className="font-mono tracking-[0.2em] uppercase block mb-3 font-bold" style={{ fontSize: 10, color: "rgba(255,215,0,0.3)" }}>
              {t("top.opportunities")}
            </span>
            <div className="rounded-xl" style={{ background: "rgba(255,255,255,0.01)", border: "1px solid rgba(255,255,255,0.04)" }}>
              {topOpportunities.map((s, i) => (
                <SubnetRow key={s.netuid} signal={s} rank={i + 1} type="opp" isMobile={isMobile} t={t} onClick={() => setPanelSignal(s)} />
              ))}
            </div>
          </div>
          <div>
            <span className="font-mono tracking-[0.2em] uppercase block mb-3 font-bold" style={{ fontSize: 10, color: "rgba(229,57,53,0.3)" }}>
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

        {/* Footer link */}
        <div className="flex justify-center pt-6 pb-2">
          <Link to="/methodology" className="font-mono text-[9px] tracking-wider text-white/15 hover:text-white/40 transition-colors">
            📖 {lang === "fr" ? "Méthodologie & Transparence" : "Methodology & Transparency"}
          </Link>
        </div>
      </div>

      <SubnetPanel signal={panelSignal} open={!!panelSignal} onClose={() => setPanelSignal(null)} />
    </div>
  );
}
