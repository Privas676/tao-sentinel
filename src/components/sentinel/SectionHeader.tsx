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
    <div className={`flex items-center gap-2.5 ${compact ? "mb-2" : "mb-4"}`}>
      {icon && <span style={{ fontSize: compact ? 11 : 14 }}>{icon}</span>}
      <span
        className="font-mono tracking-[0.2em] uppercase font-bold"
        style={{ fontSize: compact ? 9 : 11, color: `hsla(var(${accentVar}), 0.7)` }}
      >
        {title}
      </span>
      <div className="flex-1 h-px" style={{ background: `hsla(var(${accentVar}), 0.08)` }} />
      {badge}
    </div>
  );
}
