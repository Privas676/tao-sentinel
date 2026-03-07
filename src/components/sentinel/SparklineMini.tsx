import { useMemo } from "react";

interface SparklineMiniProps {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  showDot?: boolean;
}

export function SparklineMini({ data, width = 60, height = 20, color, showDot = true }: SparklineMiniProps) {
  const { path, dotX, dotY, lineColor } = useMemo(() => {
    if (!data.length) return { path: "", dotX: 0, dotY: 0, lineColor: "hsl(var(--muted-foreground))" };
    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1;
    const pad = 2;
    const w = width - pad * 2;
    const h = height - pad * 2;

    const points = data.map((v, i) => ({
      x: pad + (i / (data.length - 1 || 1)) * w,
      y: pad + h - ((v - min) / range) * h,
    }));

    const d = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
    const last = points[points.length - 1];
    const trend = data.length >= 2 ? data[data.length - 1] - data[0] : 0;
    const c = color ?? (trend > 0 ? "hsl(145,65%,48%)" : trend < 0 ? "hsl(4,80%,50%)" : "hsl(var(--muted-foreground))");

    return { path: d, dotX: last.x, dotY: last.y, lineColor: c };
  }, [data, width, height, color]);

  if (!data.length) return <div style={{ width, height }} />;

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="flex-shrink-0">
      <path d={path} fill="none" stroke={lineColor} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" opacity={0.7} />
      {showDot && <circle cx={dotX} cy={dotY} r={2} fill={lineColor} />}
    </svg>
  );
}
