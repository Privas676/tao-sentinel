import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useState, useEffect, useMemo, useRef, useCallback } from "react";

/* ═══════════════════════════════════════ */
/*              TYPES                      */
/* ═══════════════════════════════════════ */
type RawSignal = {
  netuid: number | null;
  subnet_name: string | null;
  state: string | null;
  score: number | null;
  mpi: number | null;
  confidence_pct: number | null;
  quality_score: number | null;
  reasons: any;
  miner_filter: string | null;
  ts: string | null;
};

type OracleState = "IDLE" | "BUILD" | "ARMED" | "TRIGGER";
type Asymmetry = "LOW" | "MED" | "HIGH";

type SubnetSignal = {
  netuid: number;
  name: string;
  t_minus_minutes: number;
  confidence: number;
  state: OracleState;
  asymmetry: Asymmetry;
  sparkline_30d: number[];
  mpi: number;
};

/* ═══════════════════════════════════════ */
/*          DERIVATION HELPERS             */
/* ═══════════════════════════════════════ */
function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function deriveOracleState(mpi: number): OracleState {
  if (mpi >= 85) return "TRIGGER";
  if (mpi >= 72) return "ARMED";
  if (mpi >= 55) return "BUILD";
  return "IDLE";
}

function deriveTMinus(mpi: number): number {
  // Higher MPI = closer to event. Map 0-100 → 120-0 minutes (inverse, nonlinear)
  if (mpi >= 95) return 1;
  if (mpi >= 85) return Math.max(1, Math.round(8 - (mpi - 85) * 0.7));
  if (mpi >= 72) return Math.round(25 - (mpi - 72) * 1.3);
  if (mpi >= 55) return Math.round(55 - (mpi - 55) * 1.8);
  return Math.round(90 + (100 - mpi) * 0.5);
}

function deriveAsymmetry(quality: number, confidence: number): Asymmetry {
  const score = (confidence * 0.6 + quality * 0.4);
  if (score >= 75) return "HIGH";
  if (score >= 55) return "MED";
  return "LOW";
}

function processSignals(
  raw: RawSignal[],
  sparklines: Record<number, number[]>
): SubnetSignal[] {
  return raw
    .filter(s => s.netuid != null && (s.confidence_pct ?? 0) >= 55)
    .map(s => {
      const mpi = s.mpi ?? s.score ?? 0;
      const conf = s.confidence_pct ?? 0;
      const quality = s.quality_score ?? 0;
      return {
        netuid: s.netuid!,
        name: s.subnet_name || `SN-${s.netuid}`,
        t_minus_minutes: deriveTMinus(mpi),
        confidence: conf,
        state: deriveOracleState(mpi),
        asymmetry: deriveAsymmetry(quality, conf),
        sparkline_30d: sparklines[s.netuid!] ?? [],
        mpi,
      };
    })
    .sort((a, b) => a.t_minus_minutes - b.t_minus_minutes)
    .slice(0, 7);
}

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

function stateColor(state: OracleState): string {
  switch (state) {
    case "TRIGGER": return "#c62828";
    case "ARMED":   return "#bf360c";
    case "BUILD":   return "#f9a825";
    case "IDLE":    return "#607d8b";
  }
}

function stateGlow(state: OracleState): string {
  switch (state) {
    case "TRIGGER": return "rgba(198,40,40,0.35)";
    case "ARMED":   return "rgba(191,54,12,0.2)";
    case "BUILD":   return "rgba(249,168,37,0.1)";
    case "IDLE":    return "rgba(96,125,139,0.05)";
  }
}

function rayColor(state: OracleState): string {
  switch (state) {
    case "TRIGGER": return "rgba(198,40,40,0.7)";
    case "ARMED":   return "rgba(191,54,12,0.55)";
    case "BUILD":   return "rgba(249,168,37,0.4)";
    case "IDLE":    return "rgba(96,125,139,0.25)";
  }
}

