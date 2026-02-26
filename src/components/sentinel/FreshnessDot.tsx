import { cn } from "@/lib/utils";

export function FreshnessDot({ ts }: { ts: string | null }) {
  if (!ts) return <span className="h-2 w-2 rounded-full bg-signal-exit inline-block" />;
  const diffMin = (Date.now() - new Date(ts).getTime()) / 60000;
  let color: string;
  if (diffMin < 5) color = "bg-signal-go";
  else if (diffMin < 10) color = "bg-signal-go-spec";
  else color = "bg-signal-exit";

  return <span className={cn("h-2 w-2 rounded-full inline-block", color)} title={`${Math.round(diffMin)}m ago`} />;
}
