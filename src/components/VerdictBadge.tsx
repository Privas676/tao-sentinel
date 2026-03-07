/* ═══════════════════════════════════════ */
/*   VERDICT BADGE COMPONENT                 */
/*   Displays RENTRE / HOLD / SORS badge     */
/*   with confidence and tooltip reasons     */
/* ═══════════════════════════════════════ */

import type { Verdict, ConfidenceLevel } from "@/lib/verdict-engine";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

/* ── Colors ── */

export function verdictColor(v: Verdict): string {
  switch (v) {
    case "RENTRE": return "rgba(76,175,80,0.9)";
    case "HOLD": return "rgba(255,193,7,0.85)";
    case "SORS": return "rgba(229,57,53,0.9)";
  }
}

export function verdictBg(v: Verdict): string {
  switch (v) {
    case "RENTRE": return "rgba(76,175,80,0.08)";
    case "HOLD": return "rgba(255,193,7,0.06)";
    case "SORS": return "rgba(229,57,53,0.08)";
  }
}

export function verdictBorder(v: Verdict): string {
  switch (v) {
    case "RENTRE": return "rgba(76,175,80,0.25)";
    case "HOLD": return "rgba(255,193,7,0.2)";
    case "SORS": return "rgba(229,57,53,0.25)";
  }
}

export function verdictIcon(v: Verdict): string {
  switch (v) {
    case "RENTRE": return "🟢";
    case "HOLD": return "🟡";
    case "SORS": return "🔴";
  }
}

function confidenceColor(c: ConfidenceLevel): string {
  switch (c) {
    case "forte": return "rgba(76,175,80,0.7)";
    case "moyenne": return "rgba(255,193,7,0.65)";
    case "faible": return "rgba(255,255,255,0.3)";
  }
}

/* ── Badge (compact, for table cells) ── */

export function VerdictBadge({ verdict, confidence, size = "sm" }: {
  verdict: Verdict;
  confidence: ConfidenceLevel;
  size?: "sm" | "md";
}) {
  const fontSize = size === "md" ? "text-[11px]" : "text-[9px]";
  const py = size === "md" ? "py-1" : "py-0.5";
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 ${py} rounded font-mono font-bold tracking-wider whitespace-nowrap ${fontSize}`}
      style={{
        color: verdictColor(verdict),
        background: verdictBg(verdict),
        border: `1px solid ${verdictBorder(verdict)}`,
      }}
    >
      {verdictIcon(verdict)} {verdict}
      <span className="font-normal text-[7px] tracking-normal" style={{ color: confidenceColor(confidence), opacity: 0.8 }}>
        {confidence}
      </span>
    </span>
  );
}

/* ── Badge with tooltip (reasons) ── */

export function VerdictBadgeWithTooltip({ verdict, confidence, positiveReasons, negativeReasons, entryScore, holdScore, exitRisk, size = "sm" }: {
  verdict: Verdict;
  confidence: ConfidenceLevel;
  positiveReasons: string[];
  negativeReasons: string[];
  entryScore: number;
  holdScore: number;
  exitRisk: number;
  size?: "sm" | "md";
}) {
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="cursor-help">
            <VerdictBadge verdict={verdict} confidence={confidence} size={size} />
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="font-mono text-[10px] max-w-[280px]">
          <div className="space-y-2">
            <div className="flex items-center gap-2 font-bold text-[11px]" style={{ color: verdictColor(verdict) }}>
              {verdictIcon(verdict)} {verdict} — confiance {confidence}
            </div>

            {/* Sub-scores */}
            <div className="grid grid-cols-3 gap-2 py-1 border-y border-white/10">
              <div className="text-center">
                <div className="text-[8px] text-white/30 tracking-widest">ENTRY</div>
                <div className="font-bold" style={{ color: entryScore >= 70 ? "rgba(76,175,80,0.9)" : entryScore >= 50 ? "rgba(255,193,7,0.8)" : "rgba(255,255,255,0.4)" }}>{entryScore}</div>
              </div>
              <div className="text-center">
                <div className="text-[8px] text-white/30 tracking-widest">HOLD</div>
                <div className="font-bold" style={{ color: holdScore >= 60 ? "rgba(76,175,80,0.9)" : holdScore >= 40 ? "rgba(255,193,7,0.8)" : "rgba(255,255,255,0.4)" }}>{holdScore}</div>
              </div>
              <div className="text-center">
                <div className="text-[8px] text-white/30 tracking-widest">EXIT RISK</div>
                <div className="font-bold" style={{ color: exitRisk >= 60 ? "rgba(229,57,53,0.9)" : exitRisk >= 40 ? "rgba(255,193,7,0.8)" : "rgba(76,175,80,0.7)" }}>{exitRisk}</div>
              </div>
            </div>

            {/* Positive reasons */}
            {positiveReasons.length > 0 && (
              <div>
                {positiveReasons.map((r, i) => (
                  <div key={i} className="text-[9px]" style={{ color: "rgba(76,175,80,0.8)" }}>✓ {r}</div>
                ))}
              </div>
            )}

            {/* Negative reasons */}
            {negativeReasons.length > 0 && (
              <div>
                {negativeReasons.map((r, i) => (
                  <div key={i} className="text-[9px]" style={{ color: "rgba(229,57,53,0.8)" }}>✗ {r}</div>
                ))}
              </div>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/* ── Compact verdict row for Dashboard lists ── */

export function VerdictRow({ netuid, name, verdict, confidence, mainScore, positiveReasons, negativeReasons, onClick }: {
  netuid: number;
  name: string;
  verdict: Verdict;
  confidence: ConfidenceLevel;
  mainScore: number;
  positiveReasons: string[];
  negativeReasons: string[];
  onClick?: () => void;
}) {
  const reasons = verdict === "SORS" ? negativeReasons : positiveReasons;
  const mainReason = reasons[0] || "";
  return (
    <div
      onClick={onClick}
      className="flex items-center gap-2 py-2 px-3 rounded-lg cursor-pointer transition-all hover:bg-white/[0.03]"
      style={{ borderBottom: "1px solid rgba(255,255,255,0.03)" }}
    >
      <span className="font-mono font-bold text-[11px]" style={{ color: "rgba(255,248,220,0.75)", width: 55 }}>SN-{netuid}</span>
      <span className="font-mono text-[10px] truncate flex-1" style={{ color: "rgba(255,255,255,0.35)" }}>{name}</span>
      <VerdictBadge verdict={verdict} confidence={confidence} />
      {mainReason && (
        <span className="font-mono text-[8px] truncate max-w-[120px]" style={{ color: "rgba(255,255,255,0.25)" }}>{mainReason}</span>
      )}
      <span className="font-mono text-[11px] font-bold w-7 text-right" style={{ color: verdictColor(verdict) }}>{mainScore}</span>
    </div>
  );
}