/* ═══════════════════════════════════════ */
/*           RAY SPARKLINE                 */
/* ═══════════════════════════════════════ */
function RaySparkline({
  data, x1, y1, x2, y2, state
}: {
  data: number[]; x1: number; y1: number; x2: number; y2: number; state: OracleState;
}) {
  if (data.length < 3) return null;

  // Compute direction vector and perpendicular
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 10) return null;

  // Unit vectors along ray and perpendicular
  const ux = dx / len, uy = dy / len;
  const px = -uy, py = ux; // perpendicular

  const min = Math.min(...data), max = Math.max(...data);
  const range = max - min || 1;
  const sparkW = len * 0.7; // use 70% of ray length
  const sparkH = 6; // max perpendicular deviation
  const startOffset = len * 0.15;

  const pts = data.map((v, i) => {
    const t = i / (data.length - 1);
    const along = startOffset + t * sparkW;
    const perp = ((v - min) / range - 0.5) * sparkH * 2;
    const sx = x1 + ux * along + px * perp;
    const sy = y1 + uy * along + py * perp;
    return `${sx},${sy}`;
  });

  return (
    <polyline
      points={pts.join(" ")}
      fill="none"
      stroke={rayColor(state)}
      strokeWidth="0.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ opacity: 0.5 }}
    />
  );
}

/* ═══════════════════════════════════════ */
/*          SACRED RAYS                    */
/* ═══════════════════════════════════════ */
function SacredRays({
  signals, cx, cy, outerR, hoveredIdx, setHoveredIdx
}: {
  signals: SubnetSignal[];
  cx: number; cy: number; outerR: number;
  hoveredIdx: number | null;
  setHoveredIdx: (i: number | null) => void;
}) {
  if (!signals.length) return null;

  const count = signals.length;
  const angleStep = 360 / 7; // Always divide by 7 for sacred geometry
  const gap = 16;

  return (
    <>
      {signals.map((s, i) => {
        const angleDeg = (i * angleStep) - 90; // start from top
        const angle = angleDeg * (Math.PI / 180);
        const r1 = outerR + gap;

        // Length: inversely proportional to t_minus (closer = longer)
        const maxLen = 85;
        const minLen = 18;
        const imminenceFactor = clamp(1 - (s.t_minus_minutes / 120), 0, 1);
        const len = minLen + imminenceFactor * (maxLen - minLen);
        const r2 = r1 + len;

        // Thickness: proportional to confidence
        const thickness = 1 + (s.confidence / 100) * 2; // 1-3px

        const x1 = cx + r1 * Math.cos(angle);
        const y1 = cy + r1 * Math.sin(angle);
        const x2 = cx + r2 * Math.cos(angle);
        const y2 = cy + r2 * Math.sin(angle);

        // Dashed if asymmetry LOW (noisy)
        const dashArray = s.asymmetry === "LOW" ? "3,3" : s.asymmetry === "MED" ? "6,2" : undefined;

        const isHovered = hoveredIdx === i;

        return (
          <g key={s.netuid}>
            {/* Invisible wider hit area */}
            <line
              x1={x1} y1={y1} x2={x2} y2={y2}
              stroke="transparent"
              strokeWidth={16}
              style={{ cursor: "pointer" }}
              onMouseEnter={() => setHoveredIdx(i)}
              onMouseLeave={() => setHoveredIdx(null)}
              onClick={() => window.open(`https://taostats.io/subnets/${s.netuid}`, "_blank")}
            />
            {/* Actual ray */}
            <line
              x1={x1} y1={y1} x2={x2} y2={y2}
              stroke={rayColor(s.state)}
              strokeWidth={thickness}
              strokeLinecap="round"
              strokeDasharray={dashArray}
              style={{
                opacity: isHovered ? 1 : 0.75,
                transition: "opacity 200ms ease",
                pointerEvents: "none",
              }}
            />
            {/* Sparkline along the ray */}
            <RaySparkline
              data={s.sparkline_30d}
              x1={x1} y1={y1} x2={x2} y2={y2}
              state={s.state}
            />
          </g>
        );
      })}
    </>
  );
}

/* ═══════════════════════════════════════ */
/*          TOOLTIP                        */
/* ═══════════════════════════════════════ */
function RayTooltip({
  signal, cx, cy, outerR, index, total
}: {
  signal: SubnetSignal; cx: number; cy: number; outerR: number; index: number; total: number;
}) {
  const angleStep = 360 / 7;
  const angleDeg = (index * angleStep) - 90;
  const angle = angleDeg * (Math.PI / 180);
  const r = outerR + 105; // position beyond ray end
  const x = cx + r * Math.cos(angle);
  const y = cy + r * Math.sin(angle);

  return (
    <g style={{ pointerEvents: "none" }}>
      <rect
        x={x - 90} y={y - 14}
        width={180} height={28}
        rx={4}
        fill="rgba(10,10,12,0.92)"
        stroke="rgba(255,255,255,0.08)"
        strokeWidth={0.5}
      />
      <text
        x={x} y={y + 4}
        textAnchor="middle"
        fill="rgba(255,255,255,0.65)"
        fontSize="9"
        fontFamily="monospace"
        letterSpacing="0.05em"
      >
        SN-{signal.netuid} {signal.name} | T-{signal.t_minus_minutes}m | ASYM: {signal.asymmetry}
      </text>
    </g>
  );
}

