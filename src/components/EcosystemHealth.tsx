import { Card, CardContent } from "@/components/ui/card";
import { useLanguage } from "@/i18n/LanguageContext";
import { cn } from "@/lib/utils";

interface Props {
  signals: Array<{ state: string | null }>;
}

export function EcosystemHealth({ signals }: Props) {
  const { t } = useLanguage();

  const total = signals.length || 1;
  const goCount = signals.filter((s) => s.state === "GO" || s.state === "GO_SPECULATIVE").length;
  const breakCount = signals.filter((s) => s.state === "BREAK").length;
  const goPercent = Math.round((goCount / total) * 100);
  const breakPercent = Math.round((breakCount / total) * 100);

  // Phase determination
  let phase: "expansion" | "neutral" | "riskOff";
  let phaseColor: string;
  if (goPercent >= 20 && breakPercent < 10) {
    phase = "expansion";
    phaseColor = "text-signal-go";
  } else if (breakPercent >= 15) {
    phase = "riskOff";
    phaseColor = "text-signal-exit";
  } else {
    phase = "neutral";
    phaseColor = "text-signal-hold";
  }

  return (
    <Card className="border-border bg-card/50">
      <CardContent className="p-4 flex items-center gap-6 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground font-mono">{t("eco.title")}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">{t("eco.goPercent")}:</span>
          <span className="text-sm font-mono font-bold text-signal-go">{goPercent}%</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">{t("eco.breakPercent")}:</span>
          <span className="text-sm font-mono font-bold text-signal-exit">{breakPercent}%</span>
        </div>
        <div className="flex items-center gap-1.5 ml-auto">
          <span className="text-xs text-muted-foreground">{t("eco.phase")}:</span>
          <span className={cn("text-sm font-bold font-mono uppercase", phaseColor)}>
            {t(`eco.${phase}` as any)}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
