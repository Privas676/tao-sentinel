import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useState, useEffect, useMemo, useRef } from "react";

/* ─── types ─── */
type Signal = {
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

type Directive = "ENTER" | "EXIT" | "WAIT" | "IDLE";

function deriveDirective(s: Signal): Directive {
  // gating fail → EXIT
  if (s.state === "BREAK") return "EXIT";
  const mpi = s.mpi ?? s.score ?? 0;
  if (mpi >= 72) return "ENTER";
  if (mpi >= 55) return "WAIT";
  return "IDLE";
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

/* ─── colour helpers ─── */
function confidenceColor(pct: number) {
  if (pct > 90) return { ring: "#c62828", glow: "rgba(198,40,40,0.35)" };
  if (pct > 75) return { ring: "#bf360c", glow: "rgba(191,54,12,0.2)" };
  if (pct > 60) return { ring: "#f9a825", glow: "rgba(249,168,37,0.15)" };
  return { ring: "#607d8b", glow: "rgba(96,125,139,0.1)" };
}

function exitColor() {
  return { ring: "#6d1b1b", glow: "rgba(109,27,27,0.2)" };
}

/* ─── Arc path helper ─── */
function describeArc(cx: number, cy: number, r: number, startAngle: number, endAngle: number) {
  const rad = (a: number) => ((a - 90) * Math.PI) / 180;
  const x1 = cx + r * Math.cos(rad(startAngle));
  const y1 = cy + r * Math.sin(rad(startAngle));
  const x2 = cx + r * Math.cos(rad(endAngle));
  const y2 = cy + r * Math.sin(rad(endAngle));
  const large = endAngle - startAngle > 180 ? 1 : 0;
  return `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`;
}

/* ─── Sparkline ─── */
function GaugeSparkline({ data, directive }: { data: number[]; directive: Directive }) {
  if (!data.length) return null;
  const w = 320, h = 48, pad = 2;
  const min = Math.min(...data), max = Math.max(...data);
  const range = max - min || 1;
  const pts = data.map((v, i) => {
    const x = pad + (i / (data.length - 1)) * (w - pad * 2);
    const y = h - pad - ((v - min) / range) * (h - pad * 2);
    return `${x},${y}`;
  });
  const lastSegIdx = Math.max(0, data.length - 4);

  return (
    <svg width={w} height={h} className="opacity-60">
      {/* main line */}
      <polyline
        points={pts.join(" ")}
        fill="none"
        stroke="rgba(255,255,255,0.35)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* last segment emphasis */}
      <polyline
        points={pts.slice(lastSegIdx).join(" ")}
        fill="none"
        stroke={directive === "EXIT" ? "rgba(109,27,27,0.7)" : directive === "ENTER" ? "rgba(255,255,255,0.7)" : "rgba(255,255,255,0.45)"}
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/* ─── Radial indicator line color ─── */
function radialColor(d: Directive): string {
  if (d === "ENTER") return "rgba(198,40,40,0.55)";
  if (d === "EXIT")  return "rgba(109,27,27,0.45)";
  if (d === "WAIT")  return "rgba(96,125,139,0.45)";
  return "rgba(255,255,255,0.08)";
}

/* ─── Radial lines component ─── */
function RadialIndicators({ signals, cx, cy, innerR, outerR }: {
  signals: Signal[];
  cx: number; cy: number; innerR: number; outerR: number;
}) {
  const eligible = useMemo(() => {
    if (!signals?.length) return [];
    return [...signals]
      .filter(s => (s.confidence_pct ?? 0) >= 60)
      .sort((a, b) => (b.confidence_pct ?? 0) - (a.confidence_pct ?? 0))
      .slice(0, 7);
  }, [signals]);

  if (!eligible.length) return null;

  const count = eligible.length;
  // Distribute evenly around full circle
  const angleStep = 360 / count;

  return (
    <>
      {eligible.map((s, i) => {
        const conf = clamp(s.confidence_pct ?? 0, 0, 100);
        const directive = deriveDirective(s);
        const angle = ((i * angleStep) - 90) * (Math.PI / 180); // start from top
        const gap = 14; // gap from outer ring
        const r1 = outerR + gap;
        const maxLen = 38;
        const len = 8 + (conf / 100) * maxLen; // length proportional to confidence
        const r2 = r1 + len;
        const x1 = cx + r1 * Math.cos(angle);
        const y1 = cy + r1 * Math.sin(angle);
        const x2 = cx + r2 * Math.cos(angle);
        const y2 = cy + r2 * Math.sin(angle);

        return (
          <line
            key={s.netuid ?? i}
            x1={x1} y1={y1} x2={x2} y2={y2}
            stroke={radialColor(directive)}
            strokeWidth={1.5}
            strokeLinecap="round"
          />
        );
      })}
    </>
  );
}

/* ═══════════════════════════════════════ */
/*           ALIEN GAUGE PAGE             */
/* ═══════════════════════════════════════ */
export default function AlienGauge() {
  /* ─── data ─── */
  const { data: signals } = useQuery({
    queryKey: ["signals-latest"],
    queryFn: async () => {
      const { data, error } = await supabase.from("signals_latest").select("*");
      if (error) throw error;
      return (data || []) as Signal[];
    },
    refetchInterval: 300_000, // 5 min
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

  /* ─── market energy ─── */
  const prevEnergy = useRef<number | null>(null);
  const marketEnergy = useMemo(() => {
    if (!signals?.length) return 0;
    const mpis = signals.map(s => s.mpi ?? s.score ?? 0);
    return Math.round(mpis.reduce((a, b) => a + b, 0) / mpis.length);
  }, [signals]);

  const energyArrow = useMemo(() => {
    if (prevEnergy.current === null) { prevEnergy.current = marketEnergy; return ""; }
    const arrow = marketEnergy > prevEnergy.current ? "↑" : marketEnergy < prevEnergy.current ? "↓" : "";
    prevEnergy.current = marketEnergy;
    return arrow;
  }, [marketEnergy]);

  /* ─── rotation candidates ─── */
  const candidates = useMemo(() => {
    if (!signals?.length) return [];
    return [...signals]
      .filter(s => (s.confidence_pct ?? 0) >= 60)
      .sort((a, b) => (b.confidence_pct ?? 0) - (a.confidence_pct ?? 0))
      .slice(0, 3);
  }, [signals]);

  // If any EXIT, find it
  const exitSignal = useMemo(() => signals?.find(s => s.state === "BREAK") ?? null, [signals]);

  /* ─── rotation state ─── */
  const [activeIdx, setActiveIdx] = useState(0);
  const [fading, setFading] = useState(false);

  useEffect(() => {
    if (exitSignal || candidates.length <= 1) return;
    const interval = setInterval(() => {
      setFading(true);
      setTimeout(() => {
        setActiveIdx(i => (i + 1) % candidates.length);
        setFading(false);
      }, 250);
    }, 6000);
    return () => clearInterval(interval);
  }, [candidates.length, exitSignal]);

  // Reset idx when candidates change
  useEffect(() => { setActiveIdx(0); }, [candidates.length]);

  /* ─── active signal ─── */
  const active: Signal | null = exitSignal ?? candidates[activeIdx % Math.max(candidates.length, 1)] ?? (signals?.[0] ?? null);
  const directive = active ? deriveDirective(active) : "IDLE";
  const conf = clamp(active?.confidence_pct ?? 0, 0, 100);
  const mpi = active?.mpi ?? active?.score ?? 0;
  const subnetName = active?.subnet_name || (active?.netuid != null ? `SN-${active.netuid}` : "—");
  const sparkData = active?.netuid != null ? (sparklines?.[active.netuid] ?? []) : [];

  /* ─── gauge values ─── */
  const outerAngle = (marketEnergy / 100) * 270; // market energy → outer ring
  const innerAngle = (conf / 100) * 270;          // confidence → inner ring
  // micro arc: 5m momentum approximation from MPI
  const microAngle = clamp((mpi / 100) * 90, 0, 90);

  const colors = directive === "EXIT" ? exitColor() : confidenceColor(conf);

  /* ─── breathing animation phase ─── */
  const [breathe, setBreathe] = useState(0);
  useEffect(() => {
    let raf: number;
    const start = performance.now();
    const tick = (now: number) => {
      const t = ((now - start) % 2500) / 2500;
      setBreathe(Math.sin(t * Math.PI * 2) * 0.5 + 0.5);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const glowOpacity = conf > 90 ? 0.18 + breathe * 0.22 : conf > 75 ? 0.1 + breathe * 0.12 : 0;

  const SIZE = 480;
  const SVG_SIZE = 560; // larger to accommodate radial lines
  const CX = SVG_SIZE / 2, CY = SVG_SIZE / 2;

  return (
    <div
      className="fixed inset-0 flex flex-col items-center justify-center select-none"
      style={{ background: "#050505", overflow: "hidden" }}
    >
      {/* ─── HEADER ─── */}
      <div className="absolute top-6 left-0 right-0 text-center">
        <span
          className="font-mono text-xs tracking-[0.3em] uppercase"
          style={{ color: "rgba(255,255,255,0.25)" }}
        >
          ENERGY {marketEnergy}% {energyArrow}
        </span>
      </div>

      {/* ─── GAUGE ─── */}
      <div
        className="relative"
        style={{
          width: SIZE,
          height: SIZE,
          transition: "opacity 250ms ease",
          opacity: fading ? 0 : 1,
        }}
      >
        {/* glow layer */}
        {glowOpacity > 0 && (
          <div
            className="absolute inset-0 rounded-full pointer-events-none"
            style={{
              background: `radial-gradient(circle, ${colors.glow} 0%, transparent 70%)`,
              opacity: glowOpacity,
              transform: "scale(1.3)",
            }}
          />
        )}

        <svg width={SIZE} height={SIZE} viewBox={`${(SVG_SIZE - SIZE) / -2} ${(SVG_SIZE - SIZE) / -2} ${SVG_SIZE} ${SVG_SIZE}`} style={{ overflow: "visible" }}>
          {/* outer track */}
          <circle cx={CX} cy={CY} r={210} fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="7" />
          {/* outer ring — market energy */}
          {outerAngle > 0 && (
            <path
              d={describeArc(CX, CY, 210, -135, -135 + outerAngle)}
              fill="none"
              stroke={colors.ring}
              strokeWidth="7"
              strokeLinecap="round"
              style={{ opacity: 0.7, transition: "d 500ms ease, stroke 500ms ease" }}
            />
          )}

          {/* inner track */}
          <circle cx={CX} cy={CY} r={180} fill="none" stroke="rgba(255,255,255,0.03)" strokeWidth="8" />
          {/* inner ring — confidence */}
          {innerAngle > 0 && (
            <path
              d={describeArc(CX, CY, 180, -135, -135 + innerAngle)}
              fill="none"
              stroke={colors.ring}
              strokeWidth="8"
              strokeLinecap="round"
              style={{ opacity: 0.9, transition: "d 500ms ease, stroke 500ms ease" }}
            />
          )}

          {/* radial indicators */}
          <RadialIndicators signals={signals ?? []} cx={CX} cy={CY} innerR={180} outerR={210} />

          {/* micro arc — acceleration */}
          {microAngle > 2 && (
            <path
              d={describeArc(CX, CY, 155, -135, -135 + microAngle)}
              fill="none"
              stroke={colors.ring}
              strokeWidth="3"
              strokeLinecap="round"
              style={{ opacity: 0.5, transition: "d 500ms ease" }}
            />
          )}
        </svg>

        {/* center text */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span
            className="font-mono font-light leading-none"
            style={{ fontSize: 70, color: colors.ring, transition: "color 500ms ease" }}
          >
            {conf}%
          </span>
          <span
            className="font-mono text-base tracking-[0.55em] mt-3"
            style={{ color: colors.ring, opacity: 0.85, transition: "color 500ms ease" }}
          >
            {directive}
          </span>
          <span
            className="font-mono text-xs tracking-[0.25em] mt-4"
            style={{ color: "rgba(255,255,255,0.3)" }}
          >
            {subnetName}
          </span>
        </div>
      </div>

      {/* ─── SPARKLINE ─── */}
      <div className="mt-8" style={{ transition: "opacity 250ms ease", opacity: fading ? 0 : 1 }}>
        <GaugeSparkline data={sparkData} directive={directive} />
      </div>

      {/* ─── rotation dots ─── */}
      {candidates.length > 1 && !exitSignal && (
        <div className="flex gap-1.5 mt-5">
          {candidates.map((_, i) => (
            <div
              key={i}
              className="rounded-full"
              style={{
                width: 4,
                height: 4,
                background: i === activeIdx % candidates.length ? "rgba(255,255,255,0.5)" : "rgba(255,255,255,0.12)",
                transition: "background 300ms ease",
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
