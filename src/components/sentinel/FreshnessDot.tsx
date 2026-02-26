import { cn } from "@/lib/utils";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";

export function FreshnessDot({ ts }: { ts: string | null }) {
  if (!ts) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="h-2 w-2 rounded-full bg-signal-exit inline-block cursor-help" />
        </TooltipTrigger>
        <TooltipContent side="top" className="font-mono text-xs">
          No data
        </TooltipContent>
      </Tooltip>
    );
  }

  const date = new Date(ts);
  const diffMin = (Date.now() - date.getTime()) / 60000;
  let color: string;
  if (diffMin < 5) color = "bg-signal-go";
  else if (diffMin < 10) color = "bg-signal-go-spec";
  else color = "bg-signal-exit";

  const formatted = date.toLocaleString("de-CH", {
    timeZone: "Europe/Zurich",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn("h-2 w-2 rounded-full inline-block cursor-help", color)} />
      </TooltipTrigger>
      <TooltipContent side="top" className="font-mono text-xs">
        {formatted} ({Math.round(diffMin)}m ago)
      </TooltipContent>
    </Tooltip>
  );
}
