import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  change?: number | null;
}

export function LiqIndicator({ change }: Props) {
  if (change == null) return <Minus className="h-3.5 w-3.5 text-muted-foreground" />;

  if (change > 1) {
    return <TrendingUp className="h-3.5 w-3.5 text-signal-go" />;
  } else if (change < -3) {
    return <TrendingDown className="h-3.5 w-3.5 text-signal-exit" />;
  } else {
    return <Minus className="h-3.5 w-3.5 text-signal-hold" />;
  }
}
