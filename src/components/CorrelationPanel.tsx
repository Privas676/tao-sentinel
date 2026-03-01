import { useMemo } from "react";

/* ── Pearson correlation ── */
function pearson(x: number[], y: number[]): number {
  const n = x.length;
  if (n < 3) return 0;
  const mx = x.reduce((a, b) => a + b, 0) / n;
  const my = y.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - mx;
    const dy = y[i] - my;
    num += dx * dy;
    dx2 += dx * dx;
    dy2 += dy * dy;
  }
  const denom = Math.sqrt(dx2 * dy2);
  return denom === 0 ? 0 : num / denom;
}

type DiagnosticZone = "excessive" | "ideal" | "suspect";

function classifyCorrelation(r: number): DiagnosticZone {
  if (r < -0.7) return "excessive";
  if (r > -0.3) return "suspect";
  return "ideal";
}

const ZONE_STYLES: Record<DiagnosticZone, { bg: string; border: string; color: string; label: { en: string; fr: string } }> = {
  excessive: {
    bg: "rgba(229,57,53,0.08)",
    border: "rgba(229,57,53,0.2)",
    color: "rgba(229,57,53,0.85)",
    label: { en: "Excessive dependency (r < −0.7)", fr: "Dépendance excessive (r < −0.7)" },
  },
  ideal: {
    bg: "rgba(76,175,80,0.08)",
    border: "rgba(76,175,80,0.15)",
    color: "rgba(76,175,80,0.7)",
    label: { en: "Ideal zone (−0.7 ≤ r ≤ −0.3)", fr: "Zone idéale (−0.7 ≤ r ≤ −0.3)" },
  },
  suspect: {
    bg: "rgba(255,183,77,0.1)",
    border: "rgba(255,183,77,0.25)",
    color: "rgba(255,183,77,0.85)",
    label: { en: "Suspicious independence (r > −0.3)", fr: "Indépendance suspecte (r > −0.3)" },
  },
};

/* ── Scatter Plot (pure SVG) ── */
function ScatterPlot({ psi, risk }: { psi: number[]; risk: number[] }) {
  const W = 280;
  const H = 200;
  const PAD = 28;

  const points = useMemo(() => {
    return psi.map((p, i) => ({
      x: PAD + ((p / 100) * (W - PAD * 2)),
      y: H - PAD - ((risk[i] / 100) * (H - PAD * 2)),
      psi: p,
      risk: risk[i],
    }));
  }, [psi, risk]);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-[320px]" style={{ height: "auto" }}>
      {/* Grid */}
      {[0, 25, 50, 75, 100].map(v => {
        const x = PAD + (v / 100) * (W - PAD * 2);
        const y = H - PAD - (v / 100) * (H - PAD * 2);
        return (
          <g key={v}>
            <line x1={x} y1={PAD} x2={x} y2={H - PAD} stroke="rgba(255,255,255,0.04)" strokeWidth={0.5} />
            <line x1={PAD} y1={y} x2={W - PAD} y2={y} stroke="rgba(255,255,255,0.04)" strokeWidth={0.5} />
            <text x={x} y={H - PAD + 12} textAnchor="middle" fill="rgba(255,255,255,0.15)" fontSize={7} fontFamily="monospace">{v}</text>
            <text x={PAD - 4} y={y + 3} textAnchor="end" fill="rgba(255,255,255,0.15)" fontSize={7} fontFamily="monospace">{v}</text>
          </g>
        );
      })}

      {/* Axes labels */}
      <text x={W / 2} y={H - 2} textAnchor="middle" fill="rgba(255,255,255,0.25)" fontSize={8} fontFamily="monospace">PSI</text>
      <text x={6} y={H / 2} textAnchor="middle" fill="rgba(255,255,255,0.25)" fontSize={8} fontFamily="monospace" transform={`rotate(-90,6,${H / 2})`}>Risk</text>

      {/* Points */}
      {points.map((pt, i) => (
        <circle
          key={i}
          cx={pt.x}
          cy={pt.y}
          r={3}
          fill="rgba(76,175,80,0.5)"
          stroke="rgba(76,175,80,0.8)"
          strokeWidth={0.5}
        >
          <title>PSI: {pt.psi.toFixed(1)} / Risk: {pt.risk.toFixed(1)}</title>
        </circle>
      ))}
    </svg>
  );
}

/* ── Main Panel ── */
export default function CorrelationPanel({ psiValues, riskValues, fr }: { psiValues: number[]; riskValues: number[]; fr: boolean }) {
  const r = useMemo(() => pearson(psiValues, riskValues), [psiValues, riskValues]);
  const rRound = Math.round(r * 1000) / 1000;
  const zone = classifyCorrelation(r);
  const style = ZONE_STYLES[zone];

  if (psiValues.length < 3) return null;

  return (
    <div className="border border-white/[0.06] rounded-lg p-4 space-y-4">
      <span className="font-mono text-xs tracking-widest text-white/50">
        {fr ? "CORRÉLATION PSI × RISK" : "PSI × RISK CORRELATION"}
      </span>

      {/* Coefficient */}
      <div className="flex items-center gap-3">
        <span
          className="font-mono text-2xl font-bold"
          style={{ color: style.color }}
        >
          r = {rRound > 0 ? "+" : ""}{rRound.toFixed(3)}
        </span>
        <span className="font-mono text-[10px] text-white/30">
          Pearson · n={psiValues.length}
        </span>
      </div>

      {/* Zone badge */}
      <div
        className="font-mono text-[9px] px-2 py-1 rounded inline-block"
        style={{ background: style.bg, color: style.color, border: `1px solid ${style.border}` }}
      >
        {zone === "ideal" ? "✓" : "⚠"} {fr ? style.label.fr : style.label.en}
      </div>

      {/* Scatter */}
      <ScatterPlot psi={psiValues} risk={riskValues} />

      {/* Legend */}
      <div className="font-mono text-[8px] text-white/20 space-y-0.5">
        <div>{fr ? "r < −0.7 → dépendance excessive (Risk ≈ miroir de PSI)" : "r < −0.7 → excessive dependency (Risk ≈ mirror of PSI)"}</div>
        <div>{fr ? "−0.7 ≤ r ≤ −0.3 → zone idéale (anticorrélation modérée)" : "−0.7 ≤ r ≤ −0.3 → ideal zone (moderate anticorrelation)"}</div>
        <div>{fr ? "r > −0.3 → indépendance suspecte (scores potentiellement découplés)" : "r > −0.3 → suspicious independence (scores potentially decoupled)"}</div>
      </div>
    </div>
  );
}
