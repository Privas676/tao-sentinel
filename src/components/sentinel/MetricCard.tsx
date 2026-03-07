interface MetricCardProps {
  label: string;
  value: string | number;
  icon?: string;
  color?: string;
  /** 0-100 for progress bar */
  progress?: number;
  subtext?: string;
}

export function MetricCard({ label, value, icon, color = "hsl(var(--foreground))", progress, subtext }: MetricCardProps) {
  return (
    <div
      className="rounded-lg px-3 py-3 flex flex-col items-center gap-1.5"
      style={{
        background: "hsla(0,0%,100%,0.015)",
        border: "1px solid hsla(0,0%,100%,0.05)",
      }}
    >
      <div className="flex items-center gap-1.5">
        {icon && <span style={{ fontSize: 11 }}>{icon}</span>}
        <span className="font-mono text-[8px] tracking-wider text-muted-foreground/40 uppercase">{label}</span>
      </div>
      <span className="font-mono text-sm font-bold leading-none" style={{ color }}>{value}</span>
      {typeof progress === "number" && (
        <div className="w-full h-[3px] rounded-full overflow-hidden" style={{ background: "hsla(0,0%,100%,0.04)" }}>
          <div
            className="h-full rounded-full transition-all duration-700"
            style={{ width: `${Math.min(progress, 100)}%`, background: color }}
          />
        </div>
      )}
      {subtext && (
        <span className="font-mono text-[7px] text-muted-foreground/30">{subtext}</span>
      )}
    </div>
  );
}
