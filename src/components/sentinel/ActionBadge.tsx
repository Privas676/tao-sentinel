type ActionType = "RENTRE" | "HOLD" | "SORS" | "RENFORCER" | "ATTENDRE" | "SURVEILLER" | "SYSTEME";

interface ActionBadgeProps {
  action: ActionType;
  size?: "sm" | "md";
}

const actionMap: Record<ActionType, { icon: string; label: string; color: string; bg: string; border: string }> = {
  RENTRE:     { icon: "🟢", label: "ENTRER",     color: "hsl(145,65%,48%)",  bg: "hsla(145,65%,48%,0.06)",  border: "hsla(145,65%,48%,0.15)" },
  RENFORCER:  { icon: "⬆",  label: "RENFORCER",  color: "hsl(145,65%,55%)",  bg: "hsla(145,65%,55%,0.06)",  border: "hsla(145,65%,55%,0.15)" },
  HOLD:       { icon: "🟡", label: "ATTENDRE",   color: "hsl(38,92%,55%)",   bg: "hsla(38,92%,55%,0.06)",   border: "hsla(38,92%,55%,0.15)" },
  ATTENDRE:   { icon: "🟡", label: "ATTENDRE",   color: "hsl(38,92%,55%)",   bg: "hsla(38,92%,55%,0.06)",   border: "hsla(38,92%,55%,0.15)" },
  SURVEILLER: { icon: "👁",  label: "SURVEILLER", color: "hsl(38,60%,50%)",   bg: "hsla(38,60%,50%,0.06)",   border: "hsla(38,60%,50%,0.15)" },
  SORS:       { icon: "🔴", label: "SORTIR",     color: "hsl(4,80%,50%)",    bg: "hsla(4,80%,50%,0.06)",    border: "hsla(4,80%,50%,0.15)" },
  SYSTEME:    { icon: "🔷", label: "SYSTÈME",    color: "hsl(var(--signal-system))",  bg: "hsla(var(--signal-system), 0.06)",  border: "hsla(var(--signal-system), 0.15)" },
};

export function ActionBadge({ action, size = "md" }: ActionBadgeProps) {
  const a = actionMap[action] ?? actionMap.ATTENDRE;
  const isSm = size === "sm";
  return (
    <span
      className={`inline-flex items-center gap-1 font-mono font-bold tracking-wider rounded ${isSm ? "text-[8px] px-1.5 py-0.5" : "text-[10px] px-2.5 py-1"}`}
      style={{ background: a.bg, color: a.color, border: `1px solid ${a.border}` }}
    >
      <span style={{ fontSize: isSm ? 8 : 11 }}>{a.icon}</span>
      {a.label}
    </span>
  );
}
