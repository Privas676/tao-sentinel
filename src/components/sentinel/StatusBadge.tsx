type StatusType = "success" | "warning" | "danger" | "neutral" | "info";

interface StatusBadgeProps {
  type: StatusType;
  label: string;
  pulse?: boolean;
  icon?: string;
}

const statusStyles: Record<StatusType, { bg: string; color: string; border: string }> = {
  success: { bg: "hsla(145,65%,48%,0.08)", color: "hsl(145,65%,48%)", border: "hsla(145,65%,48%,0.2)" },
  warning: { bg: "hsla(38,92%,55%,0.08)", color: "hsl(38,92%,55%)", border: "hsla(38,92%,55%,0.2)" },
  danger:  { bg: "hsla(4,80%,50%,0.08)", color: "hsl(4,80%,50%)", border: "hsla(4,80%,50%,0.2)" },
  neutral: { bg: "hsla(0,0%,100%,0.04)", color: "hsl(var(--muted-foreground))", border: "hsla(0,0%,100%,0.08)" },
  info:    { bg: "hsla(210,80%,55%,0.08)", color: "hsl(210,80%,55%)", border: "hsla(210,80%,55%,0.2)" },
};

export function StatusBadge({ type, label, pulse, icon }: StatusBadgeProps) {
  const s = statusStyles[type];
  return (
    <span
      className={`inline-flex items-center gap-1 font-mono text-[9px] font-bold px-2 py-0.5 rounded tracking-wider ${pulse ? "animate-pulse" : ""}`}
      style={{ background: s.bg, color: s.color, border: `1px solid ${s.border}` }}
    >
      {icon && <span style={{ fontSize: 10 }}>{icon}</span>}
      {label}
    </span>
  );
}
