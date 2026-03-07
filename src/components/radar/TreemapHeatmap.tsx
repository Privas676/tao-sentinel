import React, { useMemo, useState } from "react";
import { type SubnetRadarData } from "@/hooks/use-stake-analytics";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/* ─── Mode definitions ─── */
type HeatMode = "capital" | "adoption" | "risk" | "burn";

const MODES: { key: HeatMode; label: string; icon: string }[] = [
  { key: "capital", label: "Capital Inflow", icon: "💰" },
  { key: "adoption", label: "Adoption", icon: "🚀" },
  { key: "risk", label: "Dump Risk", icon: "⚠️" },
  { key: "burn", label: "Burn Rate", icon: "🔥" },
];

function getScore(d: SubnetRadarData, mode: HeatMode): number {
  switch (mode) {
    case "capital": return d.scores.capitalMomentum;
    case "adoption": return d.scores.healthIndex;
    case "risk": return d.scores.dumpRisk;
    case "burn": return Math.round(d.snapshot.uidUsage * 100);
  }
}

function scoreColor(value: number, mode: HeatMode): string {
  if (mode === "risk") {
    // Inverted: high risk = red
    if (value >= 70) return "hsla(4, 80%, 50%, 0.75)";
    if (value >= 45) return "hsla(25, 100%, 50%, 0.6)";
    if (value >= 25) return "hsla(45, 100%, 50%, 0.45)";
    return "hsla(145, 65%, 48%, 0.4)";
  }
  // Normal: high = green
  if (value >= 70) return "hsla(145, 65%, 48%, 0.65)";
  if (value >= 50) return "hsla(45, 100%, 50%, 0.45)";
  if (value >= 30) return "hsla(25, 100%, 50%, 0.5)";
  return "hsla(4, 80%, 50%, 0.5)";
}

function formatCap(v: number): string {
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}Mτ`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(0)}Kτ`;
  return `${Math.round(v)}τ`;
}

/* ─── Squarified Treemap Layout ─── */
type TreeRect = { netuid: number; x: number; y: number; w: number; h: number; data: SubnetRadarData };

function squarify(
  items: { netuid: number; area: number; data: SubnetRadarData }[],
  containerW: number,
  containerH: number
): TreeRect[] {
  if (!items.length) return [];

  const totalArea = items.reduce((s, i) => s + i.area, 0);
  const scale = (containerW * containerH) / totalArea;
  const scaled = items.map((i) => ({ ...i, scaledArea: i.area * scale }));

  const rects: TreeRect[] = [];
  layoutStrip(scaled, 0, 0, containerW, containerH, rects);
  return rects;
}

function layoutStrip(
  items: { netuid: number; scaledArea: number; data: SubnetRadarData }[],
  x: number, y: number, w: number, h: number,
  rects: TreeRect[]
) {
  if (items.length === 0) return;
  if (items.length === 1) {
    rects.push({ netuid: items[0].netuid, x, y, w, h, data: items[0].data });
    return;
  }

  const total = items.reduce((s, i) => s + i.scaledArea, 0);
  const isHorizontal = w >= h;

  let rowArea = 0;
  let bestRatio = Infinity;
  let splitIdx = 1;

  for (let i = 0; i < items.length; i++) {
    rowArea += items[i].scaledArea;
    const rowFraction = rowArea / total;
    const stripSize = isHorizontal ? w * rowFraction : h * rowFraction;

    // Compute worst aspect ratio in this strip
    let worst = 0;
    let accum = 0;
    for (let j = 0; j <= i; j++) {
      accum += items[j].scaledArea;
      const otherSize = isHorizontal ? h : w;
      const itemSize = (items[j].scaledArea / rowArea) * otherSize;
      const ratio = Math.max(stripSize / itemSize, itemSize / stripSize);
      worst = Math.max(worst, ratio);
    }

    if (worst <= bestRatio) {
      bestRatio = worst;
      splitIdx = i + 1;
    } else {
      break;
    }
  }

  const strip = items.slice(0, splitIdx);
  const rest = items.slice(splitIdx);
  const stripTotal = strip.reduce((s, i) => s + i.scaledArea, 0);
  const fraction = stripTotal / total;

  if (isHorizontal) {
    const stripW = w * fraction;
    let cy = y;
    for (const item of strip) {
      const itemH = (item.scaledArea / stripTotal) * h;
      rects.push({ netuid: item.netuid, x, y: cy, w: stripW, h: itemH, data: item.data });
      cy += itemH;
    }
    layoutStrip(rest, x + stripW, y, w - stripW, h, rects);
  } else {
    const stripH = h * fraction;
    let cx = x;
    for (const item of strip) {
      const itemW = (item.scaledArea / stripTotal) * w;
      rects.push({ netuid: item.netuid, x: cx, y, w: itemW, h: stripH, data: item.data });
      cx += itemW;
    }
    layoutStrip(rest, x, y + stripH, w, h - stripH, rects);
  }
}

