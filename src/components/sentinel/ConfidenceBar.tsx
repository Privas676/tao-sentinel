interface ConfidenceBarProps {
  value: number; // 0-100
  label?: string;
  height?: number;
  showValue?: boolean;
}

export function ConfidenceBar({ value, label, height = 4, showValue = true }: ConfidenceBarProps) {
  const clamped = Math.max(0, Math.min(100, value));
  const color =
    clamped >= 70 ? "hsl(145,65%,48%)" :
    clamped >= 45 ? "hsl(38,92%,55%)" :
    "hsl(4,80%,50%)";

  return (
    <div className="flex items-center gap-2 w-full">
      {label && (
        <span className="font-mono text-[8px] text-muted-foreground/40 tracking-wider uppercase flex-shrink-0" style={{ minWidth: 40 }}>
          {label}
        </span>
      )}
      <div
        className="flex-1 rounded-full overflow-hidden"
        style={{ height, background: "hsla(0,0%,100%,0.04)" }}
      >
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${clamped}%`, background: color }}
        />
      </div>
      {showValue && (
        <span className="font-mono text-[9px] font-bold flex-shrink-0" style={{ color, minWidth: 24, textAlign: "right" }}>
          {clamped}%
        </span>
      )}
    </div>
  );
}