/* ═══════════════════════════════════════ */
/*        ORACLE D'IMMINENCE PAGE          */
/* ═══════════════════════════════════════ */
export default function AlienGauge() {
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

  /* ─── process signals ─── */
  const signals = useMemo(
    () => processSignals(rawSignals ?? [], sparklines ?? {}),
    [rawSignals, sparklines]
  );

  const dominant = signals[0] ?? null;
  const globalState: OracleState = dominant?.state ?? "IDLE";
  const globalTMinus = dominant?.t_minus_minutes ?? 99;
  const dominantName = dominant?.name ?? "—";

  /* ─── market energy ─── */
  const marketEnergy = useMemo(() => {
    if (!rawSignals?.length) return 0;
    const mpis = rawSignals.map(s => s.mpi ?? s.score ?? 0);
    return Math.round(mpis.reduce((a, b) => a + b, 0) / mpis.length);
  }, [rawSignals]);

  /* ─── breathing animation ─── */
  const [breathe, setBreathe] = useState(0);
  useEffect(() => {
    // ARMED/TRIGGER: no breathing, perfectly stable
    if (globalState === "ARMED" || globalState === "TRIGGER") {
      setBreathe(0);
      return;
    }
    let raf: number;
    const start = performance.now();
    const tick = (now: number) => {
      const t = ((now - start) % 2500) / 2500;
      setBreathe(Math.sin(t * Math.PI * 2) * 0.5 + 0.5);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [globalState]);

  /* ─── trigger flash ─── */
  const [flashActive, setFlashActive] = useState(false);
  const hasFlashed = useRef(false);
  useEffect(() => {
    if (globalState === "TRIGGER" && !hasFlashed.current) {
      hasFlashed.current = true;
      setFlashActive(true);
      setTimeout(() => setFlashActive(false), 150);
    }
    if (globalState !== "TRIGGER") {
      hasFlashed.current = false;
    }
  }, [globalState]);

  /* ─── hover ─── */
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  /* ─── gauge geometry ─── */
  const SIZE = 480;
  const SVG_SIZE = 620;
  const CX = SVG_SIZE / 2, CY = SVG_SIZE / 2;
  const R_TENSION = 215;   // outer
  const R_PRESSION = 185;  // middle
  const R_TRIGGER_RING = 158; // inner

  const color = stateColor(globalState);
  const glow = stateGlow(globalState);

  /* ─── ring arcs ─── */
  const tensionAngle = (marketEnergy / 100) * 270;
  const pressionAngle = dominant ? (dominant.confidence / 100) * 270 : 0;
  const pressionOpacity = globalState === "ARMED" || globalState === "TRIGGER"
    ? 0.9
    : 0.55 + breathe * 0.35;

  // Trigger ring: micro ticks only when ARMED or TRIGGER
  const triggerTicks = useMemo(() => {
    if (globalState !== "ARMED" && globalState !== "TRIGGER") return [];
    const count = globalState === "TRIGGER" ? 24 : 12;
    const ticks: { angle: number }[] = [];
    for (let i = 0; i < count; i++) {
      ticks.push({ angle: -135 + (i / count) * 270 });
    }
    return ticks;
  }, [globalState]);

  /* ─── glow ─── */
  const glowOpacity = globalState === "ARMED" ? 0.15
    : globalState === "TRIGGER" ? 0.3
    : 0;

  return (
    <div
      className="fixed inset-0 flex flex-col items-center justify-center select-none"
      style={{ background: "#050608", overflow: "hidden" }}
    >
      {/* Flash overlay */}
      {flashActive && (
        <div
          className="fixed inset-0 pointer-events-none"
          style={{
            background: "radial-gradient(circle, rgba(198,40,40,0.25) 0%, transparent 60%)",
            zIndex: 50,
          }}
        />
      )}

      {/* ─── HEADER ─── */}
      <div className="absolute top-6 left-0 right-0 text-center">
        <span
          className="font-mono text-xs tracking-[0.3em] uppercase"
          style={{ color: "rgba(255,255,255,0.2)" }}
        >
          CONF {marketEnergy}%
        </span>
      </div>

      {/* ─── GAUGE ─── */}
      <div className="relative" style={{ width: SIZE, height: SIZE }}>
        {/* Glow layer */}
        {glowOpacity > 0 && (
          <div
            className="absolute inset-0 rounded-full pointer-events-none"
            style={{
              background: `radial-gradient(circle, ${glow} 0%, transparent 70%)`,
              opacity: glowOpacity,
              transform: "scale(1.35)",
              transition: "opacity 800ms ease",
            }}
          />
        )}

        <svg
          width={SIZE}
          height={SIZE}
          viewBox={`${(SVG_SIZE - SIZE) / -2} ${(SVG_SIZE - SIZE) / -2} ${SVG_SIZE} ${SVG_SIZE}`}
          style={{ overflow: "visible" }}
        >
          {/* ── Outer ring track (TENSION) ── */}
          <circle cx={CX} cy={CY} r={R_TENSION} fill="none" stroke="rgba(255,255,255,0.03)" strokeWidth="5" />
          {tensionAngle > 0 && (
            <path
              d={describeArc(CX, CY, R_TENSION, -135, -135 + tensionAngle)}
              fill="none"
              stroke={color}
              strokeWidth="5"
              strokeLinecap="round"
              style={{ opacity: 0.45, transition: "d 600ms ease, stroke 500ms ease" }}
            />
          )}

          {/* ── Middle ring track (PRESSION) ── */}
          <circle cx={CX} cy={CY} r={R_PRESSION} fill="none" stroke="rgba(255,255,255,0.03)" strokeWidth="9" />
          {pressionAngle > 0 && (
            <path
              d={describeArc(CX, CY, R_PRESSION, -135, -135 + pressionAngle)}
              fill="none"
              stroke={color}
              strokeWidth="9"
              strokeLinecap="round"
              style={{
                opacity: pressionOpacity,
                transition: "d 600ms ease, stroke 500ms ease, opacity 400ms ease",
              }}
            />
          )}

          {/* ── Inner ring (TRIGGER ticks) ── */}
          <circle cx={CX} cy={CY} r={R_TRIGGER_RING} fill="none" stroke="rgba(255,255,255,0.02)" strokeWidth="2" />
          {triggerTicks.map((tick, i) => {
            const rad = ((tick.angle - 90) * Math.PI) / 180;
            const r1 = R_TRIGGER_RING - 4;
            const r2 = R_TRIGGER_RING + 4;
            return (
              <line
                key={i}
                x1={CX + r1 * Math.cos(rad)}
                y1={CY + r1 * Math.sin(rad)}
                x2={CX + r2 * Math.cos(rad)}
                y2={CY + r2 * Math.sin(rad)}
                stroke={color}
                strokeWidth={1}
                strokeLinecap="round"
                style={{ opacity: globalState === "TRIGGER" ? 0.7 : 0.35 }}
              />
            );
          })}

          {/* ── Sacred Rays ── */}
          <SacredRays
            signals={signals}
            cx={CX} cy={CY}
            outerR={R_TENSION}
            hoveredIdx={hoveredIdx}
            setHoveredIdx={setHoveredIdx}
          />

          {/* ── Tooltip ── */}
          {hoveredIdx !== null && signals[hoveredIdx] && (
            <RayTooltip
              signal={signals[hoveredIdx]}
              cx={CX} cy={CY}
              outerR={R_TENSION}
              index={hoveredIdx}
              total={signals.length}
            />
          )}
        </svg>

        {/* ── Center text ── */}
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span
            className="font-mono font-light leading-none"
            style={{
              fontSize: 64,
              color,
              transition: "color 500ms ease",
              letterSpacing: "0.03em",
            }}
          >
            T-{globalTMinus}m
          </span>
          <span
            className="font-mono text-sm tracking-[0.55em] mt-3"
            style={{ color, opacity: 0.8, transition: "color 500ms ease" }}
          >
            {globalState}
          </span>
          <span
            className="font-mono mt-4 tracking-[0.2em]"
            style={{ color: "rgba(255,255,255,0.25)", fontSize: 10 }}
          >
            {dominantName}
          </span>
        </div>
      </div>
    </div>
  );
}
