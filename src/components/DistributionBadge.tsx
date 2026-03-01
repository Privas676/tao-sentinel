import React from "react";
import type { FleetDistributionReport, DistributionReport } from "@/lib/distribution-monitor";

interface DistributionBadgeProps {
  report: FleetDistributionReport | null;
  className?: string;
}

function metricLine(r: DistributionReport) {
  return `${r.metric}: μ=${r.mean.toFixed(1)} σ=${r.std} p10=${r.p10} p50=${r.p50} p90=${r.p90} | >${85}:${r.pctAbove85}% <${15}:${r.pctBelow15}%`;
}

function statusLabel(report: FleetDistributionReport): { text: string; icon: string } {
  if (report.killSwitchActive) return { text: "EXTRÊME", icon: "🔴" };
  if (report.isFleetUnstable) return { text: "COMPRESSÉ", icon: "🟡" };
  return { text: "STABLE", icon: "🟢" };
}

export default function DistributionBadge({ report, className = "" }: DistributionBadgeProps) {
  if (!report) return null;

  const { text, icon } = statusLabel(report);
  const isStable = !report.isFleetUnstable;
  const isExtreme = report.killSwitchActive;

  const bg = isExtreme
    ? "rgba(229,57,53,0.10)"
    : isStable
    ? "rgba(76,175,80,0.08)"
    : "rgba(255,193,7,0.08)";
  const color = isExtreme
    ? "rgba(229,57,53,0.85)"
    : isStable
    ? "rgba(76,175,80,0.75)"
    : "rgba(255,193,7,0.75)";
  const border = isExtreme
    ? "rgba(229,57,53,0.25)"
    : isStable
    ? "rgba(76,175,80,0.2)"
    : "rgba(255,193,7,0.2)";

  const tooltip = [
    `Distribution: ${text}`,
    metricLine(report.psi),
    metricLine(report.risk),
    ...(report.reasons.length > 0 ? ["", "Flags:", ...report.reasons] : []),
  ].join("\n");

  return (
    <span
      className={`font-mono text-[8px] px-2 py-0.5 rounded cursor-help inline-flex items-center gap-1 ${
        !isStable ? "animate-pulse" : ""
      } ${className}`}
      style={{ background: bg, color, border: `1px solid ${border}` }}
      title={tooltip}
    >
      {icon} DIST: {text}
      <span className="text-[7px] opacity-60">
        p10/50/90: {report.psi.p10}/{report.psi.p50}/{report.psi.p90}
      </span>
    </span>
  );
}
