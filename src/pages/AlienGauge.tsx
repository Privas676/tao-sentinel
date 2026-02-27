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
} from "@/lib/gauge-engine";
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

/* ═══════════════════════════════════════ */
/*       MINI SPARKLINE                    */
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
    return Array.from({ length: 6 }, (_, i) => {
      const t = 0.2 + Math.random() * 0.6;
      const drift = (Math.random() - 0.5) * 14;
      const size = 1 + Math.random() * 1.5;
      return {
        cx: x1 + ux * len * t + px * drift,
        cy: y1 + uy * len * t + py * drift,
        r: size,
        delay: Math.random() * 3,
        dur: 1.8 + Math.random() * 1.4,
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
/*     TIME RING (graduated scale)         */
/* ═══════════════════════════════════════ */
const TIME_SCALE_MAX_MIN = 480;
const TIME_GRADUATIONS = [
  { min: 0, label: "0" },
  { min: 60, label: "1h" },
  { min: 120, label: "2h" },
  { min: 180, label: "3h" },
];

function TimeRing({ cx, cy, outerR, isMobile }: {
  cx: number; cy: number; outerR: number; isMobile: boolean;
}) {
  const gap = 35;
  const maxLen = isMobile ? 85 : 180;
  const ringR = outerR + gap;

  return (
    <g style={{ pointerEvents: "none" }}>
      <circle cx={cx} cy={cy} r={ringR} fill="none"
        stroke="rgba(255,255,255,0.04)" strokeWidth="1" strokeDasharray="4 6" />
      {TIME_GRADUATIONS.map((grad) => {
        const fraction = grad.min / TIME_SCALE_MAX_MIN;
        const tickR = ringR + fraction * maxLen;
        const tickAngle = -Math.PI / 2;
        const tx = cx + tickR * Math.cos(tickAngle);
        const ty1 = cy + tickR * Math.sin(tickAngle) - (isMobile ? 4 : 6);
        const ty2 = cy + tickR * Math.sin(tickAngle) + (isMobile ? 4 : 6);
        const showArc = grad.min === 60 || grad.min === 180;
        return (
          <g key={grad.min}>
            {showArc && (
              <circle cx={cx} cy={cy} r={tickR} fill="none"
                stroke="rgba(255,255,255,0.02)" strokeWidth="0.5" strokeDasharray="2 8" />
            )}
            <line x1={tx} y1={ty1} x2={tx} y2={ty2}
              stroke="rgba(255,255,255,0.15)" strokeWidth={grad.min === 0 ? 1.5 : 0.8} />
            <text x={tx + (isMobile ? 6 : 8)} y={ty2 + 1}
              fill="rgba(255,255,255,0.2)" fontSize={isMobile ? 7 : 9}
              fontFamily="'JetBrains Mono', monospace"
              textAnchor="start" dominantBaseline="middle">
              {grad.label}
            </text>
          </g>
        );
      })}
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

  const isMobileSize = outerR <= 300;
  const maxLen = isMobileSize ? 85 : 180;
  const minLen = isMobileSize ? 12 : 20;
  const priorityIdx = signals.reduce((best, s, i) =>
    s.t_minus_minutes < signals[best].t_minus_minutes ? i : best, 0);

  return (
    <>
      <defs>
        {signals.map((s, i) => {
          const angleDeg = (i * angleStep) - 90;
          const angle = angleDeg * (Math.PI / 180);
          const cos = Math.cos(angle), sin = Math.sin(angle);
          // Color by dominant: gold for opportunity, dark red for risk
          const baseAlpha = 0.35;
          const tipAlpha = 1.0;
          const isOpp = s.dominant === "opportunity";
          const baseColor = isOpp ? opportunityColor(s.opportunity, baseAlpha) : s.dominant === "risk" ? riskColor(s.risk, baseAlpha) : rayColor(s.state, baseAlpha);
          const tipColor = isOpp ? opportunityColor(s.opportunity, tipAlpha) : s.dominant === "risk" ? riskColor(s.risk, tipAlpha) : rayColor(s.state, tipAlpha);
          return (
            <linearGradient key={`ray-grad-${s.netuid}`} id={`ray-grad-${s.netuid}`}
              x1={String(0.5 - cos * 0.5)} y1={String(0.5 - sin * 0.5)}
              x2={String(0.5 + cos * 0.5)} y2={String(0.5 + sin * 0.5)}>
              <stop offset="0%" stopColor={baseColor} />
              <stop offset="100%" stopColor={tipColor} />
            </linearGradient>
          );
        })}
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

        const haloOpacity = s.t_minus_minutes < 60 ? 0.35 :
                            s.t_minus_minutes < 240 ? 0.18 : 0.06;

        // Ray color for halo
        const isOpp = s.dominant === "opportunity";
        const dominantColor = isOpp ? opportunityColor(s.opportunity) : s.dominant === "risk" ? riskColor(s.risk) : stateColor(s.state);

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
        const labelText = `SN${s.netuid}`;
        const tMinusText = formatTimeClear(s.t_minus_minutes);
        const labelFontSize = isMobileSize ? 13 : 16;
        const tMinusFontSize = isMobileSize ? 11 : 14;

        // Graduated ticks on ray body (3h, 2h, 1h marks)
        const rayTicks = [60, 120, 180].map(min => {
          const tickFraction = 1 - (min / TIME_SCALE_MAX_MIN);
          const tickLen = minLen + tickFraction * (maxLen - minLen);
          const tickR = r1 + tickLen;
          if (tickR > r2) return null;
          const tx = cx + tickR * Math.cos(angle);
          const ty = cy + tickR * Math.sin(angle);
          const perpAngle = angle + Math.PI / 2;
          const tickSize = isMobileSize ? 3 : 5;
          return {
            x1: tx + Math.cos(perpAngle) * tickSize,
            y1: ty + Math.sin(perpAngle) * tickSize,
            x2: tx - Math.cos(perpAngle) * tickSize,
            y2: ty - Math.sin(perpAngle) * tickSize,
          };
        }).filter(Boolean);

        return (
          <g key={s.netuid}>
            {/* Hit area */}
            <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="transparent" strokeWidth={28}
              style={{ cursor: "pointer" }}
              onMouseEnter={() => setHoveredIdx(i)}
              onMouseLeave={() => setHoveredIdx(null)}
              onClick={() => onClickRay(s)}
            />
            {/* Dynamic halo */}
            <line x1={x1} y1={y1} x2={x2} y2={y2}
              stroke={dominantColor}
              strokeWidth={thickness + (isPriority ? 16 : 10)} strokeLinecap="round"
              style={{
                opacity: haloOpacity * (isPriority ? 1.2 : 0.6),
                filter: `blur(${isPriority ? 6 : 4}px)`,
                animation: isPriority ? "priority-pulse 2.5s ease-in-out infinite" : "none",
                pointerEvents: "none",
              }}
            />
            {/* Ray body */}
            <line x1={x1} y1={y1} x2={x2} y2={y2}
              stroke={`url(#ray-grad-${s.netuid})`} strokeWidth={thickness} strokeLinecap="round"
              style={{
                opacity: isHovered ? 1 : (isPriority ? 0.9 : 0.75),
                filter: isHovered ? `drop-shadow(0 0 10px ${dominantColor})` :
                        isPriority ? `drop-shadow(0 0 6px ${dominantColor})` : "none",
                transition: "opacity 200ms, filter 300ms",
                pointerEvents: "none",
              }}
            />
            {/* Graduated ticks on ray */}
            {rayTicks.map((tick, ti) => tick && (
              <line key={ti} x1={tick.x1} y1={tick.y1} x2={tick.x2} y2={tick.y2}
                stroke="rgba(255,255,255,0.12)" strokeWidth="0.8"
                style={{ pointerEvents: "none" }}
              />
            ))}
            {/* Hover glow */}
            {isHovered && (
              <line x1={x1} y1={y1} x2={x2} y2={y2}
                stroke={dominantColor} strokeWidth={thickness + 10} strokeLinecap="round"
                style={{ opacity: 0.3, animation: "ray-breathe 1.8s ease-in-out infinite", pointerEvents: "none" }}
              />
            )}
            {/* Labels */}
            {showLabel && (
              <>
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
                <rect
                  x={labelAnchor === "start" ? lx - 3 : lx - (isMobileSize ? 70 : 95)}
                  y={ly - (isMobileSize ? 14 : 18)}
                  width={isMobileSize ? 73 : 98} height={isMobileSize ? 28 : 38}
                  rx={4} fill="rgba(0,0,0,0.7)"
                  style={{ pointerEvents: "none" }}
                />
                <text x={lx} y={ly - (isMobileSize ? 1 : 2)} textAnchor={labelAnchor}
                  fill="rgba(255,255,255,0.92)" fontSize={labelFontSize} fontWeight="700"
                  fontFamily="'JetBrains Mono', monospace" letterSpacing="0.04em"
                  style={{ pointerEvents: "none" }}>
                  {labelText}
                </text>
                <text x={lx} y={ly + (isMobileSize ? 11 : 16)} textAnchor={labelAnchor}
                  fill={dominantColor} fontSize={tMinusFontSize} fontWeight="600"
                  fontFamily="'JetBrains Mono', monospace" letterSpacing="0.06em"
                  style={{ pointerEvents: "none" }}>
                  {tMinusText}
                </text>
              </>
            )}
            {isImm && (
              <ImminentParticles x1={x1} y1={y1} x2={x2} y2={y2} color={dominantColor} />
            )}
          </g>
        );
      })}
    </>
  );
}

/* ═══════════════════════════════════════ */
/*     PREMIUM TOOLTIP (GRANDE CARTE)      */
/* ═══════════════════════════════════════ */
function RayTooltip({ signal, cx, cy, outerR, index, svgSize, total }: {
  signal: SubnetSignal; cx: number; cy: number; outerR: number; index: number; svgSize: number; total: number;
}) {
  const { t } = useI18n();
  const angleStep = 360 / Math.max(total, 1);
  const angleDeg = (index * angleStep) - 90;
  const angle = angleDeg * (Math.PI / 180);

  const TW = 370, TH = 280, PAD = 20, BR = 14;

  const gap = 28;
  const imminenceFactor = clamp(1 - (signal.t_minus_minutes / 240), 0, 1);
  const rayLen = 30 + imminenceFactor * 130;
  const rayTipR = outerR + gap + rayLen;
  const tipX = cx + rayTipR * Math.cos(angle);
  const tipY = cy + rayTipR * Math.sin(angle);

  const tooltipR = rayTipR + 60;
  let tx = cx + tooltipR * Math.cos(angle) - TW / 2;
  let ty = cy + tooltipR * Math.sin(angle) - TH / 2;

  const margin = 12;
  const viewMax = svgSize - TW + margin;
  const viewMaxY = svgSize - TH + margin;
  tx = Math.max(-margin, Math.min(viewMax, tx));
  ty = Math.max(-margin, Math.min(viewMaxY, ty));

  // Sacred HUD protection
  const svgPerPx = svgSize / 800;
  const sacredHalfW = 250 * svgPerPx;
  const sacredTop = 150 * svgPerPx;
  const sacredBottom = 210 * svgPerPx;

  const doesOverlap = (ttx: number, tty: number) => {
    const tRight = ttx + TW, tBottom = tty + TH;
    return tRight > (cx - sacredHalfW) && ttx < (cx + sacredHalfW) &&
           tBottom > (cy - sacredTop) && tty < (cy + sacredBottom);
  };

  if (doesOverlap(tx, ty)) {
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);
    if (Math.abs(cosA) > 0.5) {
      tx = cosA > 0 ? (cx + sacredHalfW + 20) : (cx - sacredHalfW - TW - 20);
      ty = cy + tooltipR * sinA - TH / 2;
    } else {
      ty = sinA >= 0 ? (cy + sacredBottom + 15) : (cy - sacredTop - TH - 15);
    }
  }
  tx = Math.max(-margin, Math.min(viewMax, tx));
  ty = Math.max(-margin, Math.min(viewMaxY, ty));

  const tooltipCx = tx + TW / 2;
  const tooltipCy = ty + TH / 2;

  const displayName = `SN-${signal.netuid} · ${signal.name.startsWith("SN-") ? signal.name.slice(signal.name.indexOf(" ") + 1) : signal.name}`;
  const oppColor = opportunityColor(signal.opportunity);
  const rskColor = riskColor(signal.risk);
  const phaseLabel = signal.phase !== "NONE" ? t(`phase.${signal.phase.toLowerCase()}` as any) : "—";

  // Tags
  const tags: string[] = [];
  if (signal.opportunity >= 70) tags.push(t("tag.momentum"));
  if (signal.confidence >= 70) tags.push(t("tag.consensus"));
  if (signal.risk >= 60) tags.push(t("tag.high_risk"));
  if (signal.asymmetry === "HIGH" && signal.opportunity > signal.risk) tags.push(t("tag.low_cap"));

  const sparkData = signal.sparkline_7d;
  const sparkW = TW - PAD * 2 - 4;
  const sparkH = 32;

  return (
    <g style={{ pointerEvents: "none" }}>
      {/* Connector line */}
      <line x1={tipX} y1={tipY} x2={tooltipCx} y2={tooltipCy}
        stroke="rgba(255,255,255,0.08)" strokeWidth="1" strokeDasharray="4,4" />

      <defs>
        <filter id="tooltip-shadow" x="-10%" y="-10%" width="130%" height="130%">
          <feDropShadow dx="0" dy="4" stdDeviation="12" floodColor="rgba(0,0,0,0.7)" floodOpacity="0.6" />
        </filter>
      </defs>

      {/* Card background */}
      <rect x={tx} y={ty} width={TW} height={TH} rx={BR}
        fill="#0A0B10" stroke="#2A2F36" strokeWidth={1} filter="url(#tooltip-shadow)" />

      {/* Title */}
      <text x={tx + PAD} y={ty + PAD + 16}
        fill="rgba(255,255,255,0.95)" fontSize="17" fontWeight="700"
        fontFamily="'JetBrains Mono', monospace" letterSpacing="0.02em">
        {displayName.length > 26 ? displayName.slice(0, 24) + "…" : displayName}
      </text>

      {/* Phase badge + tags */}
      <rect x={tx + PAD} y={ty + PAD + 26} width={phaseLabel.length * 9 + 16} height={22} rx={5}
        fill={stateColor(signal.state)} fillOpacity={0.14} stroke={stateColor(signal.state)} strokeOpacity={0.3} strokeWidth={0.5} />
      <text x={tx + PAD + 8} y={ty + PAD + 42}
        fill={stateColor(signal.state)} fontSize="12" fontWeight="600"
        fontFamily="'JetBrains Mono', monospace" letterSpacing="0.08em">
        {phaseLabel}
      </text>

      {/* Tags */}
      {tags.slice(0, 3).map((tag, ti) => {
        const tagX = tx + PAD + phaseLabel.length * 9 + 26 + ti * 85;
        return tagX + 75 < tx + TW ? (
          <g key={ti}>
            <rect x={tagX} y={ty + PAD + 26} width={tag.length * 7 + 12} height={22} rx={4}
              fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.08)" strokeWidth={0.5} />
            <text x={tagX + 6} y={ty + PAD + 41} fill="rgba(255,255,255,0.5)" fontSize="10"
              fontFamily="'JetBrains Mono', monospace">{tag}</text>
          </g>
        ) : null;
      })}

      {/* Opportunity + Risk scores — large and clear */}
      <text x={tx + PAD} y={ty + PAD + 74} fill="rgba(255,255,255,0.4)" fontSize="11"
        fontFamily="'JetBrains Mono', monospace" letterSpacing="0.1em">
        {t("gauge.opportunity")}
      </text>
      <text x={tx + PAD + 130} y={ty + PAD + 74} fill={oppColor} fontSize="22" fontWeight="700"
        fontFamily="'JetBrains Mono', monospace">
        {signal.opportunity}
      </text>
      <text x={tx + PAD + 160} y={ty + PAD + 74} fill="rgba(255,255,255,0.25)" fontSize="13"
        fontFamily="'JetBrains Mono', monospace">/100</text>

      <text x={tx + TW / 2 + 20} y={ty + PAD + 74} fill="rgba(255,255,255,0.4)" fontSize="11"
        fontFamily="'JetBrains Mono', monospace" letterSpacing="0.1em">
        {t("gauge.risk")}
      </text>
      <text x={tx + TW / 2 + 80} y={ty + PAD + 74} fill={rskColor} fontSize="22" fontWeight="700"
        fontFamily="'JetBrains Mono', monospace">
        {signal.risk}
      </text>
      <text x={tx + TW / 2 + 110} y={ty + PAD + 74} fill="rgba(255,255,255,0.25)" fontSize="13"
        fontFamily="'JetBrains Mono', monospace">/100</text>

      {/* Window */}
      <text x={tx + PAD} y={ty + PAD + 100} fill={stateColor(signal.state)} fontSize="16" fontWeight="700"
        fontFamily="'JetBrains Mono', monospace">
        {formatTimeClear(signal.t_minus_minutes)}
      </text>
      <text x={tx + PAD + 80} y={ty + PAD + 100} fill="rgba(255,255,255,0.35)" fontSize="12"
        fontFamily="'JetBrains Mono', monospace">
        {t("tip.window")}
      </text>

      {/* Separator */}
      <line x1={tx + PAD} y1={ty + PAD + 112} x2={tx + TW - PAD} y2={ty + PAD + 112}
        stroke="rgba(255,255,255,0.06)" strokeWidth="0.5" />

      {/* "Pourquoi ?" — reasons */}
      <text x={tx + PAD} y={ty + PAD + 130} fill="rgba(255,255,255,0.5)" fontSize="11" fontWeight="600"
        fontFamily="'JetBrains Mono', monospace" letterSpacing="0.08em">
        {t("tip.why")}
      </text>
      {signal.reasons.slice(0, 3).map((reason, ri) => (
        <text key={ri} x={tx + PAD + 8} y={ty + PAD + 148 + ri * 18}
          fill="rgba(255,255,255,0.6)" fontSize="12"
          fontFamily="'JetBrains Mono', monospace">
          • {reason}
        </text>
      ))}

      {/* Sparkline */}
      {sparkData.length >= 2 && (
        <>
          <line x1={tx + PAD} y1={ty + TH - sparkH - 22} x2={tx + TW - PAD} y2={ty + TH - sparkH - 22}
            stroke="rgba(255,255,255,0.04)" strokeWidth="0.5" />
          <g transform={`translate(${tx + PAD + 2}, ${ty + TH - sparkH - 16})`}>
            <svg width={sparkW} height={sparkH} viewBox={`0 0 ${sparkW} ${sparkH}`}>
              <TooltipSparkline data={sparkData} width={sparkW} height={sparkH - 2}
                color={signal.dominant === "risk" ? rskColor : oppColor} />
            </svg>
          </g>
          <text x={tx + TW - PAD} y={ty + TH - 8} textAnchor="end"
            fill="rgba(255,255,255,0.2)" fontSize="10"
            fontFamily="'JetBrains Mono', monospace">
            {t("tip.price7d")}
          </text>
        </>
      )}
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

  const oppColor = opportunityColor(signal.opportunity);
  const rskColor = riskColor(signal.risk);

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full sm:w-[400px] border-l border-white/5 bg-[#080810] text-white overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="font-mono text-white/90 tracking-wider text-lg">
            {t("panel.title")}
          </SheetTitle>
        </SheetHeader>
        <div className="mt-6 space-y-6">
          <div className="text-center">
            <div className="font-mono text-2xl tracking-wider" style={{ color: stateColor(signal.state) }}>
              SN-{signal.netuid}
            </div>
            <div className="font-mono text-sm text-white/60 mt-1">{signal.name}</div>
          </div>

          {/* Opp / Risk scores */}
          <div className="flex items-center justify-center gap-8">
            <div className="text-center">
              <div className="font-mono text-3xl font-bold" style={{ color: oppColor }}>{signal.opportunity}</div>
              <div className="font-mono text-[10px] text-white/40 tracking-widest mt-1">{t("gauge.opportunity")}</div>
            </div>
            <div style={{ width: 1, height: 40, background: "rgba(255,255,255,0.08)" }} />
            <div className="text-center">
              <div className="font-mono text-3xl font-bold" style={{ color: rskColor }}>{signal.risk}</div>
              <div className="font-mono text-[10px] text-white/40 tracking-widest mt-1">{t("gauge.risk")}</div>
            </div>
          </div>

          <div className="text-center font-mono text-lg" style={{ color: stateColor(signal.state) }}>
            {formatTimeClear(signal.t_minus_minutes)} <span className="text-white/35 text-sm">{t("tip.window")}</span>
          </div>

          {/* Reasons */}
          <div className="bg-white/[0.02] rounded-lg p-4">
            <div className="font-mono text-[10px] text-white/40 tracking-widest mb-3">{t("tip.why")}</div>
            {signal.reasons.map((r, i) => (
              <div key={i} className="font-mono text-sm text-white/65 mb-1.5">• {r}</div>
            ))}
          </div>

          {signal.sparkline_7d.length > 1 && (
            <div className="bg-white/[0.02] rounded-lg p-4">
              <div className="font-mono text-[10px] text-white/30 tracking-widest mb-2">{t("tip.price7d")}</div>
              <svg width="100%" height="60" viewBox="0 0 300 60" preserveAspectRatio="none">
                <TooltipSparkline data={signal.sparkline_7d} width={300} height={55} color={oppColor} />
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
                  <span className="text-white/40">{label}</span>
                  <span className="text-white/75">{val}</span>
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

function PositionBar({ position, isMobile, t, onClose }: {
  position: Position; isMobile: boolean; t: (key: any) => string; onClose?: () => void;
}) {
  const pnl = position.currentValue - position.capital;
  const pnlPct = ((pnl / position.capital) * 100);
  
  const barColor = pnlPct >= 5 ? "hsl(145, 65%, 48%)" : pnlPct >= 0 ? "hsl(38, 92%, 55%)" : "hsl(0, 72%, 55%)";
  const statusLabel = pnlPct >= 5 ? t("pos.profit") : pnlPct >= 0 ? t("pos.caution") : t("pos.danger");
  const barBg = pnlPct >= 5 ? "rgba(76,175,80,0.08)" : pnlPct >= 0 ? "rgba(255,193,7,0.08)" : "rgba(244,67,54,0.08)";
  const barBorder = pnlPct >= 5 ? "rgba(76,175,80,0.2)" : pnlPct >= 0 ? "rgba(255,193,7,0.2)" : "rgba(244,67,54,0.2)";

  const barMin = -20, barMax = 30;
  const barRange = barMax - barMin;
  const currentPos = clamp((pnlPct - barMin) / barRange * 100, 2, 98);
  const protectionPos = clamp((position.protectionThreshold - barMin) / barRange * 100, 0, 100);
  const exitPos = clamp((position.exitRecommended - barMin) / barRange * 100, 0, 100);

  return (
    <div className="font-mono" style={{
      width: isMobile ? "min(92vw, 420px)" : 580,
      background: barBg,
      border: `1px solid ${barBorder}`,
      borderRadius: 12,
      padding: isMobile ? "10px 14px" : "14px 20px",
      backdropFilter: "blur(12px)",
    }}>
      <div className="flex items-center justify-between" style={{ fontSize: isMobile ? 10 : 12 }}>
        <div className="flex flex-col">
          <span style={{ color: "rgba(255,255,255,0.4)", letterSpacing: "0.1em", fontSize: isMobile ? 8 : 9 }}>{t("pos.capital")}</span>
          <span style={{ color: "rgba(255,255,255,0.7)" }}>{position.capital.toLocaleString()} τ</span>
        </div>
        <div className="flex flex-col items-center">
          <span style={{ color: "rgba(255,255,255,0.4)", letterSpacing: "0.1em", fontSize: isMobile ? 8 : 9 }}>{t("pos.current")}</span>
          <span style={{ color: "rgba(255,255,255,0.7)" }}>{Math.round(position.currentValue).toLocaleString()} τ</span>
        </div>
        <div className="flex flex-col items-center">
          <span style={{ color: "rgba(255,255,255,0.4)", letterSpacing: "0.1em", fontSize: isMobile ? 8 : 9 }}>{t("pos.pnl")}</span>
          <span style={{ color: barColor, fontWeight: 700, fontSize: isMobile ? 13 : 16 }}>
            {pnlPct >= 0 ? "+" : ""}{pnlPct.toFixed(1)}%
          </span>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span style={{ color: barColor, fontWeight: 600, fontSize: isMobile ? 9 : 11, letterSpacing: "0.1em" }}>
            {statusLabel}
          </span>
          {onClose && (
            <button
              onClick={onClose}
              className="pointer-events-auto text-white/30 hover:text-red-400 transition-colors"
              style={{ fontSize: isMobile ? 8 : 10, letterSpacing: "0.08em" }}
            >
              {t("pos.close")} ✕
            </button>
          )}
        </div>
      </div>

      <div className="relative mt-2" style={{ height: isMobile ? 20 : 24 }}>
        <div className="absolute inset-x-0 rounded-full" style={{
          top: isMobile ? 8 : 10, height: isMobile ? 4 : 5,
          background: "rgba(255,255,255,0.06)",
        }} />
        <div className="absolute rounded-full" style={{
          top: isMobile ? 8 : 10, height: isMobile ? 4 : 5, left: 0,
          width: `${currentPos}%`,
          background: `linear-gradient(90deg, rgba(255,255,255,0.05), ${barColor})`,
          transition: "width 800ms ease",
        }} />
        <div className="absolute" style={{
          left: `${protectionPos}%`, top: 0, bottom: 0,
          width: 2, background: "hsl(38, 92%, 55%)", opacity: 0.6, borderRadius: 1,
        }}>
          <div className="absolute font-mono" style={{
            top: -12, left: "50%", transform: "translateX(-50%)",
            fontSize: 8, color: "hsl(38, 92%, 55%)", whiteSpace: "nowrap",
          }}>{t("pos.protection")}</div>
        </div>
        <div className="absolute" style={{
          left: `${exitPos}%`, top: 0, bottom: 0,
          width: 2, background: "hsl(0, 72%, 55%)", opacity: 0.7, borderRadius: 1,
        }}>
          <div className="absolute font-mono" style={{
            top: -12, left: "50%", transform: "translateX(-50%)",
            fontSize: 8, color: "hsl(0, 72%, 55%)", whiteSpace: "nowrap",
          }}>{t("pos.exit_rec")}</div>
        </div>
        <div className="absolute" style={{
          left: `${currentPos}%`, top: isMobile ? 5 : 6,
          width: isMobile ? 11 : 13, height: isMobile ? 11 : 13,
          borderRadius: "50%", background: barColor,
          border: "2px solid rgba(0,0,0,0.5)",
          transform: "translateX(-50%)",
          boxShadow: `0 0 8px ${barColor}60`,
          transition: "left 800ms ease",
        }} />
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════ */
/*     OPEN POSITION DIALOG (PREMIUM)      */
/* ═══════════════════════════════════════ */
type ObjectivePreset = "x2" | "x5" | "x10" | "x20" | "custom";
type StopMode = "dynamic" | "manual";

function OpenPositionDialog({ open, onClose, signals, t, preselectedNetuid }: {
  open: boolean; onClose: () => void; signals: SubnetSignal[]; t: (key: any) => string;
  preselectedNetuid?: number;
}) {
  const [netuid, setNetuid] = useState(preselectedNetuid || signals[0]?.netuid || 1);
  const [capital, setCapital] = useState("100");
  const [stopLoss, setStopLoss] = useState("-8");
  const [objective, setObjective] = useState<ObjectivePreset>("x2");
  const [customTP, setCustomTP] = useState("50");
  const [stopMode, setStopMode] = useState<StopMode>("dynamic");
  const openPosition = useOpenPosition();

  useEffect(() => {
    if (preselectedNetuid) setNetuid(preselectedNetuid);
  }, [preselectedNetuid]);

  const { data: metrics } = useQuery({
    queryKey: ["subnet-price-for-position", netuid],
    queryFn: async () => {
      const { data } = await supabase.from("subnet_latest_display")
        .select("price_usd, price").eq("netuid", netuid).maybeSingle();
      return data;
    },
    enabled: open,
  });

  const currentPriceTao = metrics?.price ? Number(metrics.price) : 0;
  const currentPriceUsd = metrics?.price_usd ? Number(metrics.price_usd) : 0;

  const takeProfit = objective === "x2" ? 100 : objective === "x5" ? 400 : objective === "x10" ? 900 : objective === "x20" ? 1900 : parseFloat(customTP) || 50;
  const estimatedQty = currentPriceTao > 0 ? (parseFloat(capital) || 0) / currentPriceTao : 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentPriceUsd) {
      toast.error("Prix introuvable");
      return;
    }
    try {
      await openPosition.mutateAsync({
        netuid,
        capital: parseFloat(capital),
        entry_price: currentPriceUsd,
        stop_loss_pct: parseFloat(stopLoss),
        take_profit_pct: takeProfit,
      });
      toast.success("Position ouverte ✓");
      onClose();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const inputStyle = "w-full px-3 py-2.5 rounded-lg text-sm bg-white/[0.04] border border-white/[0.1] text-white/85 focus:border-white/25 focus:outline-none transition-colors font-mono";
  const objectivePresets: ObjectivePreset[] = ["x2", "x5", "x10", "x20", "custom"];

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="bg-[#08080F] border-white/10 text-white max-w-md">
        <DialogHeader>
          <DialogTitle className="font-mono tracking-wider text-white/90 text-lg">
            {t("pos.open_title")}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          {/* Subnet */}
          <div>
            <label className="block text-[10px] font-mono tracking-widest uppercase mb-1.5 text-white/40">{t("pos.subnet")}</label>
            <select value={netuid} onChange={(e) => setNetuid(Number(e.target.value))}
              className={inputStyle} style={{ appearance: "none" }}>
              {signals.map(s => (
                <option key={s.netuid} value={s.netuid} className="bg-[#08080F]">
                  SN-{s.netuid} · {s.name} (Opp: {s.opportunity} | Risk: {s.risk})
                </option>
              ))}
            </select>
          </div>

          {/* Price info */}
          {currentPriceUsd > 0 && (
            <div className="flex justify-between text-xs font-mono px-1">
              <span className="text-white/40">{t("pos.entry_price")}: <span className="text-white/70">${currentPriceUsd.toFixed(4)}</span></span>
              {estimatedQty > 0 && (
                <span className="text-white/40">{t("pos.estimated_qty")}: <span className="text-white/70">{estimatedQty.toFixed(2)}</span></span>
              )}
            </div>
          )}

          {/* Capital */}
          <div>
            <label className="block text-[10px] font-mono tracking-widest uppercase mb-1.5 text-white/40">{t("pos.amount")}</label>
            <input type="number" value={capital} onChange={(e) => setCapital(e.target.value)}
              min="1" step="any" required className={inputStyle} />
          </div>

          {/* Objective */}
          <div>
            <label className="block text-[10px] font-mono tracking-widest uppercase mb-1.5 text-white/40">{t("pos.objective")}</label>
            <div className="flex gap-2">
              {objectivePresets.map(p => (
                <button key={p} type="button"
                  onClick={() => setObjective(p)}
                  className="flex-1 py-2 rounded-lg font-mono text-xs tracking-wider transition-all"
                  style={{
                    background: objective === p ? "rgba(255,215,0,0.12)" : "rgba(255,255,255,0.03)",
                    color: objective === p ? "rgba(255,215,0,0.9)" : "rgba(255,255,255,0.35)",
                    border: `1px solid ${objective === p ? "rgba(255,215,0,0.3)" : "rgba(255,255,255,0.06)"}`,
                    fontWeight: objective === p ? 700 : 400,
                  }}>
                  {t(`pos.obj_${p}` as any)}
                </button>
              ))}
            </div>
            {objective === "custom" && (
              <input type="number" value={customTP} onChange={(e) => setCustomTP(e.target.value)}
                min="1" step="any" placeholder="%" className={`${inputStyle} mt-2`} />
            )}
          </div>

          {/* Stop mode + Stop loss */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-mono tracking-widest uppercase mb-1.5 text-white/40">{t("pos.stop_mode")}</label>
              <div className="flex gap-1">
                {(["dynamic", "manual"] as StopMode[]).map(m => (
                  <button key={m} type="button" onClick={() => setStopMode(m)}
                    className="flex-1 py-2 rounded-lg font-mono text-[10px] tracking-wider transition-all"
                    style={{
                      background: stopMode === m ? "rgba(229,57,53,0.1)" : "rgba(255,255,255,0.02)",
                      color: stopMode === m ? "rgba(229,57,53,0.8)" : "rgba(255,255,255,0.3)",
                      border: `1px solid ${stopMode === m ? "rgba(229,57,53,0.2)" : "rgba(255,255,255,0.06)"}`,
                    }}>
                    {t(`pos.stop_${m}` as any)}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-[10px] font-mono tracking-widest uppercase mb-1.5 text-white/40">{t("pos.stop_loss")}</label>
              <input type="number" value={stopLoss} onChange={(e) => setStopLoss(e.target.value)}
                step="any" required className={inputStyle} />
            </div>
          </div>

          {/* Partial TP info */}
          <div className="bg-white/[0.02] rounded-lg px-3 py-2.5 font-mono text-[10px] text-white/35 space-y-1">
            <div className="text-white/50 tracking-widest uppercase mb-1">{t("pos.partial_tp")}</div>
            <div>{t("pos.partial_25_x2")}</div>
            <div>{t("pos.partial_25_x5")}</div>
            <div>{t("pos.partial_50_x10")}</div>
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="flex-1 py-2.5 rounded-lg font-mono text-xs tracking-wider text-white/45 border border-white/10 hover:border-white/20 transition-colors">
              {t("pos.cancel")}
            </button>
            <button type="submit" disabled={openPosition.isPending || !currentPriceUsd}
              className="flex-1 py-2.5 rounded-lg font-mono text-xs tracking-wider font-bold transition-all disabled:opacity-50"
              style={{
                background: "linear-gradient(135deg, rgba(255,215,0,0.15), rgba(255,215,0,0.08))",
                color: "rgba(255,215,0,0.9)",
                border: "1px solid rgba(255,215,0,0.3)",
                boxShadow: "0 0 20px rgba(255,215,0,0.06)",
              }}>
              {openPosition.isPending ? "..." : t("pos.confirm")}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
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
  const signals = demoMode ? demoSignals : realSignals;
  const realPsi = useMemo(() => computeGlobalPsi(rawSignals ?? []), [rawSignals]);
  const realConf = useMemo(() => computeGlobalConfidence(rawSignals ?? []), [rawSignals]);
  const realOpp = useMemo(() => computeGlobalOpportunity(rawSignals ?? []), [rawSignals]);
  const realRisk = useMemo(() => computeGlobalRisk(rawSignals ?? []), [rawSignals]);

  const globalPsi = demoMode ? 62 : realPsi;
  const globalConf = demoMode ? 71 : realConf;
  const globalOpp = demoMode ? 68 : realOpp;
  const globalRisk = demoMode ? 32 : realRisk;
  const globalState = deriveGaugeState(globalPsi, globalConf);
  const globalPhase = derivePhase(globalPsi);
  const globalTMinus = deriveTMinus(globalPsi);

  /* ─── position management ─── */
  const { user } = useAuth();
  const { data: dbPositions } = usePositions();
  const closePosition = useClosePosition();
  const [openPosDialog, setOpenPosDialog] = useState(false);
  const [preselectedNetuid, setPreselectedNetuid] = useState<number | undefined>();

  const { data: latestPrices } = useQuery({
    queryKey: ["position-prices", dbPositions?.map(p => p.netuid)],
    queryFn: async () => {
      if (!dbPositions?.length) return {};
      const netuids = [...new Set(dbPositions.map(p => p.netuid))];
      const { data } = await supabase
        .from("subnet_latest_display")
        .select("netuid, price_usd")
        .in("netuid", netuids);
      const map: Record<number, number> = {};
      for (const r of data || []) {
        map[r.netuid!] = Number(r.price_usd) || 0;
      }
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
    return {
      id: pos.id,
      netuid: pos.netuid,
      capital: Number(pos.capital),
      currentValue,
      protectionThreshold: Number(pos.stop_loss_pct),
      exitRecommended: Number(pos.take_profit_pct),
    };
  }, [demoMode, dbPositions, latestPrices]);

  const hasPosition = activePosition !== null;

  const handleClosePosition = useCallback(async () => {
    if (!activePosition?.id || !latestPrices) return;
    const price = latestPrices[activePosition.netuid!] || 0;
    try {
      await closePosition.mutateAsync({ id: activePosition.id, closed_price: price });
      toast.success("Position fermée ✓");
    } catch (err: any) {
      toast.error(err.message);
    }
  }, [activePosition, latestPrices, closePosition]);

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
            body: `${sig.name} · Opp ${sig.opportunity} · Risk ${sig.risk} · ${formatTimeClear(sig.t_minus_minutes)}`,
            icon: "/pwa-192x192.png",
            tag: `imminent-${netuid}`,
          });
        }
      }
    }
    prevImminentRef.current = currentImminent;
  }, [signals]);

  /* ─── P&L threshold alerts ─── */
  const prevAlertRef = useRef<{ sl: boolean; tp: boolean }>({ sl: false, tp: false });
  useEffect(() => {
    if (!activePosition || demoMode) return;
    const pnlPct = ((activePosition.currentValue - activePosition.capital) / activePosition.capital) * 100;
    const slHit = pnlPct <= activePosition.protectionThreshold;
    const tpHit = pnlPct >= activePosition.exitRecommended;
    if (slHit && !prevAlertRef.current.sl) {
      const title = t("pos.alert_sl" as any);
      const body = `SN-${activePosition.netuid} · P&L ${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(1)}%`;
      toast.error(title, { description: body, duration: 10000 });
      if (Notification.permission === "granted") new Notification(title, { body, icon: "/pwa-192x192.png", tag: "pos-sl" });
    }
    if (tpHit && !prevAlertRef.current.tp) {
      const title = t("pos.alert_tp" as any);
      const body = `SN-${activePosition.netuid} · P&L +${pnlPct.toFixed(1)}%`;
      toast.success(title, { description: body, duration: 10000 });
      if (Notification.permission === "granted") new Notification(title, { body, icon: "/pwa-192x192.png", tag: "pos-tp" });
    }
    prevAlertRef.current = { sl: slHit, tp: tpHit };
  }, [activePosition, demoMode, t]);

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
      const from = prevStateRef.current;
      const to = globalState;
      const startTime = performance.now();
      const duration = 1200;
      const animate = (now: number) => {
        const elapsed = now - startTime;
        const progress = Math.min(elapsed / duration, 1);
        setStateTransition({ from, to, progress });
        if (progress < 1) transitionRaf.current = requestAnimationFrame(animate);
        else setStateTransition(null);
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

  /* ─── flash ─── */
  const [flashActive, setFlashActive] = useState(false);
  useEffect(() => {
    if (prevStateRef.current !== globalState || globalState === "IMMINENT") {
      setFlashActive(true);
      const timeout = setTimeout(() => setFlashActive(false), 400);
      return () => clearTimeout(timeout);
    }
  }, [globalState]);

  /* ─── hover + panel ─── */
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const [panelSignal, setPanelSignal] = useState<SubnetSignal | null>(null);

  const handleClickRay = useCallback((s: SubnetSignal) => {
    setPanelSignal(s);
  }, []);

  /* ─── geometry — LARGER (+30%) ─── */
  const isMobile = useIsMobile();
  const SIZE = isMobile ? 420 : 1000;
  const SVG_SIZE = isMobile ? 620 : 1500;
  const CX = SVG_SIZE / 2, CY = SVG_SIZE / 2;
  const R_OUTER = isMobile ? 170 : 430;      // Opportunity ring (outer)
  const R_INNER = isMobile ? 140 : 360;      // Risk ring (inner)
  const R_TRIGGER = isMobile ? 115 : 300;

  // Opportunity ring = golden, Risk ring = red
  const oppGlobal = opportunityColor(globalOpp);
  const rskGlobal = riskColor(globalRisk);
  const color = stateColor(globalState);
  const glow = stateGlow(globalState);

  const oppAngle = (globalOpp / 100) * 270;
  const riskAngle = (globalRisk / 100) * 270;
  const innerOpacity = globalState === "IMMINENT" ? 0.9 : 0.55 + breathe * 0.35;
  const showHalo = globalConf >= 70;

  const triggerTicks = useMemo(() => {
    if (globalPhase !== "TRIGGER" && globalState !== "IMMINENT") return [];
    const count = globalState === "IMMINENT" ? 24 : 12;
    return Array.from({ length: count }, (_, i) => ({ angle: -135 + (i / count) * 270 }));
  }, [globalPhase, globalState]);

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

      {/* Ambient halo */}
      <div className="absolute inset-0 pointer-events-none flex items-center justify-center" style={{ zIndex: 0 }}>
        <div style={{
          width: isMobile ? 550 : 1300,
          height: isMobile ? 550 : 1300,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${oppGlobal}0A 0%, ${oppGlobal}05 35%, transparent 65%)`,
          transition: "background 1.2s ease",
        }} />
      </div>

      {/* Flash */}
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
        @keyframes opp-sweep {
          0% { opacity: 0.3; }
          50% { opacity: 0.55; }
          100% { opacity: 0.3; }
        }
      `}</style>

      {/* Phase indicator (top) */}
      <div className="absolute top-5 sm:top-10 left-0 right-0 flex flex-col items-center z-10" style={{ paddingLeft: isMobile ? 60 : 0, paddingRight: isMobile ? 60 : 0 }}>
        <span className="font-mono tracking-[0.35em] sm:tracking-[0.5em] uppercase" style={{
          color: "rgba(255,255,255,0.45)",
          fontSize: isMobile ? 12 : 16,
        }}>
          {t("gauge.phase")}
        </span>
        <span className="font-mono font-bold uppercase mt-1 text-center" style={{
          color,
          fontSize: "clamp(16px, 4vw, 30px)",
          letterSpacing: isMobile ? "0.15em" : "0.35em",
          transition: "color 800ms ease",
          textShadow: `0 0 30px ${color}20`,
        }}>
          {phaseLabel}
        </span>
      </div>

      {/* Notification permission */}
      {typeof Notification !== "undefined" && Notification.permission !== "granted" && (
        <button onClick={() => Notification.requestPermission()}
          className="absolute bottom-4 left-4 z-20 font-mono text-[10px] tracking-wider px-3 py-1.5 rounded-md transition-all"
          style={{ background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.3)", border: "1px solid rgba(255,255,255,0.08)" }}>
          🔔 {t("gauge.notif")}
        </button>
      )}

      {/* Demo toggle */}
      <button onClick={() => setDemoMode(d => !d)}
        className="absolute bottom-4 right-4 z-20 font-mono text-[10px] tracking-wider px-3 py-1.5 rounded-md transition-all"
        style={{
          background: demoMode ? "rgba(0,255,200,0.12)" : "rgba(255,255,255,0.03)",
          color: demoMode ? "rgba(0,255,200,0.8)" : "rgba(255,255,255,0.25)",
          border: `1px solid ${demoMode ? "rgba(0,255,200,0.3)" : "rgba(255,255,255,0.06)"}`,
        }}>
        {demoMode ? "⬤ DEMO ON" : "◯ DEMO"}
      </button>

      {/* GAUGE */}
      <div className="absolute z-10" style={{
        width: isMobile ? "min(95vw, 560px)" : SIZE,
        height: isMobile ? "min(95vw, 560px)" : SIZE,
        aspectRatio: "1 / 1",
        top: "50%", left: "50%", transform: "translate(-50%, -50%)",
      }}>
        {showHalo && (
          <div className="absolute inset-0 rounded-full pointer-events-none" style={{
            background: `radial-gradient(circle, rgba(255,215,0,0.06) 0%, transparent 70%)`,
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
            `}</style>
          </defs>

          {/* OUTER RING = OPPORTUNITY (golden) */}
          <circle cx={CX} cy={CY} r={R_OUTER} fill="none" stroke="rgba(255,215,0,0.04)" strokeWidth={isMobile ? 8 : 12} />
          {oppAngle > 0 && (
            <path d={describeArc(CX, CY, R_OUTER, -135, -135 + oppAngle)} fill="none"
              stroke={oppGlobal} strokeWidth={isMobile ? 8 : 12} strokeLinecap="round"
              style={{ opacity: 0.55, transition: "d 600ms ease", animation: "opp-sweep 4s ease-in-out infinite" }} />
          )}
          {/* OUTER label */}
          <text x={CX + R_OUTER + (isMobile ? 14 : 22)} y={CY - R_OUTER + (isMobile ? 30 : 45)}
            fill="rgba(255,215,0,0.35)" fontSize={isMobile ? 8 : 11}
            fontFamily="'JetBrains Mono', monospace" letterSpacing="0.12em"
            textAnchor="start" transform={`rotate(0)`}>
            {t("gauge.opportunity")}
          </text>

          {/* INNER RING = RISK (red) */}
          <circle cx={CX} cy={CY} r={R_INNER} fill="none" stroke="rgba(229,57,53,0.04)" strokeWidth={isMobile ? 10 : 14} />
          {riskAngle > 0 && (
            <path d={describeArc(CX, CY, R_INNER, -135, -135 + riskAngle)} fill="none"
              stroke={rskGlobal} strokeWidth={isMobile ? 10 : 14} strokeLinecap="round"
              style={{ opacity: innerOpacity, transition: "d 600ms ease, opacity 400ms ease" }} />
          )}
          {/* INNER label */}
          <text x={CX + R_INNER + (isMobile ? 14 : 22)} y={CY - R_INNER + (isMobile ? 30 : 45)}
            fill="rgba(229,57,53,0.3)" fontSize={isMobile ? 8 : 11}
            fontFamily="'JetBrains Mono', monospace" letterSpacing="0.12em"
            textAnchor="start">
            {t("gauge.risk")}
          </text>

          {/* Trigger ticks */}
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
            return (
              <g style={{ pointerEvents: "none" }}>
                <path d={describeArc(CX, CY, R_OUTER, -135, -135 + sweepAngle)}
                  fill="none" stroke={toColor} strokeWidth={16 + eased * 8} strokeLinecap="round"
                  style={{ opacity: fadeOpacity * 0.6, filter: "blur(6px)" }} />
              </g>
            );
          })()}

          {/* Micro-pulse on ring for hovered ray */}
          {hoveredIdx !== null && signals[hoveredIdx] && (() => {
            const hAngleDeg = (hoveredIdx * (360 / Math.max(signals.length, 1))) - 90;
            const spread = 14;
            const hColor = signals[hoveredIdx].dominant === "opportunity" ? opportunityColor(signals[hoveredIdx].opportunity) : riskColor(signals[hoveredIdx].risk);
            return (
              <path
                d={describeArc(CX, CY, R_OUTER, hAngleDeg - spread, hAngleDeg + spread)}
                fill="none" stroke={hColor} strokeWidth="12" strokeLinecap="round"
                style={{ opacity: 0.35, transition: "opacity 200ms ease" }}
              />
            );
          })()}

          {/* Time Ring */}
          <TimeRing cx={CX} cy={CY} outerR={R_OUTER} isMobile={isMobile} />

          {/* Sacred Rays */}
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
      {/* CENTER HUD — FENÊTRE D'OPPORTUNITÉ      */}
      {/* ═══════════════════════════════════════ */}
      <div className="fixed inset-0 pointer-events-none z-20" style={{ display: "grid", placeItems: "center" }}>
        <div style={{
          maxWidth: isMobile ? "min(70vw, 280px)" : 480,
          width: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          textAlign: "center",
          lineHeight: 0.95,
        }}>
          {/* Line 1: FENÊTRE D'OPPORTUNITÉ */}
          <span className="font-mono tracking-[0.3em] sm:tracking-[0.4em] uppercase" style={{
            fontSize: isMobile ? 9 : 14,
            color: "rgba(255,215,0,0.5)",
            letterSpacing: isMobile ? "0.2em" : "0.35em",
          }}>
            {t("gauge.window")}
          </span>

          {/* Line 2: TIMER (very large, high contrast) */}
          <span className="font-mono font-bold leading-none mt-2 sm:mt-4" style={{
            fontSize: "clamp(50px, 14vw, 100px)",
            color: "rgba(255,248,220,0.95)",
            transition: "color 800ms ease",
            letterSpacing: "0.04em",
            textShadow: `0 0 60px ${oppGlobal}40, 0 0 120px ${oppGlobal}15`,
          }}>
            {formatTimeClear(globalTMinus)}
          </span>

          {/* Line 3: "avant zone de bascule" */}
          <span className="font-mono tracking-[0.15em] sm:tracking-[0.2em] uppercase mt-1 sm:mt-3" style={{
            fontSize: isMobile ? 9 : 13,
            color: "rgba(255,255,255,0.35)",
          }}>
            {t("gauge.before")}
          </span>

          {/* Phase */}
          <span className="font-mono font-bold uppercase" style={{
            fontSize: isMobile ? 14 : 20,
            letterSpacing: isMobile ? "0.3em" : "0.5em",
            marginTop: isMobile ? 8 : 22,
            color,
            opacity: 0.9,
            transition: "color 800ms ease",
          }}>
            {phaseLabel}
          </span>

          {/* Opportunity + Risk scores */}
          <div className="flex items-center mt-3 sm:mt-6" style={{ gap: isMobile ? 20 : 50 }}>
            <div className="flex flex-col items-center">
              <span className="font-mono tracking-[0.2em] uppercase" style={{
                color: "rgba(255,215,0,0.4)", fontSize: isMobile ? 9 : 12,
              }}>
                {t("gauge.opportunity")}
              </span>
              <span className="font-mono font-bold mt-0.5" style={{
                color: oppGlobal, fontSize: isMobile ? 20 : 28,
              }}>
                {globalOpp}
              </span>
            </div>
            <div style={{ width: 1, height: isMobile ? 24 : 36, background: "rgba(255,255,255,0.1)" }} />
            <div className="flex flex-col items-center">
              <span className="font-mono tracking-[0.2em] uppercase" style={{
                color: "rgba(229,57,53,0.35)", fontSize: isMobile ? 9 : 12,
              }}>
                {t("gauge.risk")}
              </span>
              <span className="font-mono font-bold mt-0.5" style={{
                color: rskGlobal, fontSize: isMobile ? 20 : 28,
              }}>
                {globalRisk}
              </span>
            </div>
            <div style={{ width: 1, height: isMobile ? 24 : 36, background: "rgba(255,255,255,0.1)" }} />
            <div className="flex flex-col items-center">
              <span className="font-mono tracking-[0.2em] uppercase" style={{
                color: "rgba(255,255,255,0.25)", fontSize: isMobile ? 9 : 12,
              }}>
                {t("gauge.confidence")}
              </span>
              <span className="font-mono font-bold mt-0.5" style={{
                color: "rgba(255,255,255,0.6)", fontSize: isMobile ? 18 : 24,
              }}>
                {globalConf}%
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* PRIORITY FOOTER */}
      {signals.length > 0 && (() => {
        const priority = signals.reduce((best, s) =>
          s.t_minus_minutes < best.t_minus_minutes ? s : best, signals[0]);
        const prioColor = priority.dominant === "opportunity" ? opportunityColor(priority.opportunity) : riskColor(priority.risk);
        return (
          <div className="fixed left-0 right-0 z-20 flex justify-center pointer-events-none"
            style={{ bottom: isMobile ? (hasPosition ? 110 : 55) : (hasPosition ? 130 : 65) }}>
            <div className="font-mono text-center px-5 py-2 rounded-lg" style={{
              background: "rgba(0,0,0,0.5)",
              border: "1px solid rgba(255,255,255,0.08)",
              fontSize: isMobile ? 11 : 13,
              letterSpacing: "0.1em",
            }}>
              <span style={{ color: "rgba(255,255,255,0.4)" }}>{t("priority.current")} : </span>
              <span style={{ color: prioColor, fontWeight: 700 }}>SN-{priority.netuid}</span>
              <span style={{ color: "rgba(255,255,255,0.55)", marginLeft: 8 }}>
                ({formatTimeClear(priority.t_minus_minutes)} {t("priority.before")})
              </span>
            </div>
          </div>
        );
      })()}

      {/* POSITION BAR or OPEN BUTTON */}
      {hasPosition ? (
        <div className="fixed left-0 right-0 z-20 flex justify-center"
          style={{ bottom: isMobile ? 12 : 20 }}>
          <PositionBar position={activePosition!} isMobile={isMobile} t={t}
            onClose={activePosition?.id ? handleClosePosition : undefined} />
        </div>
      ) : (
        <div className="fixed z-20 flex justify-center"
          style={{ bottom: isMobile ? 14 : 22, left: 0, right: 0 }}>
          {user ? (
            <button
              onClick={() => { setPreselectedNetuid(undefined); setOpenPosDialog(true); }}
              className="font-mono tracking-wider px-6 py-3 rounded-xl transition-all pointer-events-auto flex items-center gap-2"
              style={{
                background: "linear-gradient(135deg, rgba(255,215,0,0.12), rgba(255,215,0,0.06))",
                color: "rgba(255,215,0,0.9)",
                border: "1px solid rgba(255,215,0,0.3)",
                fontSize: isMobile ? 12 : 15,
                fontWeight: 700,
                boxShadow: "0 0 25px rgba(255,215,0,0.08)",
                letterSpacing: "0.08em",
              }}
            >
              <span style={{ fontSize: isMobile ? 16 : 18 }}>➕</span> {t("pos.open")}
            </button>
          ) : (
            <span className="font-mono text-[10px] tracking-wider px-3 py-2 rounded-md pointer-events-auto"
              style={{ color: "rgba(255,255,255,0.3)", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
              {t("pos.login_required")}
            </span>
          )}
        </div>
      )}

      {/* Dialogs */}
      <OpenPositionDialog open={openPosDialog} onClose={() => setOpenPosDialog(false)}
        signals={signals} t={t} preselectedNetuid={preselectedNetuid} />
      <SubnetPanel signal={panelSignal} open={!!panelSignal} onClose={() => setPanelSignal(null)} />
    </div>
  );
}
