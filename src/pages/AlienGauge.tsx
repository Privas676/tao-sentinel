import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { useI18n } from "@/lib/i18n";
import {
  SubnetSignal, RawSignal, GaugeState, GaugePhase, Asymmetry,
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
    <polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
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
/*       TIME RING (scale ring)            */
/* ═══════════════════════════════════════ */
const TIME_SCALE_MAX_MIN = 480; // 8h max
const TIME_GRADUATIONS = [
  { min: 0, label: "0m" },
  { min: 30, label: "30m" },
  { min: 60, label: "1h" },
  { min: 120, label: "2h" },
  { min: 240, label: "4h" },
  { min: 480, label: "8h" },
];

function TimeRing({ cx, cy, outerR, isMobile }: {
  cx: number; cy: number; outerR: number; isMobile: boolean;
}) {
  const gap = 35;
  const maxLen = isMobile ? 85 : 180;
  const ringR = outerR + gap; // ring at start of rays
  const [hovered, setHovered] = useState(false);

  return (
    <g style={{ pointerEvents: "none" }}>
      {/* Subtle scale ring */}
      <circle cx={cx} cy={cy} r={ringR} fill="none"
        stroke="rgba(255,255,255,0.04)" strokeWidth="1" strokeDasharray="4 6" />

      {/* Graduation ticks + labels */}
      {TIME_GRADUATIONS.map((grad) => {
        const fraction = grad.min / TIME_SCALE_MAX_MIN;
        const tickR = ringR + fraction * maxLen;
        const tickLen = isMobile ? 4 : 6;
        const labelSize = isMobile ? 7 : 9;

        // Draw ticks at 12 o'clock position (top) and label
        const tickAngle = -Math.PI / 2; // 12 o'clock
        const tx1 = cx + tickR * Math.cos(tickAngle);
        const ty1 = cy + tickR * Math.sin(tickAngle) - tickLen;
        const tx2 = cx + tickR * Math.cos(tickAngle);
        const ty2 = cy + tickR * Math.sin(tickAngle) + tickLen;

        // Also draw a subtle concentric arc for major graduations
        const showArc = grad.min === 60 || grad.min === 240 || grad.min === 480;

        return (
          <g key={grad.min}>
            {/* Concentric scale arcs for key graduations */}
            {showArc && (
              <circle cx={cx} cy={cy} r={tickR} fill="none"
                stroke="rgba(255,255,255,0.02)" strokeWidth="0.5" strokeDasharray="2 8" />
            )}
            {/* Tick mark at 12 o'clock */}
            <line x1={tx1} y1={ty1} x2={tx2} y2={ty2}
              stroke="rgba(255,255,255,0.15)" strokeWidth={grad.min === 0 ? 1.5 : 0.8} />
            {/* Label */}
            <text x={tx2 + (isMobile ? 6 : 8)} y={ty2 + 1}
              fill="rgba(255,255,255,0.2)" fontSize={labelSize}
              fontFamily="'JetBrains Mono', monospace" letterSpacing="0.05em"
              textAnchor="start" dominantBaseline="middle"
              style={{ pointerEvents: "none" }}>
              {grad.label}
            </text>
          </g>
        );
      })}

      {/* Hover zone for "ÉCHELLE T-MINUS" label */}
      <circle cx={cx} cy={cy} r={ringR} fill="transparent"
        strokeWidth={maxLen} stroke="transparent"
        style={{ pointerEvents: "stroke", cursor: "default" }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)} />
      {hovered && (
        <text x={cx} y={cy - outerR - (isMobile ? 10 : 20)}
          fill="rgba(255,255,255,0.3)" fontSize={isMobile ? 8 : 10}
          fontFamily="'JetBrains Mono', monospace" letterSpacing="0.2em"
          textAnchor="middle" dominantBaseline="auto">
          ÉCHELLE T-MINUS
        </text>
      )}
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
  const angleStep = 360 / Math.max(signals.length, 1);
  const gap = 35;
  const [tremble, setTremble] = useState(0);
  const [rayBreathe, setRayBreathe] = useState(0);

  useEffect(() => {
    let raf: number;
    const start = performance.now();
    const tick = (now: number) => {
      const elapsed = now - start;
      setTremble(Math.sin(elapsed / 80) * 2);
      setRayBreathe(Math.sin(elapsed / 1200) * 0.5 + 0.5);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  if (!signals.length) return null;

  const isMobileSize = outerR <= 250;
  const maxLen = isMobileSize ? 85 : 180;
  const minLen = isMobileSize ? 12 : 20;

  // ── Priority detection: subnet with shortest T-minus ──
  const priorityIdx = signals.reduce((best, s, i) =>
    s.t_minus_minutes < signals[best].t_minus_minutes ? i : best, 0);

  return (
    <>
      {/* Gradient defs for each ray */}
      <defs>
        {signals.map((s, i) => {
          const angleDeg = (i * angleStep) - 90;
          const angle = angleDeg * (Math.PI / 180);
          const cos = Math.cos(angle), sin = Math.sin(angle);
          const baseColor = rayColor(s.state, 0.35);
          const tipColor = rayColor(s.state, 1.0);
          return (
            <linearGradient key={`ray-grad-${s.netuid}`} id={`ray-grad-${s.netuid}`}
              x1={String(0.5 - cos * 0.5)} y1={String(0.5 - sin * 0.5)}
              x2={String(0.5 + cos * 0.5)} y2={String(0.5 + sin * 0.5)}>
              <stop offset="0%" stopColor={baseColor} />
              <stop offset="100%" stopColor={tipColor} />
            </linearGradient>
          );
        })}
        {/* Priority pulse animation */}
        <style>{`
          @keyframes priority-pulse {
            0%, 100% { opacity: 0.25; }
            50% { opacity: 0.55; }
          }
        `}</style>
      </defs>

      {signals.map((s, i) => {
        const angleDeg = (i * angleStep) - 90;
        const angle = angleDeg * (Math.PI / 180);
        const r1 = outerR + gap;

        const tMinusClamped = clamp(s.t_minus_minutes, 0, TIME_SCALE_MAX_MIN);
        const tFraction = 1 - (tMinusClamped / TIME_SCALE_MAX_MIN);
        const len = minLen + tFraction * (maxLen - minLen);
        const isOverflow = s.t_minus_minutes > TIME_SCALE_MAX_MIN;

        const isImm = s.state === "IMMINENT";
        const trembleOffset = isImm ? tremble : 0;
        const breatheLen = len * (1 + rayBreathe * 0.04);
        const r2 = r1 + breatheLen + trembleOffset;

        const baseThickness = isMobileSize ? 2.5 : 3.5;
        const maxThickness = isMobileSize ? 8 : 12;
        const thickness = baseThickness + (s.confidence / 100) * (maxThickness - baseThickness);

        const x1 = cx + r1 * Math.cos(angle);
        const y1 = cy + r1 * Math.sin(angle);
        const x2 = cx + r2 * Math.cos(angle);
        const y2 = cy + r2 * Math.sin(angle);
        const isHovered = hoveredIdx === i;
        const isPriority = i === priorityIdx;

        // ── Dynamic halo intensity based on T-minus ──
        const haloOpacity = s.t_minus_minutes < 60 ? 0.35 :
                            s.t_minus_minutes < 240 ? 0.18 : 0.06;

        // Label positioning
        const labelOffset = isMobileSize ? 20 : 18;
        const labelR = r2 + labelOffset;
        const lx = cx + labelR * Math.cos(angle);
        const ly = cy + labelR * Math.sin(angle);
        const normalizedAngle = ((angleDeg % 360) + 360) % 360;
        const isHorizontalRay = isMobileSize && (
          (normalizedAngle > 140 && normalizedAngle < 220) ||
          (normalizedAngle > 310 || normalizedAngle < 50)
        );
        const showLabel = !isHorizontalRay;
        const labelAnchor = angleDeg > -45 && angleDeg < 135 ? "start" : "end";
        const labelText = `SN${s.netuid}${isOverflow ? "+" : ""}`;
        const tMinusText = formatTMinus(s.t_minus_minutes);
        const labelFontSize = isMobileSize ? 13 : 15;
        const tMinusFontSize = isMobileSize ? 11 : 13;

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
            <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="transparent" strokeWidth={28}
              style={{ cursor: "pointer" }}
              onMouseEnter={() => setHoveredIdx(i)}
              onMouseLeave={() => setHoveredIdx(null)}
              onClick={() => onClickRay(s)}
            />
            {/* Dynamic halo behind ray */}
            <line x1={x1} y1={y1} x2={x2} y2={y2}
              stroke={rayColor(s.state, haloOpacity)}
              strokeWidth={thickness + (isPriority ? 16 : 10)} strokeLinecap="round"
              style={{
                opacity: isPriority ? 1 : 0.6,
                filter: `blur(${isPriority ? 6 : 4}px)`,
                animation: isPriority ? "priority-pulse 2.5s ease-in-out infinite" : "none",
                pointerEvents: "none",
              }}
            />
            {/* Ray body — gradient from dark base to bright tip */}
            <line x1={x1} y1={y1} x2={x2} y2={y2}
              stroke={`url(#ray-grad-${s.netuid})`} strokeWidth={thickness} strokeLinecap="round"
              style={{
                opacity: isHovered ? 1 : (isPriority ? 0.9 : 0.75),
                filter: isHovered ? `drop-shadow(0 0 10px ${rayColor(s.state, 0.5)})` :
                        isPriority ? `drop-shadow(0 0 6px ${rayColor(s.state, 0.3)})` : "none",
                transition: "opacity 200ms, filter 300ms",
                pointerEvents: "none",
              }}
            />
            {/* Hover glow */}
            {isHovered && (
              <line x1={x1} y1={y1} x2={x2} y2={y2}
                stroke={rayColor(s.state, 0.3)} strokeWidth={thickness + 10} strokeLinecap="round"
                style={{ opacity: 0.4, animation: "ray-breathe 1.8s ease-in-out infinite", pointerEvents: "none" }}
              />
            )}
            {/* Labels: horizontal text with dark halo */}
            {showLabel && (
              <>
                {/* "PRIORITÉ" label above priority ray */}
                {isPriority && (
                  <>
                    <rect
                      x={labelAnchor === "start" ? lx - 3 : lx - (isMobileSize ? 65 : 85)}
                      y={ly - (isMobileSize ? 28 : 34)}
                      width={isMobileSize ? 68 : 88} height={isMobileSize ? 13 : 15}
                      rx={3} fill="rgba(229,57,53,0.15)"
                      style={{ pointerEvents: "none" }}
                    />
                    <text x={lx} y={ly - (isMobileSize ? 18 : 22)} textAnchor={labelAnchor}
                      fill="rgba(229,57,53,0.7)" fontSize={isMobileSize ? 7 : 9} fontWeight="700"
                      fontFamily="'JetBrains Mono', monospace" letterSpacing="0.15em"
                      style={{ pointerEvents: "none", animation: "priority-pulse 2.5s ease-in-out infinite" }}>
                      PRIORITÉ
                    </text>
                  </>
                )}
                {/* Dark halo behind text */}
                <rect
                  x={labelAnchor === "start" ? lx - 3 : lx - (isMobileSize ? 65 : 85)}
                  y={ly - (isMobileSize ? 14 : 18)}
                  width={isMobileSize ? 68 : 88} height={isMobileSize ? 28 : 35}
                  rx={4} fill="rgba(0,0,0,0.6)"
                  style={{ pointerEvents: "none" }}
                />
                <text x={lx} y={ly - (isMobileSize ? 3 : 4)} textAnchor={labelAnchor}
                  fill="rgba(255,255,255,0.85)" fontSize={labelFontSize} fontWeight="700"
                  fontFamily="'JetBrains Mono', monospace" letterSpacing="0.04em"
                  style={{ pointerEvents: "none" }}>
                  {labelText}
                </text>
                <text x={lx} y={ly + (isMobileSize ? 9 : 13)} textAnchor={labelAnchor}
                  fill={stateColor(s.state)} fontSize={tMinusFontSize} fontWeight="600"
                  fontFamily="'JetBrains Mono', monospace" letterSpacing="0.06em"
                  style={{ pointerEvents: "none" }}>
                  {tMinusText}
                </text>
              </>
            )}
            <RaySparkline data={s.sparkline_7d} x1={x1} y1={y1} x2={x2} y2={y2} state={s.state} />
            {tractionPts && (
              <path
                d={`M ${tractionPts.p1.x} ${tractionPts.p1.y} Q ${tractionPts.p2.x} ${tractionPts.p2.y} ${tractionPts.p3.x} ${tractionPts.p3.y}`}
                fill="none" stroke={rayColor(s.state, 0.3)} strokeWidth="1.5"
                style={{ pointerEvents: "none" }}
              />
            )}
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
function RayTooltip({ signal, cx, cy, outerR, index, svgSize, total }: {
  signal: SubnetSignal; cx: number; cy: number; outerR: number; index: number; svgSize: number; total: number;
}) {
  const { t } = useI18n();
  const angleStep = 360 / Math.max(total, 1);
  const angleDeg = (index * angleStep) - 90;
  const angle = angleDeg * (Math.PI / 180);

  // Tooltip dimensions — BIGGER
  const TW = 340, TH = 190, PAD = 18, BR = 12;

  const gap = 28;
  const imminenceFactor = clamp(1 - (signal.t_minus_minutes / 240), 0, 1);
  const rayLen = 30 + imminenceFactor * 130;
  const rayTipR = outerR + gap + rayLen;
  const tipX = cx + rayTipR * Math.cos(angle);
  const tipY = cy + rayTipR * Math.sin(angle);

  const tooltipR = rayTipR + 50;
  let tx = cx + tooltipR * Math.cos(angle) - TW / 2;
  let ty = cy + tooltipR * Math.sin(angle) - TH / 2;

   // Viewport bounds in SVG coordinates — allow overflow since SVG has overflow:visible
   const margin = 12;
   const viewMin = -margin;
   const viewMax = svgSize - TW + margin;
   const viewMinY = -margin;
   const viewMaxY = svgSize - TH + margin;
   tx = Math.max(viewMin, Math.min(viewMax, tx));
   ty = Math.max(viewMinY, Math.min(viewMaxY, ty));

   // STRICT: never overlap the sacred HUD center (timer + PRESSION/CONFIANCE)
   // All values in SVG coordinate space.
   const svgPerPx = svgSize / 800; // 1.5 on desktop
   const sacredHalfW = 250 * svgPerPx;  // covers PRESSION to CONFIANCE width
   const sacredTop = 150 * svgPerPx;    // covers timer area
   const sacredBottom = 210 * svgPerPx; // covers CONFIANCE + margin

   const doesOverlap = (ttx: number, tty: number) => {
     const tRight = ttx + TW, tBottom = tty + TH;
     return tRight > (cx - sacredHalfW) && ttx < (cx + sacredHalfW) &&
            tBottom > (cy - sacredTop) && tty < (cy + sacredBottom);
   };

   if (doesOverlap(tx, ty)) {
     const cosA = Math.cos(angle);
     const sinA = Math.sin(angle);
     
     // For lateral rays (pointing mostly left/right), push tooltip outward horizontally
     if (Math.abs(cosA) > 0.5) {
       tx = cosA > 0
         ? (cx + sacredHalfW + 20)           // push right of sacred zone
         : (cx - sacredHalfW - TW - 20);     // push left of sacred zone
       // Keep vertical position near the ray tip
       ty = cy + tooltipR * sinA - TH / 2;
     } else {
       // For vertical rays, push above or below
       const goBelow = sinA >= 0;
       ty = goBelow ? (cy + sacredBottom + 15) : (cy - sacredTop - TH - 15);
     }
   }

   // Final clamp
   tx = Math.max(viewMin, Math.min(viewMax, tx));
   ty = Math.max(viewMinY, Math.min(viewMaxY, ty));

  const tooltipCx = tx + TW / 2;
  const tooltipCy = ty + TH / 2;

  const displayName = signal.name.startsWith("SN-") ? signal.name : `SN-${signal.netuid} · ${signal.name}`;
  const color = stateColor(signal.state);
  const stateLabel = t(`state.${signal.state.toLowerCase()}` as any);
  const phaseLabel = signal.phase !== "NONE" ? t(`phase.${signal.phase.toLowerCase()}` as any) : "—";
  const asymLabel = t(`asym.${signal.asymmetry.toLowerCase()}` as any);

  const sparkData = signal.sparkline_7d;
  const sparkW = TW - PAD * 2 - 4;
  const sparkH = 36;

  return (
    <g style={{ pointerEvents: "none" }}>
      <line
        x1={tipX} y1={tipY}
        x2={tooltipCx} y2={tooltipCy}
        stroke="rgba(255,255,255,0.08)"
        strokeWidth="1"
        strokeDasharray="4,4"
      />

      <rect
        x={tx} y={ty} width={TW} height={TH} rx={BR}
        fill="#0E0F12"
        stroke="#2A2F36"
        strokeWidth={1}
        filter="url(#tooltip-shadow)"
      />

      <defs>
        <filter id="tooltip-shadow" x="-10%" y="-10%" width="130%" height="130%">
          <feDropShadow dx="0" dy="4" stdDeviation="10" floodColor="rgba(0,0,0,0.6)" floodOpacity="0.5" />
        </filter>
      </defs>

      {/* Name */}
      <text
        x={tx + PAD} y={ty + PAD + 16}
        fill="rgba(255,255,255,0.92)"
        fontSize="16" fontWeight="600"
        fontFamily="'JetBrains Mono', monospace"
        letterSpacing="0.02em"
      >
        {displayName.length > 28 ? displayName.slice(0, 26) + "…" : displayName}
      </text>

      {/* State badge */}
      <rect
        x={tx + PAD} y={ty + PAD + 26}
        width={stateLabel.length * 10 + 18} height={24} rx={5}
        fill={color} fillOpacity={0.14}
        stroke={color} strokeOpacity={0.3} strokeWidth={0.5}
      />
      <text
        x={tx + PAD + 9} y={ty + PAD + 43}
        fill={color}
        fontSize="13" fontWeight="500"
        fontFamily="'JetBrains Mono', monospace"
        letterSpacing="0.08em"
      >
        {stateLabel}
      </text>
      <text
        x={tx + PAD + stateLabel.length * 10 + 32} y={ty + PAD + 43}
        fill="rgba(255,255,255,0.4)"
        fontSize="12"
        fontFamily="'JetBrains Mono', monospace"
        letterSpacing="0.04em"
      >
        {phaseLabel}
      </text>

      {/* T-minus */}
      <text
        x={tx + PAD} y={ty + PAD + 72}
        fill={color}
        fontSize="18" fontWeight="600"
        fontFamily="'JetBrains Mono', monospace"
        letterSpacing="0.04em"
      >
        {formatTMinus(signal.t_minus_minutes)}
      </text>
      <text
        x={tx + TW - PAD} y={ty + PAD + 72}
        textAnchor="end"
        fill="rgba(255,255,255,0.55)"
        fontSize="13"
        fontFamily="'JetBrains Mono', monospace"
      >
        PSI {signal.psi} · {signal.confidence}%
      </text>

      {/* Asymmetry */}
      <text
        x={tx + PAD} y={ty + PAD + 92}
        fill="rgba(255,255,255,0.28)"
        fontSize="12"
        fontFamily="'JetBrains Mono', monospace"
        letterSpacing="0.06em"
      >
        {t("tip.asym")}: {asymLabel}
      </text>

      {/* Sparkline 7d */}
      <line
        x1={tx + PAD} y1={ty + PAD + 102}
        x2={tx + TW - PAD} y2={ty + PAD + 102}
        stroke="rgba(255,255,255,0.06)" strokeWidth="0.5"
      />
      {sparkData.length >= 2 && (
        <g transform={`translate(${tx + PAD + 2}, ${ty + PAD + 110})`}>
          <svg width={sparkW} height={sparkH} viewBox={`0 0 ${sparkW} ${sparkH}`}>
            <TooltipSparkline data={sparkData} width={sparkW} height={sparkH - 2} color={color} />
          </svg>
        </g>
      )}
      <text
        x={tx + TW - PAD} y={ty + TH - 10}
        textAnchor="end"
        fill="rgba(255,255,255,0.2)"
        fontSize="10"
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
          <div className="text-center">
            <div className="font-mono text-2xl tracking-wider" style={{ color }}>
              SN-{signal.netuid}
            </div>
            <div className="font-mono text-sm text-white/50 mt-1">{signal.name}</div>
          </div>

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

          <div className="flex justify-between font-mono text-xs px-2">
            <span className="text-white/40">{t("sub.phase")}: <span style={{ color }}>{phaseLabel}</span></span>
            <span className="text-white/40">{t("sub.state")}: <span style={{ color }}>{t(`state.${signal.state.toLowerCase()}` as any)}</span></span>
          </div>

          {signal.sparkline_7d.length > 1 && (
            <div className="bg-white/[0.02] rounded-lg p-4">
              <div className="font-mono text-[9px] text-white/25 tracking-widest mb-2">{t("tip.price7d")}</div>
              <svg width="100%" height="60" viewBox="0 0 300 60" preserveAspectRatio="none">
                <TooltipSparkline data={signal.sparkline_7d} width={300} height={55} color={color} />
              </svg>
            </div>
          )}

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

  /* ─── demo mode ─── */
  const [demoMode, setDemoMode] = useState(false);

  const demoSignals: SubnetSignal[] = useMemo(() => [
    { netuid: 1, name: "Alpha (Top)", psi: 72, t_minus_minutes: 45, confidence: 85, state: "IMMINENT" as GaugeState, phase: "TRIGGER" as GaugePhase, asymmetry: "HIGH" as Asymmetry, sparkline_7d: [10,15,12,18,22,20,25], liquidity: 1200, momentum: 0.8 },
    { netuid: 2, name: "Beta (Top-Right)", psi: 55, t_minus_minutes: 120, confidence: 65, state: "ALERT" as GaugeState, phase: "ARMED" as GaugePhase, asymmetry: "MED" as Asymmetry, sparkline_7d: [5,8,6,9,11,10,12], liquidity: 800, momentum: 0.5 },
    { netuid: 3, name: "Gamma (Right)", psi: 60, t_minus_minutes: 90, confidence: 70, state: "ALERT" as GaugeState, phase: "ARMED" as GaugePhase, asymmetry: "HIGH" as Asymmetry, sparkline_7d: [20,18,22,25,23,28,30], liquidity: 2000, momentum: 0.65 },
    { netuid: 4, name: "Delta (Bottom-Right)", psi: 45, t_minus_minutes: 180, confidence: 55, state: "ALERT" as GaugeState, phase: "BUILD" as GaugePhase, asymmetry: "LOW" as Asymmetry, sparkline_7d: [3,4,3,5,4,6,5], liquidity: 500, momentum: 0.3 },
    { netuid: 5, name: "Epsilon (Bottom)", psi: 88, t_minus_minutes: 15, confidence: 92, state: "IMMINENT" as GaugeState, phase: "TRIGGER" as GaugePhase, asymmetry: "HIGH" as Asymmetry, sparkline_7d: [30,35,40,38,45,50,55], liquidity: 3000, momentum: 0.95 },
    { netuid: 6, name: "Zeta (Bottom-Left)", psi: 40, t_minus_minutes: 200, confidence: 50, state: "ALERT" as GaugeState, phase: "BUILD" as GaugePhase, asymmetry: "MED" as Asymmetry, sparkline_7d: [7,6,8,7,9,8,10], liquidity: 600, momentum: 0.25 },
    { netuid: 7, name: "Eta (Left)", psi: 65, t_minus_minutes: 60, confidence: 75, state: "ALERT" as GaugeState, phase: "ARMED" as GaugePhase, asymmetry: "HIGH" as Asymmetry, sparkline_7d: [15,18,16,20,22,21,24], liquidity: 1500, momentum: 0.7 },
    { netuid: 8, name: "Theta (Top-Left)", psi: 50, t_minus_minutes: 150, confidence: 60, state: "ALERT" as GaugeState, phase: "BUILD" as GaugePhase, asymmetry: "MED" as Asymmetry, sparkline_7d: [8,10,9,12,11,14,13], liquidity: 900, momentum: 0.4 },
  ], []);

  /* ─── signals ─── */
  const realSignals = useMemo(() => processSignals(rawSignals ?? [], sparklines ?? {}), [rawSignals, sparklines]);
  const signals = demoMode ? demoSignals : realSignals;
  const realPsi = useMemo(() => computeGlobalPsi(rawSignals ?? []), [rawSignals]);
  const realConf = useMemo(() => computeGlobalConfidence(rawSignals ?? []), [rawSignals]);
  const globalPsi = demoMode ? 62 : realPsi;
  const globalConf = demoMode ? 71 : realConf;
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
  const [stateTransition, setStateTransition] = useState<{ from: GaugeState; to: GaugeState; progress: number } | null>(null);
  const transitionRaf = useRef<number | null>(null);

  useEffect(() => {
    if (prevStateRef.current !== null && prevStateRef.current !== globalState) {
      playClick();
      // Start transition animation
      const from = prevStateRef.current;
      const to = globalState;
      const startTime = performance.now();
      const duration = 1200; // 1.2s transition

      const animate = (now: number) => {
        const elapsed = now - startTime;
        const progress = Math.min(elapsed / duration, 1);
        setStateTransition({ from, to, progress });
        if (progress < 1) {
          transitionRaf.current = requestAnimationFrame(animate);
        } else {
          setStateTransition(null);
        }
      };
      if (transitionRaf.current) cancelAnimationFrame(transitionRaf.current);
      transitionRaf.current = requestAnimationFrame(animate);
    }
    prevStateRef.current = globalState;
    return () => { if (transitionRaf.current) cancelAnimationFrame(transitionRaf.current); };
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

  /* ─── flash (on IMMINENT + on any state change) ─── */
  const [flashActive, setFlashActive] = useState(false);
  useEffect(() => {
    if (prevStateRef.current !== globalState || (globalState === "IMMINENT")) {
      setFlashActive(true);
      const timeout = setTimeout(() => setFlashActive(false), 400);
      return () => clearTimeout(timeout);
    }
  }, [globalState]);

  /* ─── hover + panel ─── */
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const [panelSignal, setPanelSignal] = useState<SubnetSignal | null>(null);

  const handleClickRay = useCallback((s: SubnetSignal) => {
    window.open(`https://taostats.io/subnets/${s.netuid}`, "_blank");
    setPanelSignal(s);
  }, []);

  /* ─── geometry (responsive) — mobile-first breakpoints ─── */
  const isMobile = useIsMobile();
  const isSmall = typeof window !== "undefined" && window.innerWidth <= 768 && window.innerWidth > 420;
  const SIZE = isMobile ? 380 : 800; // +12% on mobile (was 340)
  const SVG_SIZE = isMobile ? 560 : 1200; // scaled up for larger mobile gauge
  const CX = SVG_SIZE / 2, CY = SVG_SIZE / 2;
  const R_OUTER = isMobile ? 155 : 360; // +12% (was 138)
  const R_INNER = isMobile ? 132 : 310; // +12% (was 118)
  const R_TRIGGER = isMobile ? 112 : 268; // +12% (was 100)
  const CENTER_RADIUS = isMobile ? 101 : 240; // sacred center zone — no tooltip allowed

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
    <div className="fixed inset-0 select-none" style={{ background: "#000", overflow: "hidden" }}>
      {/* Vignette */}
      <div className="absolute inset-0 pointer-events-none" style={{
        background: "radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,0.7) 100%)",
      }} />

      {/* Ambient radial halo behind gauge */}
      <div className="absolute inset-0 pointer-events-none flex items-center justify-center" style={{ zIndex: 0 }}>
        <div style={{
          width: isMobile ? 500 : 1100,
          height: isMobile ? 500 : 1100,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${color}0A 0%, ${color}05 35%, transparent 65%)`,
          transition: "background 1.2s ease",
        }} />
      </div>

      {/* State transition flash */}
      {flashActive && (
        <div className="absolute inset-0 pointer-events-none z-50" style={{
          background: `radial-gradient(circle, ${color}40 0%, ${color}15 30%, transparent 65%)`,
          animation: "flash-fade 0.4s ease-out forwards",
        }} />
      )}
      <style>{`
        @keyframes flash-fade {
          0% { opacity: 1; transform: scale(0.95); }
          100% { opacity: 0; transform: scale(1.1); }
        }
      `}</style>

      {/* Phase indicator (top) — large and clear */}
      <div className="absolute top-4 sm:top-10 left-0 right-0 flex flex-col items-center z-10" style={{ paddingLeft: isMobile ? 60 : 0, paddingRight: isMobile ? 60 : 0 }}>
        <span className="font-mono tracking-[0.3em] sm:tracking-[0.5em] uppercase" style={{
          color: "rgba(255,255,255,0.35)",
          fontSize: isMobile ? 11 : 14,
          letterSpacing: isMobile ? "0.3em" : "0.5em",
        }}>
          {t("gauge.phase")}
        </span>
        <span className="font-mono font-bold uppercase mt-1" style={{
          color,
          fontSize: "clamp(18px, 4.2vw, 26px)",
          letterSpacing: isMobile ? "0.15em" : "0.3em",
          transition: "color 800ms ease",
          textShadow: `0 0 30px ${color}20`,
        }}>
          {phaseLabel}
        </span>
      </div>

      {/* Notification permission button */}
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

      {/* Demo mode toggle */}
      <button
        onClick={() => setDemoMode(d => !d)}
        className="absolute bottom-4 right-4 z-20 font-mono text-[9px] tracking-wider px-3 py-1.5 rounded-md transition-all"
        style={{
          background: demoMode ? "rgba(0,255,200,0.12)" : "rgba(255,255,255,0.03)",
          color: demoMode ? "rgba(0,255,200,0.8)" : "rgba(255,255,255,0.25)",
          border: `1px solid ${demoMode ? "rgba(0,255,200,0.3)" : "rgba(255,255,255,0.06)"}`,
        }}
      >
        {demoMode ? "⬤ DEMO ON" : "◯ DEMO"}
      </button>


      {/* GAUGE — arcs are purely decorative, center HUD is an independent layer */}
      <div className="absolute z-10" style={{
        width: isMobile ? "min(92vw, 520px)" : SIZE,
        height: isMobile ? "min(92vw, 520px)" : SIZE,
        aspectRatio: "1 / 1",
        top: "50%", left: "50%", transform: "translate(-50%, -50%)",
        margin: "auto",
      }}>
        {showHalo && (
          <div className="absolute inset-0 rounded-full pointer-events-none" style={{
            background: `radial-gradient(circle, rgba(100,180,255,0.06) 0%, transparent 70%)`,
            transform: "scale(1.4)",
          }} />
        )}

        {(globalState === "IMMINENT" || globalState === "EXIT") && (
          <div className="absolute inset-0 rounded-full pointer-events-none" style={{
            background: `radial-gradient(circle, ${glow} 0%, transparent 70%)`,
            opacity: globalState === "IMMINENT" ? 0.4 : 0.2,
            transform: "scale(1.35)",
            transition: "opacity 800ms ease",
          }} />
        )}

        <svg width={SIZE} height={SIZE}
          viewBox={`${CX - SVG_SIZE / 2} ${CY - SVG_SIZE / 2} ${SVG_SIZE} ${SVG_SIZE}`}
          style={{ overflow: "visible" }}>

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
              @keyframes phase-pulse {
                0% { opacity: 0.6; transform: scale(1); }
                50% { opacity: 1; transform: scale(1.02); }
                100% { opacity: 0.6; transform: scale(1); }
              }
            `}</style>
          </defs>

          {/* Outer ring track */}
          <circle cx={CX} cy={CY} r={R_OUTER} fill="none" stroke="rgba(255,255,255,0.025)" strokeWidth={isMobile ? 6 : 8} />
          {tensionAngle > 0 && (
            <path d={describeArc(CX, CY, R_OUTER, -135, -135 + tensionAngle)} fill="none"
              stroke={color} strokeWidth={isMobile ? 6 : 8} strokeLinecap="round"
              style={{ opacity: 0.4, transition: "d 600ms ease, stroke 500ms ease" }} />
          )}

          {/* Inner ring */}
          <circle cx={CX} cy={CY} r={R_INNER} fill="none" stroke="rgba(255,255,255,0.025)" strokeWidth={isMobile ? 8 : 12} />
          {innerAngle > 0 && (
            <path d={describeArc(CX, CY, R_INNER, -135, -135 + innerAngle)} fill="none"
              stroke={color} strokeWidth={isMobile ? 8 : 12} strokeLinecap="round"
              style={{ opacity: innerOpacity, transition: "d 600ms ease, stroke 500ms ease, opacity 400ms ease" }} />
          )}

          {/* Trigger ticks ring */}
          <circle cx={CX} cy={CY} r={R_TRIGGER} fill="none" stroke="rgba(255,255,255,0.015)" strokeWidth="2" />
          {triggerTicks.map((tick, i) => {
            const rad = ((tick.angle - 90) * Math.PI) / 180;
            const r1 = R_TRIGGER - 7, r2 = R_TRIGGER + 7;
            return (
              <line key={i}
                x1={CX + r1 * Math.cos(rad)} y1={CY + r1 * Math.sin(rad)}
                x2={CX + r2 * Math.cos(rad)} y2={CY + r2 * Math.sin(rad)}
                stroke={color} strokeWidth={1} strokeLinecap="round"
                style={{ opacity: globalState === "IMMINENT" ? 0.7 : 0.35 }} />
            );
          })}

          {/* State transition sweep */}
          {stateTransition && (() => {
            const toColor = stateColor(stateTransition.to);
            const eased = 1 - Math.pow(1 - stateTransition.progress, 3);
            const sweepAngle = eased * 270;
            const fadeOpacity = stateTransition.progress < 0.7 ? 0.5 : 0.5 * (1 - (stateTransition.progress - 0.7) / 0.3);
            const glowSize = 16 + eased * 8;
            const edgeAngleDeg = -135 + sweepAngle;
            const edgeAngle = (edgeAngleDeg - 90) * Math.PI / 180;
            return (
              <g style={{ pointerEvents: "none" }}>
                <path d={describeArc(CX, CY, R_OUTER, -135, edgeAngleDeg)}
                  fill="none" stroke={toColor} strokeWidth={glowSize} strokeLinecap="round"
                  style={{ opacity: fadeOpacity * 0.6, filter: "blur(6px)" }} />
                <path d={describeArc(CX, CY, R_INNER, -135, -135 + sweepAngle * 0.85)}
                  fill="none" stroke={toColor} strokeWidth={glowSize * 0.8} strokeLinecap="round"
                  style={{ opacity: fadeOpacity * 0.4, filter: "blur(4px)" }} />
                <path d={describeArc(CX, CY, R_TRIGGER, -135, -135 + sweepAngle * 0.7)}
                  fill="none" stroke={toColor} strokeWidth={glowSize * 0.5} strokeLinecap="round"
                  style={{ opacity: fadeOpacity * 0.3, filter: "blur(3px)" }} />
                {sweepAngle < 268 && (
                  <circle cx={CX + R_OUTER * Math.cos(edgeAngle)} cy={CY + R_OUTER * Math.sin(edgeAngle)}
                    r={4 + eased * 3} fill={toColor}
                    style={{ opacity: fadeOpacity, filter: "blur(2px)" }} />
                )}
              </g>
            );
          })()}

          {/* Micro-pulse on ring toward hovered ray */}
          {hoveredIdx !== null && signals[hoveredIdx] && (() => {
            const hAngleDeg = (hoveredIdx * (360 / Math.max(signals.length, 1))) - 90;
            const spread = 14;
            const hColor = stateColor(signals[hoveredIdx].state);
            return (
              <g>
                <path
                  d={describeArc(CX, CY, R_OUTER, hAngleDeg - spread, hAngleDeg + spread)}
                  fill="none" stroke={hColor} strokeWidth="14" strokeLinecap="round"
                  style={{ opacity: 0.12, filter: `blur(4px)` }}
                />
                <path
                  d={describeArc(CX, CY, R_OUTER, hAngleDeg - spread * 0.5, hAngleDeg + spread * 0.5)}
                  fill="none" stroke={hColor} strokeWidth="9" strokeLinecap="round"
                  style={{ opacity: 0.5, transition: "opacity 200ms ease" }}
                />
                <path
                  d={describeArc(CX, CY, R_OUTER, hAngleDeg - spread, hAngleDeg + spread)}
                  fill="none" stroke={hColor} strokeWidth="10" strokeLinecap="round"
                  style={{ opacity: 0.25, animation: "ring-pulse 2s ease-in-out infinite" }}
                />
              </g>
            );
          })()}

          {/* Time Ring (scale) */}
          <TimeRing cx={CX} cy={CY} outerR={R_OUTER} isMobile={isMobile} />

          {/* Sacred Rays — limit to 5 on mobile */}
          {(() => {
            const displaySignals = isMobile ? signals.slice(0, 5) : signals;
            return (
              <>
                <SacredRays signals={displaySignals} cx={CX} cy={CY} outerR={R_OUTER}
                  hoveredIdx={hoveredIdx} setHoveredIdx={setHoveredIdx} onClickRay={handleClickRay} />
                {hoveredIdx !== null && displaySignals[hoveredIdx] && (
                  <RayTooltip signal={displaySignals[hoveredIdx]} cx={CX} cy={CY} outerR={R_OUTER} index={hoveredIdx} svgSize={SVG_SIZE} total={displaySignals.length} />
                )}
              </>
            );
          })()}
        </svg>
      </div>

      {/* ═══════════════════════════════════════ */}
      {/* CENTER HUD — fully independent layer    */}
      {/* Positioned relative to VIEWPORT, not    */}
      {/* to the gauge div or SVG, ensuring       */}
      {/* perfect mathematical centering.          */}
      {/* ═══════════════════════════════════════ */}
      <div
        className="fixed inset-0 pointer-events-none z-20"
        style={{ display: "grid", placeItems: "center" }}
      >
        <div
          style={{
            maxWidth: isMobile ? "min(65vw, 260px)" : 440,
            width: "100%",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            textAlign: "center",
            animation: "phase-pulse 3s ease-in-out infinite",
            lineHeight: 0.95,
          }}
        >
        {/* Title: FENÊTRE D'OPPORTUNITÉ */}
        <span className="font-mono tracking-[0.35em] uppercase text-center" style={{
          fontSize: isMobile ? 8 : 12,
          color: "rgba(255,255,255,0.3)",
          letterSpacing: isMobile ? "0.2em" : "0.4em",
          lineHeight: 1.2,
        }}>
          {t("gauge.window")}
        </span>

        {/* Timer principal — fluid sizing, never overflows */}
        <span className="font-mono font-bold leading-none mt-1 sm:mt-3" style={{
          fontSize: "clamp(44px, 12vw, 92px)",
          color,
          transition: "color 800ms ease",
          letterSpacing: "0.04em",
          textShadow: `0 0 60px ${color}30, 0 0 120px ${color}12`,
          maxWidth: "100%",
          overflow: "hidden",
          whiteSpace: "nowrap",
        }}>
          {(() => {
            const h = Math.floor(globalTMinus / 60);
            const m = globalTMinus % 60;
            if (h > 0) {
              return <>{h}<span style={{ fontSize: "0.65em" }}>h</span>{String(m).padStart(2, '0')}</>;
            }
            return <>{m}<span style={{ fontSize: "0.65em" }}>m</span></>;
          })()}
        </span>

        {/* Sous-texte — hidden on mobile if too dense */}
        {!isMobile && (
          <span className="font-mono tracking-[0.25em] uppercase mt-1 sm:mt-2 text-center" style={{
            fontSize: 10,
            color: "rgba(255,255,255,0.2)",
          }}>
            {t("gauge.before")}
          </span>
        )}

        {/* State label */}
        <span className="font-mono uppercase" style={{
          fontSize: isMobile ? 12 : 16,
          letterSpacing: isMobile ? "0.3em" : "0.5em",
          marginTop: isMobile ? 6 : 24,
          color,
          opacity: 0.85,
          transition: "color 800ms ease",
        }}>
          {stateLabel}
        </span>

        {/* Metrics row: PSI + Confidence */}
        <div className="flex items-center mt-2 sm:mt-6" style={{ gap: isMobile ? 16 : 40 }}>
          <div className="flex flex-col items-center">
            <span className="font-mono tracking-[0.2em] uppercase" style={{
              color: "rgba(255,255,255,0.22)", fontSize: isMobile ? 8 : 10,
            }}>
              {t("gauge.pressure")}
            </span>
            <span className="font-mono font-bold mt-0.5" style={{
              color: "rgba(255,255,255,0.55)", fontSize: isMobile ? 15 : 22,
            }}>
              {globalPsi}
            </span>
          </div>
          <div style={{ width: 1, height: isMobile ? 20 : 32, background: "rgba(255,255,255,0.08)" }} />
          <div className="flex flex-col items-center">
            <span className="font-mono tracking-[0.2em] uppercase" style={{
              color: "rgba(255,255,255,0.22)", fontSize: isMobile ? 8 : 10,
            }}>
              {t("gauge.confidence")}
            </span>
            <span className="font-mono font-bold mt-0.5" style={{
              color: "rgba(255,255,255,0.55)", fontSize: isMobile ? 15 : 22,
            }}>
              {globalConf}%
            </span>
          </div>
        </div>
      </div>
      </div>

      {/* ═══════════════════════════════════════ */}
      {/* PRIORITY FOOTER LINE                     */}
      {/* ═══════════════════════════════════════ */}
      {signals.length > 0 && (() => {
        const priority = signals.reduce((best, s) =>
          s.t_minus_minutes < best.t_minus_minutes ? s : best, signals[0]);
        return (
          <div className="fixed left-0 right-0 z-20 flex justify-center pointer-events-none"
            style={{ bottom: isMobile ? 50 : 60 }}>
            <div className="font-mono text-center px-4 py-1.5 rounded-md" style={{
              background: "rgba(0,0,0,0.4)",
              border: "1px solid rgba(255,255,255,0.06)",
              fontSize: isMobile ? 10 : 12,
              letterSpacing: "0.12em",
            }}>
              <span style={{ color: "rgba(255,255,255,0.35)" }}>PRIORITÉ ACTUELLE : </span>
              <span style={{ color: stateColor(deriveGaugeState(priority.psi, priority.confidence)), fontWeight: 700 }}>
                SN-{priority.netuid}
              </span>
              <span style={{ color: "rgba(255,255,255,0.5)", marginLeft: 8 }}>
                ({formatTMinus(priority.t_minus_minutes)})
              </span>
            </div>
          </div>
        );
      })()}

      {/* Subnet Panel */}
      <SubnetPanel signal={panelSignal} open={!!panelSignal} onClose={() => setPanelSignal(null)} />
    </div>
  );
}
