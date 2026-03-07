import type { ReactNode } from "react";

type WarningLevel = "warning" | "critical" | "info";

interface WarningBannerProps {
  level: WarningLevel;
  icon?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}

const levelStyles: Record<WarningLevel, { bg: string; border: string; iconColor: string }> = {
  info:     { bg: "hsla(210,80%,55%,0.04)", border: "hsla(210,80%,55%,0.12)", iconColor: "hsl(210,80%,55%)" },
  warning:  { bg: "hsla(38,92%,55%,0.04)",  border: "hsla(38,92%,55%,0.12)",  iconColor: "hsl(38,92%,55%)" },
  critical: { bg: "hsla(4,80%,50%,0.04)",   border: "hsla(4,80%,50%,0.12)",   iconColor: "hsl(4,80%,50%)" },
};

export function WarningBanner({ level, icon, title, description, action }: WarningBannerProps) {
  const s = levelStyles[level];
  const defaultIcon = level === "critical" ? "🚨" : level === "warning" ? "⚠" : "ℹ";

  return (
    <div
      className="flex items-start gap-3 rounded-xl px-4 py-3"
      style={{ background: s.bg, border: `1px solid ${s.border}` }}
    >
      <span className="flex-shrink-0 mt-0.5" style={{ fontSize: 14, color: s.iconColor }}>
        {icon ?? defaultIcon}
      </span>
      <div className="flex-1 min-w-0">
        <div className="font-mono text-[11px] font-bold tracking-wider" style={{ color: s.iconColor }}>
          {title}
        </div>
        {description && (
          <div className="font-mono text-[9px] text-muted-foreground/50 mt-0.5 leading-relaxed">
            {description}
          </div>
        )}
      </div>
      {action && <div className="flex-shrink-0">{action}</div>}
    </div>
  );
}
