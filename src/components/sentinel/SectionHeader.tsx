import type { ReactNode } from "react";

interface SectionHeaderProps {
  title: string;
  icon?: string;
  accentVar?: string;
  badge?: ReactNode;
  compact?: boolean;
}

export function SectionHeader({ title, icon, accentVar = "--gold", badge, compact }: SectionHeaderProps) {
  return (
    <div className={`flex items-center gap-2.5 ${compact ? "mb-3" : "mb-5"}`}>
      {icon && <span style={{ fontSize: compact ? 11 : 13, opacity: 0.6 }}>{icon}</span>}
      <span
        className="font-mono tracking-[0.2em] uppercase font-bold"
        style={{ fontSize: compact ? 9 : 10, color: `hsla(var(${accentVar}), 0.65)` }}
      >
        {title}
      </span>
      <div className="flex-1 h-px" style={{ background: `hsla(var(${accentVar}), 0.06)` }} />
      {badge}
    </div>
  );
}
