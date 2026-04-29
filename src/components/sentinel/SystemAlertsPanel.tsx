/* ═══════════════════════════════════════════════════════════ */
/*   SYSTEM ALERTS PANEL (Lot 2)                                */
/*   Shows the EXACT reasons behind DATA SAFE MODE.             */
/* ═══════════════════════════════════════════════════════════ */

import type { DataTrustResult } from "@/lib/data-trust";
import { DATA_TRUST_THRESHOLDS, dataTrustLabel } from "@/lib/data-trust";
import { BREAK, WARN, GO } from "@/components/sentinel/Atoms";

const ZURICH_TZ = "Europe/Zurich";

function fmtZurich(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat("fr-CH", {
      timeZone: ZURICH_TZ,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function fmtAge(seconds: number, fr: boolean): string {
  if (seconds < 0) return fr ? "inconnu" : "unknown";
  if (seconds < 60) return `${seconds} s`;
  const min = Math.round(seconds / 60);
  if (min < 60) return `${min} min`;
  const h = Math.round(min / 60);
  return `${h} h`;
}

export function SystemAlertsPanel({
  dataTrust,
  fr,
}: {
  dataTrust: DataTrustResult;
  fr: boolean;
}) {
  const isOk = !dataTrust.isSafeMode;
  const color = isOk ? GO : dataTrust.level === "DEGRADED" ? WARN : BREAK;
  const ageLabel = fmtAge(dataTrust.worstAgeSeconds, fr);
  const thresholdMin = Math.round(DATA_TRUST_THRESHOLDS.staleMaxSeconds / 60);

  return (
    <section
      className="rounded-lg border border-border bg-card overflow-hidden"
      aria-labelledby="system-alerts-title"
      data-testid="system-alerts-panel"
    >
      <header className="px-4 py-2.5 flex items-center gap-2 border-b border-border">
        <span style={{ fontSize: 11 }}>🛡</span>
        <h2
          id="system-alerts-title"
          className="font-mono text-[10px] tracking-[0.18em] uppercase text-foreground/80"
        >
          {fr ? "Alertes système" : "System alerts"}
        </h2>
        <span
          className="ml-auto font-mono text-[9px] px-1.5 py-0.5 rounded uppercase tracking-wider"
          style={{
            color,
            background: `color-mix(in srgb, ${color} 8%, transparent)`,
            border: `1px solid color-mix(in srgb, ${color} 18%, transparent)`,
          }}
        >
          {dataTrust.level}
        </span>
      </header>

      <div className="px-4 py-3 space-y-2 font-mono text-[10px]">
        <div
          className="font-bold tracking-wider"
          style={{ color }}
        >
          {isOk
            ? (fr ? "Données fraîches — aucune alerte système" : "Fresh data — no system alert")
            : (fr ? "DATA SAFE MODE actif" : "DATA SAFE MODE active")}
        </div>

        {!isOk && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-muted-foreground">
            <Row
              label={fr ? "Source stale" : "Stale source"}
              value={dataTrust.worstSource ?? "—"}
              testid="row-source"
            />
            <Row
              label={fr ? "Âge" : "Age"}
              value={ageLabel}
              testid="row-age"
            />
            <Row
              label={fr ? "Dernière donnée" : "Last update"}
              value={`${fmtZurich(dataTrust.lastReliableUpdate)} ${ZURICH_TZ}`}
              testid="row-last"
            />
            <Row
              label={fr ? "Seuil" : "Threshold"}
              value={`${thresholdMin} min`}
              testid="row-threshold"
            />
            <Row
              label={fr ? "Niveau" : "Level"}
              value={dataTrustLabel(dataTrust.level, fr)}
              testid="row-level"
            />
            <Row
              label={fr ? "Confiance globale" : "Global confidence"}
              value={`${dataTrust.globalConfidence}%`}
              testid="row-confidence"
            />
          </div>
        )}

        {!isOk && (
          <div
            className="mt-2 rounded px-2 py-1.5"
            style={{
              background: `color-mix(in srgb, ${BREAK} 6%, transparent)`,
              border: `1px solid color-mix(in srgb, ${BREAK} 14%, transparent)`,
              color: BREAK,
            }}
            data-testid="row-impact"
          >
            <span className="font-bold tracking-wider">{fr ? "Impact :" : "Impact:"}</span>{" "}
            <span className="text-foreground/80">
              {fr
                ? "ENTRER / RENFORCER gelés. HOT NOW, pumps, risques et positions restent visibles."
                : "ENTER / ADD frozen. HOT NOW, pumps, risks and positions remain visible."}
            </span>
          </div>
        )}

        {dataTrust.reasons.length > 0 && (
          <ul className="mt-1 space-y-0.5 text-muted-foreground/80">
            {dataTrust.reasons.slice(0, 4).map((r, i) => (
              <li key={i} className="truncate">· {r}</li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function Row({ label, value, testid }: { label: string; value: string; testid?: string }) {
  return (
    <div className="flex items-center justify-between gap-3" data-testid={testid}>
      <span className="text-muted-foreground/70 uppercase tracking-wider text-[8px]">{label}</span>
      <span className="font-bold text-foreground">{value}</span>
    </div>
  );
}
