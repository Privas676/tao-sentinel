import React from "react";

interface DegradedModeBadgeProps {
  degradedCount: number;
  totalCount: number;
  className?: string;
}

/**
 * Shows a discreet badge when the decision engine is in degraded mode
 * (market data from fallback source due to Taostats 429).
 */
export default function DegradedModeBadge({ degradedCount, totalCount, className = "" }: DegradedModeBadgeProps) {
  if (degradedCount === 0 || totalCount === 0) return null;

  const pct = Math.round((degradedCount / totalCount) * 100);
  if (pct < 30) return null; // Only show if significant portion is degraded

  return (
    <span
      className={`font-mono text-[8px] px-2 py-0.5 rounded cursor-help ${className}`}
      style={{
        background: "rgba(255,152,0,0.08)",
        color: "rgba(255,152,0,0.80)",
        border: "1px solid rgba(255,152,0,0.20)",
      }}
      title={`${degradedCount}/${totalCount} subnets utilisent des données marché de secours (TaoFlute fallback). Les verdicts sont prudents mais fiables pour les cas critiques confirmés.`}
    >
      📡 Données marché limitées
    </span>
  );
}
