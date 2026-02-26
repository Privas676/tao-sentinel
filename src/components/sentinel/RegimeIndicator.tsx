import { cn } from "@/lib/utils";

type Regime = "EXPANSION" | "NEUTRAL" | "COMPRESSION";

export function RegimeIndicator({ avgMpi }: { avgMpi: number }) {
  let regime: Regime;
  let color: string;
  if (avgMpi > 65) { regime = "EXPANSION"; color = "text-signal-go"; }
  else if (avgMpi < 45) { regime = "COMPRESSION"; color = "text-signal-exit"; }
  else { regime = "NEUTRAL"; color = "text-signal-hold"; }

  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-muted-foreground font-mono uppercase tracking-widest">REGIME</span>
      <span className={cn("text-xs font-bold font-mono tracking-wider", color)}>{regime}</span>
    </div>
  );
}
