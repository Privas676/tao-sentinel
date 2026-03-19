/* ═══════════════════════════════════════════════════════ */
/*   EARLY PUMP BADGE — Visual tag for pump detection     */
/* ═══════════════════════════════════════════════════════ */

import type { EarlyPumpTag } from "@/lib/early-pump-detector";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const TAG_CONFIG: Record<Exclude<EarlyPumpTag, null>, { icon: string; label: string; color: string; bg: string; border: string }> = {
  EARLY_PUMP_CANDIDATE: {
    icon: "🚀",
    label: "EARLY PUMP",
    color: "hsl(280, 80%, 65%)",
    bg: "hsla(280, 80%, 65%, 0.08)",
    border: "hsla(280, 80%, 65%, 0.20)",
  },
  EARLY_PUMP_WATCH: {
    icon: "👁",
    label: "PUMP WATCH",
    color: "hsl(38, 80%, 55%)",
    bg: "hsla(38, 80%, 55%, 0.08)",
    border: "hsla(38, 80%, 55%, 0.20)",
  },
  LATE_PUMP: {
    icon: "🔥",
    label: "LATE PUMP",
    color: "hsl(25, 90%, 55%)",
    bg: "hsla(25, 90%, 55%, 0.08)",
    border: "hsla(25, 90%, 55%, 0.20)",
  },
  OVEREXTENDED: {
    icon: "⚠️",
    label: "OVEREXTENDED",
    color: "hsl(4, 80%, 55%)",
    bg: "hsla(4, 80%, 55%, 0.08)",
    border: "hsla(4, 80%, 55%, 0.20)",
  },
};

type EarlyPumpBadgeProps = {
  tag: EarlyPumpTag;
  score?: number;
  size?: "sm" | "md";
  showScore?: boolean;
  reasons?: string[];
};

export function EarlyPumpBadge({ tag, score, size = "sm", showScore = false, reasons }: EarlyPumpBadgeProps) {
  if (!tag) return null;
  const cfg = TAG_CONFIG[tag];
  const isSm = size === "sm";

  const badge = (
    <span
      className={`inline-flex items-center gap-0.5 font-mono font-bold tracking-wider rounded ${isSm ? "text-[7px] px-1.5 py-0.5" : "text-[9px] px-2 py-0.5"}`}
      style={{ background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.border}` }}
    >
      <span style={{ fontSize: isSm ? 7 : 9 }}>{cfg.icon}</span>
      {cfg.label}
      {showScore && score != null && <span className="opacity-70 ml-0.5">{score}</span>}
    </span>
  );

  if (!reasons?.length) return badge;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{badge}</TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-[300px]">
        <div className="space-y-1">
          <div className="font-mono text-[10px] font-bold" style={{ color: cfg.color }}>{cfg.icon} {cfg.label} — Score: {score}/100</div>
          {reasons.slice(0, 5).map((r, i) => (
            <div key={i} className="font-mono text-[9px] text-muted-foreground">• {r}</div>
          ))}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
