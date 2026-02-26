import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const ACTION_STYLES: Record<string, string> = {
  GO: "bg-signal-go text-primary-foreground font-bold shadow-[0_0_12px_hsl(var(--signal-go)/0.4)]",
  EARLY: "bg-signal-go-spec text-primary-foreground font-bold shadow-[0_0_12px_hsl(var(--signal-go-spec)/0.4)]",
  WATCH: "bg-signal-watch/30 text-foreground border border-signal-watch/40",
  HOLD: "bg-signal-hold/20 text-signal-hold border border-signal-hold/40",
  BREAK: "bg-signal-exit text-destructive-foreground font-bold animate-pulse-glow shadow-[0_0_12px_hsl(var(--signal-exit)/0.5)]",
};

export function ActionBadge({ state, isNew }: { state: string | null; isNew?: boolean }) {
  const label = state || "HOLD";
  return (
    <div className={cn("flex items-center gap-1.5 rounded-md px-1 -mx-1 transition-all", isNew && "animate-state-glow")}>
      <Badge className={cn("text-sm font-mono uppercase tracking-wider border-0 px-3 py-1", ACTION_STYLES[label] || ACTION_STYLES.HOLD)}>
        {label}
      </Badge>
      {isNew && (
        <span className="text-[10px] font-bold text-signal-go-spec animate-pulse">NEW</span>
      )}
    </div>
  );
}
