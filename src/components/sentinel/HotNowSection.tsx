/* ═══════════════════════════════════════════════════════════ */
/*   HOT NOW — TaoStats Price Pulse Section                    */
/*   Affiche les pumps bruts détectés (5-8 max).               */
/*   Inclut TOUS les pumps : risqués, illiquides, toxiques,    */
/*   inconnus. Le verdict prudent est dans la colonne action.  */
/* ═══════════════════════════════════════════════════════════ */

import { Link } from "react-router-dom";
import {
  selectHotNow,
  pulseTypeLabel,
  pulseSuggestedAction,
  type PulseResult,
  type PulseType,
  type PulseTradability,
} from "@/lib/pulse-detector";
import type { DataTrustResult } from "@/lib/data-trust";
import { GOLD, GO, WARN, BREAK, MUTED } from "@/components/sentinel/Atoms";

function pulseTypeColor(t: PulseType): string {
  switch (t) {
    case "PUMP_LIVE":
    case "DAILY_BREAKOUT":
      return GO;
    case "EXTREME_PUMP":
    case "WEEKLY_ROTATION":
      return GOLD;
    case "DEAD_CAT_BOUNCE":
    case "TOXIC_PUMP":
      return BREAK;
    case "ILLIQUID_PUMP":
    case "OVEREXTENDED":
      return WARN;
    default:
      return MUTED;
  }
}

function tradabilityColor(t: PulseTradability): string {
  switch (t) {
    case "TRADABLE_CANDIDATE":
      return GO;
    case "WATCH_ONLY":
    case "NEEDS_CONFIRMATION":
      return WARN;
    case "LATE_PUMP":
      return WARN;
    case "DEAD_CAT":
    case "TOXIC":
    case "AVOID":
    case "ILLIQUID":
      return BREAK;
  }
}

function fmtPct(n: number | null): string {
  if (n == null) return "—";
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(1)}%`;
}

export function HotNowSection({
  pulses,
  dataTrust,
  fr,
  limit = 8,
}: {
  pulses: Map<number, PulseResult>;
  dataTrust: DataTrustResult;
  fr: boolean;
  limit?: number;
}) {
  const hot = selectHotNow(pulses, limit);

  return (
    <section
      className="rounded-lg border border-border bg-card overflow-hidden"
      aria-labelledby="hot-now-title"
    >
      <header className="px-4 py-2.5 flex items-center gap-2 border-b border-border">
        <span style={{ fontSize: 11 }}>🔥</span>
        <h2
          id="hot-now-title"
          className="font-mono text-[10px] tracking-[0.18em] uppercase text-foreground/80"
        >
          {fr ? "Hot now — TaoStats Price Pulse" : "Hot now — TaoStats Price Pulse"}
        </h2>
        <span
          className="ml-auto font-mono text-[9px] px-1.5 py-0.5 rounded uppercase tracking-wider"
          style={{
            color: dataTrust.isSafeMode ? BREAK : GO,
            background: `color-mix(in srgb, ${dataTrust.isSafeMode ? BREAK : GO} 8%, transparent)`,
            border: `1px solid color-mix(in srgb, ${dataTrust.isSafeMode ? BREAK : GO} 18%, transparent)`,
          }}
          title={dataTrust.reasons.join(" · ") || (fr ? "Données fraîches" : "Fresh data")}
        >
          {dataTrust.level}
        </span>
      </header>

      {hot.length === 0 ? (
        <div className="px-4 py-6 font-mono text-[10px] text-muted-foreground text-center">
          {fr ? "Aucun pump détecté actuellement" : "No pump detected right now"}
        </div>
      ) : (
        <ul className="divide-y divide-border/60">
          {hot.map((p) => {
            const typeColor = pulseTypeColor(p.pulse_type);
            const tradColor = tradabilityColor(p.tradability);
            return (
              <li key={p.netuid} className="px-4 py-2.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <Link
                    to={`/subnets/${p.netuid}`}
                    className="font-mono text-[11px] font-bold text-foreground hover:underline"
                  >
                    SN-{p.netuid}
                  </Link>
                  <span className="font-mono text-[10px] text-muted-foreground truncate max-w-[160px]">
                    {p.name}
                  </span>

                  <span
                    className="font-mono text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider"
                    style={{
                      color: typeColor,
                      background: `color-mix(in srgb, ${typeColor} 8%, transparent)`,
                      border: `1px solid color-mix(in srgb, ${typeColor} 18%, transparent)`,
                    }}
                  >
                    {pulseTypeLabel(p.pulse_type, fr)}
                  </span>

                  <span
                    className="font-mono text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider"
                    style={{
                      color: tradColor,
                      background: `color-mix(in srgb, ${tradColor} 8%, transparent)`,
                      border: `1px solid color-mix(in srgb, ${tradColor} 18%, transparent)`,
                    }}
                  >
                    {pulseSuggestedAction(p, fr)}
                  </span>

                  <span className="ml-auto flex items-center gap-2 font-mono text-[10px] text-muted-foreground">
                    <span style={{ color: (p.price_change_1h ?? 0) >= 0 ? GO : BREAK }}>
                      1H {fmtPct(p.price_change_1h)}
                    </span>
                    <span style={{ color: (p.price_change_24h ?? 0) >= 0 ? GO : BREAK }}>
                      1D {fmtPct(p.price_change_24h)}
                    </span>
                    <span style={{ color: (p.price_change_7d ?? 0) >= 0 ? GO : BREAK }}>
                      7J {fmtPct(p.price_change_7d)}
                    </span>
                  </span>
                </div>
                {p.reasons.length > 0 && (
                  <div className="mt-1 font-mono text-[9px] text-muted-foreground/80 truncate">
                    {p.reasons.slice(0, 2).join(" · ")}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