/* ─── Component ─── */
export default function TreemapHeatmap({ data }: { data: SubnetRadarData[] }) {
  const [mode, setMode] = useState<HeatMode>("capital");

  // Use stakeTotal as proxy for market cap; fallback to equal sizing if all zero
  const filtered = useMemo(() => {
    const withStake = data.filter((d) => d.snapshot.stakeTotal > 0);
    // If no subnet has stake data, show all with equal sizing
    if (withStake.length === 0) return data;
    return withStake;
  }, [data]);

  const allZeroStake = useMemo(() => data.every((d) => d.snapshot.stakeTotal === 0), [data]);

  const excluded = data.length - filtered.length;

  // Treemap dimensions
  const W = 800;
  const H = 500;

  const rects = useMemo(() => {
    const items = filtered
      .map((d) => ({ netuid: d.netuid, area: allZeroStake ? 1 : d.snapshot.stakeTotal, data: d }))
      .sort((a, b) => b.area - a.area)
      .slice(0, 60); // limit for performance
    return squarify(items, W, H);
  }, [filtered, allZeroStake]);

  return (
    <div className="p-4 space-y-3">
      {/* Mode Selector */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-mono text-[10px] tracking-widest uppercase text-muted-foreground">Mode :</span>
        {MODES.map((m) => (
          <button
            key={m.key}
            onClick={() => setMode(m.key)}
            className="px-2.5 py-1 rounded font-mono text-[11px] transition-all"
            style={{
              background: mode === m.key ? "hsl(var(--accent))" : "transparent",
              color: mode === m.key ? "hsl(var(--foreground))" : "hsl(var(--muted-foreground))",
              border: mode === m.key ? "1px solid hsl(var(--border))" : "1px solid transparent",
            }}
          >
            {m.icon} {m.label}
          </button>
        ))}
      </div>

      {/* Treemap */}
      <TooltipProvider delayDuration={100}>
        <div className="w-full overflow-hidden rounded-lg" style={{ border: "1px solid hsl(var(--border))" }}>
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="w-full h-auto"
            style={{ maxHeight: "520px" }}
          >
            {rects.map((r) => {
              const score = getScore(r.data, mode);
              const bg = scoreColor(score, mode);
              const isSmall = r.w < 50 || r.h < 30;
              const isTiny = r.w < 30 || r.h < 20;
              const name = r.data.subnetName.length > 10
                ? `SN-${r.netuid}`
                : r.data.subnetName;

              return (
                <Tooltip key={r.netuid}>
                  <TooltipTrigger asChild>
                    <g className="cursor-pointer transition-opacity hover:opacity-80">
                      <rect
                        x={r.x + 1}
                        y={r.y + 1}
                        width={Math.max(r.w - 2, 0)}
                        height={Math.max(r.h - 2, 0)}
                        rx={3}
                        fill={bg}
                        stroke="hsl(var(--background))"
                        strokeWidth={1.5}
                      />
                      {!isTiny && (
                        <>
                          <text
                            x={r.x + r.w / 2}
                            y={r.y + r.h / 2 + (isSmall ? 0 : -5)}
                            textAnchor="middle"
                            dominantBaseline="central"
                            className="font-mono"
                            style={{
                              fontSize: isSmall ? "8px" : "10px",
                              fill: "rgba(255,255,255,0.85)",
                              fontWeight: 600,
                            }}
                          >
                            {isSmall ? `${r.netuid}` : name}
                          </text>
                          {!isSmall && (
                            <text
                              x={r.x + r.w / 2}
                              y={r.y + r.h / 2 + 10}
                              textAnchor="middle"
                              dominantBaseline="central"
                              className="font-mono"
                              style={{ fontSize: "9px", fill: "rgba(255,255,255,0.55)" }}
                            >
                              {score}
                            </text>
                          )}
                        </>
                      )}
                    </g>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-[200px]">
                    <div className="space-y-1">
                      <div className="font-mono text-xs font-semibold">
                        SN-{r.netuid} · {r.data.subnetName}
                      </div>
                      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 font-mono text-[10px]">
                        <span className="text-muted-foreground">Cap</span>
                        <span>{formatCap(r.data.snapshot.stakeTotal)}</span>
                        <span className="text-muted-foreground">Capital</span>
                        <span>{r.data.scores.capitalMomentum}</span>
                        <span className="text-muted-foreground">Adoption</span>
                        <span>{r.data.scores.healthIndex}</span>
                        <span className="text-muted-foreground">Dump Risk</span>
                        <span>{r.data.scores.dumpRisk}</span>
                        <span className="text-muted-foreground">Burn</span>
                        <span>{Math.round(r.data.snapshot.uidUsage * 100)}%</span>
                      </div>
                    </div>
                  </TooltipContent>
                </Tooltip>
              );
            })}
          </svg>
        </div>
      </TooltipProvider>

      {/* Footer */}
      <div className="flex justify-between font-mono text-[10px] text-muted-foreground/50">
        <span>{filtered.length} subnets · taille = stake total</span>
        {excluded > 0 && <span>{excluded} exclus (stake = 0)</span>}
      </div>
    </div>
  );
}
