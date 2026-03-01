import React from "react";

interface DataAlignmentBadgeProps {
  dataAlignment: string;
  dataAgeDebug: { source: string; ageSeconds: number }[];
  className?: string;
}

export default function DataAlignmentBadge({ dataAlignment, dataAgeDebug = [], className = "" }: DataAlignmentBadgeProps) {
  if (!dataAlignment || dataAlignment === "ALIGNED") return null;

  const isStale = dataAlignment === "STALE";

  return (
    <span
      className={`font-mono text-[8px] px-2 py-0.5 rounded animate-pulse cursor-help ${className}`}
      style={{
        background: isStale ? "rgba(229,57,53,0.10)" : "rgba(255,193,7,0.08)",
        color: isStale ? "rgba(229,57,53,0.85)" : "rgba(255,193,7,0.75)",
        border: `1px solid ${isStale ? "rgba(229,57,53,0.25)" : "rgba(255,193,7,0.2)"}`,
      }}
      title={`Data ${dataAlignment} — ${dataAgeDebug.map(d => `${d.source}: ${d.ageSeconds}s`).join(", ")}`}
    >
      {isStale ? "⚠ STALE" : "⏳ DEGRADED"}
    </span>
  );
}
