import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/hooks/use-auth";
import { usePositions, useOpenPosition, useClosePosition, type DbPosition } from "@/hooks/use-positions";
import {
  SubnetSignal, RawSignal, GaugeState, GaugePhase, Asymmetry,
  clamp, deriveGaugeState, derivePhase, deriveTMinus, formatTimeClear,
  stateColor, stateGlow, rayColor, processSignals,
  computeGlobalPsi, computeGlobalConfidence,
  computeGlobalOpportunity, computeGlobalRisk,
  opportunityColor, riskColor,
  computeSmartCapital, computeDualCore,
  type SmartCapitalState,
} from "@/lib/gauge-engine";
import {
  deriveStrategicAction, actionColor, actionBg, actionBorder, actionIcon,
  computeSentinelIndex, sentinelIndexColor, sentinelIndexLabel,
  deriveSubnetAction,
} from "@/lib/strategy-engine";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";

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
  return (
    <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl transition-all" style={{
      background: actionBg(action),
      border: `1.5px solid ${actionBorder(action)}`,
      boxShadow: `0 0 25px ${actionBg(action)}, 0 0 50px ${actionBg(action)}`,
      animation: action === "EXIT" ? "priority-pulse 2s ease-in-out infinite" : action === "ENTER" ? "priority-pulse 3s ease-in-out infinite" : "none",
    }}>
      <span style={{ fontSize: isMobile ? 16 : 22 }}>{actionIcon(action)}</span>
      <span className="font-mono font-bold tracking-[0.2em]" style={{
        color: actionColor(action),
        fontSize: isMobile ? 14 : 20,
      }}>
        {label}
      </span>
    </div>
  );
}

/* ═══════════════════════════════════════ */
/*     SENTINEL INDEX RING                 */
/* ═══════════════════════════════════════ */
function SentinelIndexDisplay({ score, label, isMobile }: { score: number; label: string; isMobile: boolean }) {
  const color = sentinelIndexColor(score);
  return (
    <div className="flex flex-col items-center gap-1">
      <span className="font-mono tracking-[0.2em] uppercase" style={{
        color: "rgba(255,255,255,0.3)", fontSize: isMobile ? 7 : 9,
      }}>
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
/*     FLOW / ROTATION BADGES              */
/* ═══════════════════════════════════════ */
function FlowBadge({ label, direction, isMobile }: { label: string; direction: "up" | "down" | "stable"; isMobile: boolean }) {
  const arrow = direction === "up" ? "↑" : direction === "down" ? "↓" : "→";
  const c = direction === "up" ? "rgba(76,175,80,0.8)" : direction === "down" ? "rgba(229,57,53,0.8)" : "rgba(255,255,255,0.35)";
  return (
    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md" style={{
      background: "rgba(255,255,255,0.02)",
      border: "1px solid rgba(255,255,255,0.06)",
    }}>
      <span className="font-mono" style={{ color: "rgba(255,255,255,0.35)", fontSize: isMobile ? 8 : 10, letterSpacing: "0.08em" }}>{label}</span>
      <span className="font-mono font-bold" style={{ color: c, fontSize: isMobile ? 12 : 14 }}>{arrow}</span>
    </div>
  );
}

