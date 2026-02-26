import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const SIGNAL_STYLES: Record<string, string> = {
  GO: "bg-signal-go text-primary-foreground",
  EARLY: "bg-signal-go-spec text-primary-foreground",
  GO_SPECULATIVE: "bg-signal-go-spec text-primary-foreground",
  HOLD: "bg-signal-hold text-primary-foreground",
  BREAK: "bg-signal-exit text-destructive-foreground animate-pulse-glow",
  EXIT_FAST: "bg-signal-exit text-destructive-foreground animate-pulse-glow",
  WATCH: "bg-signal-watch text-foreground",
  NO: "bg-signal-no text-muted-foreground",
};

const SIGNAL_LABELS: Record<string, Record<string, string>> = {
  GO: { en: "GO", fr: "ENTRER" },
  EARLY: { en: "EARLY", fr: "PRÉCOCE" },
  GO_SPECULATIVE: { en: "GO SPEC", fr: "ENTRER SPEC" },
  HOLD: { en: "HOLD", fr: "CONSERVER" },
  BREAK: { en: "BREAK", fr: "SORTIE" },
  EXIT_FAST: { en: "BREAK", fr: "SORTIE" },
  WATCH: { en: "WATCH", fr: "SURVEILLER" },
  NO: { en: "NO", fr: "AUCUN" },
};

export function SignalBadge({ state, className, lang = "en" }: { state: string | null; className?: string; lang?: string }) {
  const label = state || "NO";
  const displayLabel = SIGNAL_LABELS[label]?.[lang] || label.replace("_", " ");
  return (
    <Badge className={cn("text-xs font-mono uppercase tracking-wide border-0", SIGNAL_STYLES[label] || SIGNAL_STYLES.NO, className)}>
      {displayLabel}
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
