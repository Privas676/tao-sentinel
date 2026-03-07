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
    <div className="flex flex-col gap-1 mb-6">
      <div className="flex items-center gap-3 flex-wrap">
        {icon && <span style={{ fontSize: isMobile ? 16 : 20 }}>{icon}</span>}
        <h1
          className="font-mono tracking-[0.15em] uppercase leading-none"
          style={{ fontSize: isMobile ? 14 : 18, color: "hsl(var(--gold))", fontWeight: 700 }}
        >
          {title}
        </h1>
        {badge && <div className="flex-shrink-0">{badge}</div>}
        {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
      </div>
      {subtitle && (
        <p className="font-mono text-muted-foreground/40" style={{ fontSize: 10, letterSpacing: "0.04em", maxWidth: 600 }}>
          {subtitle}
        </p>
      )}
    </div>
  );
}
