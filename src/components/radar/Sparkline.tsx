import React, { useMemo } from "react";

type Props = {
  /** Array of numeric values (oldest → newest) */
  data: number[];
  width?: number;
  height?: number;
  className?: string;
};

/**
 * Micro sparkline SVG — green if trending up, red if down, muted if flat.
 */
export default function Sparkline({ data, width = 48, height = 18, className = "" }: Props) {
  const { path, color } = useMemo(() => {
    if (!data.length || data.length < 2) {
      return { path: "", color: "hsl(var(--muted-foreground) / 0.3)" };
    }

    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1;

    const points = data.map((v, i) => {
      const x = (i / (data.length - 1)) * width;
      const y = height - ((v - min) / range) * (height - 2) - 1;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });

    const trend = data[data.length - 1] - data[0];
    const threshold = range * 0.05;

    let c: string;
    if (trend > threshold) c = "hsl(var(--signal-go) / 0.7)";
    else if (trend < -threshold) c = "hsl(var(--destructive) / 0.7)";
    else c = "hsl(var(--muted-foreground) / 0.35)";

    return { path: `M${points.join("L")}`, color: c };
  }, [data, width, height]);

  if (!path) return null;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={`shrink-0 ${className}`}
      aria-hidden="true"
    >
      <path d={path} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
