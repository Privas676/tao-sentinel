import { useSubnetScores } from "@/hooks/use-subnet-scores";
import { APP_VERSION, BUILD_TAG } from "@/lib/version";
import { SectionCard, SectionTitle } from "@/components/settings/SettingsShared";

/* ═══════════════════════════════════════════════════════ */
/*   SYSTEM DIAGNOSTICS — Global health at a glance        */
/* ═══════════════════════════════════════════════════════ */

const GO = "hsl(var(--signal-go))";
const WARN = "hsl(var(--signal-go-spec))";
const BREAK = "hsl(var(--signal-break))";
const MUTED = "hsl(var(--muted-foreground))";

function freshnessColor(ageSeconds: number) {
  if (ageSeconds < 120) return GO;
  if (ageSeconds < 300) return WARN;
  return BREAK;
}

function freshnessLabel(ageSeconds: number, fr: boolean) {
  if (ageSeconds < 120) return fr ? "En temps réel" : "Real-time";
  if (ageSeconds < 300) return fr ? "Récent" : "Recent";
  return fr ? "Obsolète" : "Stale";
}

function formatAge(seconds: number, fr: boolean) {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}${fr ? " min" : "m"}`;
  return `${Math.round(seconds / 3600)}h`;
}

function alignmentLabel(status: string, fr: boolean) {
  switch (status) {
    case "SYNCED": return fr ? "Synchronisé" : "Synced";
    case "DEGRADED": return fr ? "Dégradé" : "Degraded";
    case "STALE": return fr ? "Obsolète" : "Stale";
    default: return status;
  }
}

function alignmentColor(status: string) {
  switch (status) {
    case "SYNCED": return GO;
    case "DEGRADED": return WARN;
    case "STALE": return BREAK;
    default: return MUTED;
  }
}

function DiagRow({ label, value, color, sub }: { label: string; value: string; color?: string; sub?: string }) {
  return (
    <div className="flex items-center justify-between py-2.5 px-5 border-b border-border last:border-0">
      <span className="font-mono text-[10px] text-muted-foreground">{label}</span>
      <div className="text-right">
        <span className="font-mono text-[10px] font-bold" style={{ color: color || "hsl(var(--foreground))" }}>
          {value}
        </span>
        {sub && (
          <div className="font-mono text-[8px] text-muted-foreground/50 mt-0.5">{sub}</div>
        )}
      </div>
    </div>
  );
}

export default function SystemDiagnostics({ fr }: { fr: boolean }) {
  const {
    scoresList,
    scoreTimestamp,
    taoUsd,
    isLoading,
    dataAlignment,
    dataAgeDebug,
    dataConfidence,
  } = useSubnetScores();

  const now = Date.now();
  const tsDate = scoreTimestamp ? new Date(scoreTimestamp) : null;
  const lastSyncAge = tsDate ? Math.round((now - tsDate.getTime()) / 1000) : null;

  // Engine status
  const subnetCount = scoresList.length;
  const overrideCount = scoresList.filter(s => s.isOverridden).length;
  const warningCount = scoresList.filter(s => s.isWarning && !s.isOverridden).length;
  const engineRunning = !isLoading && subnetCount > 0;

  // Global confidence
  const confScore = dataConfidence?.score ?? null;
  const confColor = confScore !== null
    ? confScore >= 70 ? GO : confScore >= 40 ? WARN : BREAK
    : MUTED;

  // Last sync formatted
  const lastSyncFormatted = tsDate
    ? tsDate.toLocaleTimeString(fr ? "fr-FR" : "en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : "—";

  return (
    <SectionCard>
      <SectionTitle icon="🔬" title={fr ? "Diagnostic système" : "System diagnostics"} />

      <DiagRow
        label={fr ? "Statut moteur" : "Engine status"}
        value={isLoading ? (fr ? "Chargement…" : "Loading…") : engineRunning ? "RUNNING" : "OFFLINE"}
        color={isLoading ? MUTED : engineRunning ? GO : BREAK}
        sub={engineRunning ? `${subnetCount} subnets · ${overrideCount} overrides · ${warningCount} warnings` : undefined}
      />

      <DiagRow
        label={fr ? "Dernier sync" : "Last sync"}
        value={lastSyncFormatted}
        color={lastSyncAge !== null ? freshnessColor(lastSyncAge) : MUTED}
        sub={lastSyncAge !== null ? `${formatAge(lastSyncAge, fr)} ${fr ? "il y a" : "ago"}` : undefined}
      />

      <DiagRow
        label={fr ? "Alignement données" : "Data alignment"}
        value={alignmentLabel(dataAlignment, fr)}
        color={alignmentColor(dataAlignment)}
      />

      <DiagRow
        label={fr ? "Confiance globale" : "Global confidence"}
        value={confScore !== null ? `${confScore}%` : "N/A"}
        color={confColor}
        sub={dataConfidence?.reasons?.length ? dataConfidence.reasons.slice(0, 2).join(" · ") : undefined}
      />

      <DiagRow
        label="TAO/USD"
        value={taoUsd ? `$${taoUsd.toFixed(2)}` : "—"}
        color={taoUsd ? "hsl(var(--foreground))" : MUTED}
      />

      {/* Per-source freshness */}
      {dataAgeDebug.length > 0 && (
        <div className="px-5 py-2 border-b border-border last:border-0">
          <div className="font-mono text-[9px] text-muted-foreground/60 mb-1.5 tracking-wider uppercase">
            {fr ? "Fraîcheur par source" : "Per-source freshness"}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {dataAgeDebug.map(d => (
              <div key={d.source} className="flex items-center gap-1.5">
                <span
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ background: freshnessColor(d.ageSeconds) }}
                />
                <span className="font-mono text-[9px] text-muted-foreground/70">{d.source}</span>
                <span
                  className="font-mono text-[9px] font-bold"
                  style={{ color: freshnessColor(d.ageSeconds) }}
                >
                  {formatAge(d.ageSeconds, fr)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Confidence breakdown */}
      {dataConfidence?.components && (
        <div className="px-5 py-2 border-b border-border last:border-0">
          <div className="font-mono text-[9px] text-muted-foreground/60 mb-1.5 tracking-wider uppercase">
            {fr ? "Composantes confiance" : "Confidence breakdown"}
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1">
            {Object.entries(dataConfidence.components).map(([key, val]) => (
              <div key={key} className="flex items-center justify-between">
                <span className="font-mono text-[9px] text-muted-foreground/70 capitalize">{key.replace(/([A-Z])/g, " $1").trim()}</span>
                <span
                  className="font-mono text-[9px] font-bold"
                  style={{ color: (val as number) >= 70 ? GO : (val as number) >= 40 ? WARN : BREAK }}
                >
                  {val as number}%
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <DiagRow
        label="Build"
        value={`${APP_VERSION} · ${BUILD_TAG}`}
        color={MUTED}
      />
    </SectionCard>
  );
}
