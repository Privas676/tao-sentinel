import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { useI18n } from "@/lib/i18n";
import {
  SubnetSignal, RawSignal, GaugeState, GaugePhase,
  clamp, deriveGaugeState, derivePhase, deriveTMinus, formatTMinus,
  stateColor, stateGlow, rayColor, processSignals,
  computeGlobalPsi, computeGlobalConfidence,
} from "@/lib/gauge-engine";
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

/* ═══════════════════════════════════════ */
/*       MINI SPARKLINE IN TOOLTIP         */
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
  return (
    <polyline points={pts} fill="none" stroke={color} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
  );
}

/* ═══════════════════════════════════════ */
/*       RAY SPARKLINE (on ray body)       */
/* ═══════════════════════════════════════ */
function RaySparkline({ data, x1, y1, x2, y2, state }: {
  data: number[]; x1: number; y1: number; x2: number; y2: number; state: GaugeState;
}) {
  if (data.length < 3) return null;
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 10) return null;
  const ux = dx / len, uy = dy / len;
  const px = -uy, py = ux;
  const min = Math.min(...data), max = Math.max(...data);
  const range = max - min || 1;
  const sparkW = len * 0.7, sparkH = 6, startOffset = len * 0.15;
  const pts = data.map((v, i) => {
    const t = i / (data.length - 1);
    const along = startOffset + t * sparkW;
    const perp = ((v - min) / range - 0.5) * sparkH * 2;
    return `${x1 + ux * along + px * perp},${y1 + uy * along + py * perp}`;
  });
  return (
    <polyline points={pts.join(" ")} fill="none" stroke={rayColor(state, 0.35)} strokeWidth="0.8"
      strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.5 }} />
  );
}

/* ═══════════════════════════════════════ */
/*       IMMINENT PARTICLES                */
/* ═══════════════════════════════════════ */
function ImminentParticles({ x1, y1, x2, y2, color }: {
  x1: number; y1: number; x2: number; y2: number; color: string;
}) {
  const particles = useMemo(() => {
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 10) return [];
    const ux = dx / len, uy = dy / len;
    const px = -uy, py = ux;
    return Array.from({ length: 8 }, (_, i) => {
      const t = 0.15 + Math.random() * 0.7;
      const drift = (Math.random() - 0.5) * 18;
      const size = 1 + Math.random() * 1.5;
      const delay = Math.random() * 3;
      const dur = 1.8 + Math.random() * 1.4;
      return {
        cx: x1 + ux * len * t + px * drift,
        cy: y1 + uy * len * t + py * drift,
        r: size,
        delay,
        dur,
        driftX: px * (Math.random() - 0.5) * 12,
        driftY: py * (Math.random() - 0.5) * 12,
      };
    });
  }, [x1, y1, x2, y2]);

  return (
    <g style={{ pointerEvents: "none" }}>
      {particles.map((p, i) => (
        <circle key={i} cx={p.cx} cy={p.cy} r={p.r}
          fill={color} fillOpacity={0.6}
          style={{
            animation: `particle-float ${p.dur}s ease-in-out ${p.delay}s infinite`,
            transformOrigin: `${p.cx}px ${p.cy}px`,
          }}
        />
      ))}
    </g>
  );
}

