import { cn } from "@/lib/utils";

interface Props {
  flow3m: number | null;
  flow6m: number | null;
  flow15m: number | null;
}

/** Visual indicator for flow acceleration: 3m > 6m > 15m */
export function AccelIndicator({ flow3m, flow6m, flow15m }: Props) {
  const f3 = flow3m ?? 0;
  const f6 = flow6m ?? 0;
  const f15 = flow15m ?? 0;

  const full = f3 > f6 && f6 > f15;
  const partial = f3 > f6;

  return (
    <div className="flex items-center gap-0.5" title={`3m:${f3.toFixed(2)} 6m:${f6.toFixed(2)} 15m:${f15.toFixed(2)}`}>
      <div className={cn("w-1.5 h-3 rounded-sm", full ? "bg-signal-go" : partial ? "bg-signal-go-spec" : "bg-muted")} />
      <div className={cn("w-1.5 h-4 rounded-sm", full ? "bg-signal-go" : partial ? "bg-signal-go-spec" : "bg-muted")} />
      <div className={cn("w-1.5 h-5 rounded-sm", full ? "bg-signal-go" : "bg-muted")} />
    </div>
  );
}
