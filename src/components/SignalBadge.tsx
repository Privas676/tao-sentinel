import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const SIGNAL_STYLES: Record<string, string> = {
  GO: "bg-signal-go text-primary-foreground",
  GO_SPECULATIVE: "bg-signal-go-spec text-primary-foreground",
  HOLD: "bg-signal-hold text-primary-foreground",
  EXIT_FAST: "bg-signal-exit text-destructive-foreground animate-pulse-glow",
  WATCH: "bg-signal-watch text-foreground",
  NO: "bg-signal-no text-muted-foreground",
};

export function SignalBadge({ state, className }: { state: string | null; className?: string }) {
  const label = state || "NO";
  return (
    <Badge className={cn("text-xs font-mono uppercase tracking-wide border-0", SIGNAL_STYLES[label] || SIGNAL_STYLES.NO, className)}>
      {label.replace("_", " ")}
    </Badge>
  );
}

export function MinerBadge({ filter }: { filter: string | null }) {
  const styles: Record<string, string> = {
    PASS: "bg-signal-go/20 text-signal-go border-signal-go/30",
    WARN: "bg-signal-go-spec/20 text-signal-go-spec border-signal-go-spec/30",
    FAIL: "bg-signal-exit/20 text-signal-exit border-signal-exit/30",
  };
  const label = filter || "—";
  return (
    <Badge variant="outline" className={cn("text-xs font-mono", styles[label] || "")}>
      {label}
    </Badge>
  );
}