/* ═══════════════════════════════════════ */
/*     TOP SUBNET CARD (best asymmetry)    */
/* ═══════════════════════════════════════ */
function BestSubnetCard({ signal, isMobile, t, onClick }: { signal: SubnetSignal; isMobile: boolean; t: (k: any) => string; onClick: () => void }) {
  const action = deriveSubnetAction(signal.opportunity, signal.risk, signal.confidence);
  const asymScore = signal.opportunity - signal.risk;
  return (
    <div onClick={onClick} className="cursor-pointer rounded-xl transition-all hover:scale-[1.01]" style={{
      background: "rgba(255,215,0,0.03)",
      border: "1px solid rgba(255,215,0,0.12)",
      padding: isMobile ? "12px 14px" : "16px 20px",
      boxShadow: "0 0 40px rgba(255,215,0,0.04)",
    }}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="font-mono font-bold" style={{ color: "rgba(255,248,220,0.9)", fontSize: isMobile ? 14 : 18 }}>
            SN-{signal.netuid}
          </span>
          <span className="font-mono" style={{ color: "rgba(255,255,255,0.4)", fontSize: isMobile ? 10 : 12 }}>
            {signal.name}
          </span>
        </div>
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md" style={{
          background: actionBg(action),
          border: `1px solid ${actionBorder(action)}`,
        }}>
          <span style={{ fontSize: isMobile ? 10 : 12 }}>{actionIcon(action)}</span>
          <span className="font-mono font-bold tracking-wider" style={{
            color: actionColor(action), fontSize: isMobile ? 9 : 11,
          }}>
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
          <span className="font-mono" style={{ color: "rgba(255,255,255,0.25)", fontSize: 8, letterSpacing: "0.12em" }}>{t("sub.tminus")}</span>
          <span className="font-mono font-bold" style={{ color: stateColor(signal.state), fontSize: isMobile ? 14 : 16 }}>{formatTimeClear(signal.t_minus_minutes)}</span>
        </div>
        {signal.sparkline_7d.length > 1 && (
          <div className="ml-auto">
            <svg width={isMobile ? 50 : 70} height={24} viewBox={`0 0 ${isMobile ? 50 : 70} 24`}>
              <TooltipSparkline data={signal.sparkline_7d} width={isMobile ? 50 : 70} height={22} color={opportunityColor(signal.opportunity, 0.6)} />
            </svg>
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
      <span className="font-mono font-bold" style={{ color: "rgba(255,248,220,0.75)", fontSize: isMobile ? 11 : 13, width: isMobile ? 50 : 60 }}>
        SN-{signal.netuid}
      </span>
      <span className="font-mono truncate" style={{ color: "rgba(255,255,255,0.35)", fontSize: isMobile ? 9 : 11, flex: 1 }}>
        {signal.name}
      </span>
      <span className="font-mono font-bold" style={{ color: mainColor, fontSize: isMobile ? 14 : 16, width: 36, textAlign: "right" }}>
        {mainScore}
      </span>
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
/*     POSITION BAR COMPONENT              */
/* ═══════════════════════════════════════ */
type Position = {
  id?: string;
  netuid?: number;
  capital: number;
  currentValue: number;
  protectionThreshold: number;
  exitRecommended: number;
};

function PositionBar({ position, isMobile, t, onClose, onTakeProfit, exitWarning }: {
  position: Position; isMobile: boolean; t: (key: any) => string; onClose?: () => void; onTakeProfit?: () => void; exitWarning?: string | null;
}) {
  const pnl = position.currentValue - position.capital;
  const pnlPct = ((pnl / position.capital) * 100);
  const barColor = pnlPct >= 5 ? "hsl(145, 65%, 48%)" : pnlPct >= 0 ? "hsl(38, 92%, 55%)" : "hsl(0, 72%, 55%)";
  const barMin = -20, barMax = 30;
  const barRange = barMax - barMin;
  const currentPos = clamp((pnlPct - barMin) / barRange * 100, 2, 98);
  const protectionPos = clamp((position.protectionThreshold - barMin) / barRange * 100, 0, 100);
  const exitPos = clamp((position.exitRecommended - barMin) / barRange * 100, 0, 100);

  return (
    <div className="font-mono" style={{
      width: isMobile ? "min(95vw, 440px)" : 680,
      background: "rgba(10,8,5,0.85)", border: "1px solid rgba(255,215,0,0.12)",
      borderRadius: 14, padding: isMobile ? "12px 14px 14px" : "16px 24px 18px",
      backdropFilter: "blur(16px)", boxShadow: "0 4px 40px rgba(0,0,0,0.6), 0 0 30px rgba(255,215,0,0.03)",
    }}>
      <div className="flex items-center justify-between" style={{ fontSize: isMobile ? 11 : 13 }}>
        <div className="flex flex-col">
          <span style={{ color: "rgba(255,255,255,0.35)", letterSpacing: "0.1em", fontSize: isMobile ? 8 : 10 }}>{t("pos.capital")}</span>
          <span style={{ color: "rgba(255,248,220,0.8)", fontWeight: 700, fontSize: isMobile ? 14 : 17 }}>{position.capital.toLocaleString()} <span style={{ color: "rgba(255,215,0,0.5)", fontSize: isMobile ? 10 : 12 }}>TAO</span></span>
        </div>
        <div style={{ width: 1, height: 28, background: "rgba(255,255,255,0.06)" }} />
        <div className="flex flex-col items-center">
          <span style={{ color: "rgba(255,255,255,0.35)", letterSpacing: "0.1em", fontSize: isMobile ? 8 : 10 }}>{t("pos.current")}</span>
          <span style={{ color: "rgba(255,248,220,0.8)", fontWeight: 700, fontSize: isMobile ? 14 : 17 }}>{position.currentValue.toFixed(2)} <span style={{ color: "rgba(255,215,0,0.5)", fontSize: isMobile ? 10 : 12 }}>TAO</span></span>
        </div>
        <div style={{ width: 1, height: 28, background: "rgba(255,255,255,0.06)" }} />
        <div className="flex flex-col items-center">
          <span style={{ color: barColor, fontWeight: 800, fontSize: isMobile ? 18 : 22 }}>
            {pnlPct >= 0 ? "+" : ""}{pnlPct.toFixed(1)}%
          </span>
        </div>
      </div>
      {/* Progress bar */}
      <div className="relative mt-3" style={{ height: isMobile ? 22 : 26 }}>
        <div className="absolute inset-x-0 rounded" style={{ top: isMobile ? 8 : 10, height: isMobile ? 5 : 6, background: "linear-gradient(90deg, rgba(229,57,53,0.15), rgba(255,193,7,0.15), rgba(76,175,80,0.25))" }} />
        <div className="absolute rounded" style={{ top: isMobile ? 8 : 10, height: isMobile ? 5 : 6, left: 0, width: `${currentPos}%`, background: `linear-gradient(90deg, rgba(255,255,255,0.03), ${barColor})`, transition: "width 800ms ease" }} />
        <div className="absolute" style={{ left: `${protectionPos}%`, top: 2, bottom: 0, width: 2, background: "hsl(38, 92%, 55%)", opacity: 0.7, borderRadius: 1 }}>
          <div className="absolute font-mono" style={{ bottom: -14, left: "50%", transform: "translateX(-50%)", fontSize: 7, color: "rgba(255,255,255,0.3)", whiteSpace: "nowrap" }}>{t("pos.protection")}</div>
        </div>
        <div className="absolute" style={{ left: `${exitPos}%`, top: 2, bottom: 0, width: 2, background: "hsl(0, 72%, 55%)", opacity: 0.6, borderRadius: 1 }}>
          <div className="absolute font-mono" style={{ bottom: -14, left: "50%", transform: "translateX(-50%)", fontSize: 7, color: "rgba(255,255,255,0.3)", whiteSpace: "nowrap" }}>{t("pos.exit_rec")}</div>
        </div>
        <div className="absolute" style={{ left: `${currentPos}%`, top: isMobile ? 4 : 5, width: 3, height: isMobile ? 14 : 16, background: barColor, transform: "translateX(-50%)", boxShadow: `0 0 10px ${barColor}80`, borderRadius: 2, transition: "left 800ms ease" }} />
      </div>
      {exitWarning && (
        <div className="mt-3 px-3 py-2 rounded-lg flex items-center gap-2" style={{
          background: "rgba(229,57,53,0.08)", border: "1px solid rgba(229,57,53,0.2)",
          animation: "priority-pulse 2.5s ease-in-out infinite",
        }}>
          <span style={{ color: "rgba(229,57,53,0.9)", fontSize: isMobile ? 10 : 12, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace", letterSpacing: "0.04em" }}>{exitWarning}</span>
        </div>
      )}
      <div className="flex items-center gap-3 mt-3">
        {onClose && (
          <button onClick={onClose} className="pointer-events-auto font-mono tracking-wider px-5 py-2.5 rounded-lg transition-all flex items-center gap-2"
            style={{ background: "rgba(229,57,53,0.08)", color: "rgba(229,57,53,0.7)", border: "1px solid rgba(229,57,53,0.15)", fontSize: isMobile ? 10 : 12, fontWeight: 600 }}>
            <span>✦</span> {t("pos.close_position")}
          </button>
        )}
        {onTakeProfit && (
          <button onClick={onTakeProfit} className="pointer-events-auto flex-1 font-mono tracking-wider px-5 py-2.5 rounded-lg transition-all"
            style={{ background: "linear-gradient(135deg, rgba(255,215,0,0.08), rgba(255,215,0,0.04))", color: "rgba(255,248,220,0.85)", border: "1px solid rgba(255,215,0,0.2)", fontSize: isMobile ? 11 : 13, fontWeight: 700 }}>
            {t("pos.take_profit_btn")}
          </button>
        )}
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
            <div className="font-mono text-2xl tracking-wider" style={{ color: stateColor(signal.state) }}>SN-{signal.netuid}</div>
            <div className="font-mono text-sm text-white/60 mt-1">{signal.name}</div>
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
          <div className="text-center font-mono text-lg" style={{ color: stateColor(signal.state) }}>
            {formatTimeClear(signal.t_minus_minutes)} <span className="text-white/35 text-sm">{t("tip.window")}</span>
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
/*     OPEN POSITION DIALOG                */
/* ═══════════════════════════════════════ */
type Objective = "x2" | "x5" | "x10" | "x20" | "custom";
type StopMode = "dynamic" | "manual";
const OBJ_TP: Record<Exclude<Objective, "custom">, number> = { x2: 100, x5: 400, x10: 900, x20: 1900 };

function OpenPositionDialog({ open, onClose, signals, t, preselectedNetuid }: {
  open: boolean; onClose: () => void; signals: SubnetSignal[]; t: (key: any) => string; preselectedNetuid?: number;
}) {
  const { user } = useAuth();
  const openPosition = useOpenPosition();
  const [netuid, setNetuid] = useState<string>("");
  const [capital, setCapital] = useState("");
  const [stopLoss, setStopLoss] = useState("8");
  const [objective, setObjective] = useState<Objective>("x5");
  const [customTP, setCustomTP] = useState("");
  const [stopMode, setStopMode] = useState<StopMode>("dynamic");

  useEffect(() => {
    if (preselectedNetuid && open) setNetuid(String(preselectedNetuid));
  }, [preselectedNetuid, open]);

  const { data: currentPriceUsd } = useQuery({
    queryKey: ["pos-price", netuid],
    queryFn: async () => {
      if (!netuid) return null;
      const { data } = await supabase.from("subnet_latest_display").select("price_usd").eq("netuid", Number(netuid)).maybeSingle();
      return data?.price_usd ? Number(data.price_usd) : null;
    },
    enabled: !!netuid && open,
  });

  const tpPct = objective === "custom" ? (parseFloat(customTP) || 100) : OBJ_TP[objective];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !currentPriceUsd) return;
    const capitalNum = parseFloat(capital);
    if (!capitalNum || !netuid) return;
    try {
      await openPosition.mutateAsync({
        netuid: Number(netuid), capital: capitalNum,
        entry_price: currentPriceUsd,
        stop_loss_pct: parseFloat(stopLoss) || 8, take_profit_pct: tpPct,
      });
      toast.success("Position ouverte ✓");
      onClose();
    } catch (err: any) { toast.error(err.message); }
  };

  const inputStyle = "w-full rounded-lg px-3 py-2.5 font-mono text-sm bg-white/[0.03] border border-white/[0.08] text-white/80 focus:border-[rgba(255,215,0,0.3)] focus:outline-none transition-colors";

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="bg-[#0A0B10] border-white/10 text-white max-w-md">
        <DialogHeader><DialogTitle className="font-mono tracking-widest text-white/90">{t("pos.open_title")}</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <div>
            <label className="block text-[10px] font-mono tracking-widest uppercase mb-1.5 text-white/40">{t("pos.subnet")}</label>
            <select value={netuid} onChange={e => setNetuid(e.target.value)} required className={`${inputStyle} appearance-none`}>
              <option value="">—</option>
              {signals.map(s => (<option key={s.netuid} value={s.netuid} className="bg-[#0a0a0f]">SN-{s.netuid} · {s.name}</option>))}
            </select>
          </div>
          {currentPriceUsd && (
            <div className="flex items-center gap-4 text-xs font-mono text-white/40">
              <span>{t("pos.entry_price")}: <span className="text-white/70">${currentPriceUsd.toFixed(4)}</span></span>
              {capital && (<span>{t("pos.estimated_qty")}: <span className="text-white/70">{(parseFloat(capital) / currentPriceUsd).toFixed(4)}</span></span>)}
            </div>
          )}
          <div>
            <label className="block text-[10px] font-mono tracking-widest uppercase mb-1.5 text-white/40">{t("pos.amount")}</label>
            <input type="number" value={capital} onChange={e => setCapital(e.target.value)} min="1" step="any" required className={inputStyle} />
          </div>
          <div>
            <label className="block text-[10px] font-mono tracking-widest uppercase mb-1.5 text-white/40">{t("pos.objective")}</label>
            <div className="flex gap-1.5">
              {(["x2", "x5", "x10", "x20", "custom"] as Objective[]).map(p => (
                <button key={p} type="button" onClick={() => setObjective(p)}
                  className="flex-1 py-2 rounded-lg font-mono text-xs tracking-wider transition-all"
                  style={{ background: objective === p ? "rgba(255,215,0,0.12)" : "rgba(255,255,255,0.03)", color: objective === p ? "rgba(255,215,0,0.9)" : "rgba(255,255,255,0.35)", border: `1px solid ${objective === p ? "rgba(255,215,0,0.3)" : "rgba(255,255,255,0.06)"}`, fontWeight: objective === p ? 700 : 400 }}>
                  {t(`pos.obj_${p}` as any)}
                </button>
              ))}
            </div>
            {objective === "custom" && (<input type="number" value={customTP} onChange={e => setCustomTP(e.target.value)} min="1" step="any" placeholder="%" className={`${inputStyle} mt-2`} />)}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-mono tracking-widest uppercase mb-1.5 text-white/40">{t("pos.stop_mode")}</label>
              <div className="flex gap-1">
                {(["dynamic", "manual"] as StopMode[]).map(m => (
                  <button key={m} type="button" onClick={() => setStopMode(m)}
                    className="flex-1 py-2 rounded-lg font-mono text-[10px] tracking-wider transition-all"
                    style={{ background: stopMode === m ? "rgba(229,57,53,0.1)" : "rgba(255,255,255,0.02)", color: stopMode === m ? "rgba(229,57,53,0.8)" : "rgba(255,255,255,0.3)", border: `1px solid ${stopMode === m ? "rgba(229,57,53,0.2)" : "rgba(255,255,255,0.06)"}` }}>
                    {t(`pos.stop_${m}` as any)}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-[10px] font-mono tracking-widest uppercase mb-1.5 text-white/40">{t("pos.stop_loss")}</label>
              <input type="number" value={stopLoss} onChange={e => setStopLoss(e.target.value)} step="any" required className={inputStyle} />
            </div>
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 py-2.5 rounded-lg font-mono text-xs tracking-wider text-white/45 border border-white/10 hover:border-white/20 transition-colors">{t("pos.cancel")}</button>
            <button type="submit" disabled={openPosition.isPending || !currentPriceUsd}
              className="flex-1 py-2.5 rounded-lg font-mono text-xs tracking-wider font-bold transition-all disabled:opacity-50"
              style={{ background: "linear-gradient(135deg, rgba(255,215,0,0.15), rgba(255,215,0,0.08))", color: "rgba(255,215,0,0.9)", border: "1px solid rgba(255,215,0,0.3)", boxShadow: "0 0 20px rgba(255,215,0,0.06)" }}>
              {openPosition.isPending ? "..." : t("pos.confirm")}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ═══════════════════════════════════════ */
/*    ALIEN GAUGE — MAIN PAGE (WAR MODE)   */
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

  /* ─── demo mode + view mode ─── */
  const [demoMode, setDemoMode] = useState(false);
  const [viewMode, setViewMode] = useState<"hunter" | "defensive">("hunter");
  const [bagBuilder, setBagBuilder] = useState(false);

  const demoSignals: SubnetSignal[] = useMemo(() => [
    { netuid: 1, name: "Alpha", psi: 72, opportunity: 78, risk: 22, t_minus_minutes: 45, confidence: 85, state: "IMMINENT" as GaugeState, phase: "TRIGGER" as GaugePhase, asymmetry: "HIGH" as Asymmetry, sparkline_7d: [10,15,12,18,22,20,25], liquidity: 1200, momentum: 0.8, reasons: ["Momentum fort ↑", "Consensus élevé ✓", "Signal d'entrée actif"], dominant: "opportunity" as const },
    { netuid: 2, name: "Beta", psi: 55, opportunity: 52, risk: 35, t_minus_minutes: 120, confidence: 65, state: "ALERT" as GaugeState, phase: "ARMED" as GaugePhase, asymmetry: "MED" as Asymmetry, sparkline_7d: [5,8,6,9,11,10,12], liquidity: 800, momentum: 0.5, reasons: ["Momentum modéré →", "Consensus élevé ✓"], dominant: "opportunity" as const },
    { netuid: 3, name: "Gamma", psi: 60, opportunity: 65, risk: 30, t_minus_minutes: 90, confidence: 70, state: "ALERT" as GaugeState, phase: "ARMED" as GaugePhase, asymmetry: "HIGH" as Asymmetry, sparkline_7d: [20,18,22,25,23,28,30], liquidity: 2000, momentum: 0.65, reasons: ["Momentum modéré →", "Adoption réelle détectée"], dominant: "opportunity" as const },
    { netuid: 4, name: "Delta", psi: 45, opportunity: 40, risk: 55, t_minus_minutes: 180, confidence: 55, state: "ALERT" as GaugeState, phase: "BUILD" as GaugePhase, asymmetry: "LOW" as Asymmetry, sparkline_7d: [3,4,3,5,4,6,5], liquidity: 500, momentum: 0.3, reasons: ["Momentum modéré →", "Consensus faible ⚠", "Hype > Adoption"], dominant: "risk" as const },
    { netuid: 5, name: "Epsilon", psi: 88, opportunity: 85, risk: 40, t_minus_minutes: 15, confidence: 92, state: "IMMINENT" as GaugeState, phase: "TRIGGER" as GaugePhase, asymmetry: "HIGH" as Asymmetry, sparkline_7d: [30,35,40,38,45,50,55], liquidity: 3000, momentum: 0.95, reasons: ["Momentum fort ↑", "Consensus élevé ✓", "Adoption réelle détectée"], dominant: "opportunity" as const },
    { netuid: 6, name: "Zeta", psi: 40, opportunity: 25, risk: 65, t_minus_minutes: 200, confidence: 50, state: "ALERT" as GaugeState, phase: "BUILD" as GaugePhase, asymmetry: "MED" as Asymmetry, sparkline_7d: [7,6,8,7,9,8,10], liquidity: 600, momentum: 0.25, reasons: ["Consensus faible ⚠", "Hype > Adoption"], dominant: "risk" as const },
    { netuid: 7, name: "Eta", psi: 65, opportunity: 60, risk: 32, t_minus_minutes: 60, confidence: 75, state: "ALERT" as GaugeState, phase: "ARMED" as GaugePhase, asymmetry: "HIGH" as Asymmetry, sparkline_7d: [15,18,16,20,22,21,24], liquidity: 1500, momentum: 0.7, reasons: ["Momentum modéré →", "Consensus élevé ✓", "Spéculatif · cap faible"], dominant: "opportunity" as const },
  ], []);

  /* ─── signals ─── */
  const realSignals = useMemo(() => processSignals(rawSignals ?? [], sparklines ?? {}), [rawSignals, sparklines]);
  const allSignals = demoMode ? demoSignals : realSignals;

  const signals = useMemo(() => {
    const scored = allSignals.map(s => {
      let sortScore: number;
      if (viewMode === "hunter") {
        sortScore = bagBuilder
          ? s.opportunity * 0.5 + (s.asymmetry === "HIGH" ? 30 : s.asymmetry === "MED" ? 15 : 0) + (s.confidence < 60 ? 10 : 0)
          : s.opportunity;
      } else {
        sortScore = s.risk;
      }
      return { ...s, _sort: sortScore };
    });
    scored.sort((a, b) => b._sort - a._sort);
    return scored.slice(0, 7);
  }, [allSignals, viewMode, bagBuilder]);

  const realPsi = useMemo(() => computeGlobalPsi(rawSignals ?? []), [rawSignals]);
  const realConf = useMemo(() => computeGlobalConfidence(rawSignals ?? []), [rawSignals]);
  const realOpp = useMemo(() => computeGlobalOpportunity(rawSignals ?? []), [rawSignals]);
  const realRisk = useMemo(() => computeGlobalRisk(rawSignals ?? []), [rawSignals]);

  const globalPsi = demoMode ? 62 : realPsi;
  const globalConf = demoMode ? 71 : realConf;
  const globalOpp = demoMode ? 68 : realOpp;
  const globalRisk = demoMode ? 32 : realRisk;
  const globalTMinus = deriveTMinus(globalPsi);

  /* ─── smart capital + dual core ─── */
  const smartCapital = useMemo(() => {
    if (demoMode) return { score: 72, state: "ACCUMULATION" as SmartCapitalState };
    return computeSmartCapital(rawSignals ?? []);
  }, [rawSignals, demoMode]);

  const dualCore = useMemo(() => computeDualCore(signals, smartCapital), [signals, smartCapital]);

  /* ─── Strategic recommendation ─── */
  const strategicAction = useMemo(() =>
    deriveStrategicAction(globalOpp, globalRisk, smartCapital.state, globalConf),
    [globalOpp, globalRisk, smartCapital.state, globalConf]
  );

  /* ─── Sentinel Index ─── */
  const sentinelIndex = useMemo(() =>
    computeSentinelIndex(globalOpp, globalRisk, smartCapital.score),
    [globalOpp, globalRisk, smartCapital.score]
  );
  const sentinelLabel = sentinelIndexLabel(sentinelIndex, lang);

  /* ─── Flow/Rotation badges (derived from signals) ─── */
  const flowData = useMemo(() => {
    if (!signals.length) return { dominance: "stable" as const, emission: "stable" as const, inflow: "stable" as const };
    const oppSignals = signals.filter(s => s.dominant === "opportunity").length;
    const riskSignals = signals.filter(s => s.dominant === "risk").length;
    const avgMomentum = signals.reduce((a, s) => a + s.momentum, 0) / signals.length;
    return {
      dominance: oppSignals > riskSignals + 1 ? "up" as const : riskSignals > oppSignals + 1 ? "down" as const : "stable" as const,
      emission: avgMomentum > 55 ? "up" as const : avgMomentum < 35 ? "down" as const : "stable" as const,
      inflow: smartCapital.state === "ACCUMULATION" ? "up" as const : smartCapital.state === "DISTRIBUTION" ? "down" as const : "stable" as const,
    };
  }, [signals, smartCapital.state]);

  /* ─── Best asymmetry subnet (dynamic center) ─── */
  const bestSubnet = useMemo(() => {
    if (!signals.length) return null;
    return [...signals].sort((a, b) => (b.opportunity - b.risk) - (a.opportunity - a.risk))[0];
  }, [signals]);

  /* ─── Top 5 opportunities + Top 3 risks ─── */
  const topOpportunities = useMemo(() =>
    [...allSignals].sort((a, b) => b.opportunity - a.opportunity).slice(0, 5),
    [allSignals]
  );
  const topRisks = useMemo(() =>
    [...allSignals].filter(s => s.risk > 40).sort((a, b) => b.risk - a.risk).slice(0, 3),
    [allSignals]
  );

  const { user } = useAuth();
  const { data: dbPositions } = usePositions();
  const closePosition = useClosePosition();
  const [openPosDialog, setOpenPosDialog] = useState(false);
  const [preselectedNetuid, setPreselectedNetuid] = useState<number | undefined>();
  const [panelSignal, setPanelSignal] = useState<SubnetSignal | null>(null);

  const { data: latestPrices } = useQuery({
    queryKey: ["position-prices", dbPositions?.map(p => p.netuid)],
    queryFn: async () => {
      if (!dbPositions?.length) return {};
      const netuids = [...new Set(dbPositions.map(p => p.netuid))];
      const { data } = await supabase.from("subnet_latest_display").select("netuid, price_usd").in("netuid", netuids);
      const map: Record<number, number> = {};
      for (const r of data || []) { map[r.netuid!] = Number(r.price_usd) || 0; }
      return map;
    },
    enabled: !!dbPositions?.length,
    refetchInterval: 60_000,
  });

  const activePosition: Position | null = useMemo(() => {
    if (demoMode) return { capital: 5000, currentValue: 5420, protectionThreshold: -8, exitRecommended: 100, netuid: 1 };
    if (!dbPositions?.length || !latestPrices) return null;
    const pos = dbPositions[0];
    const currentPrice = latestPrices[pos.netuid] || Number(pos.entry_price);
    const currentValue = Number(pos.quantity) * currentPrice;
    return { id: pos.id, netuid: pos.netuid, capital: Number(pos.capital), currentValue, protectionThreshold: Number(pos.stop_loss_pct), exitRecommended: Number(pos.take_profit_pct) };
  }, [demoMode, dbPositions, latestPrices]);

  const hasPosition = activePosition !== null;

  const handleClosePosition = useCallback(async () => {
    if (!activePosition?.id || !latestPrices) return;
    const price = latestPrices[activePosition.netuid!] || 0;
    try { await closePosition.mutateAsync({ id: activePosition.id, closed_price: price }); toast.success("Position fermée ✓"); }
    catch (err: any) { toast.error(err.message); }
  }, [activePosition, latestPrices, closePosition]);

  /* ─── Notifications ─── */
  const prevExitWarnRef = useRef(false);
  useEffect(() => {
    if (!activePosition || demoMode) return;
    const shouldWarn = smartCapital.state === "DISTRIBUTION" || globalRisk > 70;
    if (shouldWarn && !prevExitWarnRef.current) {
      const msg = smartCapital.state === "DISTRIBUTION" ? t("pos.exit_warn_sc" as any) : t("pos.exit_warn_risk" as any);
      toast.warning(msg, { duration: 15000 });
      if (Notification.permission === "granted") new Notification(msg, { icon: "/pwa-192x192.png", tag: "pos-exit-warn" });
    }
    prevExitWarnRef.current = shouldWarn;
  }, [activePosition, smartCapital.state, globalRisk, demoMode, t]);

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
    <div className="fixed inset-0 select-none overflow-y-auto" style={{ background: "#000" }}>
      {/* Vignette */}
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
      <div className="relative z-30 flex items-start justify-between px-4 sm:px-8 pt-4 sm:pt-6">
        <div style={{ width: 100 }} />
        <div className="flex flex-col items-center">
          <div style={{ width: 6, height: 6, borderRadius: "50%", background: "rgba(255,215,0,0.6)", boxShadow: "0 0 12px rgba(255,215,0,0.3)", marginBottom: 8 }} />
          <span className="font-mono font-bold tracking-[0.4em] sm:tracking-[0.6em]" style={{ fontSize: isMobile ? 14 : 20, color: "rgba(255,248,220,0.85)", textShadow: "0 0 30px rgba(255,215,0,0.15)" }}>
            {t("header.title")}
          </span>
        </div>
        {/* Mode toggles */}
        <div className="flex items-center gap-2" style={{ paddingTop: isMobile ? 2 : 6 }}>
          <button onClick={() => setViewMode("hunter")} className="font-mono tracking-wider px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5"
            style={{ fontSize: isMobile ? 9 : 11, fontWeight: 700, background: viewMode === "hunter" ? "rgba(255,215,0,0.1)" : "rgba(255,255,255,0.03)", color: viewMode === "hunter" ? "rgba(255,215,0,0.9)" : "rgba(255,255,255,0.3)", border: `1px solid ${viewMode === "hunter" ? "rgba(255,215,0,0.3)" : "rgba(255,255,255,0.06)"}` }}>
            <span>🔥</span> {t("mode.hunter")}
          </button>
          <button onClick={() => setViewMode("defensive")} className="font-mono tracking-wider px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5"
            style={{ fontSize: isMobile ? 9 : 11, fontWeight: 700, background: viewMode === "defensive" ? "rgba(229,57,53,0.1)" : "rgba(255,255,255,0.03)", color: viewMode === "defensive" ? "rgba(229,57,53,0.8)" : "rgba(255,255,255,0.3)", border: `1px solid ${viewMode === "defensive" ? "rgba(229,57,53,0.25)" : "rgba(255,255,255,0.06)"}` }}>
            <span>🛡</span> {t("mode.defensive")}
          </button>
          <div style={{ width: 1, height: 20, background: "rgba(255,255,255,0.08)" }} />
          <button onClick={() => setBagBuilder(b => !b)} className="font-mono tracking-wider px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5"
            style={{ fontSize: isMobile ? 9 : 11, fontWeight: 700, background: bagBuilder ? "rgba(0,220,180,0.1)" : "rgba(255,255,255,0.03)", color: bagBuilder ? "rgba(0,220,180,0.9)" : "rgba(255,255,255,0.3)", border: `1px solid ${bagBuilder ? "rgba(0,220,180,0.3)" : "rgba(255,255,255,0.06)"}` }}>
            <span>💎</span> {t("mode.bag_builder")}
          </button>
        </div>
      </div>

      {/* ═══ MAIN CONTENT ═══ */}
      <div className="relative z-10 flex flex-col items-center px-4 sm:px-8 pb-32" style={{ paddingTop: isMobile ? 12 : 24 }}>

        {/* ─── GAUGE + CENTER HUD ─── */}
        <div className="relative" style={{ width: SIZE, height: SIZE }}>
          {/* Ambient glow */}
          <div className="absolute inset-0 rounded-full pointer-events-none" style={{
            background: `radial-gradient(circle, rgba(255,180,50,0.05) 0%, transparent 60%)`,
            transform: "scale(1.3)",
          }} />

          <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SVG_SIZE} ${SVG_SIZE}`}>
            {/* Outer ticks */}
            {Array.from({ length: 54 }, (_, i) => {
              const angleDeg = (i * 5) - 135;
              if (angleDeg > 135) return null;
              const rad = ((angleDeg - 90) * Math.PI) / 180;
              const isMajor = i % 9 === 0;
              const r1 = R_OUTER + 4;
              const r2 = R_OUTER + (isMajor ? 14 : 8);
              return (
                <line key={`ot-${i}`} x1={CX + r1 * Math.cos(rad)} y1={CY + r1 * Math.sin(rad)}
                  x2={CX + r2 * Math.cos(rad)} y2={CY + r2 * Math.sin(rad)}
                  stroke={isMajor ? "rgba(255,215,0,0.2)" : "rgba(255,215,0,0.06)"} strokeWidth={isMajor ? 1.5 : 0.7} strokeLinecap="round" />
              );
            })}
            {/* Inner ticks */}
            {Array.from({ length: 54 }, (_, i) => {
              const angleDeg = (i * 5) - 135;
              if (angleDeg > 135) return null;
              const rad = ((angleDeg - 90) * Math.PI) / 180;
              const isMajor = i % 9 === 0;
              const r1 = R_INNER - 4;
              const r2 = R_INNER - (isMajor ? 12 : 7);
              return (
                <line key={`it-${i}`} x1={CX + r1 * Math.cos(rad)} y1={CY + r1 * Math.sin(rad)}
                  x2={CX + r2 * Math.cos(rad)} y2={CY + r2 * Math.sin(rad)}
                  stroke={isMajor ? "rgba(229,57,53,0.18)" : "rgba(229,57,53,0.05)"} strokeWidth={isMajor ? 1.2 : 0.5} strokeLinecap="round" />
              );
            })}

            {/* OUTER RING = OPPORTUNITY */}
            <circle cx={CX} cy={CY} r={R_OUTER} fill="none" stroke="rgba(255,215,0,0.04)" strokeWidth={isMobile ? 6 : 10} />
            {oppAngle > 0 && (
              <path d={describeArc(CX, CY, R_OUTER, -135, -135 + oppAngle)} fill="none"
                stroke={oppGlobal} strokeWidth={isMobile ? 6 : 10} strokeLinecap="round"
                style={{ opacity: 0.55, animation: "opp-sweep 4s ease-in-out infinite" }} />
            )}

            {/* INNER RING = RISK */}
            <circle cx={CX} cy={CY} r={R_INNER} fill="none" stroke="rgba(229,57,53,0.04)" strokeWidth={isMobile ? 8 : 12} />
            {riskAngle > 0 && (
              <path d={describeArc(CX, CY, R_INNER, -135, -135 + riskAngle)} fill="none"
                stroke={rskGlobal} strokeWidth={isMobile ? 8 : 12} strokeLinecap="round"
                style={{ opacity: 0.55 }} />
            )}

            {/* Labels */}
            <text x={CX + R_OUTER + 18} y={CY - R_OUTER + 30} fill="rgba(255,215,0,0.3)" fontSize={isMobile ? 7 : 10}
              fontFamily="'JetBrains Mono', monospace" letterSpacing="0.12em" textAnchor="start">{t("gauge.opportunity")}</text>
            <text x={CX + R_INNER + 14} y={CY - R_INNER + 28} fill="rgba(229,57,53,0.25)" fontSize={isMobile ? 7 : 10}
              fontFamily="'JetBrains Mono', monospace" letterSpacing="0.12em" textAnchor="start">{t("gauge.risk")}</text>
          </svg>

          {/* CENTER HUD — overlaid on gauge */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="flex flex-col items-center text-center" style={{ maxWidth: isMobile ? 180 : 300 }}>
              {/* Window label */}
              <span className="font-mono tracking-[0.2em] uppercase" style={{ fontSize: isMobile ? 7 : 10, color: "rgba(255,215,0,0.45)" }}>
                {t("gauge.window")}
              </span>
              {/* Timer */}
              <span className="font-mono font-bold leading-none mt-1" style={{
                fontSize: isMobile ? 36 : 64, color: "rgba(255,248,220,0.95)",
                textShadow: "0 0 40px rgba(255,215,0,0.2)",
              }}>
                {formatTimeClear(globalTMinus)}
              </span>
              <span className="font-mono tracking-wider mt-1" style={{ fontSize: isMobile ? 7 : 10, color: "rgba(255,248,220,0.3)", fontStyle: "italic" }}>
                {t("gauge.before")}
              </span>
              {/* Opp / Risk / Smart Capital in gauge */}
              <div className="flex items-center mt-3" style={{ gap: isMobile ? 10 : 18 }}>
                <div className="flex flex-col items-center">
                  <span className="font-mono" style={{ color: "rgba(255,215,0,0.3)", fontSize: isMobile ? 6 : 8, letterSpacing: "0.15em" }}>OPP</span>
                  <span className="font-mono font-bold" style={{ color: oppGlobal, fontSize: isMobile ? 16 : 22 }}>{globalOpp}</span>
                </div>
                <div style={{ width: 1, height: isMobile ? 18 : 28, background: "rgba(255,255,255,0.06)" }} />
                <div className="flex flex-col items-center">
                  <span className="font-mono" style={{ color: "rgba(229,57,53,0.3)", fontSize: isMobile ? 6 : 8, letterSpacing: "0.15em" }}>RISK</span>
                  <span className="font-mono font-bold" style={{ color: rskGlobal, fontSize: isMobile ? 16 : 22 }}>{globalRisk}</span>
                </div>
                <div style={{ width: 1, height: isMobile ? 18 : 28, background: "rgba(255,255,255,0.06)" }} />
                <div className="flex flex-col items-center">
                  <span className="font-mono" style={{
                    color: smartCapital.state === "ACCUMULATION" ? "rgba(76,175,80,0.4)" : smartCapital.state === "DISTRIBUTION" ? "rgba(229,57,53,0.4)" : "rgba(255,255,255,0.2)",
                    fontSize: isMobile ? 6 : 8, letterSpacing: "0.15em",
                  }}>SC</span>
                  <span className="font-mono font-bold" style={{
                    color: smartCapital.state === "ACCUMULATION" ? "rgba(76,175,80,0.85)" : smartCapital.state === "DISTRIBUTION" ? "rgba(229,57,53,0.85)" : "rgba(255,248,220,0.5)",
                    fontSize: isMobile ? 10 : 13,
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
          <StrategicBadge
            action={strategicAction}
            label={t(`strat.${strategicAction.toLowerCase()}` as any)}
            isMobile={isMobile}
          />
        </div>

        {/* ═══ SENTINEL INDEX + FLOW BADGES ═══ */}
        <div className="mt-5 sm:mt-8 flex flex-col sm:flex-row items-center gap-4 sm:gap-10">
          <SentinelIndexDisplay score={sentinelIndex} label={sentinelLabel} isMobile={isMobile} />
          <div style={{ width: 1, height: 40, background: "rgba(255,255,255,0.05)" }} className="hidden sm:block" />
          <div className="flex items-center gap-2">
            <FlowBadge label={t("flow.dominance")} direction={flowData.dominance} isMobile={isMobile} />
            <FlowBadge label={t("flow.emission")} direction={flowData.emission} isMobile={isMobile} />
            <FlowBadge label={t("flow.inflow")} direction={flowData.inflow} isMobile={isMobile} />
          </div>
        </div>

        {/* ═══ DUAL CORE ═══ */}
        <div className="flex items-center gap-4 mt-4">
          <div className="flex items-center gap-1.5">
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: "rgba(255,215,0,0.6)" }} />
            <span className="font-mono" style={{ color: "rgba(255,215,0,0.45)", fontSize: isMobile ? 8 : 10, letterSpacing: "0.1em" }}>
              {t("dc.structure")} {dualCore.structurePct}%
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: "rgba(0,200,255,0.6)" }} />
            <span className="font-mono" style={{ color: "rgba(0,200,255,0.45)", fontSize: isMobile ? 8 : 10, letterSpacing: "0.1em" }}>
              {t("dc.sniper")} {dualCore.sniperPct}%
            </span>
          </div>
        </div>

        {/* ═══ BEST ASYMMETRY SUBNET ═══ */}
        {bestSubnet && (
          <div className="mt-6 sm:mt-10 w-full" style={{ maxWidth: isMobile ? "100%" : 600 }}>
            <span className="font-mono tracking-[0.2em] uppercase block mb-3" style={{ fontSize: isMobile ? 8 : 10, color: "rgba(255,215,0,0.3)" }}>
              {t("top.best")}
            </span>
            <BestSubnetCard signal={bestSubnet} isMobile={isMobile} t={t} onClick={() => setPanelSignal(bestSubnet)} />
          </div>
        )}

        {/* ═══ TOP OPPORTUNITIES + TOP RISKS ═══ */}
        <div className="mt-6 sm:mt-8 w-full grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-8" style={{ maxWidth: 900 }}>
          {/* Top 5 Opportunities */}
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
          {/* Top 3 Risks */}
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

      {/* ═══ BOTTOM BAR ═══ */}
      <div className="fixed left-0 right-0 z-20 flex flex-col items-center" style={{ bottom: isMobile ? 12 : 20 }}>
        {hasPosition ? (
          <PositionBar position={activePosition!} isMobile={isMobile} t={t}
            onClose={activePosition?.id ? handleClosePosition : undefined}
            onTakeProfit={() => toast.info("Prise de profit partielle — à implémenter")}
            exitWarning={
              smartCapital.state === "DISTRIBUTION" ? t("pos.exit_warn_sc") :
              globalRisk > 70 ? t("pos.exit_warn_risk") : null
            } />
        ) : user ? (
          <button onClick={() => { setPreselectedNetuid(undefined); setOpenPosDialog(true); }}
            className="font-mono tracking-wider px-7 py-3 rounded-xl transition-all pointer-events-auto flex items-center gap-2"
            style={{ background: "linear-gradient(135deg, rgba(255,215,0,0.1), rgba(255,215,0,0.04))", color: "rgba(255,215,0,0.9)", border: "1px solid rgba(255,215,0,0.25)", fontSize: isMobile ? 12 : 15, fontWeight: 700, boxShadow: "0 0 30px rgba(255,215,0,0.06)", letterSpacing: "0.08em" }}>
            + {t("pos.open")}
          </button>
        ) : (
          <span className="font-mono text-[10px] tracking-wider px-3 py-2 rounded-md pointer-events-auto"
            style={{ color: "rgba(255,255,255,0.3)", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
            {t("pos.login_required")}
          </span>
        )}
      </div>

      {/* Notification + Demo toggles */}
      {typeof Notification !== "undefined" && Notification.permission !== "granted" && (
        <button onClick={() => Notification.requestPermission()}
          className="fixed bottom-4 left-4 z-20 font-mono text-[10px] tracking-wider px-3 py-1.5 rounded-md transition-all"
          style={{ background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.3)", border: "1px solid rgba(255,255,255,0.08)" }}>
          🔔 {t("gauge.notif")}
        </button>
      )}
      <button onClick={() => setDemoMode(d => !d)}
        className="fixed bottom-4 right-4 z-30 font-mono text-[10px] tracking-wider px-3 py-1.5 rounded-md transition-all pointer-events-auto"
        style={{ background: demoMode ? "rgba(0,255,200,0.12)" : "rgba(255,255,255,0.03)", color: demoMode ? "rgba(0,255,200,0.8)" : "rgba(255,255,255,0.25)", border: `1px solid ${demoMode ? "rgba(0,255,200,0.3)" : "rgba(255,255,255,0.06)"}` }}>
        {demoMode ? "⬤ DEMO ON" : "◯ DEMO"}
      </button>

      {/* Dialogs */}
      <OpenPositionDialog open={openPosDialog} onClose={() => setOpenPosDialog(false)} signals={signals} t={t} preselectedNetuid={preselectedNetuid} />
      <SubnetPanel signal={panelSignal} open={!!panelSignal} onClose={() => setPanelSignal(null)} />
    </div>
  );
}