/* ═══════════════════════════════════════ */
/*          SACRED RAYS                    */
/* ═══════════════════════════════════════ */
function SacredRays({ signals, cx, cy, outerR, hoveredIdx, setHoveredIdx, onClickRay }: {
  signals: SubnetSignal[]; cx: number; cy: number; outerR: number;
  hoveredIdx: number | null; setHoveredIdx: (i: number | null) => void;
  onClickRay: (s: SubnetSignal) => void;
}) {
  const angleStep = 360 / 7;
  const gap = 24;
  const [tremble, setTremble] = useState(0);

  useEffect(() => {
    let raf: number;
    const start = performance.now();
    const tick = (now: number) => {
      setTremble(Math.sin((now - start) / 80) * 2);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  if (!signals.length) return null;

  return (
    <>
      {signals.map((s, i) => {
        const angleDeg = (i * angleStep) - 90;
        const angle = angleDeg * (Math.PI / 180);
        const r1 = outerR + gap;
        const maxLen = 130;
        const minLen = 25;
        const imminenceFactor = clamp(1 - (s.t_minus_minutes / 240), 0, 1);
        const len = minLen + imminenceFactor * (maxLen - minLen);
        const isImm = s.state === "IMMINENT";
        const trembleOffset = isImm ? tremble : 0;
        const r2 = r1 + len + trembleOffset;
        const thickness = 1.5 + (s.confidence / 100) * 3;
        const x1 = cx + r1 * Math.cos(angle);
        const y1 = cy + r1 * Math.sin(angle);
        const x2 = cx + r2 * Math.cos(angle);
        const y2 = cy + r2 * Math.sin(angle);
        const isHovered = hoveredIdx === i;
        const breatheScale = isHovered ? 1 : 0;

        // Ring traction effect for IMMINENT rays
        const tractionPts = isImm ? (() => {
          const trR = outerR + 2;
          const spreadDeg = 4;
          const a1 = (angleDeg - spreadDeg) * (Math.PI / 180);
          const a2 = (angleDeg + spreadDeg) * (Math.PI / 180);
          const pull = 4;
          return {
            p1: { x: cx + trR * Math.cos(a1), y: cy + trR * Math.sin(a1) },
            p2: { x: cx + (trR + pull) * Math.cos(angle), y: cy + (trR + pull) * Math.sin(angle) },
            p3: { x: cx + trR * Math.cos(a2), y: cy + trR * Math.sin(a2) },
          };
        })() : null;

        return (
          <g key={s.netuid}>
            {/* Hit area */}
            <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="transparent" strokeWidth={22}
              style={{ cursor: "pointer" }}
              onMouseEnter={() => setHoveredIdx(i)}
              onMouseLeave={() => setHoveredIdx(null)}
              onClick={() => onClickRay(s)}
            />
            {/* Visible ray */}
            <line x1={x1} y1={y1} x2={x2} y2={y2}
              stroke={rayColor(s.state)} strokeWidth={thickness} strokeLinecap="round"
              style={{
                opacity: isHovered ? 1 : 0.75,
                filter: isHovered ? `drop-shadow(0 0 6px ${rayColor(s.state, 0.5)})` : "none",
                transition: "opacity 200ms, filter 300ms",
                pointerEvents: "none",
              }}
            />
            {/* Breathing glow on hovered ray */}
            {isHovered && (
              <line x1={x1} y1={y1} x2={x2} y2={y2}
                stroke={rayColor(s.state, 0.3)} strokeWidth={thickness + 6} strokeLinecap="round"
                style={{
                  opacity: 0.4,
                  animation: "ray-breathe 1.8s ease-in-out infinite",
                  pointerEvents: "none",
                }}
              />
            )}
            {/* Sparkline on ray */}
            <RaySparkline data={s.sparkline_7d} x1={x1} y1={y1} x2={x2} y2={y2} state={s.state} />
            {/* Traction deformation for IMMINENT */}
            {tractionPts && (
              <path
                d={`M ${tractionPts.p1.x} ${tractionPts.p1.y} Q ${tractionPts.p2.x} ${tractionPts.p2.y} ${tractionPts.p3.x} ${tractionPts.p3.y}`}
                fill="none" stroke={rayColor(s.state, 0.3)} strokeWidth="1.5"
                style={{ pointerEvents: "none" }}
              />
            )}
            {/* IMMINENT particles */}
            {isImm && (
              <ImminentParticles x1={x1} y1={y1} x2={x2} y2={y2} color={stateColor(s.state)} />
            )}
          </g>
        );
      })}
    </>
  );
}

/* ═══════════════════════════════════════ */
/*     PREMIUM TOOLTIP + CONNECTOR         */
/* ═══════════════════════════════════════ */
function RayTooltip({ signal, cx, cy, outerR, index, svgSize }: {
  signal: SubnetSignal; cx: number; cy: number; outerR: number; index: number; svgSize: number;
}) {
  const { t } = useI18n();
  const angleStep = 360 / 7;
  const angleDeg = (index * angleStep) - 90;
  const angle = angleDeg * (Math.PI / 180);

  // Tooltip dimensions
  const TW = 270, TH = 160, PAD = 14, BR = 10;

  // Ray tip position (end of ray)
  const gap = 24;
  const imminenceFactor = clamp(1 - (signal.t_minus_minutes / 240), 0, 1);
  const rayLen = 25 + imminenceFactor * 105;
  const rayTipR = outerR + gap + rayLen;
  const tipX = cx + rayTipR * Math.cos(angle);
  const tipY = cy + rayTipR * Math.sin(angle);

  // Tooltip anchor: pushed further out from ray tip
  const tooltipR = rayTipR + 35;
  let tx = cx + tooltipR * Math.cos(angle) - TW / 2;
  let ty = cx + tooltipR * Math.sin(angle) - TH / 2;

  // Viewport clamping (SVG coords)
  const margin = 8;
  const minX = -((svgSize - 720) / 2) + margin;
  const maxX = svgSize - ((svgSize - 720) / 2) - TW - margin;
  const minY = -((svgSize - 720) / 2) + margin;
  const maxY = svgSize - ((svgSize - 720) / 2) - TH - margin;
  tx = Math.max(minX, Math.min(maxX, tx));
  ty = Math.max(minY, Math.min(maxY, ty));

  const tooltipCx = tx + TW / 2;
  const tooltipCy = ty + TH / 2;

  const displayName = signal.name.startsWith("SN-") ? signal.name : `SN-${signal.netuid} · ${signal.name}`;
  const color = stateColor(signal.state);
  const stateLabel = t(`state.${signal.state.toLowerCase()}` as any);
  const phaseLabel = signal.phase !== "NONE" ? t(`phase.${signal.phase.toLowerCase()}` as any) : "—";
  const asymLabel = t(`asym.${signal.asymmetry.toLowerCase()}` as any);

  // Sparkline data
  const sparkData = signal.sparkline_7d;
  const sparkW = TW - PAD * 2 - 4;
  const sparkH = 28;

  return (
    <g style={{ pointerEvents: "none" }}>
      {/* Connector line: ray tip → tooltip center */}
      <line
        x1={tipX} y1={tipY}
        x2={tooltipCx} y2={tooltipCy}
        stroke="rgba(255,255,255,0.06)"
        strokeWidth="0.8"
        strokeDasharray="3,3"
      />

      {/* Tooltip card */}
      <rect
        x={tx} y={ty} width={TW} height={TH} rx={BR}
        fill="#0E0F12"
        stroke="#2A2F36"
        strokeWidth={1}
        filter="url(#tooltip-shadow)"
      />

      {/* Shadow filter */}
      <defs>
        <filter id="tooltip-shadow" x="-10%" y="-10%" width="130%" height="130%">
          <feDropShadow dx="0" dy="4" stdDeviation="8" floodColor="rgba(0,0,0,0.5)" floodOpacity="0.4" />
        </filter>
      </defs>

      {/* ─ Line 1: Name ─ */}
      <text
        x={tx + PAD} y={ty + PAD + 13}
        fill="rgba(255,255,255,0.88)"
        fontSize="14" fontWeight="600"
        fontFamily="'JetBrains Mono', monospace"
        letterSpacing="0.02em"
      >
        {displayName.length > 24 ? displayName.slice(0, 22) + "…" : displayName}
      </text>

      {/* ─ Line 2: State badge ─ */}
      <rect
        x={tx + PAD} y={ty + PAD + 22}
        width={stateLabel.length * 8.5 + 16} height={20} rx={4}
        fill={color} fillOpacity={0.12}
        stroke={color} strokeOpacity={0.25} strokeWidth={0.5}
      />
      <text
        x={tx + PAD + 8} y={ty + PAD + 37}
        fill={color}
        fontSize="11" fontWeight="500"
        fontFamily="'JetBrains Mono', monospace"
        letterSpacing="0.08em"
      >
        {stateLabel}
      </text>
      {/* Phase next to state */}
      <text
        x={tx + PAD + stateLabel.length * 8.5 + 28} y={ty + PAD + 37}
        fill="rgba(255,255,255,0.35)"
        fontSize="10"
        fontFamily="'JetBrains Mono', monospace"
        letterSpacing="0.04em"
      >
        {phaseLabel}
      </text>

      {/* ─ Line 3: T-minus (large) ─ */}
      <text
        x={tx + PAD} y={ty + PAD + 62}
        fill={color}
        fontSize="16" fontWeight="600"
        fontFamily="'JetBrains Mono', monospace"
        letterSpacing="0.04em"
      >
        {formatTMinus(signal.t_minus_minutes)}
      </text>
      {/* PSI + Confidence on same line */}
      <text
        x={tx + TW - PAD} y={ty + PAD + 62}
        textAnchor="end"
        fill="rgba(255,255,255,0.5)"
        fontSize="11"
        fontFamily="'JetBrains Mono', monospace"
      >
        PSI {signal.psi} · {signal.confidence}%
      </text>

      {/* ─ Line 4: Asymmetry ─ */}
      <text
        x={tx + PAD} y={ty + PAD + 80}
        fill="rgba(255,255,255,0.22)"
        fontSize="10"
        fontFamily="'JetBrains Mono', monospace"
        letterSpacing="0.06em"
      >
        {t("tip.asym")}: {asymLabel}
      </text>

      {/* ─ Sparkline 7d ─ */}
      <line
        x1={tx + PAD} y1={ty + PAD + 90}
        x2={tx + TW - PAD} y2={ty + PAD + 90}
        stroke="rgba(255,255,255,0.04)" strokeWidth="0.5"
      />
      {sparkData.length >= 2 && (
        <g transform={`translate(${tx + PAD + 2}, ${ty + PAD + 96})`}>
          <svg width={sparkW} height={sparkH} viewBox={`0 0 ${sparkW} ${sparkH}`}>
            <TooltipSparkline data={sparkData} width={sparkW} height={sparkH - 2} color={color} />
          </svg>
        </g>
      )}
      <text
        x={tx + TW - PAD} y={ty + TH - 8}
        textAnchor="end"
        fill="rgba(255,255,255,0.15)"
        fontSize="8"
        fontFamily="'JetBrains Mono', monospace"
        letterSpacing="0.05em"
      >
        {t("tip.price7d")}
      </text>
    </g>
  );
}

/* ═══════════════════════════════════════ */
/*        SUBNET SIDE PANEL                */
/* ═══════════════════════════════════════ */
function SubnetPanel({ signal, open, onClose }: {
  signal: SubnetSignal | null; open: boolean; onClose: () => void;
}) {
  const { t } = useI18n();
  if (!signal) return null;

  const { data: metrics } = useQuery({
    queryKey: ["subnet-detail", signal.netuid],
    queryFn: async () => {
      const { data } = await supabase.from("subnet_latest_display")
        .select("*").eq("netuid", signal.netuid).maybeSingle();
      return data;
    },
    enabled: open,
  });

  const color = stateColor(signal.state);
  const phaseLabel = (() => {
    switch (signal.phase) {
      case "BUILD": return t("phase.build");
      case "ARMED": return t("phase.armed");
      case "TRIGGER": return t("phase.trigger");
      default: return "—";
    }
  })();

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full sm:w-[380px] border-l border-white/5 bg-[#080810] text-white overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="font-mono text-white/90 tracking-wider">
            {t("panel.title")}
          </SheetTitle>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          {/* Header */}
          <div className="text-center">
            <div className="font-mono text-2xl tracking-wider" style={{ color }}>
              SN-{signal.netuid}
            </div>
            <div className="font-mono text-sm text-white/50 mt-1">{signal.name}</div>
          </div>

          {/* PSI gauge mini */}
          <div className="flex items-center justify-center gap-8">
            <div className="text-center">
              <div className="font-mono text-3xl font-bold" style={{ color }}>{signal.psi}</div>
              <div className="font-mono text-[9px] text-white/30 tracking-widest mt-1">PSI</div>
            </div>
            <div className="text-center">
              <div className="font-mono text-lg text-white/70">{signal.confidence}%</div>
              <div className="font-mono text-[9px] text-white/30 tracking-widest mt-1">{t("tip.confidence")}</div>
            </div>
            <div className="text-center">
              <div className="font-mono text-lg text-white/70">{formatTMinus(signal.t_minus_minutes)}</div>
              <div className="font-mono text-[9px] text-white/30 tracking-widest mt-1">T-MINUS</div>
            </div>
          </div>

          {/* Phase + State */}
          <div className="flex justify-between font-mono text-xs px-2">
            <span className="text-white/40">{t("sub.phase")}: <span style={{ color }}>{phaseLabel}</span></span>
            <span className="text-white/40">{t("sub.state")}: <span style={{ color }}>{t(`state.${signal.state.toLowerCase()}` as any)}</span></span>
          </div>

          {/* Sparkline */}
          {signal.sparkline_7d.length > 1 && (
            <div className="bg-white/[0.02] rounded-lg p-4">
              <div className="font-mono text-[9px] text-white/25 tracking-widest mb-2">{t("tip.price7d")}</div>
              <svg width="100%" height="60" viewBox="0 0 300 60" preserveAspectRatio="none">
                <TooltipSparkline data={signal.sparkline_7d} width={300} height={55} color={color} />
              </svg>
            </div>
          )}

          {/* Metrics from DB */}
          {metrics && (
            <div className="space-y-3">
              <div className="font-mono text-[9px] text-white/25 tracking-widest">{t("panel.metrics")}</div>
              {[
                [t("panel.liquidity"), metrics.liquidity_usd ? `$${Number(metrics.liquidity_usd).toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "—"],
                [t("panel.volume"), metrics.vol_24h_usd ? `$${Number(metrics.vol_24h_usd).toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "—"],
                [t("panel.miners"), metrics.miners_active != null ? String(Math.round(Number(metrics.miners_active))) : "—"],
                [t("panel.cap"), metrics.cap_usd ? `$${Number(metrics.cap_usd).toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "—"],
              ].map(([label, val]) => (
                <div key={label} className="flex justify-between font-mono text-xs border-b border-white/[0.04] pb-2">
                  <span className="text-white/35">{label}</span>
                  <span className="text-white/70">{val}</span>
                </div>
              ))}
            </div>
          )}

          {/* Open Taostats button */}
          <button
            onClick={() => window.open(`https://taostats.io/subnets/${signal.netuid}`, "_blank")}
            className="w-full font-mono text-xs tracking-widest py-3 rounded-lg border border-white/10 hover:border-white/20 text-white/50 hover:text-white/80 transition-all"
          >
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

  /* ─── signals ─── */
  const signals = useMemo(() => processSignals(rawSignals ?? [], sparklines ?? {}), [rawSignals, sparklines]);
  const globalPsi = useMemo(() => computeGlobalPsi(rawSignals ?? []), [rawSignals]);
  const globalConf = useMemo(() => computeGlobalConfidence(rawSignals ?? []), [rawSignals]);
  const globalState = deriveGaugeState(globalPsi, globalConf);
  const globalPhase = derivePhase(globalPsi);
  const globalTMinus = deriveTMinus(globalPsi);

  /* ─── IMMINENT notifications ─── */
  const prevImminentRef = useRef<Set<number>>(new Set());
  useEffect(() => {
    if (!signals.length) return;
    const currentImminent = new Set(signals.filter(s => s.state === "IMMINENT").map(s => s.netuid));
    const newImminent = [...currentImminent].filter(id => !prevImminentRef.current.has(id));
    if (newImminent.length > 0 && Notification.permission === "granted") {
      for (const netuid of newImminent) {
        const sig = signals.find(s => s.netuid === netuid);
        if (sig) {
          new Notification(`⚠ IMMINENT — SN-${sig.netuid}`, {
            body: `${sig.name} · PSI ${sig.psi} · ${formatTMinus(sig.t_minus_minutes)}`,
            icon: "/pwa-192x192.png",
            tag: `imminent-${netuid}`,
          });
        }
      }
    }
    prevImminentRef.current = currentImminent;
  }, [signals]);

  /* ─── mechanical click ─── */
  const audioCtxRef = useRef<AudioContext | null>(null);
  const playClick = useCallback(() => {
    try {
      if (!audioCtxRef.current) audioCtxRef.current = new AudioContext();
      const ctx = audioCtxRef.current;
      const now = ctx.currentTime;
      const bufLen = Math.floor(ctx.sampleRate * 0.035);
      const buf = ctx.createBuffer(1, bufLen, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < bufLen; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufLen * 0.12)) * 0.15;
      const src = ctx.createBufferSource(); src.buffer = buf;
      const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 3200; bp.Q.value = 2.5;
      const gain = ctx.createGain(); gain.gain.setValueAtTime(0.25, now); gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
      src.connect(bp).connect(gain).connect(ctx.destination); src.start(now); src.stop(now + 0.06);
    } catch { /* silent */ }
  }, []);

  const prevStateRef = useRef<GaugeState | null>(null);
  useEffect(() => {
    if (prevStateRef.current !== null && prevStateRef.current !== globalState) playClick();
    prevStateRef.current = globalState;
  }, [globalState, playClick]);

  /* ─── breathing ─── */
  const [breathe, setBreathe] = useState(0);
  useEffect(() => {
    if (globalState === "IMMINENT") { setBreathe(0); return; }
    let raf: number;
    const start = performance.now();
    const tick = (now: number) => { setBreathe(Math.sin(((now - start) % 2500) / 2500 * Math.PI * 2) * 0.5 + 0.5); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [globalState]);

  /* ─── flash ─── */
  const [flashActive, setFlashActive] = useState(false);
  const hasFlashed = useRef(false);
  useEffect(() => {
    if (globalState === "IMMINENT" && !hasFlashed.current) { hasFlashed.current = true; setFlashActive(true); setTimeout(() => setFlashActive(false), 150); }
    if (globalState !== "IMMINENT") hasFlashed.current = false;
  }, [globalState]);

  /* ─── hover + panel ─── */
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const [panelSignal, setPanelSignal] = useState<SubnetSignal | null>(null);

  const handleClickRay = useCallback((s: SubnetSignal) => {
    window.open(`https://taostats.io/subnets/${s.netuid}`, "_blank");
    setPanelSignal(s);
  }, []);

  /* ─── geometry (responsive) ─── */
  const isMobile = useIsMobile();
  const SIZE = isMobile ? 340 : 720;
  const SVG_SIZE = isMobile ? 480 : 960;
  const CX = SVG_SIZE / 2, CY = SVG_SIZE / 2;
  const R_OUTER = isMobile ? 150 : 320;
  const R_INNER = isMobile ? 128 : 275;
  const R_TRIGGER = isMobile ? 110 : 238;

  const color = stateColor(globalState);
  const glow = stateGlow(globalState);
  const tensionAngle = (globalPsi / 100) * 270;
  const innerAngle = (globalConf / 100) * 270;
  const innerOpacity = globalState === "IMMINENT" ? 0.9 : 0.55 + breathe * 0.35;
  const showHalo = globalConf >= 70;

  const triggerTicks = useMemo(() => {
    if (globalPhase !== "TRIGGER" && globalState !== "IMMINENT") return [];
    const count = globalState === "IMMINENT" ? 24 : 12;
    return Array.from({ length: count }, (_, i) => ({ angle: -135 + (i / count) * 270 }));
  }, [globalPhase, globalState]);

  // State / Phase labels
  const stateLabel = (() => {
    switch (globalState) {
      case "CALM": return t("state.calm");
      case "ALERT": return t("state.alert");
      case "IMMINENT": return t("state.imminent");
      case "EXIT": return t("state.exit");
    }
  })();

  const phaseLabel = (() => {
    switch (globalPhase) {
      case "BUILD": return t("phase.build");
      case "ARMED": return t("phase.armed");
      case "TRIGGER": return t("phase.trigger");
      default: return "—";
    }
  })();

  return (
    <div className="h-full w-full flex flex-col items-center justify-center select-none relative" style={{ background: "#000", overflow: "hidden" }}>
      {/* Vignette */}
      <div className="absolute inset-0 pointer-events-none" style={{
        background: "radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,0.7) 100%)",
      }} />

      {/* Flash */}
      {flashActive && (
        <div className="absolute inset-0 pointer-events-none z-50" style={{
          background: "radial-gradient(circle, rgba(229,57,53,0.25) 0%, transparent 60%)",
        }} />
      )}

      {/* Phase indicator (top) */}
      <div className="absolute top-3 sm:top-5 left-0 right-0 text-center z-10">
        <span className="font-mono tracking-[0.35em] uppercase" style={{ color: "rgba(255,255,255,0.12)", fontSize: isMobile ? 8 : 9 }}>
          {t("gauge.phase")} : {phaseLabel}
        </span>
      </div>
      <div className="absolute top-8 sm:top-12 left-0 right-0 text-center z-10">
        <span className="font-mono tracking-[0.3em] uppercase" style={{ color: "rgba(255,255,255,0.2)", fontSize: isMobile ? 9 : 10 }}>
          {t("gauge.confidence")} {globalConf}%
        </span>
      </div>

      {/* Notification permission button (bottom-left) */}
      {typeof Notification !== "undefined" && Notification.permission !== "granted" && (
        <button
          onClick={() => Notification.requestPermission()}
          className="absolute bottom-4 left-4 z-20 font-mono text-[9px] tracking-wider px-3 py-1.5 rounded-md transition-all"
          style={{
            background: "rgba(255,255,255,0.03)",
            color: "rgba(255,255,255,0.25)",
            border: "1px solid rgba(255,255,255,0.06)",
          }}
        >
          🔔 {t("gauge.notif")}
        </button>
      )}

      {/* GAUGE */}
      <div className="relative z-10" style={{ width: SIZE, height: SIZE }}>
        {/* Halo for high confidence */}
        {showHalo && (
          <div className="absolute inset-0 rounded-full pointer-events-none" style={{
            background: `radial-gradient(circle, rgba(100,180,255,0.06) 0%, transparent 70%)`,
            transform: "scale(1.4)",
          }} />
        )}

        {/* Glow */}
        {(globalState === "IMMINENT" || globalState === "EXIT") && (
          <div className="absolute inset-0 rounded-full pointer-events-none" style={{
            background: `radial-gradient(circle, ${glow} 0%, transparent 70%)`,
            opacity: globalState === "IMMINENT" ? 0.4 : 0.2,
            transform: "scale(1.35)",
            transition: "opacity 800ms ease",
          }} />
        )}

        <svg width={SIZE} height={SIZE}
          viewBox={`${(SVG_SIZE - SIZE) / -2} ${(SVG_SIZE - SIZE) / -2} ${SVG_SIZE} ${SVG_SIZE}`}
          style={{ overflow: "visible" }}>

          {/* Animation keyframes */}
          <defs>
            <style>{`
              @keyframes ray-breathe {
                0%, 100% { opacity: 0.15; }
                50% { opacity: 0.5; }
              }
              @keyframes ring-pulse {
                0%, 100% { opacity: 0.15; stroke-width: 8; }
                50% { opacity: 0.35; stroke-width: 12; }
              }
              @keyframes particle-float {
                0%, 100% { opacity: 0; transform: translate(0, 0) scale(0.6); }
                20% { opacity: 0.7; transform: translate(2px, -3px) scale(1); }
                50% { opacity: 0.4; transform: translate(-1px, -6px) scale(0.9); }
                80% { opacity: 0.6; transform: translate(3px, -2px) scale(1.1); }
              }
            `}</style>
          </defs>

          {/* Outer ring track (+35% thickness = ~7) */}
          <circle cx={CX} cy={CY} r={R_OUTER} fill="none" stroke="rgba(255,255,255,0.025)" strokeWidth="7" />
          {tensionAngle > 0 && (
            <path d={describeArc(CX, CY, R_OUTER, -135, -135 + tensionAngle)} fill="none"
              stroke={color} strokeWidth="7" strokeLinecap="round"
              style={{ opacity: 0.4, transition: "d 600ms ease, stroke 500ms ease" }} />
          )}

          {/* Inner ring (+20% = ~11) */}
          <circle cx={CX} cy={CY} r={R_INNER} fill="none" stroke="rgba(255,255,255,0.025)" strokeWidth="11" />
          {innerAngle > 0 && (
            <path d={describeArc(CX, CY, R_INNER, -135, -135 + innerAngle)} fill="none"
              stroke={color} strokeWidth="11" strokeLinecap="round"
              style={{ opacity: innerOpacity, transition: "d 600ms ease, stroke 500ms ease, opacity 400ms ease" }} />
          )}

          {/* Trigger ticks ring */}
          <circle cx={CX} cy={CY} r={R_TRIGGER} fill="none" stroke="rgba(255,255,255,0.015)" strokeWidth="2" />
          {triggerTicks.map((tick, i) => {
            const rad = ((tick.angle - 90) * Math.PI) / 180;
            const r1 = R_TRIGGER - 6, r2 = R_TRIGGER + 6;
            return (
              <line key={i}
                x1={CX + r1 * Math.cos(rad)} y1={CY + r1 * Math.sin(rad)}
                x2={CX + r2 * Math.cos(rad)} y2={CY + r2 * Math.sin(rad)}
                stroke={color} strokeWidth={1} strokeLinecap="round"
                style={{ opacity: globalState === "IMMINENT" ? 0.7 : 0.35 }} />
            );
          })}

          {/* Micro-pulse on ring toward hovered ray */}
          {hoveredIdx !== null && signals[hoveredIdx] && (() => {
            const hAngleDeg = (hoveredIdx * (360 / 7)) - 90;
            const spread = 14;
            const hColor = stateColor(signals[hoveredIdx].state);
            return (
              <g>
                {/* Wide glow arc */}
                <path
                  d={describeArc(CX, CY, R_OUTER, hAngleDeg - spread, hAngleDeg + spread)}
                  fill="none" stroke={hColor} strokeWidth="14" strokeLinecap="round"
                  style={{ opacity: 0.12, filter: `blur(4px)` }}
                />
                {/* Bright core arc */}
                <path
                  d={describeArc(CX, CY, R_OUTER, hAngleDeg - spread * 0.5, hAngleDeg + spread * 0.5)}
                  fill="none" stroke={hColor} strokeWidth="9" strokeLinecap="round"
                  style={{ opacity: 0.5, transition: "opacity 200ms ease" }}
                />
                {/* Breathing pulse arc */}
                <path
                  d={describeArc(CX, CY, R_OUTER, hAngleDeg - spread, hAngleDeg + spread)}
                  fill="none" stroke={hColor} strokeWidth="10" strokeLinecap="round"
                  style={{ opacity: 0.25, animation: "ring-pulse 2s ease-in-out infinite" }}
                />
              </g>
            );
          })()}

          {/* Sacred Rays */}
          <SacredRays signals={signals} cx={CX} cy={CY} outerR={R_OUTER}
            hoveredIdx={hoveredIdx} setHoveredIdx={setHoveredIdx} onClickRay={handleClickRay} />

          {/* Tooltip */}
          {hoveredIdx !== null && signals[hoveredIdx] && (
            <RayTooltip signal={signals[hoveredIdx]} cx={CX} cy={CY} outerR={R_OUTER} index={hoveredIdx} svgSize={SVG_SIZE} />
          )}
        </svg>

        {/* Center text */}
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          {/* T-minus */}
          <span className="font-mono font-light leading-none" style={{
            fontSize: isMobile ? 48 : 104, color, transition: "color 500ms ease", letterSpacing: "0.05em",
          }}>
            {formatTMinus(globalTMinus)}
          </span>

          {/* State */}
          <span className="font-mono tracking-[0.5em] mt-2 sm:mt-3" style={{
            fontSize: isMobile ? 11 : 18, color, opacity: 0.85, transition: "color 500ms ease",
          }}>
            {stateLabel}
          </span>

          {/* PSI GLOBAL */}
          <span className="font-mono mt-3 sm:mt-6 tracking-[0.2em]" style={{ color: "rgba(255,255,255,0.2)", fontSize: isMobile ? 9 : 11 }}>
            {t("gauge.global")}
          </span>

          {/* PSI value */}
          <span className="font-mono mt-1 tracking-[0.15em]" style={{ color: "rgba(255,255,255,0.35)", fontSize: isMobile ? 12 : 14, fontWeight: 600 }}>
            {globalPsi}
          </span>
        </div>
      </div>

      {/* Subnet Panel */}
      <SubnetPanel signal={panelSignal} open={!!panelSignal} onClose={() => setPanelSignal(null)} />
    </div>
  );
}
