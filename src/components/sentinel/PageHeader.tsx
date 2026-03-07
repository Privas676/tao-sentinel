import type { ReactNode } from "react";
import { useIsMobile } from "@/hooks/use-mobile";

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  icon?: string;
  badge?: ReactNode;
  actions?: ReactNode;
}

export function PageHeader({ title, subtitle, icon, badge, actions }: PageHeaderProps) {
  const isMobile = useIsMobile();

  return (
    <div className="flex flex-col gap-1.5 mb-7">
      <div className="flex items-center gap-3 flex-wrap">
        {icon && <span style={{ fontSize: isMobile ? 16 : 18, opacity: 0.7 }}>{icon}</span>}
        <h1
          className="font-mono tracking-[0.18em] uppercase leading-none"
          style={{ fontSize: isMobile ? 14 : 17, color: "hsl(var(--gold))", fontWeight: 700 }}
        >
          {title}
        </h1>
        {badge && <div className="flex-shrink-0">{badge}</div>}
        {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
      </div>
      {subtitle && (
        <p className="font-mono text-muted-foreground" style={{ fontSize: 10, letterSpacing: "0.04em", maxWidth: 550, opacity: 0.5, lineHeight: 1.5 }}>
          {subtitle}
        </p>
      )}
    </div>
  );
}
