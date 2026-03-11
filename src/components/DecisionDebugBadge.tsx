/* ═══════════════════════════════════════════ */
/*   DEBUG BADGE — Hidden decision diagnostic   */
/*   Triple-click to toggle visibility.         */
/* ═══════════════════════════════════════════ */

import { useState, useCallback } from "react";
import type { SubnetDecision } from "@/lib/subnet-decision";

type Props = {
  decision: SubnetDecision;
  className?: string;
};

export default function DecisionDebugBadge({ decision, className = "" }: Props) {
  const [visible, setVisible] = useState(false);
  const [clickCount, setClickCount] = useState(0);

  const handleClick = useCallback(() => {
    setClickCount(prev => {
      const next = prev + 1;
      if (next >= 3) {
        setVisible(v => !v);
        return 0;
      }
      // Reset after 600ms of inactivity
      setTimeout(() => setClickCount(0), 600);
      return next;
    });
  }, []);

  if (!visible) {
    return (
      <span
        onClick={handleClick}
        className={`inline-block w-3 h-3 rounded-full cursor-default opacity-10 hover:opacity-30 transition-opacity ${className}`}
        style={{ background: "hsl(var(--muted-foreground))" }}
        title="Triple-click for debug"
      />
    );
  }

  const rawColor = decision.rawSignal === "opportunity" ? "hsl(142,70%,45%)" : decision.rawSignal === "exit" ? "hsl(4,80%,55%)" : "hsl(45,80%,55%)";
  const faColor = decision.finalAction === "ENTRER" ? "hsl(142,70%,45%)" : decision.finalAction === "SORTIR" ? "hsl(4,80%,55%)" : decision.finalAction === "SYSTÈME" ? "hsl(210,60%,50%)" : "hsl(45,80%,55%)";

  return (
    <div
      onClick={handleClick}
      className={`inline-flex flex-col gap-0.5 rounded-lg px-2.5 py-1.5 font-mono text-[8px] cursor-pointer border border-border bg-card/80 backdrop-blur ${className}`}
      style={{ boxShadow: "0 2px 8px hsla(0,0%,0%,0.3)" }}
    >
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground tracking-widest uppercase">Signal</span>
        <span className="font-bold" style={{ color: rawColor }}>{decision.rawSignal}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground tracking-widest uppercase">Bloqué</span>
        <span className="font-bold" style={{ color: decision.isBlocked ? "hsl(4,80%,55%)" : "hsl(142,70%,45%)" }}>
          {decision.isBlocked ? "OUI" : "NON"}
        </span>
      </div>
      {decision.blockReasons.length > 0 && (
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground tracking-widest uppercase">Raisons</span>
          <span className="text-foreground/60 truncate" style={{ maxWidth: 180 }}>
            {decision.blockReasons.slice(0, 2).join(", ")}
          </span>
        </div>
      )}
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground tracking-widest uppercase">Final</span>
        <span className="font-bold" style={{ color: faColor }}>{decision.finalAction}</span>
      </div>
    </div>
  );
}
