import React from "react";
import { type SubnetRadarData } from "@/hooks/use-stake-analytics";
import { ammEfficiencyColor, slippageColor } from "@/lib/stake-analytics";
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from "@/components/ui/table";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";

function formatTao(v: number): string {
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}Mτ`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(0)}Kτ`;
  return `${Math.round(v)}τ`;
}

function formatBps(bps: number): string {
  if (bps <= 0) return "—";
  if (bps < 10) return `${bps.toFixed(1)}bp`;
  return `${Math.round(bps)}bp`;
}

function SignalChip({ label, color }: { label: string; color: "red" | "orange" | "green" | "blue" }) {
  const styles = {
    red: { bg: "rgba(229,57,53,0.15)", fg: "rgba(229,57,53,0.9)" },
    orange: { bg: "rgba(255,109,0,0.15)", fg: "rgba(255,109,0,0.9)" },
    green: { bg: "rgba(76,175,80,0.15)", fg: "rgba(76,175,80,0.9)" },
    blue: { bg: "rgba(100,181,246,0.15)", fg: "rgba(100,181,246,0.9)" },
  }[color];
  return (
    <span className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: styles.bg, color: styles.fg }}>
      {label}
    </span>
  );
}

const SLIPPAGE_TOOLTIP = "Slippage estimé via la formule AMM constant-product (x·y=k).\nPlus le pool est profond, plus le slippage est faible.";
const SPREAD_TOOLTIP = "Spread Bid/Ask estimé = coût aller-retour d'un micro-trade.\nReflète la liquidité réelle du pool AMM.";
const POOL_BALANCE_TOOLTIP = "Ratio TAO/Alpha dans le pool AMM.\n≈1.0 = équilibré. >>1 = excès TAO (pression acheteuse). <<1 = excès Alpha (pression vendeuse).";

export default function AMMPricingTable({ data }: { data: SubnetRadarData[] }) {
  const sorted = [...data].sort((a, b) => b.ammMetrics.ammEfficiency - a.ammMetrics.ammEfficiency);

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="font-mono text-[10px]">SN</TableHead>
            <TableHead className="font-mono text-[10px]">Nom</TableHead>
            <TableHead className="font-mono text-[10px] text-right">
              <TooltipProvider delayDuration={200}>
                <Tooltip>
                  <TooltipTrigger asChild><span className="cursor-help border-b border-dotted border-muted-foreground/30">Pool Bal.</span></TooltipTrigger>
                  <TooltipContent side="top" className="max-w-[260px] whitespace-pre-line text-[10px]">{POOL_BALANCE_TOOLTIP}</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </TableHead>
            <TableHead className="font-mono text-[10px] text-right">Depth τ</TableHead>
            <TableHead className="font-mono text-[10px] text-right">
              <TooltipProvider delayDuration={200}>
                <Tooltip>
                  <TooltipTrigger asChild><span className="cursor-help border-b border-dotted border-muted-foreground/30">Slip. 1τ</span></TooltipTrigger>
                  <TooltipContent side="top" className="max-w-[260px] whitespace-pre-line text-[10px]">{SLIPPAGE_TOOLTIP}</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </TableHead>
            <TableHead className="font-mono text-[10px] text-right">
              <TooltipProvider delayDuration={200}>
                <Tooltip>
                  <TooltipTrigger asChild><span className="cursor-help border-b border-dotted border-muted-foreground/30">Slip. 10τ</span></TooltipTrigger>
                  <TooltipContent side="top" className="max-w-[260px] whitespace-pre-line text-[10px]">{SLIPPAGE_TOOLTIP}</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </TableHead>
            <TableHead className="font-mono text-[10px] text-right">
              <TooltipProvider delayDuration={200}>
                <Tooltip>
                  <TooltipTrigger asChild><span className="cursor-help border-b border-dotted border-muted-foreground/30">Spread</span></TooltipTrigger>
                  <TooltipContent side="top" className="max-w-[260px] whitespace-pre-line text-[10px]">{SPREAD_TOOLTIP}</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </TableHead>
            <TableHead className="font-mono text-[10px] text-right">AMM Score</TableHead>
            <TableHead className="font-mono text-[10px] text-right">Signal</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.slice(0, 30).map((d) => {
            const amm = d.ammMetrics;
            return (
              <TableRow key={d.netuid}>
                <TableCell className="font-mono text-xs font-semibold text-muted-foreground">{d.netuid}</TableCell>
                <TableCell className="font-mono text-xs truncate max-w-[120px]">{d.subnetName}</TableCell>
                <TableCell className="font-mono text-xs text-right">
                  <span style={{ color: amm.poolBalance > 0.5 && amm.poolBalance < 2 ? "rgba(76,175,80,0.8)" : amm.poolBalance > 0 ? "rgba(255,193,7,0.8)" : "rgba(255,255,255,0.3)" }}>
                    {amm.poolBalance > 0 ? amm.poolBalance.toFixed(3) : "—"}
                  </span>
                </TableCell>
                <TableCell className="font-mono text-xs text-right text-muted-foreground">
                  {amm.poolDepth > 0 ? formatTao(amm.poolDepth) : "—"}
                </TableCell>
                <TableCell className="text-right">
                  <span className="font-mono text-xs" style={{ color: slippageColor(amm.slippageBps1Tao) }}>
                    {amm.slippageBps1Tao > 0 ? formatBps(amm.slippageBps1Tao) : "—"}
                  </span>
                </TableCell>
                <TableCell className="text-right">
                  <span className="font-mono text-xs" style={{ color: slippageColor(amm.slippageBps10Tao) }}>
                    {amm.slippageBps10Tao > 0 ? formatBps(amm.slippageBps10Tao) : "—"}
                  </span>
                </TableCell>
                <TableCell className="text-right">
                  <span className="font-mono text-xs" style={{ color: slippageColor(amm.spreadBps) }}>
                    {amm.spreadBps > 0 ? formatBps(amm.spreadBps) : "—"}
                  </span>
                </TableCell>
                <TableCell className="text-right">
                  <span className="font-mono text-xs font-bold" style={{ color: ammEfficiencyColor(amm.ammEfficiency) }}>
                    {amm.ammEfficiency}
                  </span>
                </TableCell>
                <TableCell className="text-right">
                  {amm.ammEfficiency >= 75 ? <SignalChip label="EFFICIENT" color="green" /> :
                   amm.ammEfficiency >= 50 ? <SignalChip label="OK" color="blue" /> :
                   amm.ammEfficiency >= 30 ? <SignalChip label="THIN" color="orange" /> :
                   amm.slippageBps1Tao > 0 ? <SignalChip label="ILLIQUID" color="red" /> :
                   <span className="font-mono text-[10px] text-muted-foreground/40">—</span>}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
