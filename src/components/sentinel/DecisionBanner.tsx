type DecisionType = "offensive" | "neutral" | "defensive";

interface DecisionBannerProps {
  type: DecisionType;
  icon?: string;
  title: string;
  subtitle?: string;
}

const decisionStyles: Record<DecisionType, { bg: string; border: string; color: string; shadow: string }> = {
  offensive:  { bg: "hsla(145,65%,48%,0.06)", border: "hsla(145,65%,48%,0.15)", color: "hsl(145,65%,48%)", shadow: "0 0 24px hsla(145,65%,48%,0.08)" },
  neutral:    { bg: "hsla(38,92%,55%,0.06)",  border: "hsla(38,92%,55%,0.15)",  color: "hsl(38,92%,55%)",  shadow: "0 0 24px hsla(38,92%,55%,0.08)" },
  defensive:  { bg: "hsla(4,80%,50%,0.06)",   border: "hsla(4,80%,50%,0.15)",   color: "hsl(4,80%,50%)",   shadow: "0 0 24px hsla(4,80%,50%,0.08)" },
};

const defaultIcons: Record<DecisionType, string> = {
  offensive: "🟢",
  neutral: "🟡",
  defensive: "🔴",
};

export function DecisionBanner({ type, icon, title, subtitle }: DecisionBannerProps) {
  const s = decisionStyles[type];
  return (
    <div
      className="flex items-center gap-3 rounded-xl px-5 py-3"
      style={{ background: s.bg, border: `1.5px solid ${s.border}`, boxShadow: s.shadow }}
    >
      <span style={{ fontSize: 18 }}>{icon ?? defaultIcons[type]}</span>
      <div>
        {subtitle && (
          <div className="font-mono text-[7px] tracking-[0.15em] uppercase text-muted-foreground/30">{subtitle}</div>
        )}
        <div className="font-mono font-bold tracking-[0.15em]" style={{ color: s.color, fontSize: 14 }}>
          {title}
        </div>
      </div>
    </div>
  );
}
