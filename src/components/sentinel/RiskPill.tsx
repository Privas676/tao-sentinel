import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

type RiskLevel = "CLEAN" | "ATTENTION" | "STRUCTURAL";

function getRisk(q: number | null): { level: RiskLevel; color: string } {
  const quality = q ?? 50;
  if (quality >= 70) return { level: "CLEAN", color: "bg-signal-go/20 text-signal-go border-signal-go/30" };
  if (quality >= 40) return { level: "ATTENTION", color: "bg-signal-go-spec/20 text-signal-go-spec border-signal-go-spec/30" };
  return { level: "STRUCTURAL", color: "bg-signal-exit/20 text-signal-exit border-signal-exit/30" };
}

interface RiskPillProps {
  qualityScore: number | null;
  reasons?: any;
}

export function RiskPill({ qualityScore, reasons }: RiskPillProps) {
  const { level, color } = getRisk(qualityScore);
  const reasonList = Array.isArray(reasons) ? reasons : [];

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge variant="outline" className={cn("text-xs font-mono cursor-help", color)}>
          {level}
        </Badge>
      </TooltipTrigger>
      <TooltipContent side="left" className="max-w-[240px] space-y-1">
        <p className="text-xs font-semibold">Quality: {qualityScore ?? "—"}/100</p>
        {reasonList.length > 0 && (
          <div className="space-y-0.5">
            {reasonList.map((r: string, i: number) => (
              <p key={i} className="text-xs text-muted-foreground">• {r}</p>
            ))}
          </div>
        )}
      </TooltipContent>
    </Tooltip>
  );
}
