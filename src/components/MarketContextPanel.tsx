/* ═══════════════════════════════════════ */
/*   MARKET CONTEXT (TMC) — Informational   */
/*   Does NOT affect scoring or alerts      */
/* ═══════════════════════════════════════ */

import { type SourceMetrics } from "@/lib/data-fusion";

type Props = {
  netuid: number;
  name: string;
  tmc: SourceMetrics | undefined;
  onClose: () => void;
};

function minutesAgo(ts: string | null): string {
  if (!ts) return "—";
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "< 1m";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export default function MarketContextPanel({ netuid, name, tmc, onClose }: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/70" />
      <div
        className="relative rounded-xl p-5 font-mono text-[11px] max-w-sm w-full mx-4 space-y-4"
        style={{
          background: "rgba(10,10,14,0.98)",
          border: "1px solid rgba(100,181,246,0.15)",
          boxShadow: "0 8px 40px rgba(0,0,0,0.8)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex justify-between items-center mb-3">
          <h3 className="text-white/90 text-sm font-bold tracking-wider">
            📊 MARKET CONTEXT — SN-{netuid} {name}
          </h3>
          <button
            onClick={onClose}
            className="text-white/30 hover:text-white/60 text-lg"
          >
            ✕
          </button>
        </div>

        {/* Source label */}
        <div className="flex items-center gap-2">
          <span
            className="font-mono text-[8px] px-2 py-0.5 rounded font-bold tracking-wider"
            style={{
              background: "rgba(100,181,246,0.08)",
              color: "rgba(100,181,246,0.7)",
              border: "1px solid rgba(100,181,246,0.15)",
            }}
          >
            TaoMarketCap
          </span>
          {tmc?.ts && (
            <span className="text-white/20 text-[9px]">
              ⏱ {minutesAgo(tmc.ts)} ago
            </span>
          )}
        </div>

        {/* Data or unavailable */}
        {!tmc ? (
          <div
            className="text-center py-6 rounded-lg"
            style={{
              background: "rgba(255,255,255,0.02)",
              border: "1px dashed rgba(255,255,255,0.08)",
            }}
          >
            <div className="text-white/30 text-sm">TMC unavailable</div>
            <div className="text-white/15 text-[9px] mt-1">
              No market context data for this subnet
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <Row label="Prix (TMC)" value={tmc.price != null ? `${tmc.price.toFixed(6)} τ` : "—"} />
            <Row label="Volume 24h (TMC)" value={tmc.vol24h != null ? formatTao(tmc.vol24h) : "—"} />
            <Row label="Market Cap (TMC)" value={tmc.cap != null ? formatTao(tmc.cap) : "—"} />
            <Row label="Liquidité (TMC)" value={tmc.liquidity != null ? formatTao(tmc.liquidity) : "—"} />
          </div>
        )}

        {/* Disclaimer */}
        <div
          className="text-[8px] tracking-wider px-3 py-2 rounded-md"
          style={{
            background: "rgba(100,181,246,0.04)",
            color: "rgba(100,181,246,0.4)",
            border: "1px solid rgba(100,181,246,0.08)",
          }}
        >
          ℹ Info only — does not affect risk score
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-center py-1.5 border-b border-white/[0.04]">
      <span className="text-white/40">{label}</span>
      <span className="text-white/70 font-bold">{value}</span>
    </div>
  );
}

function formatTao(v: number): string {
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M τ`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K τ`;
  return `${v.toFixed(2)} τ`;
}
